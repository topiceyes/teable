import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  tableAuthorityPolicySchema,
  tableMatrixActions,
  type ITableAuthorityPreviewRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { PermissionService } from '../../auth/permission.service';
import { DirectoryRoleService } from '../directory/directory-role.service';
import { TableDataAccessService } from './table-data-access.service';

@Injectable()
export class TableAuthorityPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissions: PermissionService,
    private readonly roles: DirectoryRoleService,
    private readonly dataAccess: TableDataAccessService
  ) {}

  async preview(ro: ITableAuthorityPreviewRo) {
    const table = await this.prisma.tableMeta.findFirst({
      where: {
        id: ro.tableId,
        baseId: ro.baseId,
        deletedTime: null,
        base: { deletedTime: null, space: { deletedTime: null } },
      },
      select: { id: true },
    });
    if (!table) throw new NotFoundException('Table unavailable in this base');
    const user = await this.prisma.user.findFirst({
      where: {
        email: ro.email,
        deletedTime: null,
        deactivatedTime: null,
        permanentDeletedTime: null,
        OR: [{ isSystem: false }, { isSystem: null }],
      },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('Active local account not found');
    // A fresh store simulates an interactive login. Never inherit the administrator, token, share or ancestry caches.
    return this.cls.runWith({ user } as IClsStore, async () => {
      let baseActions: Awaited<ReturnType<PermissionService['getPermissionsByResourceId']>> = [];
      try {
        baseActions = await this.permissions.getPermissionsByResourceId(ro.baseId);
      } catch {
        /* no base membership */
      }
      const hasBaseAccess = baseActions.includes('base|read');
      const effective = hasBaseAccess
        ? await this.permissions.getPermissionsByResourceId(ro.tableId)
        : [];
      const row = await this.prisma.tableAuthorityPolicy.findUnique({
        where: { baseId: ro.baseId },
      });
      const policy = tableAuthorityPolicySchema.safeParse(row?.policy);
      const roles = (await this.roles.resolveForUser(user.id)).filter(
        (role) => role.connectionId === row?.connectionId
      );
      const ids = new Set(roles.map((role) => role.roleId));
      const grants = new Set(
        policy.success && policy.data.enabled
          ? policy.data.rules
              .filter((rule) => rule.tableId === ro.tableId && ids.has(rule.roleId))
              .flatMap((rule) => rule.actions)
          : []
      );
      const dataScope = await this.dataAccess.scope(ro.tableId, user.id);
      return {
        user,
        hasBaseAccess,
        roles: roles.map((role) => ({ id: role.roleId, name: role.name })),
        actions: tableMatrixActions.map((action) => ({
          action,
          allowed: effective.includes(action),
          sources: [
            ...(hasBaseAccess && baseActions.includes(action) ? ['collaborator' as const] : []),
            ...(hasBaseAccess && grants.has(action) ? ['matrix' as const] : []),
          ],
        })),
        dataScope: dataScope
          ? {
              rowScope: dataScope.restriction.rowScope,
              hiddenFields: dataScope.fields
                .filter((field) => dataScope.hidden.has(field.id))
                .map((field) => field.name),
              readOnlyFields: dataScope.fields
                .filter((field) => dataScope.readOnly.has(field.id))
                .map((field) => field.name),
            }
          : null,
        note: 'Interactive account permissions; access tokens and share links have separate limits.',
      };
    });
  }
}
