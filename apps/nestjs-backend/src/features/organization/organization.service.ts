import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import type {
  IGetDepartmentListRo,
  IGetDepartmentUserRo,
  IGetDepartmentUserVo,
  IOrganizationMeVo,
  IOrganizationQueryRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { DirectoryTree } from './directory/directory-tree';

const activeUser = { deletedTime: null, deactivatedTime: null, permanentDeletedTime: null };

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private async membership(tx: Prisma.TransactionClient, organizationId?: string) {
    const userId = this.cls.get('user.id');
    if (!userId) throw new UnauthorizedException();
    const member = await tx.directoryMember.findFirst({
      where: {
        userId,
        inactiveTime: null,
        user: activeUser,
        connection: { enabled: true, ...(organizationId ? { id: organizationId } : {}) },
      },
      include: { connection: true },
      orderBy: { connectionId: 'asc' },
    });
    // Instance admins use the separate admin endpoints. They do not bypass enterprise membership.
    if (!member && organizationId) throw new ForbiddenException('Organization membership required');
    return member;
  }

  private async tree(tx: Prisma.TransactionClient, connectionId: string) {
    const departments = await tx.directoryDepartment.findMany({
      where: { connectionId, inactiveTime: null },
      select: { id: true, externalId: true, name: true, parentExternalId: true },
    });
    return new DirectoryTree(departments);
  }

  async me(ro: IOrganizationQueryRo = {}): Promise<IOrganizationMeVo> {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await this.membership(tx, ro.organizationId);
        return member
          ? {
              id: member.connection.id,
              name: member.connection.name,
              // Organization administration is not implemented. Instance and source roles
              // do not implicitly become enterprise roles.
              isAdmin: false,
            }
          : null;
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async departments(ro: IGetDepartmentListRo) {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await this.membership(tx, ro.organizationId);
        if (!member) return [];
        const tree = await this.tree(tx, member.connectionId);
        return tree.list(
          ro.parentId,
          ro.includeChildrenDepartment ?? Boolean(ro.search),
          ro.search
        );
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async users(ro: IGetDepartmentUserRo): Promise<IGetDepartmentUserVo> {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await this.membership(tx, ro.organizationId);
        if (!member) return { users: [], total: 0 };
        const tree = await this.tree(tx, member.connectionId);
        const departmentIds = ro.departmentId
          ? ro.includeChildrenDepartment
            ? tree.descendants(ro.departmentId, true)
            : [tree.require(ro.departmentId).id]
          : undefined;
        const where: Prisma.DirectoryMemberWhereInput = {
          connectionId: member.connectionId,
          inactiveTime: null,
          userId: { not: null },
          user: activeUser,
          ...(departmentIds
            ? {
                memberships: {
                  some: { connectionId: member.connectionId, departmentId: { in: departmentIds } },
                },
              }
            : {}),
          ...(ro.search
            ? {
                OR: [
                  { name: { contains: ro.search, mode: 'insensitive' } },
                  { user: { name: { contains: ro.search, mode: 'insensitive' } } },
                  { user: { email: { contains: ro.search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          tx.directoryMember.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: ro.skip ?? 0,
            take: ro.take ?? 50,
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true } },
              memberships: {
                where: { department: { inactiveTime: null } },
                include: { department: { select: { id: true } } },
              },
            },
          }),
          tx.directoryMember.count({ where }),
        ]);
        return {
          total,
          users: rows.map((row) => {
            // The relation filter above guarantees a live linked local user.
            const user = row.user!;
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              ...(user.avatar ? { avatar: getPublicFullStorageUrl(user.avatar) } : {}),
              departments: row.memberships.map(({ department }) => {
                const { id, name, path, pathName } = tree.dto(department.id);
                return { id, name, path, pathName };
              }),
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }
}
