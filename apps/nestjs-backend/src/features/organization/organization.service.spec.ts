import type { PrismaService } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { OrganizationService } from './organization.service';

const departments = [
  { id: 'root', externalId: '1', name: 'Company', parentExternalId: null },
  { id: 'dept', externalId: '2', name: 'Department', parentExternalId: '1' },
  { id: 'child', externalId: '3', name: 'Child department', parentExternalId: '2' },
];
function fixture() {
  const tx = {
    directoryMember: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ connectionId: 'org', connection: { id: 'org', name: 'Company' } }),
      findMany: vi.fn().mockResolvedValue([
        {
          user: {
            id: 'local-user',
            name: 'Local name',
            email: 'local@example.com',
            avatar: null,
          },
          memberships: [{ department: { id: 'dept' } }],
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    directoryDepartment: { findMany: vi.fn().mockResolvedValue(departments) },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
  const store = { ['user.id']: 'current-user', ['user.isAdmin']: false };
  const cls = { get: vi.fn((key: string) => store[key as keyof typeof store]) };
  const service = new OrganizationService(
    prisma as unknown as PrismaService,
    cls as unknown as ClsService<IClsStore>
  );
  return { tx, service, store };
}
describe('organization directory scope', () => {
  it('resolves only live member identities with an enabled connection', async () => {
    const { service, tx } = fixture();
    expect(await service.me()).toEqual({ id: 'org', name: 'Company', isAdmin: false });
    expect(tx.directoryMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'current-user',
          inactiveTime: null,
          user: { deletedTime: null, deactivatedTime: null, permanentDeletedTime: null },
          connection: { enabled: true },
        },
        orderBy: { connectionId: 'asc' },
      })
    );
  });
  it('does not interpret instance administration as an organization role', async () => {
    const { service, store } = fixture();
    store['user.isAdmin'] = true;
    expect((await service.me())?.isAdmin).toBe(false);
  });
  it('preserves empty results for users without directory membership', async () => {
    const { service, tx } = fixture();
    tx.directoryMember.findFirst.mockResolvedValue(null);
    expect(await service.me()).toBeNull();
    expect(await service.departments({})).toEqual([]);
    expect(await service.users({})).toEqual({ users: [], total: 0 });
    expect(tx.directoryDepartment.findMany).not.toHaveBeenCalled();
    expect(tx.directoryMember.findMany).not.toHaveBeenCalled();
  });
  it('denies foreign organization selection even to instance administrators', async () => {
    const { service, tx, store } = fixture();
    store['user.isAdmin'] = true;
    tx.directoryMember.findFirst.mockResolvedValue(null);
    await expect(service.users({ organizationId: 'foreign-org' })).rejects.toThrow(
      'membership required'
    );
    expect(tx.directoryMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connection: { enabled: true, id: 'foreign-org' },
        }),
      })
    );
    expect(tx.directoryMember.findMany).not.toHaveBeenCalled();
  });
  it('rejects foreign department IDs without falling back to an enterprise-wide listing', async () => {
    const { service, tx } = fixture();
    await expect(service.users({ departmentId: 'foreign-department' })).rejects.toThrow(
      'Department not found'
    );
    await expect(service.departments({ parentId: 'foreign-department' })).rejects.toThrow(
      'Department not found'
    );
    expect(tx.directoryMember.findMany).not.toHaveBeenCalled();
  });
  it('returns live local user IDs and scoped department paths', async () => {
    const { service, tx } = fixture();
    const result = await service.users({
      departmentId: 'dept',
      includeChildrenDepartment: true,
      skip: 2,
      take: 10,
      search: 'local',
    });
    expect(result).toEqual({
      total: 1,
      users: [
        {
          id: 'local-user',
          name: 'Local name',
          email: 'local@example.com',
          departments: [
            {
              id: 'dept',
              name: 'Department',
              path: ['root', 'dept'],
              pathName: ['Company', 'Department'],
            },
          ],
        },
      ],
    });
    expect(tx.directoryMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 2,
        take: 10,
        where: expect.objectContaining({
          connectionId: 'org',
          inactiveTime: null,
          userId: { not: null },
          memberships: { some: { connectionId: 'org', departmentId: { in: ['dept', 'child'] } } },
          user: { deletedTime: null, deactivatedTime: null, permanentDeletedTime: null },
        }),
      })
    );
  });
  it('refreshes membership every request after unlinking or employee deactivation', async () => {
    const { service, tx } = fixture();
    expect(await service.me()).not.toBeNull();
    tx.directoryMember.findFirst.mockResolvedValue(null);
    expect(await service.me()).toBeNull();
    expect(await service.users({})).toEqual({ users: [], total: 0 });
  });
  it('searches the nested department tree and returns only direct members by default', async () => {
    const { service, tx } = fixture();
    expect((await service.departments({ search: 'child' })).map((node) => node.id)).toEqual([
      'child',
    ]);
    await service.users({ departmentId: 'dept' });
    expect(tx.directoryMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberships: { some: { connectionId: 'org', departmentId: { in: ['dept'] } } },
        }),
      })
    );
  });
});
