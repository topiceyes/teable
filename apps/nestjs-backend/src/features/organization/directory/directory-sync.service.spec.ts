import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import type { DingtalkDirectoryClient } from './dingtalk-directory.client';
import type { DirectoryConnectionService } from './directory-connection.service';
import { directorySnapshotSchema } from './directory-snapshot';
import { DirectorySyncController } from './directory-sync.controller';
import { DirectorySyncService } from './directory-sync.service';
const snapshot = directorySnapshotSchema.parse({
  complete: true,
  departments: [{ externalId: '1', name: 'Company', parentExternalId: null }],
  members: [{ externalId: 'u1', name: 'Employee', active: true, departmentExternalIds: ['1'] }],
});
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    directoryConnection: {
      upsert: vi.fn().mockResolvedValue({ id: 'connection', enabled: true }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'connection', enabled: true }),
    },
    directoryDepartment: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async ({ create }) => create),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    directoryMember: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async ({ create }) => create),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    directoryMembership: { deleteMany: vi.fn(), createMany: vi.fn() },
    directorySyncRun: {
      create: vi.fn().mockResolvedValue({ id: 'run' }),
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'run', ...data })),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const client = { fetchSnapshot: vi.fn().mockResolvedValue(structuredClone(snapshot)) };
  const config = {
    get: vi.fn().mockReturnValue({ corpId: 'corp', name: 'Company', configurationVersion: 0 }),
    list: vi.fn().mockResolvedValue([{ corpId: 'corp', name: 'Company', provider: 'dingtalk' }]),
  };
  const service = new DirectorySyncService(
    prisma as unknown as PrismaService,
    config as unknown as DirectoryConnectionService,
    client as unknown as DingtalkDirectoryClient
  );
  return { tx, prisma, client, service, config };
}
describe('directory synchronization', () => {
  it('protects all directory admin endpoints with instance permission', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, DirectorySyncController)).toEqual([
      'instance|update',
    ]);
  });
  it('uses the sanitized connection listing', async () => {
    expect(await fixture().service.listConnections()).toEqual([
      { corpId: 'corp', name: 'Company', provider: 'dingtalk' },
    ]);
  });
  it('invalidates old previews when credentials change', async () => {
    const { service, tx, config } = fixture();
    const preview = await service.preview('corp');
    config.get.mockReturnValue({ corpId: 'corp', name: 'Company', configurationVersion: 2 });
    tx.directoryConnection.upsert.mockResolvedValue({
      id: 'connection',
      enabled: true,
      configurationVersion: 2,
    });
    tx.directoryConnection.findUniqueOrThrow.mockResolvedValue({
      id: 'connection',
      enabled: true,
      configurationVersion: 2,
    });
    await expect(service.sync('corp', preview.previewToken)).rejects.toThrow('Directory changed');
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
  });
  it('rejects configuration changes while the remote snapshot is being fetched', async () => {
    const { service, tx } = fixture();
    const preview = await service.preview('corp');
    tx.directoryConnection.findUniqueOrThrow.mockResolvedValue({
      id: 'connection',
      enabled: true,
      configurationVersion: 2,
    });
    await expect(service.sync('corp', preview.previewToken)).rejects.toThrow(
      'configuration changed'
    );
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
  });
  it('previews without changing the directory', async () => {
    const { service, tx } = fixture();
    const preview = await service.preview('corp');
    expect(preview.changes.members.added).toHaveLength(1);
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
    expect(tx.directorySyncRun.create).not.toHaveBeenCalled();
  });
  it('reconciles reviewed data atomically without changing local user links', async () => {
    const { service, tx } = fixture();
    const preview = await service.preview('corp');
    expect((await service.sync('corp', preview.previewToken)).status).toBe('succeeded');
    const update = tx.directoryMember.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('userId');
    expect(update).not.toHaveProperty('roleName');
    expect(tx.directoryMembership.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ connectionId: 'connection' })],
    });
    expect(tx.directoryMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId: 'connection', externalId: { notIn: ['u1'] }, inactiveTime: null },
        data: { inactiveTime: expect.any(Date), externalRoleIds: [] },
      })
    );
  });
  it('rejects stale previews before any directory writes', async () => {
    const { service, tx, client } = fixture();
    const preview = await service.preview('corp');
    client.fetchSnapshot.mockResolvedValue({ ...snapshot, members: [] });
    await expect(service.sync('corp', preview.previewToken)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
    expect(tx.directorySyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', errorCode: 'DIRECTORY_CONFLICT' }),
      })
    );
  });
  it('rejects concurrent applies and disabled connections', async () => {
    const { service, tx } = fixture();
    const preview = await service.preview('corp');
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.sync('corp', preview.previewToken)).rejects.toThrow('already running');
    tx.directoryConnection.upsert.mockResolvedValue({ id: 'connection', enabled: false });
    await expect(service.preview('corp')).rejects.toThrow('disabled');
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
  });
  it('logs a sanitized failure and preserves the directory when fetching fails', async () => {
    const { service, tx, client } = fixture();
    client.fetchSnapshot.mockRejectedValue(new Error('secret-upstream-token'));
    await expect(service.sync('corp', 'a'.repeat(64))).rejects.toThrow('DINGTALK_SYNC_FAILED');
    expect(tx.directoryMember.upsert).not.toHaveBeenCalled();
    expect(tx.directorySyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', errorCode: 'DIRECTORY_SYNC_FAILED' }),
      })
    );
  });
});
