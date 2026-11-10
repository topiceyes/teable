import type { Action } from '@teable/core';
import {
  tableAuthorityPolicySchema,
  tableMatrixActions,
  type ITableAuthorityPolicy,
} from '@teable/openapi';

export const matrixActions = tableMatrixActions;
export const tablePolicySchema = tableAuthorityPolicySchema;
export type ITablePolicy = ITableAuthorityPolicy;

export interface ITablePolicyContext {
  baseId: string;
  tableId: string;
  tableBaseId: string;
  // Scope must come from the resource permission service, never from a client header.
  hasBaseAccess: boolean;
  effectiveRoleIds: readonly string[];
  existingActions: readonly Action[];
  // Shared/template/robot paths retain their own independent permission rules.
  identityMode: 'user' | 'share' | 'template' | 'robot';
}

/** Additive grants never revoke independent collaborator permissions or create base access. */
export function evaluateTablePolicy(input: unknown, context: ITablePolicyContext): Action[] {
  const existing = [...new Set(context.existingActions)];
  if (
    !context.hasBaseAccess ||
    context.tableBaseId !== context.baseId ||
    context.identityMode !== 'user'
  )
    return existing;
  const parsed = tablePolicySchema.safeParse(input);
  // Invalid persisted policies contribute no new grants.
  if (!parsed.success || !parsed.data.enabled) return existing;
  const roleIds = new Set(context.effectiveRoleIds);
  const grants = parsed.data.rules
    .filter((rule) => rule.tableId === context.tableId && roleIds.has(rule.roleId))
    .flatMap((rule) => rule.actions);
  return [...new Set<Action>([...existing, ...grants])];
}
