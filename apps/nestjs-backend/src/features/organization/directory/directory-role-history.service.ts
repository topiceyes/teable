import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  directoryRoleVoSchema,
  type IDirectoryRoleVo,
  type IDirectoryRoleHistoryRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';

@Injectable()
export class DirectoryRoleHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async record(
    tx: Prisma.TransactionClient,
    before: IDirectoryRoleVo | null,
    after: IDirectoryRoleVo
  ) {
    const actor = this.cls.get('user');
    await tx.directoryRoleHistory.create({
      data: {
        id: randomUUID(),
        roleId: after.id,
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        ...(before ? { before: before as unknown as Prisma.InputJsonValue } : {}),
        after: after as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async list(ro: IDirectoryRoleHistoryRo) {
    return this.prisma.$transaction(
      async (tx) => {
        const role = await tx.directoryBusinessRole.findFirst({
          where: {
            id: ro.roleId,
            connection: { provider: 'dingtalk', tenantId: ro.corpId },
          },
          select: { id: true },
        });
        if (!role) throw new NotFoundException('Business role not found');
        const where = { roleId: role.id };
        const [rows, total] = await Promise.all([
          tx.directoryRoleHistory.findMany({
            where,
            orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
            skip: ro.skip,
            take: ro.take,
          }),
          tx.directoryRoleHistory.count({ where }),
        ]);
        return {
          total,
          entries: rows.map((row) => ({
            id: row.id,
            createdAt: row.createdTime.toISOString(),
            actor: { id: row.actorId, name: row.actorName },
            before: row.before === null ? null : directoryRoleVoSchema.parse(row.before),
            after: directoryRoleVoSchema.parse(row.after),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }
}
