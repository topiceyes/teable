import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  directoryRoleRosterRoSchema,
  directoryChecksRoSchema,
  directorySetRolePeopleRoSchema,
} from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { DirectoryRoleChecksController } from '../authority-matrix/directory-role-checks.controller';
import { DirectoryRoleChecksService } from '../authority-matrix/directory-role-checks.service';
import type { TableAuthorityPreviewService } from '../authority-matrix/table-authority-preview.service';
import { DirectoryRoleHistoryService } from './directory-role-history.service';
import { DirectoryRoleToolsController } from './directory-role-tools.controller';
import { DirectoryRoleToolsService } from './directory-role-tools.service';
import type { DirectoryRoleService } from './directory-role.service';

const user = {
  id: 'u',
  name: 'User',
  email: 'u@example.invalid',
  isAdmin: false,
  isSystem: false,
  deletedTime: null,
  deactivatedTime: null,
  permanentDeletedTime: null,
};
const department = { id: 'dep', externalId: '1', name: 'Finance', parentExternalId: null };
const rules = [
  { type: 'department' as const, departmentId: 'dep', includeDescendants: false },
  { type: 'member' as const, memberId: 'bound' },
  { type: 'member' as const, memberId: 'unbound' },
];
const role = {
  id: 'role',
  connectionId: 'conn',
  name: 'Finance',
  enabled: true,
  version: 2,
  rules,
};
const bound = {
  id: 'bound',
  connectionId: 'conn',
  externalId: 'dt-bound',
  name: 'Bound',
  email: null,
  inactiveTime: null,
  userId: 'u',
  user,
  externalRoleIds: [],
  memberships: [{ departmentId: 'dep', department: { id: 'dep', name: 'Finance' } }],
};
function fixture() {
  const tx = {
    directoryConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'conn', enabled: true }) },
    directoryDepartment: { findMany: vi.fn().mockResolvedValue([department]) },
    directoryMember: {
      findMany: vi.fn().mockResolvedValue([
        bound,
        {
          ...bound,
          id: 'unbound',
          externalId: 'dt-unbound',
          name: 'Unbound',
          userId: null,
          user: null,
        },
        {
          ...bound,
          id: 'other',
          externalId: 'dt-other',
          name: 'Other',
          memberships: [],
          externalRoleIds: [],
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    directoryBusinessRole: {
      findMany: vi.fn().mockResolvedValue([role]),
      findFirst: vi.fn().mockResolvedValue(role),
    },
    directoryRoleHistory: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    tableAuthorityPolicy: {
      findMany: vi.fn().mockResolvedValue([
        {
          policy: {
            version: 1,
            enabled: true,
            rules: [{ roleId: 'role', tableId: 'tbl', actions: ['table|read', 'record|read'] }],
          },
          base: { id: 'base', name: 'Base' },
        },
      ]),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaService;
  const roles = { save: vi.fn().mockResolvedValue(role) };
  const preview = { baseAccess: vi.fn().mockResolvedValue([]) };
  const cls = { get: vi.fn().mockReturnValue({ id: 'admin', name: 'Admin' }) };
  return {
    tx,
    prisma,
    roles,
    preview,
    cls,
    service: new DirectoryRoleToolsService(prisma, roles as unknown as DirectoryRoleService),
    checks: new DirectoryRoleChecksService(
      prisma,
      preview as unknown as TableAuthorityPreviewService
    ),
    history: new DirectoryRoleHistoryService(prisma, cls as unknown as ClsService<IClsStore>),
  };
}
describe('directory role tools', () => {
  it('scopes all roster rows to the enterprise and filters sources, bindings and departments', async () => {
    const { service, tx } = fixture();
    const result = await service.roster(
      directoryRoleRosterRoSchema.parse({
        corpId: 'corp',
        roleId: 'role',
        departmentId: 'dep',
        binding: 'unbound',
        source: 'member',
      })
    );
    expect(result.total).toBe(1);
    expect(result.members[0].id).toBe('unbound');
    expect(result.members[0].effective).toBe(false);
    expect(result.counts).toEqual({ effective: 1, unbound: 1, matched: 2 });
    expect(tx.directoryMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { connectionId: 'conn' } })
    );
    expect(result.members[0].sources).toEqual(['member', 'department']);
  });
  it('supports all-employee candidates and stable pagination independently of role counts', async () => {
    const { service } = fixture();
    const result = await service.roster(
      directoryRoleRosterRoSchema.parse({
        corpId: 'corp',
        roleId: 'role',
        scope: 'all',
        skip: 2,
        take: 1,
      })
    );
    expect(result.total).toBe(3);
    expect(result.members.map((member) => member.id)).toEqual(['other']);
    expect(result.counts.effective).toBe(1);
    const search = await service.roster(
      directoryRoleRosterRoSchema.parse({
        corpId: 'corp',
        roleId: 'role',
        scope: 'all',
        search: 'ＤＴ－ＢＯＵＮＤ',
      })
    );
    expect(search.members.map((member) => member.id)).toEqual(['bound']);
  });
  it('deduplicates inherited and direct counts and excludes disabled or inactive identities', async () => {
    const { service, tx } = fixture();
    expect(await service.counts('corp')).toEqual([{ roleId: 'role', effective: 1, unbound: 1 }]);
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'conn', enabled: false });
    expect((await service.counts('corp'))[0].effective).toBe(0);
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'conn', enabled: true });
    tx.directoryMember.findMany.mockResolvedValue([
      { ...bound, user: { ...user, isSystem: true } },
    ]);
    expect((await service.counts('corp'))[0].effective).toBe(0);
  });
  it('bulk removal preserves inherited and other employee rules and uses the original revision', async () => {
    const { service, roles } = fixture();
    await service.setPeople({
      corpId: 'corp',
      roleId: 'role',
      expectedVersion: 2,
      memberIds: ['bound'],
      assigned: false,
    });
    expect(roles.save).toHaveBeenCalledWith({
      corpId: 'corp',
      roleId: 'role',
      expectedVersion: 2,
      name: 'Finance',
      enabled: true,
      rules: [rules[0], rules[2]],
    });
  });
  it('rejects stale revisions, foreign employees and rule overflow before saving', async () => {
    const { service, tx, roles } = fixture();
    const ro = {
      corpId: 'corp',
      roleId: 'role',
      expectedVersion: 2,
      memberIds: ['new'],
      assigned: true,
    };
    await expect(service.setPeople({ ...ro, expectedVersion: 1 })).rejects.toThrow('Role changed');
    tx.directoryMember.count.mockResolvedValue(0);
    await expect(service.setPeople(ro)).rejects.toThrow('Active employee not found');
    expect(tx.directoryMember.count).toHaveBeenCalledWith({
      where: { connectionId: 'conn', id: { in: ['new'] }, inactiveTime: null },
    });
    tx.directoryMember.count.mockResolvedValue(1);
    tx.directoryBusinessRole.findFirst.mockResolvedValue({
      ...role,
      rules: Array.from({ length: 100 }, (_, i) => ({
        type: 'externalRole',
        externalRoleId: String(i),
      })),
    });
    await expect(service.setPeople(ro)).rejects.toThrow('Role rule limit exceeded');
    expect(roles.save).not.toHaveBeenCalled();
  });
  it('reports inactive, missing, unbound identities and invalid departments', async () => {
    const { checks, tx } = fixture();
    tx.directoryMember.findMany.mockResolvedValue([
      { ...bound, id: 'bound', inactiveTime: new Date() },
      { ...bound, id: 'unbound', userId: null, user: null },
      { ...bound, id: 'suspended', user: { ...user, deactivatedTime: new Date() } },
    ]);
    tx.directoryBusinessRole.findMany.mockResolvedValue([
      {
        ...role,
        rules: [
          ...rules,
          { type: 'member', memberId: 'missing' },
          { type: 'member', memberId: 'suspended' },
          { type: 'department', departmentId: 'gone', includeDescendants: true },
        ],
      },
    ]);
    const result = await checks.check(directoryChecksRoSchema.parse({ corpId: 'corp' }));
    expect(result.issues.map((issue) => issue.kind).sort()).toEqual(
      [
        'inactiveAccount',
        'inactiveMember',
        'invalidDepartment',
        'missingMember',
        'unboundMember',
      ].sort()
    );
  });
  it('uses actual account permissions for missing base access and avoids unrelated role warnings', async () => {
    const { checks, preview } = fixture();
    const result = await checks.check(
      directoryChecksRoSchema.parse({ corpId: 'corp', kind: 'noBaseAccess' })
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'noBaseAccess',
        memberId: 'bound',
        roleId: 'role',
        baseId: 'base',
      }),
    ]);
    expect(preview.baseAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'u' }), 'base');
    preview.baseAccess.mockResolvedValue(['base|read']);
    expect(
      (await checks.check(directoryChecksRoSchema.parse({ corpId: 'corp', kind: 'noBaseAccess' })))
        .total
    ).toBe(0);
  });
  it('labels disabled connections and skips base access simulation when filtered or disabled', async () => {
    const { checks, tx, preview } = fixture();
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'conn', enabled: false });
    const result = await checks.check(directoryChecksRoSchema.parse({ corpId: 'corp' }));
    expect(result.connectionEnabled).toBe(false);
    expect(result.issues.map((issue) => issue.kind)).toEqual(['unboundMember']);
    expect(preview.baseAccess).not.toHaveBeenCalled();
  });
  it('persists actor and snapshots using the caller transaction, and fails if the history write fails', async () => {
    const { history, tx } = fixture();
    const snapshot = { id: 'role', name: 'Finance', enabled: true, version: 2, rules };
    await history.record(tx as never, null, snapshot);
    expect(tx.directoryRoleHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roleId: 'role',
        actorId: 'admin',
        actorName: 'Admin',
        after: snapshot,
      }),
    });
    expect(tx.directoryRoleHistory.create.mock.calls[0][0].data).not.toHaveProperty('before');
    tx.directoryRoleHistory.create.mockRejectedValue(new Error('history unavailable'));
    await expect(
      history.record(tx as never, snapshot, { ...snapshot, version: 3 })
    ).rejects.toThrow('history unavailable');
  });
  it('scopes history reads to the enterprise and preserves snapshot actor names', async () => {
    const { history, tx } = fixture();
    const snapshot = { id: 'role', name: 'Finance', enabled: true, version: 2, rules };
    tx.directoryRoleHistory.findMany.mockResolvedValue([
      {
        id: 'entry',
        before: null,
        after: snapshot,
        actorId: 'admin',
        actorName: 'Original name',
        createdTime: new Date('2026-11-11T00:00:00Z'),
      },
    ]);
    const result = await history.list({ corpId: 'corp', roleId: 'role', skip: 0, take: 20 });
    expect(result.entries[0].actor.name).toBe('Original name');
    expect(tx.directoryBusinessRole.findFirst).toHaveBeenCalledWith({
      where: { id: 'role', connection: { provider: 'dingtalk', tenantId: 'corp' } },
      select: { id: true },
    });
    tx.directoryBusinessRole.findFirst.mockResolvedValue(null);
    await expect(
      history.list({ corpId: 'corp', roleId: 'foreign', skip: 0, take: 20 })
    ).rejects.toThrow('Business role not found');
  });
  it('requires administrator permissions for roster/history/checks and rejects unbounded malformed batches', () => {
    for (const controller of [DirectoryRoleToolsController, DirectoryRoleChecksController])
      expect(new Reflector().get(PERMISSIONS_KEY, controller)).toEqual(['instance|update']);
    const ro = {
      corpId: 'corp',
      roleId: 'role',
      expectedVersion: 2,
      memberIds: ['person'],
      assigned: true,
    };
    for (const patch of [
      { memberIds: [] },
      { memberIds: ['a', 'a'] },
      { memberIds: Array.from({ length: 101 }, (_, i) => String(i)) },
      { expectedVersion: 0 },
      { permissions: ['record|delete'] },
    ])
      expect(directorySetRolePeopleRoSchema.safeParse({ ...ro, ...patch }).success).toBe(false);
    expect(directoryChecksRoSchema.safeParse({ corpId: 'corp', take: 101 }).success).toBe(false);
    expect(
      directoryRoleRosterRoSchema.safeParse({ corpId: 'corp', roleId: 'role', binding: 'invalid' })
        .success
    ).toBe(false);
  });
});
