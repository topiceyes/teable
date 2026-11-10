import type { Action } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import type { TeableJwtService } from '../../auth/jwt/teable-jwt.service';
import { PermissionService } from '../../auth/permission.service';
import type { CollaboratorModel } from '../../model/collaborator';
import type { TemplateModel } from '../../model/template';
import type { TableAuthorityService } from './table-authority.service';

function fixture() {
  const values: Record<string, unknown> = { ['user.id']: 'usr-user' };
  const cls = { get: (key: string) => values[key] };
  const matrix = {
    apply: vi.fn().mockResolvedValue(['table|read', 'record|read', 'record|update']),
  };
  const service = new PermissionService(
    {} as PrismaService,
    cls as ClsService<IClsStore>,
    {} as CollaboratorModel,
    {} as TemplateModel,
    {} as TeableJwtService,
    matrix as unknown as TableAuthorityService
  );
  vi.spyOn(service, 'getUpperIdByTableId').mockResolvedValue({ baseId: 'base', spaceId: 'space' });
  const base = vi
    .spyOn(service, 'getPermissionByBaseId')
    .mockResolvedValue(['table|read', 'record|read']);
  return { service, matrix, base, values };
}
describe('matrix request permission integration', () => {
  it('resolves table ancestry before adding grants', async () => {
    const { service, matrix } = fixture();
    expect(await service.getPermissionsByResourceId('tbl-table')).toContain('record|update');
    expect(matrix.apply).toHaveBeenCalledWith('base', 'tbl-table', ['table|read', 'record|read']);
  });
  it('never grants base access when existing authorization rejects the caller', async () => {
    const { service, matrix, base } = fixture();
    base.mockRejectedValue(new Error('base access denied'));
    await expect(service.getPermissionsByResourceId('tbl-table')).rejects.toThrow(
      'base access denied'
    );
    expect(matrix.apply).not.toHaveBeenCalled();
  });
  it('intersects matrix grants with token scope restrictions', async () => {
    const { service } = fixture();
    vi.spyOn(service, 'getPermissionsByAccessToken').mockResolvedValue([
      'table|read',
      'record|read',
    ]);
    expect(await service.getPermissions('tbl-table', 'token')).toEqual([
      'table|read',
      'record|read',
    ]);
  });
  it('does not add grants for operations on deleted resources', async () => {
    const { service, matrix } = fixture();
    expect(await service.getPermissionsByResourceId('tbl-table', true)).toEqual([
      'table|read',
      'record|read',
    ]);
    expect(matrix.apply).not.toHaveBeenCalled();
  });
  it('never uses table grants for database-level operations', async () => {
    const { service, matrix, base } = fixture();
    base.mockResolvedValue(['base|read'] as Action[]);
    expect(await service.getPermissionsByResourceId('bse-base')).toEqual(['base|read']);
    expect(matrix.apply).not.toHaveBeenCalled();
  });
});

describe('multi-action and cross-table matrix checks', () => {
  it('requires both create and update for upsert and rechecks each target table', async () => {
    const { service, matrix } = fixture();
    matrix.apply.mockImplementation(async (_baseId: string, tableId: string, existing: Action[]) =>
      tableId === 'tbl-source' ? [...existing, 'record|create', 'record|update'] : existing
    );
    expect(
      await service.validPermissions('tbl-source', ['record|create', 'record|update'])
    ).toContain('record|update');
    await expect(service.validPermissions('tbl-target', ['record|create'])).rejects.toThrow();
    await expect(service.validPermissions('tbl-target', ['record|update'])).rejects.toThrow();
    expect(matrix.apply).toHaveBeenCalledWith('base', 'tbl-target', ['table|read', 'record|read']);
  });

  it('does not let an update-only grant create rows through a mixed bulk request', async () => {
    const { service } = fixture();
    await expect(
      service.validPermissions('tbl-source', ['record|create', 'record|update'])
    ).rejects.toThrow();
    expect(await service.validPermissions('tbl-source', ['record|update'])).toContain(
      'record|update'
    );
  });

  it('does not reuse a successful write check after matrix-derived authority is revoked', async () => {
    const { service, matrix } = fixture();
    await service.validPermissions('tbl-source', ['record|update']);
    matrix.apply.mockResolvedValue(['table|read', 'record|read']);
    await expect(service.validPermissions('tbl-source', ['record|update'])).rejects.toThrow();
    expect(await service.validPermissions('tbl-source', ['record|read'])).toContain('record|read');
  });

  it('preserves independent manual writes when the matrix no longer matches', async () => {
    const { service, base, matrix } = fixture();
    base.mockResolvedValue(['table|read', 'record|read', 'record|update']);
    matrix.apply.mockImplementation(
      async (_baseId: string, _tableId: string, existing: Action[]) => existing
    );
    expect(await service.validPermissions('tbl-source', ['record|update'])).toContain(
      'record|update'
    );
  });

  it('keeps field/schema operations outside record matrix grants on every target', async () => {
    const { service } = fixture();
    for (const tableId of ['tbl-source', 'tbl-target']) {
      await expect(service.validPermissions(tableId, ['field|create'])).rejects.toThrow();
      await expect(service.validPermissions(tableId, ['table|export'])).rejects.toThrow();
    }
  });
});
