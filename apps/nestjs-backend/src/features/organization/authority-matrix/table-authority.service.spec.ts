import { Reflector } from '@nestjs/core';
import type { Action } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import type { AuditScope } from '../../audit/audit-scope';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import type { DirectoryRoleService } from '../directory/directory-role.service';
import { TableAuthorityController } from './table-authority.controller';
import { TableAuthorityService } from './table-authority.service';

const policy = {
  version: 1 as const,
  enabled: true,
  rules: [
    {
      roleId: 'finance',
      tableId: 'table',
      actions: ['table|read', 'record|read', 'record|update'] as (
        | 'table|read'
        | 'record|read'
        | 'record|update'
      )[],
    },
  ],
};
const input = { baseId: 'base', connectionId: 'connection', expectedRevision: 0, policy };
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    base: { findFirst: vi.fn().mockResolvedValue({ id: 'base' }) },
    tableMeta: { count: vi.fn().mockResolvedValue(1) },
    directoryConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'connection' }) },
    directoryBusinessRole: { count: vi.fn().mockResolvedValue(1) },
    tableAuthorityPolicy: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ baseId: 'base', connectionId: 'connection', revision: 1, policy }),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const values: Record<string, unknown> = { ['user.id']: 'user' };
  const cls = { get: vi.fn((key: string) => values[key]) };
  const roles = {
    resolveForUser: vi
      .fn()
      .mockResolvedValue([{ roleId: 'finance', connectionId: 'connection', name: 'Finance' }]),
  };
  const audit = { emitAtomic: vi.fn() };
  const service = new TableAuthorityService(
    prisma as unknown as PrismaService,
    cls as unknown as ClsService<IClsStore>,
    roles as unknown as DirectoryRoleService,
    audit as unknown as AuditScope
  );
  return { tx, values, roles, audit, service };
}
describe('table authority policy persistence and resolution', () => {
  it('protects read, options, and write endpoints with instance administration', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, TableAuthorityController)).toEqual([
      'instance|update',
    ]);
  });
  it('returns a disabled initial policy without creating anything', async () => {
    const { service, tx } = fixture();
    tx.tableAuthorityPolicy.findUnique.mockResolvedValue(null);
    expect(await service.get('base')).toEqual({
      baseId: 'base',
      connectionId: null,
      revision: 0,
      policy: { version: 1, enabled: false, rules: [] },
    });
    expect(tx.tableAuthorityPolicy.create).not.toHaveBeenCalled();
  });
  it('includes the enterprise identifier for inline role management without exposing credentials', async () => {
    const { service, tx } = fixture();
    const connections = vi.fn().mockResolvedValue([
      {
        id: 'connection',
        name: 'Company',
        tenantId: 'corp',
        businessRoles: [{ id: 'finance', name: 'Finance' }],
      },
    ]);
    const tables = vi.fn().mockResolvedValue([{ id: 'table', name: 'Invoices', fields: [] }]);
    Object.assign(tx.directoryConnection, { findMany: connections });
    Object.assign(tx.tableMeta, { findMany: tables });
    expect(await service.options('base')).toEqual({
      connections: [
        {
          id: 'connection',
          name: 'Company',
          corpId: 'corp',
          roles: [{ id: 'finance', name: 'Finance' }],
        },
      ],
      tables: [{ id: 'table', name: 'Invoices', fields: [] }],
    });
    const select = connections.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('encryptedAppSecret');
    expect(select).not.toHaveProperty('appKey');
    expect(connections.mock.calls[0][0].where).toEqual({ enabled: true });
  });
  it('validates live base, enterprise roles and table scope before saving', async () => {
    const { service, tx, audit } = fixture();
    expect((await service.save(input)).revision).toBe(1);
    expect(tx.tableMeta.count).toHaveBeenCalledWith({
      where: { id: { in: ['table'] }, baseId: 'base', deletedTime: null },
    });
    expect(tx.directoryBusinessRole.count).toHaveBeenCalledWith({
      where: { id: { in: ['finance'] }, connectionId: 'connection', enabled: true },
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'base.authority-matrix.update', resourceId: 'base' })
    );
  });
  it('validates role scope references even when they grant no actions', async () => {
    const { service, tx } = fixture();
    Object.assign(tx, {
      field: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'primary', type: 'singleLineText', isPrimary: true },
          { id: 'creator', type: 'createdBy', isPrimary: false },
        ]),
      },
    });
    const scope = {
      roleId: 'manager',
      rowScope: 'department' as const,
      hiddenFieldIds: [],
      readOnlyFieldIds: [],
    };
    const restriction = {
      tableId: 'table',
      rowScope: 'own' as const,
      hiddenFieldIds: [],
      readOnlyFieldIds: [],
      roleOverrides: [scope],
    };
    const inputWithScope = {
      ...input,
      policy: { ...policy, rules: [], restrictions: [restriction] },
    };
    await service.save(inputWithScope);
    expect(tx.directoryBusinessRole.count).toHaveBeenCalledWith({
      where: { id: { in: ['manager'] }, connectionId: 'connection', enabled: true },
    });
    tx.directoryBusinessRole.count.mockResolvedValue(0);
    await expect(service.save(inputWithScope)).rejects.toThrow('unavailable in this scope');
  });
  it.each([
    { hiddenFieldIds: ['foreign'], message: 'field is unavailable' },
    { hiddenFieldIds: ['primary'], message: 'Primary field cannot' },
  ])(
    'rejects invalid fields inside a role override: $message',
    async ({ hiddenFieldIds, message }) => {
      const { service, tx } = fixture();
      Object.assign(tx, {
        field: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'primary', type: 'singleLineText', isPrimary: true }]),
        },
      });
      await expect(
        service.save({
          ...input,
          policy: {
            ...policy,
            restrictions: [
              {
                tableId: 'table',
                rowScope: 'all',
                hiddenFieldIds: [],
                readOnlyFieldIds: [],
                roleOverrides: [
                  { roleId: 'finance', rowScope: 'all', hiddenFieldIds, readOnlyFieldIds: [] },
                ],
              },
            ],
          },
        })
      ).rejects.toThrow(message);
    }
  );
  it('requires creator fields for role-specific row scopes and permits disabling stale role scopes', async () => {
    const { service, tx } = fixture();
    Object.assign(tx, { field: { findMany: vi.fn().mockResolvedValue([]) } });
    const next = {
      ...input,
      policy: {
        ...policy,
        restrictions: [
          {
            tableId: 'table',
            rowScope: 'all' as const,
            hiddenFieldIds: [],
            readOnlyFieldIds: [],
            roleOverrides: [
              {
                roleId: 'finance',
                rowScope: 'own' as const,
                hiddenFieldIds: [],
                readOnlyFieldIds: [],
              },
            ],
          },
        ],
      },
    };
    await expect(service.save(next)).rejects.toThrow('Created By');
    tx.directoryBusinessRole.count.mockClear();
    await service.save({ ...next, policy: { ...next.policy, enabled: false } });
    expect(tx.directoryBusinessRole.count).not.toHaveBeenCalled();
  });
  it('rejects foreign or deleted tables and foreign business roles', async () => {
    for (const model of ['tableMeta', 'directoryBusinessRole'] as const) {
      const { service, tx } = fixture();
      tx[model].count.mockResolvedValue(0);
      await expect(service.save(input)).rejects.toThrow('unavailable in this scope');
      expect(tx.tableAuthorityPolicy.create).not.toHaveBeenCalled();
    }
  });
  it('rejects stale revisions and concurrent edits without overwriting a policy', async () => {
    const { service, tx } = fixture();
    tx.tableAuthorityPolicy.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save({ ...input, expectedRevision: 1 })).rejects.toThrow('Policy changed');
    expect(tx.tableAuthorityPolicy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { baseId: 'base', revision: 1 } })
    );
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.save(input)).rejects.toThrow('already running');
  });
  it('allows disabling a policy with obsolete rules', async () => {
    const { service, tx } = fixture();
    await service.save({ ...input, policy: { ...policy, enabled: false }, expectedRevision: 1 });
    expect(tx.tableMeta.count).not.toHaveBeenCalled();
    expect(tx.directoryBusinessRole.count).not.toHaveBeenCalled();
  });
  it('handles simultaneous first saves as conflicts', async () => {
    const { service, tx } = fixture();
    tx.tableAuthorityPolicy.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.save(input)).rejects.toThrow('Policy changed');
  });
  it('adds grants only from live roles in the configured enterprise', async () => {
    const { service, roles } = fixture();
    const existing: Action[] = ['record|read'];
    expect(await service.apply('base', 'table', existing)).toContain('record|update');
    roles.resolveForUser.mockResolvedValue([
      { roleId: 'finance', connectionId: 'other', name: 'Finance' },
    ]);
    expect(await service.apply('base', 'table', existing)).toEqual(existing);
    roles.resolveForUser.mockResolvedValue([]);
    expect(await service.apply('base', 'table', existing)).toEqual(existing);
  });
  it('never amplifies shared, template or internal-token permissions', async () => {
    for (const key of ['shareViewId', 'baseShare', 'template', 'tempAuthBaseId']) {
      const { service, values, roles, tx } = fixture();
      values[key] = 'present';
      expect(await service.apply('base', 'table', ['record|read'])).toEqual(['record|read']);
      expect(roles.resolveForUser).not.toHaveBeenCalled();
      expect(tx.tableAuthorityPolicy.findUnique).not.toHaveBeenCalled();
    }
  });
  it('does not grant for another table, disabled policy, or invalid stored policy', async () => {
    const { service, tx } = fixture();
    expect(await service.apply('base', 'other', [])).toEqual([]);
    for (const value of [{ ...policy, enabled: false }, { invalid: true }]) {
      tx.tableAuthorityPolicy.findUnique.mockResolvedValue({
        baseId: 'base',
        connectionId: 'connection',
        revision: 1,
        policy: value,
      });
      expect(await service.apply('base', 'table', [])).toEqual([]);
    }
  });
});
