import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { describe, expect, it, vi } from 'vitest';
import type { AuditScope } from '../../audit/audit-scope';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { DirectoryMemberController } from './directory-member.controller';
import { DirectoryMemberService } from './directory-member.service';

const input = { corpId: 'corp', memberId: 'employee', userId: 'local', expectedUserId: null };
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    directoryConnection: {
      findFirst: vi.fn().mockResolvedValue({ id: 'connection', enabled: true }),
    },
    directoryMember: {
      findFirst: vi
        .fn()
        .mockImplementation(
          async ({
            where,
          }): Promise<{ id: string; userId?: string | null; inactiveTime?: Date | null } | null> =>
            where.id === 'employee' ? { id: 'employee', userId: null, inactiveTime: null } : null
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'local' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    directoryDepartment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const audit = { emitAtomic: vi.fn() };
  const service = new DirectoryMemberService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditScope
  );
  return { service, tx, audit };
}
describe('directory account binding', () => {
  it('requires instance administration for listing and binding', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, DirectoryMemberController)).toEqual([
      'instance|update',
    ]);
  });
  it('binds only an active account and audits the change', async () => {
    const { service, tx, audit } = fixture();
    expect(await service.bind(input)).toEqual({ memberId: 'employee', userId: 'local' });
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'local', deletedTime: null, deactivatedTime: null, permanentDeletedTime: null },
      select: { id: true, isSystem: true },
    });
    expect(tx.directoryMember.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'employee',
        connectionId: 'connection',
        userId: null,
      },
      data: { userId: 'local' },
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.directory.member.bind',
        resourceId: 'employee',
        params: { connectionId: 'connection', previousUserId: null, userId: 'local' },
      })
    );
  });
  it('requires explicit unlinking before replacing a local account', async () => {
    const { service, tx, audit } = fixture();
    tx.directoryMember.findFirst.mockResolvedValue({
      id: 'employee',
      userId: 'previous',
      inactiveTime: null,
    });
    await expect(service.bind({ ...input, expectedUserId: 'previous' })).rejects.toThrow('Unbind');
    expect(tx.directoryMember.updateMany).not.toHaveBeenCalled();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
  it('rejects stale bindings and compare-and-set races', async () => {
    const { service, tx } = fixture();
    await expect(service.bind({ ...input, expectedUserId: 'unexpected' })).rejects.toBeInstanceOf(
      ConflictException
    );
    tx.directoryMember.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.bind(input)).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows unlinking inactive identities on disabled connections', async () => {
    const { service, tx } = fixture();
    tx.directoryConnection.findFirst.mockResolvedValue({ id: 'connection', enabled: false });
    tx.directoryMember.findFirst.mockResolvedValue({
      id: 'employee',
      userId: 'local',
      inactiveTime: new Date(),
    });
    await service.bind({ ...input, expectedUserId: 'local', userId: null });
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.directoryMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: null } })
    );
  });
  it('rejects inactive or deleted local accounts', async () => {
    const { service, tx } = fixture();
    tx.user.findFirst.mockResolvedValue(null);
    await expect(service.bind(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.directoryMember.updateMany).not.toHaveBeenCalled();
  });
  it('rejects cross-enterprise member IDs', async () => {
    const { service, tx } = fixture();
    tx.directoryMember.findFirst.mockResolvedValue(null);
    await expect(service.bind(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.directoryMember.findFirst).toHaveBeenCalledWith({
      where: { id: 'employee', connectionId: 'connection' },
    });
  });
  it('rejects duplicate links and unique constraint races', async () => {
    const { service, tx } = fixture();
    tx.directoryMember.findFirst.mockImplementation(async ({ where }) =>
      where.id === 'employee'
        ? { id: 'employee', userId: null, inactiveTime: null }
        : { id: 'another' }
    );
    await expect(service.bind(input)).rejects.toThrow('already linked');
    tx.directoryMember.findFirst.mockImplementation(async ({ where }) =>
      where.id === 'employee' ? { id: 'employee', userId: null, inactiveTime: null } : null
    );
    tx.directoryMember.updateMany.mockRejectedValue({ code: 'P2002' });
    await expect(service.bind(input)).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects binding during synchronization', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(service.bind(input)).rejects.toThrow('already running');
    expect(tx.directoryMember.updateMany).not.toHaveBeenCalled();
  });
  it('scopes employee searches to the selected enterprise with pagination', async () => {
    const { service, tx } = fixture();
    expect(await service.list({ corpId: 'corp', search: 'Name', skip: 5, take: 10 })).toEqual({
      members: [],
      total: 0,
    });
    expect(tx.directoryMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ connectionId: 'connection' }),
        skip: 5,
        take: 10,
      })
    );
  });
});

describe('administrator directory browsing', () => {
  it('searches active non-system accounts not already linked in this enterprise', async () => {
    const { service, tx } = fixture();
    await service.accounts({ corpId: 'corp', search: 'Name' });
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedTime: null,
          deactivatedTime: null,
          directoryMembers: { none: { connectionId: 'connection' } },
          AND: expect.arrayContaining([{ OR: [{ isSystem: false }, { isSystem: null }] }]),
        }),
        select: { id: true, name: true, email: true },
        take: 20,
      })
    );
  });
  it('rejects system account links even if a caller supplies an ID directly', async () => {
    const { service, tx } = fixture();
    tx.user.findFirst.mockResolvedValue({ id: 'local', isSystem: true });
    await expect(service.bind(input)).rejects.toThrow('System accounts');
    expect(tx.directoryMember.updateMany).not.toHaveBeenCalled();
  });
  it('lists scoped departments without requiring the administrator to bind themselves', async () => {
    const { service, tx } = fixture();
    tx.directoryDepartment.findMany.mockResolvedValue([
      { id: 'root', externalId: '1', name: 'Company', parentExternalId: null },
    ]);
    expect(await service.departments('corp')).toEqual([
      expect.objectContaining({ id: 'root', name: 'Company' }),
    ]);
    expect(tx.directoryDepartment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { connectionId: 'connection', inactiveTime: null } })
    );
  });
});
