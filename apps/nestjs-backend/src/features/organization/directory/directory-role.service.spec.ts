import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  directorySaveRoleRoSchema,
  directoryPreviewRoleRoSchema,
  directorySaveMemberRolesRoSchema,
} from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuditScope } from '../../audit/audit-scope';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import type { DirectoryRoleHistoryService } from './directory-role-history.service';
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
      count: vi.fn().mockImplementation(async ({ where }) => where.id.in.length),
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
      findFirst: vi.fn().mockResolvedValue({
        id: 'member',
        connectionId: 'conn',
        inactiveTime: null,
        user: {
          deletedTime: null,
          deactivatedTime: null,
          permanentDeletedTime: null,
          isSystem: false,
        },
        externalRoleIds: [],
        memberships: [{ departmentId: 'child' }],
      }),
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'member',
          name: 'Employee',
          externalId: 'dt-member',
          inactiveTime: null,
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
  const history = { record: vi.fn() };
  return {
    tx,
    audit,
    history,
    service: new DirectoryRoleService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditScope,
      history as unknown as DirectoryRoleHistoryService
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
  it('matches a specified employee without requiring any department or source role', () => {
    const match = compileDirectoryRoleRules([{ type: 'member', memberId: 'member' }], []);
    expect(match({ memberId: 'member', departmentIds: [], externalRoleIds: [] })).toBe(true);
    expect(match({ memberId: 'other', departmentIds: [], externalRoleIds: [] })).toBe(false);
    expect(match({ departmentIds: [], externalRoleIds: [] })).toBe(false);
    const mixed = compileDirectoryRoleRules(
      [{ type: 'member', memberId: 'member' }, ...role.rules],
      nodes
    );
    expect(mixed({ memberId: 'other', departmentIds: ['child'], externalRoleIds: [] })).toBe(true);
  });
  it('persists specified people only from the same active enterprise directory', async () => {
    const { service, tx, audit } = fixture();
    const rules = [{ type: 'member' as const, memberId: 'member' }];
    tx.directoryBusinessRole.create.mockResolvedValue({ ...role, rules });
    expect((await service.save({ ...input, rules })).rules).toEqual(rules);
    expect(tx.directoryMember.count).toHaveBeenCalledWith({
      where: { connectionId: 'conn', inactiveTime: null, id: { in: ['member'] } },
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ rules }),
      })
    );
    tx.directoryMember.count.mockResolvedValue(0);
    tx.directoryBusinessRole.create.mockClear();
    await expect(service.save({ ...input, rules })).rejects.toThrow('Active employee not found');
    expect(tx.directoryBusinessRole.create).not.toHaveBeenCalled();
  });
  it('can disable a role with departed specified people without revalidating them', async () => {
    const { service, tx } = fixture();
    await service.save({ ...input, enabled: false, rules: [{ type: 'member', memberId: 'gone' }] });
    expect(tx.directoryMember.count).not.toHaveBeenCalled();
  });
  it('uses the same specified identity in previews and live permission resolution', async () => {
    const { service, tx } = fixture();
    const directRole = { ...role, rules: [{ type: 'member', memberId: 'member' }] };
    tx.directoryBusinessRole.findFirst.mockResolvedValue(directRole);
    tx.directoryMember.findMany.mockResolvedValue([
      {
        id: 'member',
        userId: 'user',
        connectionId: 'conn',
        user: { id: 'user', name: 'Local', email: 'local@example.com' },
        externalRoleIds: [],
        memberships: [],
        connection: { businessRoles: [directRole], departments: [] },
      },
    ]);
    expect(
      (await service.members({ corpId: 'corp', roleId: 'role', skip: 0, take: 50 })).total
    ).toBe(1);
    expect(await service.resolveForUser('user')).toEqual([
      { roleId: 'role', connectionId: 'conn', name: 'Finance' },
    ]);
    directRole.rules = [];
    expect(await service.resolveForUser('user')).toEqual([]);
  });
  it('rejects repeated, oversized and malformed specified-person rules', () => {
    const member = { type: 'member', memberId: 'member' };
    expect(directorySaveRoleRoSchema.safeParse({ ...input, rules: [member] }).success).toBe(true);
    expect(directorySaveRoleRoSchema.safeParse({ ...input, rules: [member, member] }).success).toBe(
      false
    );
    expect(
      directorySaveRoleRoSchema.safeParse({ ...input, rules: [{ ...member, memberId: '' }] })
        .success
    ).toBe(false);
    expect(
      directorySaveRoleRoSchema.safeParse({ ...input, rules: [{ ...member, userId: 'user' }] })
        .success
    ).toBe(false);
    expect(
      directorySaveRoleRoSchema.safeParse({
        ...input,
        rules: Array.from({ length: 101 }, (_, i) => ({ ...member, memberId: String(i) })),
      }).success
    ).toBe(false);
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
  it('returns all membership sources and suppresses inactive identity grants', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.findMany.mockResolvedValue([
      {
        ...role,
        rules: [
          ...role.rules,
          { type: 'member', memberId: 'member' },
          { type: 'externalRole', externalRoleId: 'external' },
        ],
      },
    ]);
    tx.directoryMember.findFirst.mockResolvedValue({
      id: 'member',
      inactiveTime: null,
      user: {
        deletedTime: null,
        deactivatedTime: null,
        permanentDeletedTime: null,
        isSystem: false,
      },
      memberships: [{ departmentId: 'child' }],
      externalRoleIds: ['external'],
    });
    const ro = { corpId: 'corp', memberId: 'member' };
    const result = await service.memberRoles(ro);
    expect(result.roles[0].sources).toEqual(['member', 'department', 'externalRole']);
    expect(result.roles[0].effective).toBe(true);
    expect(tx.directoryMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId: 'conn', id: 'member' },
      })
    );
    tx.directoryMember.findFirst.mockResolvedValue({
      id: 'member',
      inactiveTime: null,
      user: null,
      memberships: [{ departmentId: 'child' }],
      externalRoleIds: [],
    });
    expect((await service.memberRoles(ro)).roles[0].effective).toBe(false);
    tx.directoryMember.findFirst.mockResolvedValue(null);
    await expect(service.memberRoles(ro)).rejects.toThrow('Employee not found');
  });
  it('prevalidates every role in a batch before writing any changes', async () => {
    const { service, tx, audit } = fixture();
    tx.directoryBusinessRole.findFirst
      .mockResolvedValueOnce(role)
      .mockResolvedValueOnce({ ...role, id: 'other', version: 3 });
    await expect(
      service.saveMemberRoles({
        corpId: 'corp',
        memberId: 'member',
        assignments: [
          { roleId: 'role', expectedVersion: 1, assigned: true },
          { roleId: 'other', expectedVersion: 2, assigned: true },
        ],
      })
    ).rejects.toThrow('Role changed');
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
  it('saves multiple roles together and preserves inherited rules on removal', async () => {
    const { service, tx, audit } = fixture();
    tx.directoryBusinessRole.findFirst
      .mockResolvedValueOnce({
        ...role,
        rules: [
          ...role.rules,
          { type: 'member', memberId: 'member' },
          { type: 'member', memberId: 'someone-else' },
        ],
      })
      .mockResolvedValueOnce({ ...role, id: 'other', rules: [] });
    const result = await service.saveMemberRoles({
      corpId: 'corp',
      memberId: 'member',
      assignments: [
        { roleId: 'role', expectedVersion: 1, assigned: false },
        { roleId: 'other', expectedVersion: 1, assigned: true },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].rules).toEqual([...role.rules, { type: 'member', memberId: 'someone-else' }]);
    expect(result[1].rules).toEqual([{ type: 'member', memberId: 'member' }]);
    expect(tx.directoryBusinessRole.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.directoryBusinessRole.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other', connectionId: 'conn', version: 1 },
      })
    );
    expect(audit.emitAtomic).toHaveBeenCalledTimes(2);
  });
  it('rejects a foreign role in the batch and never creates or overwrites it', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.findFirst.mockResolvedValue(null);
    await expect(
      service.saveMemberRoles({
        corpId: 'corp',
        memberId: 'member',
        assignments: [{ roleId: 'foreign', expectedVersion: 1, assigned: true }],
      })
    ).rejects.toThrow('Role changed');
    expect(tx.directoryBusinessRole.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', connectionId: 'conn' },
    });
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
  });
  it('honors sync locks and refuses to add inactive employees', async () => {
    const { service, tx } = fixture();
    const ro = {
      corpId: 'corp',
      memberId: 'member',
      assignments: [{ roleId: 'role', expectedVersion: 1, assigned: true }],
    };
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.saveMemberRoles(ro)).rejects.toThrow('already running');
    tx.$queryRaw.mockResolvedValue([{ acquired: true }]);
    tx.directoryMember.findFirst.mockResolvedValue({
      id: 'member',
      inactiveTime: new Date(),
      user: null,
      memberships: [],
      externalRoleIds: [],
    });
    await expect(service.saveMemberRoles(ro)).rejects.toThrow('Active employee not found');
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
  });
  it('refuses a rule overflow instead of partially saving a batch', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.findFirst.mockResolvedValue({
      ...role,
      rules: Array.from({ length: 100 }, (_, i) => ({
        type: 'externalRole',
        externalRoleId: String(i),
      })),
    });
    await expect(
      service.saveMemberRoles({
        corpId: 'corp',
        memberId: 'member',
        assignments: [{ roleId: 'role', expectedVersion: 1, assigned: true }],
      })
    ).rejects.toThrow('Role rule limit exceeded');
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
  });
  it('previews direct removal retained by department and pending unbound members', async () => {
    const { service, tx } = fixture();
    tx.directoryBusinessRole.findFirst.mockResolvedValue({
      ...role,
      rules: [...role.rules, { type: 'member', memberId: 'member' }],
    });
    const rows = await tx.directoryMember.findMany();
    tx.directoryMember.findMany.mockResolvedValue([
      ...rows,
      { ...rows[0], id: 'unbound', user: null, userId: null },
    ]);
    const preview = await service.preview({
      ...input,
      roleId: 'role',
      expectedVersion: 1,
      skip: 0,
      take: 50,
    });
    expect(preview).toEqual({
      before: 1,
      after: 1,
      counts: { added: 0, removed: 0, retained: 1, pending: 1 },
      total: 2,
      members: [
        { memberId: 'member', name: 'Employee', externalId: 'dt-member', change: 'retained' },
        { memberId: 'unbound', name: 'Employee', externalId: 'dt-member', change: 'pending' },
      ],
    });
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
  });
  it('previews additions, complete removal and pagination without mutating roles', async () => {
    const { service, tx } = fixture();
    const ro = { ...input, roleId: 'role', expectedVersion: 1, skip: 0, take: 50 };
    const disabled = await service.preview({ ...ro, enabled: false });
    expect(disabled.before).toBe(1);
    expect(disabled.after).toBe(0);
    expect(disabled.counts.removed).toBe(1);
    tx.directoryBusinessRole.findFirst.mockResolvedValue({ ...role, rules: [] });
    const added = await service.preview(ro);
    expect(added.counts.added).toBe(1);
    expect((await service.preview({ ...ro, skip: 1 })).members).toEqual([]);
    tx.directoryBusinessRole.findFirst.mockResolvedValue(role);
    await expect(service.preview({ ...ro, expectedVersion: 9 })).rejects.toThrow('Role changed');
    expect(tx.directoryBusinessRole.updateMany).not.toHaveBeenCalled();
  });
  it('does not count inactive or system accounts as effective in the preview', async () => {
    const { service, tx } = fixture();
    const rows = await tx.directoryMember.findMany();
    for (const state of [
      { isSystem: true },
      { deletedTime: new Date() },
      { deactivatedTime: new Date() },
      { permanentDeletedTime: new Date() },
    ]) {
      tx.directoryMember.findMany.mockResolvedValue([
        { ...rows[0], user: { ...rows[0].user, ...state } },
      ]);
      const result = await service.preview({
        ...input,
        roleId: 'role',
        expectedVersion: 1,
        skip: 0,
        take: 50,
      });
      expect(result.before).toBe(0);
      expect(result.after).toBe(0);
      expect(result.counts.pending).toBe(1);
    }
  });
  it('validates strict batch and draft contracts', () => {
    const ro = {
      corpId: 'corp',
      memberId: 'member',
      assignments: [{ roleId: 'role', expectedVersion: 1, assigned: true }],
    };
    expect(directorySaveMemberRolesRoSchema.safeParse(ro).success).toBe(true);
    expect(
      directorySaveMemberRolesRoSchema.safeParse({
        ...ro,
        assignments: [...ro.assignments, ...ro.assignments],
      }).success
    ).toBe(false);
    expect(directorySaveMemberRolesRoSchema.safeParse({ ...ro, assignments: [] }).success).toBe(
      false
    );
    expect(
      directorySaveMemberRolesRoSchema.safeParse({
        ...ro,
        assignments: [{ ...ro.assignments[0], expectedVersion: 0 }],
      }).success
    ).toBe(false);
    expect(
      directorySaveMemberRolesRoSchema.safeParse({ ...ro, permissions: ['table|delete'] }).success
    ).toBe(false);
    expect(directoryPreviewRoleRoSchema.safeParse({ ...input, skip: -1 }).success).toBe(false);
    expect(directoryPreviewRoleRoSchema.safeParse({ ...input, take: 101 }).success).toBe(false);
    expect(
      directoryPreviewRoleRoSchema.safeParse({ ...input, roleId: 'role', expectedVersion: 0 })
        .success
    ).toBe(false);
  });
  it('revalidates bulk additions under the sync lock even for disabled roles', async () => {
    const { service, tx, history } = fixture();
    tx.directoryMember.count.mockResolvedValue(0);
    await expect(service.save({ ...input, enabled: false }, ['departed'])).rejects.toThrow(
      'Active employee not found'
    );
    expect(tx.directoryBusinessRole.create).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });
  it('propagates history persistence failure to roll back the business transaction', async () => {
    const { service, history } = fixture();
    history.record.mockRejectedValue(new Error('history persistence failed'));
    await expect(service.save(input)).rejects.toThrow('history persistence failed');
  });
});
