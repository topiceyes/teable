import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { directorySaveConnectionRoSchema, directoryConnectionVoSchema } from '@teable/openapi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThirdPartyCredentialCodec } from '../../../utils/third-party-credential-encryption';
import type { AuditScope } from '../../audit/audit-scope';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import type { DingtalkDirectoryClient } from './dingtalk-directory.client';
import { DingtalkDirectoryConfig } from './dingtalk-directory.config';
import { DirectoryConnectionController } from './directory-connection.controller';
import { DirectoryConnectionService } from './directory-connection.service';

const input = {
  corpId: 'corp',
  name: 'Company',
  appKey: 'key',
  appSecret: 'private-test-secret',
  expectedVersion: 0,
};
function fixture() {
  const db = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'connection', ...data })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn(),
  };
  const tx = {
    directoryConnection: db,
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const client = {
    testConnection: vi.fn().mockResolvedValue({ connected: true, departmentName: 'Company' }),
  };
  const audit = { emitAtomic: vi.fn() };
  const service = new DirectoryConnectionService(
    prisma as unknown as PrismaService,
    new DingtalkDirectoryConfig(),
    client as unknown as DingtalkDirectoryClient,
    audit as unknown as AuditScope
  );
  const stored = {
    id: 'connection',
    provider: 'dingtalk',
    tenantId: 'corp',
    name: 'Company',
    enabled: true,
    appKey: 'key',
    appSecret: new ThirdPartyCredentialCodec().encryptValue(input.appSecret),
    configurationVersion: 1,
  };
  return { service, db, tx, client, audit, stored };
}
beforeEach(() => {
  vi.stubEnv('BACKEND_DINGTALK_DIRECTORY_CONNECTIONS', '');
  vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET', 'directory-unit-test-root');
});
afterEach(() => vi.unstubAllEnvs());
describe('directory connection administration', () => {
  it('requires instance administrator permissions for save and test', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, DirectoryConnectionController)).toEqual([
      'instance|update',
    ]);
  });
  it('always encrypts stored secrets and never includes them in response or audit params', async () => {
    const { service, db, audit } = fixture();
    const result = await service.save(input);
    const value = db.create.mock.calls[0][0].data.appSecret;
    expect(value).toMatch(/^teable_enc_v1:/);
    expect(value).not.toContain(input.appSecret);
    expect(new ThirdPartyCredentialCodec().decryptValueStrict(value)).toBe(input.appSecret);
    expect(directoryConnectionVoSchema.parse(result)).toMatchObject({
      source: 'database',
      hasSecret: true,
      version: 1,
    });
    expect(JSON.stringify([result, audit.emitAtomic.mock.calls])).not.toContain(input.appSecret);
    expect(result).not.toHaveProperty('appSecret');
  });
  it('retains an existing secret when editing without sending one', async () => {
    const { service, db, stored } = fixture();
    db.findUnique.mockResolvedValue(stored);
    db.findUniqueOrThrow.mockResolvedValue({ ...stored, name: 'Renamed', configurationVersion: 2 });
    const { appSecret: _, ...edit } = input;
    await service.save({ ...edit, name: 'Renamed', expectedVersion: 1 });
    expect(db.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: stored.id, configurationVersion: 1 },
      data: { name: 'Renamed', configurationVersion: 2 },
    });
    expect(db.updateMany.mock.calls[0][0].data).not.toHaveProperty('appSecret');
  });
  it('requires a secret for new connections and for a replacement appKey', async () => {
    const { service, db, stored } = fixture();
    const { appSecret: _, ...edit } = input;
    await expect(service.save(edit)).rejects.toThrow('DIRECTORY_APP_SECRET_REQUIRED');
    db.findUnique.mockResolvedValue(stored);
    await expect(service.save({ ...edit, appKey: 'another', expectedVersion: 1 })).rejects.toThrow(
      'DIRECTORY_APP_SECRET_REQUIRED'
    );
    expect(db.create).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it('rejects stale versions, duplicate companies, and sync lock contention', async () => {
    const { service, db, tx, stored } = fixture();
    db.findUnique.mockResolvedValue(stored);
    await expect(service.save(input)).rejects.toThrow('DIRECTORY_CONNECTION_CHANGED');
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.save({ ...input, expectedVersion: 1 })).rejects.toThrow(
      'DIRECTORY_CONNECTION_BUSY'
    );
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a stale concurrent update even after the initial revision read', async () => {
    const { service, db, stored } = fixture();
    db.findUnique.mockResolvedValue(stored);
    db.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save({ ...input, expectedVersion: 1 })).rejects.toThrow(
      'DIRECTORY_CONNECTION_CHANGED'
    );
  });
  it('keeps environment configurations read-only and never returns the environment secret', async () => {
    vi.stubEnv(
      'BACKEND_DINGTALK_DIRECTORY_CONNECTIONS',
      JSON.stringify([input].map(({ expectedVersion: _, ...config }) => config))
    );
    const { service, db } = fixture();
    expect(await service.list()).toEqual([
      {
        corpId: 'corp',
        name: 'Company',
        appKey: 'key',
        provider: 'dingtalk',
        source: 'environment',
        hasSecret: true,
        version: 0,
      },
    ]);
    await expect(service.save(input)).rejects.toThrow('DIRECTORY_CONNECTION_ENVIRONMENT_MANAGED');
    expect(db.create).not.toHaveBeenCalled();
  });
  it('lists database metadata without decrypting or returning stored secrets', async () => {
    const { service, db, stored } = fixture();
    db.findMany.mockResolvedValue([{ ...stored, appSecret: 'teable_enc_v1:broken' }]);
    const results = await service.list();
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty('appSecret');
    expect(JSON.stringify(results)).not.toContain('broken');
  });
  it('resolves a saved credential for synchronization', async () => {
    const { service, db, stored } = fixture();
    db.findUnique.mockResolvedValue(stored);
    expect(await service.get('corp')).toMatchObject({
      appSecret: input.appSecret,
      configurationVersion: 1,
    });
  });
  it('tests unsaved input without writing configuration or directory data', async () => {
    const { service, db, client, audit } = fixture();
    expect(await service.test(input)).toEqual({ connected: true, departmentName: 'Company' });
    expect(client.testConnection).toHaveBeenCalledWith(input);
    expect(db.create).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
  it('can test the stored secret without returning it and sanitizes provider failures', async () => {
    const { service, db, client, stored } = fixture();
    db.findUnique.mockResolvedValue(stored);
    const { appSecret: _, ...edit } = input;
    await service.test({ ...edit, expectedVersion: 1 });
    expect(client.testConnection.mock.calls[0][0].appSecret).toBe(input.appSecret);
    client.testConnection.mockRejectedValue(new Error(input.appSecret));
    await expect(service.test({ ...edit, expectedVersion: 1 })).rejects.toThrow(
      /^DINGTALK_CONNECTION_FAILED$/
    );
  });
  it('fails closed on an unreadable secret and on an unconfigured encryption root', async () => {
    const { service, db, stored } = fixture();
    db.findUnique.mockResolvedValue({ ...stored, appSecret: 'teable_enc_v1:broken' });
    await expect(service.get('corp')).rejects.toThrow(/^DIRECTORY_CREDENTIAL_DECRYPTION_FAILED$/);
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET', '');
    vi.stubEnv('SECRET_KEY', '');
    await expect(service.save({ ...input, expectedVersion: 1 })).rejects.toThrow(
      'DIRECTORY_ENCRYPTION_NOT_CONFIGURED'
    );
  });
  it('rejects a submitted ciphertext and unexpected fields', () => {
    expect(
      directorySaveConnectionRoSchema.safeParse({ ...input, appSecret: 'teable_enc_v1:pretend' })
        .success
    ).toBe(false);
    expect(directorySaveConnectionRoSchema.safeParse({ ...input, enabled: true }).success).toBe(
      false
    );
  });
});
