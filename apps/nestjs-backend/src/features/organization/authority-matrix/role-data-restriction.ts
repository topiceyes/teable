import type { ITableDataRestriction } from '@teable/openapi';

/** The first matched role replaces the default scope as one unit; grants remain independent. */
export function resolveRoleDataRestriction(
  restriction: ITableDataRestriction,
  roleIds: ReadonlySet<string>
): { restriction: ITableDataRestriction; appliedRoleId?: string } {
  const override = restriction.roleOverrides?.find((item) => roleIds.has(item.roleId));
  if (!override) return { restriction };
  return {
    restriction: {
      tableId: restriction.tableId,
      hiddenFieldIds: [...override.hiddenFieldIds],
      readOnlyFieldIds: [...override.readOnlyFieldIds],
      rowScope: override.rowScope,
    },
    appliedRoleId: override.roleId,
  };
}
