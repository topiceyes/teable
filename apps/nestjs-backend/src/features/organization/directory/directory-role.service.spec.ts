import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { directorySaveRoleRoSchema } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuditScope } from '../../audit/audit-scope';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { compileDirectoryRoleRules } from './directory-role-matcher';
import { DirectoryRoleController } from './directory-role.controller';
import { DirectoryRoleService } from './directory-role.service';

const nodes = [
  { id: 'root', externalId: '1', name: 'Company', parentExternalId: null },
  { id: 'child', externalId: '2', name: 'Child', parentExternalId: '1' },
];
const role = {
  id: 'role',
  name: 'Finance',
  enabled: true,
  version: 1,
  rules: [{ type: 'department' as const, departmentId: 'root', includeDescendants: true }],
};
const input = {
  corpId: 'corp',
  expectedVersion: 0,
  name: 'Finance',
  enabled: true,
  rules: role.rules,
};
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    directoryConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'conn', enabled: true }) },
    directoryDepartment: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue(nodes),
    },
    directoryBusinessRole: {
      create: vi.fn().mockResolvedValue(role),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(role),
      findFirstOrThrow: vi.fn().mockResolvedValue({ ...role, version: 2 }),
      findMany: vi.fn().mockResolvedValue([role]),
    },
    directoryMember: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'member',
          userId: 'user',
          connectionId: 'conn',
          user: { id: 'user', name: 'Local', email: 'local@example.com' },
          externalRoleIds: [],
          memberships: [{ departmentId: 'child' }],
          connection: { businessRoles: [role], departments: nodes },
        },
      ]),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const audit = { emitAtomic: vi.fn() };
  return {
    tx,
    audit,
    service: new DirectoryRoleService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditScope
    ),
  };
}
describe('business role mappings', () => {
  it('requires explicit descendant selection and exact source role IDs', () => {
    const member = { departmentIds: ['child'], externalRoleIds: [] };
    expect(
      compileDirectoryRoleRules(
        [{ type: 'department', departmentId: 'root', includeDescendants: false }],
        nodes
      )(member)
    ).toBe(false);
    expect(compileDirectoryRoleRules(role.rules, nodes)(member)).toBe(true);
    const match = compileDirectoryRoleRules(
      [{ type: 'externalRole', externalRoleId: 'source-role' }],
      nodes
    );
    expect(match({ ...member, externalRoleIds: ['other'] })).toBe(false);
    expect(match({ ...member, externalRoleIds: ['source-role'] })).toBe(true);
  });
  it('does not match removed departments or empty rules', () => {
    expect(
      compileDirectoryRoleRules(
        role.rules,
        nodes.slice(1)
      )({ departmentIds: ['child'], externalRoleIds: [] })
    ).toBe(false);
    expect(
      compileDirectoryRoleRules([], nodes)({ departmentIds: ['root'], externalRoleIds: [] })
    ).toBe(false);
  });
  it('requires administrator privileges for role configuration and previews', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, DirectoryRoleController)).toEqual([
      'instance|update',
    ]);
  });
  it('creates a scoped role with a canonical name key and audits it', async () => {
    const { service, tx, audit } = fixture();
    await service.save(input);
    expect(tx.directoryBusinessRole.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        connectionId: 'conn',
        nameKey: 'finance',
        rules: role.rules,
      }),
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.directory.role.save' })
    );
  });
  it('rejects foreign and inactive department rules', async () => {
    const { service, tx } = fixture();
    tx.directoryDepartment.count.mockResolvedValue(0);
    await expect(service.save(input)).rejects.toThrow('Active department not found');
    expect(tx.directoryBusinessRole.create).not.toHaveBeenCalled();
    expect(tx.directoryDepartment.count).toHaveBeenCalledWith({
      where: { connectionId: 'conn', inactiveTime: null, id: { in: ['root'] } },
    });
  });
  it('rejects stale role revisions and scopes every update to its connection', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save({ ...input, roleId: 'role', expectedVersion: 1 })).rejects.toThrow(
      'Role changed'
    );
    expect(tx.directoryBusinessRole.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'role', connectionId: 'conn', version: 1 } })
    );
  });
  it('allows disabling stale department mappings without reactivating them', async () => {
    const { service, tx } = fixture();
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'conn', enabled: false });
    await service.save({ ...input, roleId: 'role', expectedVersion: 1, enabled: false });
    expect(tx.directoryDepartment.count).not.toHaveBeenCalled();
    expect(tx.directoryBusinessRole.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: false }) })
    );
  });
  it('rejects concurrent writes and duplicate normalized role names', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.save(input)).rejects.toThrow('already running');
    tx.$queryRaw.mockResolvedValue([{ acquired: true }]);
    tx.directoryBusinessRole.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.save(input)).rejects.toThrow('Role name already exists');
  });
  it('previews deduplicated active linked members with stable pagination', async () => {
    const { service } = fixture();
    expect(await service.members({ corpId: 'corp', roleId: 'role', skip: 0, take: 50 })).toEqual({
      total: 1,
      members: [{ memberId: 'member', userId: 'user', name: 'Local', email: 'local@example.com' }],
    });
    expect(await service.members({ corpId: 'corp', roleId: 'role', skip: 1, take: 50 })).toEqual({
      total: 1,
      members: [],
    });
  });
  it('removes membership when a role or connection is disabled', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.findFirst.mockResolvedValue({ ...role, enabled: false });
    expect(
      (await service.members({ corpId: 'corp', roleId: 'role', skip: 0, take: 50 })).total
    ).toBe(0);
    tx.directoryBusinessRole.findFirst.mockResolvedValue(role);
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'conn', enabled: false });
    expect(
      (await service.members({ corpId: 'corp', roleId: 'role', skip: 0, take: 50 })).total
    ).toBe(0);
    expect(tx.directoryMember.findMany).not.toHaveBeenCalled();
  });
  it('resolves live identities and immediately drops unlinked members', async () => {
    const { service, tx } = fixture();
    expect(await service.resolveForUser('user')).toEqual([
      { roleId: 'role', connectionId: 'conn', name: 'Finance' },
    ]);
    expect(tx.directoryMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user',
          inactiveTime: null,
          connection: { enabled: true },
          user: expect.objectContaining({
            deletedTime: null,
            deactivatedTime: null,
            permanentDeletedTime: null,
          }),
        }),
      })
    );
    tx.directoryMember.findMany.mockResolvedValue([]);
    expect(await service.resolveForUser('user')).toEqual([]);
  });
  it('rejects duplicate rules, unsupported grant fields, and invalid revisions', () => {
    expect(
      directorySaveRoleRoSchema.safeParse({ ...input, rules: [role.rules[0], role.rules[0]] })
        .success
    ).toBe(false);
    expect(
      directorySaveRoleRoSchema.safeParse({ ...input, permissions: ['table|delete'] }).success
    ).toBe(false);
    expect(directorySaveRoleRoSchema.safeParse({ ...input, expectedVersion: 1 }).success).toBe(
      false
    );
  });
});
