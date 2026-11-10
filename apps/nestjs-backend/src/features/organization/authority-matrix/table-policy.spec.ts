import { describe, expect, it } from 'vitest';
import { evaluateTablePolicy, tablePolicySchema, type ITablePolicyContext } from './table-policy';
const policy = {
  version: 1,
  enabled: true,
  rules: [
    {
      roleId: 'finance',
      tableId: 'table',
      actions: ['table|read', 'record|read', 'record|update'],
    },
  ],
};
const context: ITablePolicyContext = {
  baseId: 'base',
  tableBaseId: 'base',
  tableId: 'table',
  hasBaseAccess: true,
  identityMode: 'user',
  effectiveRoleIds: ['finance'],
  existingActions: ['table|read', 'record|read'],
};
describe('table matrix policy boundary', () => {
  it('adds matching grants while preserving existing permissions', () => {
    expect(evaluateTablePolicy(policy, context)).toEqual([
      'table|read',
      'record|read',
      'record|update',
    ]);
  });
  it('does not grant access to another table or project', () => {
    for (const override of [
      { tableId: 'other' },
      { tableBaseId: 'other' },
      { hasBaseAccess: false },
    ]) {
      expect(evaluateTablePolicy(policy, { ...context, ...override })).toEqual(
        context.existingActions
      );
    }
  });
  it('removes derived grants immediately when live roles disappear', () => {
    expect(evaluateTablePolicy(policy, { ...context, effectiveRoleIds: [] })).toEqual(
      context.existingActions
    );
  });
  it('never broadens share, template or robot authority', () => {
    for (const identityMode of ['share', 'template', 'robot'] as const) {
      expect(evaluateTablePolicy(policy, { ...context, identityMode })).toEqual(
        context.existingActions
      );
    }
  });
  it('retains independent manual grants when matrix is disabled or malformed', () => {
    const existingActions = ['table|read', 'record|delete'] as const;
    for (const input of [{ ...policy, enabled: false }, { unexpected: true }, null]) {
      expect(evaluateTablePolicy(input, { ...context, existingActions })).toEqual(existingActions);
    }
  });
  it('rejects schema, invitation, export and enterprise escalation actions', () => {
    for (const action of [
      'table|create',
      'table|delete',
      'field|update',
      'base|invite_email',
      'table|export',
      'instance|update',
    ]) {
      expect(
        tablePolicySchema.safeParse({
          ...policy,
          rules: [{ ...policy.rules[0], actions: ['table|read', 'record|read', action] }],
        }).success
      ).toBe(false);
    }
  });
  it('rejects duplicate rules, duplicate actions and write-only grants', () => {
    for (const rules of [
      [policy.rules[0], policy.rules[0]],
      [{ ...policy.rules[0], actions: ['record|update'] }],
      [{ ...policy.rules[0], actions: ['table|read', 'record|read', 'record|read'] }],
    ]) {
      expect(tablePolicySchema.safeParse({ ...policy, rules }).success).toBe(false);
    }
  });
  it('merges matching roles without duplicate actions', () => {
    const input = { ...policy, rules: [...policy.rules, { ...policy.rules[0], roleId: 'sales' }] };
    expect(
      evaluateTablePolicy(input, { ...context, effectiveRoleIds: ['finance', 'sales'] })
    ).toEqual(['table|read', 'record|read', 'record|update']);
  });
});
