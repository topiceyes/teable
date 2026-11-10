import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import type {
  IDirectoryAccountSearchRo,
  IDirectoryBindMemberRo,
  IDirectoryMemberVo,
  IDirectoryMembersRo,
} from '@teable/openapi';
import { AuditScope } from '../../audit/audit-scope';
import { DirectoryTree } from './directory-tree';

const activeUser = { deletedTime: null, deactivatedTime: null, permanentDeletedTime: null };

@Injectable()
export class DirectoryMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditScope
  ) {}

  private async connection(tx: Prisma.TransactionClient, corpId: string) {
    const connection = await tx.directoryConnection.findFirst({
      where: { provider: 'dingtalk', tenantId: corpId },
    });
    if (!connection) throw new NotFoundException('Directory connection not found');
    return connection;
  }

  async list(ro: IDirectoryMembersRo) {
    return this.prisma.$transaction(
      async (tx) => {
        const connection = await this.connection(tx, ro.corpId);
        const where: Prisma.DirectoryMemberWhereInput = {
          connectionId: connection.id,
          ...(ro.search
            ? {
                OR: [
                  { name: { contains: ro.search, mode: 'insensitive' } },
                  { externalId: { contains: ro.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          tx.directoryMember.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: ro.skip,
            take: ro.take,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  deletedTime: true,
                  permanentDeletedTime: true,
                },
              },
              memberships: {
                where: { department: { inactiveTime: null } },
                include: { department: { select: { id: true, name: true } } },
              },
            },
          }),
          tx.directoryMember.count({ where }),
        ]);
        const members: IDirectoryMemberVo[] = rows.map((row) => ({
          id: row.id,
          externalId: row.externalId,
          name: row.name,
          email: row.email,
          active: !row.inactiveTime,
          userId: row.userId,
          user:
            row.user && !row.user.deletedTime && !row.user.permanentDeletedTime
              ? { id: row.user.id, name: row.user.name, email: row.user.email }
              : null,
          departments: row.memberships.map((membership) => membership.department),
          externalRoleIds: row.externalRoleIds,
        }));
        return { members, total };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async departments(corpId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const connection = await this.connection(tx, corpId);
        const nodes = await tx.directoryDepartment.findMany({
          where: { connectionId: connection.id, inactiveTime: null },
          select: { id: true, externalId: true, name: true, parentExternalId: true },
        });
        return new DirectoryTree(nodes).list(undefined, true);
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async accounts(ro: IDirectoryAccountSearchRo) {
    const connection = await this.connection(this.prisma, ro.corpId);
    return this.prisma.user.findMany({
      where: {
        ...activeUser,
        AND: [
          { OR: [{ isSystem: false }, { isSystem: null }] },
          {
            OR: [
              { name: { contains: ro.search, mode: 'insensitive' } },
              { email: { contains: ro.search, mode: 'insensitive' } },
              { id: { equals: ro.search } },
            ],
          },
        ],
        directoryMembers: { none: { connectionId: connection.id } },
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
    });
  }

  private async validateAccount(
    tx: Prisma.TransactionClient,
    connectionId: string,
    memberId: string,
    userId: string
  ) {
    const user = await tx.user.findFirst({
      where: { id: userId, ...activeUser },
      select: { id: true, isSystem: true },
    });
    if (user?.isSystem) throw new ConflictException('System accounts cannot be linked');
    if (!user) throw new NotFoundException('Active local account not found');
    const existing = await tx.directoryMember.findFirst({
      where: {
        connectionId: connectionId,
        userId: userId,
        id: { not: memberId },
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('Account already linked to another employee in this enterprise');
  }

  async bind(ro: IDirectoryBindMemberRo) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const connection = await this.connection(tx, ro.corpId);
        // Share the sync lock: a link cannot change during reconciliation.
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0)) AS acquired
        `;
        if (!lock?.acquired) throw new ConflictException('Directory update already running');
        const member = await tx.directoryMember.findFirst({
          where: { id: ro.memberId, connectionId: connection.id },
        });
        if (!member) throw new NotFoundException('Directory member not found');
        if (member.userId !== ro.expectedUserId)
          throw new ConflictException('Binding changed; refresh before editing');
        if (member.userId && ro.userId && member.userId !== ro.userId) {
          throw new ConflictException('Unbind the current account before binding another');
        }
        if (ro.userId) {
          if (!connection.enabled || member.inactiveTime)
            throw new ConflictException('Directory identity is inactive');
          await this.validateAccount(tx, connection.id, member.id, ro.userId);
        }
        const updated = await tx.directoryMember.updateMany({
          where: { id: member.id, connectionId: connection.id, userId: ro.expectedUserId },
          data: { userId: ro.userId },
        });
        if (updated.count !== 1)
          throw new ConflictException('Binding changed; refresh before editing');
        return {
          memberId: member.id,
          userId: ro.userId,
          connectionId: connection.id,
          previousUserId: member.userId,
        };
      });
      await this.audit.emitAtomic({
        action: 'organization.directory.member.bind',
        resourceId: result.memberId,
        params: {
          connectionId: result.connectionId,
          previousUserId: result.previousUserId,
          userId: result.userId,
        },
      });
      return { memberId: result.memberId, userId: result.userId };
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new ConflictException('Account already linked to another employee');
      throw error;
    }
  }
}
