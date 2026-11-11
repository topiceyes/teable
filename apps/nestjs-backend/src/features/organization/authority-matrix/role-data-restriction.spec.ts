import { tableAuthorityPolicySchema, type ITableDataRestriction } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { resolveRoleDataRestriction } from './role-data-restriction';

const baseline: ITableDataRestriction = {
  tableId: 'table',
  hiddenFieldIds: ['private'],
  readOnlyFieldIds: ['locked'],
  rowScope: 'own',
};
const manager = {
  roleId: 'manager',
  rowScope: 'department' as const,
  hiddenFieldIds: ['private'],
  readOnlyFieldIds: [],
};
const executive = {
  roleId: 'executive',
  rowScope: 'all' as const,
  hiddenFieldIds: [],
  readOnlyFieldIds: [],
};
describe('ordered role data scopes', () => {
  it('preserves existing policies and unrecognized roles without adding a grant', () => {
    expect(resolveRoleDataRestriction(baseline, new Set(['manager']))).toEqual({
      restriction: baseline,
    });
    expect(
      resolveRoleDataRestriction({ ...baseline, roleOverrides: [manager] }, new Set())
    ).toEqual({ restriction: { ...baseline, roleOverrides: [manager] } });
  });
  it('uses the first matching role as a complete scope and does not combine fields from other roles', () => {
    const rule = { ...baseline, roleOverrides: [executive, manager] };
    expect(resolveRoleDataRestriction(rule, new Set(['manager', 'executive']))).toEqual({
      restriction: { tableId: 'table', hiddenFieldIds: [], readOnlyFieldIds: [], rowScope: 'all' },
      appliedRoleId: 'executive',
    });
    const result = resolveRoleDataRestriction(
      { ...rule, roleOverrides: [manager, executive] },
      new Set(['manager', 'executive'])
    );
    expect(result.restriction.rowScope).toBe('department');
    expect(result.restriction.readOnlyFieldIds).toEqual([]);
    expect(result.appliedRoleId).toBe('manager');
  });
  it('does not mutate a stored policy or its override arrays', () => {
    const rule = { ...baseline, roleOverrides: [manager] };
    const before = structuredClone(rule);
    const result = resolveRoleDataRestriction(rule, new Set(['manager']));
    result.restriction.hiddenFieldIds.push('another');
    expect(rule).toEqual(before);
  });
  it('rejects duplicate roles, unknown scope fields and excessive role rules', () => {
    const parse = (roleOverrides: unknown[]) =>
      tableAuthorityPolicySchema.safeParse({
        version: 1,
        enabled: true,
        rules: [],
        restrictions: [{ ...baseline, roleOverrides }],
      }).success;
    expect(parse([manager, executive])).toBe(true);
    expect(parse([manager, manager])).toBe(false);
    expect(parse([{ ...manager, hiddenFieldIds: ['private', 'private'] }])).toBe(false);
    expect(parse([{ ...manager, allowAll: true }])).toBe(false);
    expect(parse(Array.from({ length: 101 }, (_, i) => ({ ...manager, roleId: String(i) })))).toBe(
      false
    );
  });
});
