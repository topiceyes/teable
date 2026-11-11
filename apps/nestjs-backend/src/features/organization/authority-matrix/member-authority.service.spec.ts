import { AsyncLocalStorage } from 'node:async_hooks';
import { Reflector } from '@nestjs/core';
import { HttpErrorCode } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { memberAuthorityRoSchema, memberAuthorityTablesRoSchema } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import type { PermissionService } from '../../auth/permission.service';
import type { DirectoryRoleService } from '../directory/directory-role.service';
import { MemberAuthorityService } from './member-authority.service';
import { TableAuthorityPreviewService } from './table-authority-preview.service';
import { TableAuthorityController } from './table-authority.controller';
import type { TableDataAccessService } from './table-data-access.service';

const ro = { corpId: 'corp', memberId: 'member', skip: 0, take: 10 };
function fixture() {
  const user = {
    id: 'usr-employee',
    name: 'Employee',
    email: 'employee@example.com',
    isAdmin: false,
    isSystem: false,
    deletedTime: null,
    permanentDeletedTime: null,
    deactivatedTime: null,
  };
  const member = {
    id: 'member',
    name: 'Employee',
    inactiveTime: null as Date | null,
    user: user as typeof user | null,
    connection: { id: 'connection', enabled: true },
    memberships: [{ department: { id: 'department', name: 'Sales' } }],
  };
  const policy = {
    version: 1,
    enabled: true,
    rules: [
      {
        tableId: 'tbl-table',
        roleId: 'writer',
        actions: ['table|read', 'record|read', 'record|update'],
      },
    ],
  };
  const base = {
    id: 'bse-base',
    name: 'Orders',
    spaceId: 'spc-space',
    space: { name: 'Business' },
    authorityPolicy: { connectionId: 'connection', policy } as {
      connectionId: string;
      policy: unknown;
    } | null,
  };
  const prisma = {
    directoryMember: { findFirst: vi.fn().mockResolvedValue(member) },
    base: {
      findMany: vi.fn().mockResolvedValue([base]),
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue(base),
    },
    tableMeta: {
      findMany: vi.fn().mockResolvedValue([{ id: 'tbl-table', name: 'Orders' }]),
      count: vi.fn().mockResolvedValue(1),
    },
    collaborator: {
      findMany: vi.fn().mockResolvedValue([{ resourceType: 'space', roleName: 'viewer' }]),
    },
  };
  const roles = {
    resolveForUser: vi
      .fn()
      .mockResolvedValue([{ connectionId: 'connection', roleId: 'writer', name: 'Writer' }]),
  };
  const result = {
    user,
    hasBaseAccess: true,
    roles: [{ id: 'writer', name: 'Writer' }],
    actions: [
      { action: 'record|read', allowed: true, sources: ['collaborator'] },
      { action: 'record|update', allowed: true, sources: ['matrix'] },
    ],
    dataScope: {
      rowScope: 'department',
      hiddenFields: ['Private'],
      readOnlyFields: ['Locked'],
      emptyRowScope: true,
    },
  };
  const preview = {
    baseAccess: vi.fn().mockResolvedValue(['base|read', 'record|read']),
    preview: vi.fn().mockResolvedValue(result),
  };
  const service = new MemberAuthorityService(
    prisma as unknown as PrismaService,
    roles as unknown as DirectoryRoleService,
    preview as unknown as TableAuthorityPreviewService
  );
  return { service, prisma, member, user, base, roles, preview, result };
}
describe('employee authority inspection', () => {
  it('requires instance administration and caps both page sizes', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, TableAuthorityController)).toEqual([
      'instance|update',
    ]);
    expect(memberAuthorityRoSchema.parse({ corpId: 'corp', memberId: 'member' }).take).toBe(10);
    expect(memberAuthorityRoSchema.safeParse({ ...ro, take: 21 }).success).toBe(false);
    expect(memberAuthorityRoSchema.safeParse({ ...ro, skip: -1 }).success).toBe(false);
    expect(
      memberAuthorityTablesRoSchema.safeParse({ ...ro, baseId: 'bse-base', take: 21 }).success
    ).toBe(false);
    expect(
      memberAuthorityTablesRoSchema.safeParse({ ...ro, baseId: 'bse-base', skip: -1 }).success
    ).toBe(false);
  });
  it('verifies employee and enterprise together before any resource listing', async () => {
    const { service, prisma } = fixture();
    prisma.directoryMember.findFirst.mockResolvedValue(null);
    await expect(service.overview(ro)).rejects.toThrow('Employee unavailable');
    expect(prisma.directoryMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'member', connection: { provider: 'dingtalk', tenantId: 'corp' } },
      })
    );
    expect(prisma.base.findMany).not.toHaveBeenCalled();
    await expect(service.tables({ ...ro, baseId: 'bse-base' })).rejects.toThrow(
      'Employee unavailable'
    );
    expect(prisma.tableMeta.findMany).not.toHaveBeenCalled();
  });
  it('pages active bases, filters by name or space and explains inherited local membership', async () => {
    const { service, prisma } = fixture();
    const result = await service.overview({ ...ro, search: 'Orders', skip: 10 });
    expect(result.employee.roles).toEqual([{ id: 'writer', name: 'Writer' }]);
    expect(result.bases[0]).toMatchObject({
      hasBaseAccess: true,
      memberships: [{ resourceType: 'space', role: 'viewer' }],
      policyState: 'enabled',
    });
    expect(prisma.base.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          deletedTime: null,
          space: { deletedTime: null },
          OR: expect.any(Array),
        }),
      })
    );
    expect(prisma.collaborator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          principalId: 'usr-employee',
          principalType: 'user',
          OR: [
            { resourceType: 'base', resourceId: 'bse-base' },
            { resourceType: 'space', resourceId: 'spc-space' },
          ],
        }),
      })
    );
  });
  it('handles unbound employees without checking the administrator as a substitute', async () => {
    const { service, member, preview } = fixture();
    member.user = null;
    const overview = await service.overview(ro);
    expect(overview.employee.account).toBeNull();
    expect(overview.diagnostics).toContain('accountUnbound');
    expect(overview.bases[0].hasBaseAccess).toBe(false);
    const tables = await service.tables({ ...ro, baseId: 'bse-base' });
    expect(tables.tables[0].actions.every((action) => !action.allowed)).toBe(true);
    expect(preview.baseAccess).not.toHaveBeenCalled();
    expect(preview.preview).not.toHaveBeenCalled();
  });
  it.each(['deactivatedTime', 'deletedTime', 'permanentDeletedTime', 'isSystem'] as const)(
    'does not evaluate an inactive or system account: %s',
    async (key) => {
      const { service, user, preview } = fixture();
      Object.assign(user, { [key]: key === 'isSystem' ? true : new Date() });
      const result = await service.overview(ro);
      expect(result.diagnostics).toContain('accountInactive');
      expect(result.bases[0].hasBaseAccess).toBe(false);
      expect(preview.baseAccess).not.toHaveBeenCalled();
    }
  );
  it('preserves actual local access after enterprise disablement and employee departure', async () => {
    const { service, member, roles, preview, result } = fixture();
    member.connection.enabled = false;
    member.inactiveTime = new Date();
    roles.resolveForUser.mockResolvedValue([]);
    result.actions[1].sources = ['collaborator'];
    result.roles = [];
    const overview = await service.overview(ro);
    expect(overview.diagnostics).toEqual(
      expect.arrayContaining(['connectionDisabled', 'employeeInactive', 'noEffectiveRole'])
    );
    expect(overview.bases[0].hasBaseAccess).toBe(true);
    const tables = await service.tables({ ...ro, baseId: 'bse-base' });
    expect(tables.tables[0].diagnostics).toContain('collaboratorWrite');
    expect(tables.tables[0].actions[1].allowed).toBe(true);
    expect(preview.preview).toHaveBeenCalledWith({
      baseId: 'bse-base',
      tableId: 'tbl-table',
      email: 'employee@example.com',
    });
  });
  it('explains matrix writes and an empty department scope without returning creator IDs', async () => {
    const { service } = fixture();
    const result = await service.tables({ ...ro, baseId: 'bse-base' });
    expect(result.tables[0].diagnostics).toEqual(
      expect.arrayContaining([
        'matrixWrite',
        'departmentRows',
        'emptyDepartmentScope',
        'fieldRestrictions',
      ])
    );
    expect(result.tables[0].diagnostics).not.toContain('noTableRule');
    expect(result.tables[0].dataScope).not.toHaveProperty('creatorIds');
  });
  it('never confuses a matching role with base access', async () => {
    const { service, preview, result } = fixture();
    preview.baseAccess.mockResolvedValue([]);
    result.hasBaseAccess = false;
    result.actions = [{ action: 'record|update', allowed: false, sources: [] }];
    const overview = await service.overview(ro);
    expect(overview.employee.roles).toHaveLength(1);
    expect(overview.bases[0].diagnostics).toContain('noBaseAccess');
    const tables = await service.tables({ ...ro, baseId: 'bse-base' });
    expect(tables.tables[0].diagnostics).toContain('noBaseAccess');
    expect(tables.tables[0].diagnostics).not.toContain('matrixWrite');
  });
  it.each([
    null,
    { connectionId: 'other', policy: { version: 1, enabled: false, rules: [] } },
    { connectionId: 'connection', policy: { invalid: true } },
  ])('explains missing, foreign or invalid policies without changing them', async (policy) => {
    const { service, base } = fixture();
    base.authorityPolicy = policy;
    const result = await service.overview(ro);
    expect(result.bases[0].policyState).toBe(
      policy === null ? 'missing' : policy.connectionId === 'other' ? 'disabled' : 'invalid'
    );
    if (policy?.connectionId === 'other')
      expect(result.bases[0].diagnostics).toContain('policyOtherEnterprise');
  });
  it('propagates resource and infrastructure errors instead of misreporting denial', async () => {
    const { service, prisma, preview } = fixture();
    prisma.base.findFirst.mockResolvedValue(null);
    await expect(service.tables({ ...ro, baseId: 'missing' })).rejects.toThrow(
      'Active base not found'
    );
    preview.baseAccess.mockRejectedValue(new Error('database unavailable'));
    await expect(service.overview(ro)).rejects.toThrow('database unavailable');
  });
});

describe('permission inspection identity isolation', () => {
  it('uses a fresh employee store without tokens, share context or administrator caches', async () => {
    const storage = new AsyncLocalStorage<IClsStore>();
    const cls = {
      runWith: (store: IClsStore, callback: () => unknown) => storage.run(store, callback),
    };
    const permissions = {
      getPermissionsByResourceId: vi.fn(async () => {
        await Promise.resolve();
        expect(storage.getStore()).toEqual({
          user: { id: 'employee', name: 'Employee', email: 'employee@example.com' },
        });
        return ['base|read'];
      }),
    };
    const service = new TableAuthorityPreviewService(
      {} as PrismaService,
      cls as unknown as ClsService<IClsStore>,
      permissions as unknown as PermissionService,
      {} as DirectoryRoleService,
      {} as TableDataAccessService
    );
    await storage.run(
      {
        user: { id: 'admin', name: 'Admin', email: 'admin@example.com', isAdmin: true },
        accessTokenId: 'token',
        shareViewId: 'share',
      } as IClsStore,
      async () => {
        await service.baseAccess(
          { id: 'employee', name: 'Employee', email: 'employee@example.com' },
          'bse-base'
        );
        expect(storage.getStore()?.user.id).toBe('admin');
      }
    );
    permissions.getPermissionsByResourceId.mockRejectedValueOnce(
      new CustomHttpException('No access', HttpErrorCode.RESTRICTED_RESOURCE)
    );
    expect(
      await service.baseAccess(
        { id: 'employee', name: 'Employee', email: 'employee@example.com' },
        'bse-base'
      )
    ).toEqual([]);
    permissions.getPermissionsByResourceId.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.baseAccess(
        { id: 'employee', name: 'Employee', email: 'employee@example.com' },
        'bse-base'
      )
    ).rejects.toThrow('database unavailable');
  });
});
