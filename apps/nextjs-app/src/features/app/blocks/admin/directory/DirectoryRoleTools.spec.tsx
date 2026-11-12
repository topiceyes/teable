import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IDirectoryRoleVo } from '@teable/openapi';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryRoleChecks } from './DirectoryRoleChecks';
import { DirectoryRoleHistory, roleRuleDiff } from './DirectoryRoleHistory';
import { DirectoryRoleRoster } from './DirectoryRoleRoster';
const mocks = vi.hoisted(() => ({
  getDirectoryRoleRoster: vi.fn(),
  listDirectoryDepartments: vi.fn(),
  setDirectoryRolePeople: vi.fn(),
  previewDirectoryRole: vi.fn(),
  getDirectoryRoleHistory: vi.fn(),
  getDirectoryRoleChecks: vi.fn(),
  listDirectoryMembers: vi.fn(),
  listDirectoryRoles: vi.fn(),
}));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./DirectoryAuthorityDialog', () => ({
  DirectoryAuthorityDialog: ({ memberId }: { memberId: string }) => (
    <div role="dialog">diagnose {memberId}</div>
  ),
}));
vi.mock('./DirectoryBindingDialog', () => ({
  DirectoryBindingDialog: ({ member }: { member: { id: string } }) => (
    <div role="dialog">bind {member.id}</div>
  ),
}));
vi.mock('./DirectoryRoles', () => ({ RoleEditor: () => <div role="dialog">role editor</div> }));
const departmentRule = {
  type: 'department' as const,
  departmentId: 'dep',
  includeDescendants: false,
};
const role: IDirectoryRoleVo = {
  id: 'role',
  name: 'Finance',
  enabled: true,
  version: 4,
  rules: [departmentRule, { type: 'member', memberId: 'one' }],
};
const members = [
  {
    id: 'one',
    name: 'Alice',
    externalId: 'dt-alice',
    active: true,
    userId: 'u',
    sources: ['member', 'department'],
    effective: true,
  },
  {
    id: 'two',
    name: 'Bob',
    externalId: 'dt-bob',
    active: true,
    userId: null,
    sources: ['department'],
    effective: false,
  },
];
const close = vi.fn(),
  diagnose = vi.fn();
function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDirectoryDepartments.mockResolvedValue({
    data: [{ id: 'dep', name: 'Finance', pathName: ['Finance'] }],
  });
  mocks.getDirectoryRoleRoster.mockResolvedValue({
    data: { role, counts: { effective: 1, unbound: 1, matched: 2 }, total: 2, members },
  });
  mocks.previewDirectoryRole.mockResolvedValue({
    data: {
      before: 1,
      after: 1,
      counts: { added: 0, removed: 0, retained: 1, pending: 0 },
      total: 1,
      members: [{ memberId: 'one', name: 'Alice', externalId: 'dt-alice', change: 'retained' }],
    },
  });
  mocks.setDirectoryRolePeople.mockResolvedValue({ data: { ...role, version: 5 } });
});
afterEach(cleanup);
describe('role tools UI', () => {
  it('previews a selected batch before removal and preserves department rules', async () => {
    mount(
      <DirectoryRoleRoster
        corpId="corp"
        role={role}
        syncBusy={false}
        onClose={close}
        onDiagnose={diagnose}
      />
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'selectCurrentPage' }));
    fireEvent.click(screen.getByRole('button', { name: 'batchRemovePeople' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'saveRole' })).toBeEnabled());
    expect(mocks.setDirectoryRolePeople).not.toHaveBeenCalled();
    expect(mocks.previewDirectoryRole).toHaveBeenCalledWith(
      expect.objectContaining({ rules: [departmentRule], expectedVersion: 4 })
    );
    expect(screen.getByText(/roleChange_retained/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    await waitFor(() =>
      expect(mocks.setDirectoryRolePeople).toHaveBeenCalledWith({
        corpId: 'corp',
        roleId: 'role',
        expectedVersion: 4,
        assigned: false,
        memberIds: ['one', 'two'],
      })
    );
    expect(await screen.findByText('batchRoleSaved')).toBeInTheDocument();
  });
  it('clears page selection on filters and sends the exact scoped filter', async () => {
    mount(
      <DirectoryRoleRoster
        corpId="corp"
        role={role}
        syncBusy={false}
        onClose={close}
        onDiagnose={diagnose}
      />
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Alice' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'filterBinding' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('option', { name: 'bindingFilter_unbound' }));
    await waitFor(() =>
      expect(mocks.getDirectoryRoleRoster).toHaveBeenCalledWith(
        expect.objectContaining({ corpId: 'corp', roleId: 'role', binding: 'unbound', skip: 0 })
      )
    );
    expect(await screen.findByRole('checkbox', { name: 'Alice' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'batchAddPeople' })).toBeDisabled();
  });
  it('retains a failed batch and shows an actionable conflict message', async () => {
    mocks.setDirectoryRolePeople.mockRejectedValue(
      new Error('Role changed or unavailable; refresh before editing')
    );
    mount(
      <DirectoryRoleRoster
        corpId="corp"
        role={role}
        syncBusy={false}
        onClose={close}
        onDiagnose={diagnose}
      />
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'batchRemovePeople' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'saveRole' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('roleErrorConflict');
    expect(screen.getByRole('checkbox', { name: 'Alice' })).toBeChecked();
    expect(close).not.toHaveBeenCalled();
  });
  it('opens permission verification for a chosen roster member', async () => {
    mount(
      <DirectoryRoleRoster
        corpId="corp"
        role={role}
        syncBusy={false}
        onClose={close}
        onDiagnose={diagnose}
      />
    );
    await screen.findByRole('checkbox', { name: 'Alice' });
    fireEvent.click(screen.getAllByRole('button', { name: 'viewAuthority' })[0]);
    expect(diagnose).toHaveBeenCalledWith('one');
  });
  it('shows durable actor snapshots and explicit before/after rule differences', async () => {
    mocks.getDirectoryRoleHistory.mockResolvedValue({
      data: {
        total: 1,
        entries: [
          {
            id: 'entry',
            createdAt: '2026-11-11T00:00:00Z',
            actor: { id: 'admin', name: 'Operator' },
            before: role,
            after: { ...role, version: 5, name: 'New Finance', rules: [departmentRule] },
          },
        ],
      },
    });
    mount(<DirectoryRoleHistory corpId="corp" role={role} onClose={close} />);
    expect(await screen.findByText(/Operator/)).toBeInTheDocument();
    expect(screen.getByText(/Finance → New Finance/)).toBeInTheDocument();
    expect(screen.getByText(/− roleSource_member · one/)).toBeInTheDocument();
    expect(roleRuleDiff(role.rules, [departmentRule])).toEqual({
      added: [],
      removed: [{ type: 'member', memberId: 'one' }],
    });
  });
  it('shows empty history explicitly and does not invent earlier changes', async () => {
    mocks.getDirectoryRoleHistory.mockResolvedValue({ data: { total: 0, entries: [] } });
    mount(<DirectoryRoleHistory corpId="corp" role={role} onClose={close} />);
    expect(await screen.findByText('noRoleHistory')).toBeInTheDocument();
    expect(screen.getByText('roleHistoryDescription')).toBeInTheDocument();
  });
  it('routes unbound issues to binding and missing-base issues to permission diagnosis', async () => {
    mocks.getDirectoryRoleChecks.mockResolvedValue({
      data: {
        connectionEnabled: true,
        total: 2,
        checkedAt: '2026-11-11T00:00:00Z',
        issues: [
          {
            kind: 'unboundMember',
            roleId: 'role',
            roleName: 'Finance',
            roleEnabled: true,
            memberId: 'two',
            memberName: 'Bob',
          },
          {
            kind: 'noBaseAccess',
            roleId: 'role',
            roleName: 'Finance',
            roleEnabled: true,
            memberId: 'one',
            memberName: 'Alice',
            baseId: 'base',
            baseName: 'Base',
          },
        ],
      },
    });
    mocks.listDirectoryMembers.mockResolvedValue({ data: { members: [members[1]], total: 1 } });
    mount(<DirectoryRoleChecks corpId="corp" syncBusy={false} />);
    const issue = (await screen.findByText(/roleIssuenoBaseAccess/)).closest('li')!;
    fireEvent.click(within(issue).getByRole('button', { name: 'viewAuthority' }));
    expect(await screen.findByText('diagnose one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bind' }));
    expect(await screen.findByText('bind two')).toBeInTheDocument();
  });
});
