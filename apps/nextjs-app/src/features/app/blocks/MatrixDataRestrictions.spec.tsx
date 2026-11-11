import type { ITableAuthorityPolicy } from '@teable/openapi';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixDataRestrictions } from './MatrixDataRestrictions';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const tables = [
  {
    id: 'table',
    name: 'Orders',
    fields: [
      { id: 'name', name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: 'private', name: 'Private', type: 'singleLineText', isPrimary: false },
      { id: 'creator', name: 'Creator', type: 'createdBy', isPrimary: false },
    ],
  },
];
const roles = [
  { id: 'manager', name: 'Manager' },
  { id: 'executive', name: 'Executive' },
];
const policy: ITableAuthorityPolicy = {
  version: 1,
  enabled: true,
  rules: [],
  restrictions: [
    { tableId: 'table', rowScope: 'own', hiddenFieldIds: ['private'], readOnlyFieldIds: ['name'] },
  ],
};
function mount(initial = policy) {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <MatrixDataRestrictions
        policy={value}
        tables={tables}
        roles={roles}
        disabled={false}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return changed;
}
afterEach(cleanup);
describe('role-specific data scope configuration', () => {
  it('copies the fallback when adding a role, then edits fields and rows independently', () => {
    const changed = mount();
    const section = within(screen.getByRole('region', { name: 'table roleScopes' }));
    fireEvent.change(section.getByRole('combobox', { name: 'table restrictionRole' }), {
      target: { value: 'manager' },
    });
    fireEvent.click(section.getByRole('button', { name: 'addRoleScope' }));
    expect(
      section.getByRole('checkbox', { name: 'table:manager name hiddenFieldIds' })
    ).toBeDisabled();
    expect(
      section.getByRole('checkbox', { name: 'table:manager private hiddenFieldIds' })
    ).toBeChecked();
    fireEvent.change(section.getByRole('combobox', { name: 'table:manager rowScope' }), {
      target: { value: 'department' },
    });
    fireEvent.click(
      section.getByRole('checkbox', { name: 'table:manager private hiddenFieldIds' })
    );
    const last = changed.mock.calls.at(-1)![0];
    expect(last.restrictions[0]).toMatchObject({
      rowScope: 'own',
      hiddenFieldIds: ['private'],
      roleOverrides: [
        {
          roleId: 'manager',
          rowScope: 'department',
          hiddenFieldIds: [],
          readOnlyFieldIds: ['name'],
        },
      ],
    });
    expect(section.getByRole('button', { name: 'addRoleScope' })).toBeDisabled();
    expect(section.queryByRole('option', { name: 'Manager' })).not.toBeInTheDocument();
  });
  it('changes priority explicitly and leaves default restrictions intact when a role is removed', () => {
    const overrides = roles.map((role) => ({
      roleId: role.id,
      rowScope: 'all' as const,
      hiddenFieldIds: [],
      readOnlyFieldIds: [],
    }));
    const changed = mount({
      ...policy,
      restrictions: [{ ...policy.restrictions![0], roleOverrides: overrides }],
    });
    expect(screen.getByRole('button', { name: 'manager moveUp' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'executive moveUp' }));
    expect(
      changed.mock.calls
        .at(-1)![0]
        .restrictions[0].roleOverrides.map((item: { roleId: string }) => item.roleId)
    ).toEqual(['executive', 'manager']);
    fireEvent.click(screen.getByRole('button', { name: 'executive removeRoleScope' }));
    expect(changed.mock.calls.at(-1)![0].restrictions[0]).toMatchObject({
      rowScope: 'own',
      hiddenFieldIds: ['private'],
      roleOverrides: [overrides[0]],
    });
  });
});
