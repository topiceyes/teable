import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorityMatrixPage } from './AuthorityMatrix';
const mocks = vi.hoisted(() => ({
  session: { user: { isAdmin: true } },
  getTableAuthorityPolicy: vi.fn(),
  getTableAuthorityOptions: vi.fn(),
  saveTableAuthorityPolicy: vi.fn(),
  previewTableAuthority: vi.fn(),
  listDirectoryRoles: vi.fn(),
  saveDirectoryRole: vi.fn(),
  listDirectoryDepartments: vi.fn(),
  getDirectoryRoleMembers: vi.fn(),
  listDirectoryMembers: vi.fn(),
  searchDirectoryAccounts: vi.fn(),
  bindDirectoryMember: vi.fn(),
}));
vi.mock('@teable/sdk/hooks', () => ({ useSession: () => mocks.session }));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next/router', () => ({ useRouter: () => ({ query: { baseId: 'base' } }) }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../components/collaborator/share/ShareBaseDialog', () => ({
  ShareBaseDialog: ({ children }: { children: React.ReactNode }) => children,
}));
const saved = {
  baseId: 'base',
  connectionId: 'connection',
  revision: 3,
  policy: {
    version: 1,
    enabled: true,
    rules: [{ roleId: 'finance', tableId: 'table', actions: ['table|read', 'record|read'] }],
  },
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthorityMatrixPage />
    </QueryClientProvider>
  );
  return { ...view, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user.isAdmin = true;
  mocks.getTableAuthorityPolicy.mockResolvedValue({ data: structuredClone(saved) });
  mocks.getTableAuthorityOptions.mockResolvedValue({
    data: {
      connections: [
        {
          id: 'connection',
          name: 'Company',
          corpId: 'corp',
          roles: [{ id: 'finance', name: 'Finance' }],
        },
      ],
      tables: [
        {
          id: 'table',
          name: 'Invoices',
          fields: [
            { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
            { id: 'fldPrivate', name: 'Private', type: 'singleLineText', isPrimary: false },
            { id: 'fldCreator', name: 'Creator', type: 'createdBy', isPrimary: false },
          ],
        },
      ],
    },
  });
  mocks.saveTableAuthorityPolicy.mockResolvedValue({ data: { ...saved, revision: 4 } });
  mocks.listDirectoryRoles.mockResolvedValue({ data: [] });
  mocks.saveDirectoryRole.mockResolvedValue({ data: {} });
  mocks.listDirectoryDepartments.mockResolvedValue({ data: [] });
  mocks.listDirectoryMembers.mockResolvedValue({ data: { members: [], total: 0 } });
  mocks.searchDirectoryAccounts.mockResolvedValue({
    data: [{ id: 'account', name: 'Employee', email: 'account@example.com' }],
  });
  mocks.bindDirectoryMember.mockResolvedValue({ data: {} });
  mocks.previewTableAuthority.mockResolvedValue({
    data: {
      user: { id: 'user', name: 'Account', email: 'account@example.com' },
      hasBaseAccess: true,
      roles: [{ id: 'finance', name: 'Finance' }],
      actions: [{ action: 'record|update', allowed: true, sources: ['collaborator', 'matrix'] }],
      dataScope: { rowScope: 'own', hiddenFields: ['Private'], readOnlyFields: ['Private'] },
    },
  });
});
afterEach(cleanup);
describe('community table matrix configuration', () => {
  it('previews a selected account and explains both sources and data restrictions', async () => {
    mount();
    await screen.findByText('Finance');
    const region = within(screen.getByRole('region', { name: 'previewTitle' }));
    fireEvent.change(region.getByRole('textbox', { name: 'previewEmail' }), {
      target: { value: 'account@example.com' },
    });
    fireEvent.change(region.getByRole('combobox', { name: 'chooseTable' }), {
      target: { value: 'table' },
    });
    fireEvent.click(region.getByRole('button', { name: 'previewAction' }));
    expect(await region.findByRole('status')).toHaveTextContent('collaborator + matrix');
    expect(region.getByRole('status')).toHaveTextContent('ownRows');
    expect(mocks.previewTableAuthority).toHaveBeenCalledWith({
      baseId: 'base',
      tableId: 'table',
      email: 'account@example.com',
    });
    expect(mocks.saveTableAuthorityPolicy).not.toHaveBeenCalled();
  });
  it('edits independent field and row restrictions and requires review before saving', async () => {
    mount();
    await screen.findByText('Finance');
    fireEvent.change(screen.getByRole('combobox', { name: 'restrictionTable' }), {
      target: { value: 'table' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'addRestriction' }));
    expect(screen.getByRole('checkbox', { name: 'fldName hiddenFieldIds' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'fldPrivate hiddenFieldIds' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'fldName readOnlyFieldIds' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'table rowScope' }), {
      target: { value: 'own' },
    });
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(mocks.saveTableAuthorityPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: {
            ...saved.policy,
            restrictions: [
              {
                tableId: 'table',
                hiddenFieldIds: ['fldPrivate'],
                readOnlyFieldIds: ['fldName'],
                rowScope: 'own',
              },
            ],
          },
        })
      )
    );
  });
  it('does not query privileged endpoints for a non-admin', () => {
    mocks.session.user.isAdmin = false;
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('adminRequired');
    expect(mocks.getTableAuthorityPolicy).not.toHaveBeenCalled();
  });
  it('requires explicit review before saving additional record permissions', async () => {
    mount();
    await screen.findByText('Finance');
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|update' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(mocks.saveTableAuthorityPolicy).toHaveBeenCalledWith({
        baseId: 'base',
        connectionId: 'connection',
        expectedRevision: 3,
        policy: {
          ...saved.policy,
          rules: [
            { ...saved.policy.rules[0], actions: ['table|read', 'record|read', 'record|update'] },
          ],
        },
      })
    );
  });
  it('requires another review when permissions change after review', async () => {
    mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|delete' }));
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
  });
  it('retains unsaved edits after conflict and offers reload', async () => {
    mocks.saveTableAuthorityPolicy.mockRejectedValue(new Error('revision conflict'));
    mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saveFailed');
    expect(screen.getByRole('button', { name: 'reload' })).toBeEnabled();
    expect(mocks.saveTableAuthorityPolicy).toHaveBeenCalledTimes(1);
  });
  it('creates a role in place, refreshes its options and preserves matrix edits', async () => {
    const options = (await mocks.getTableAuthorityOptions()).data;
    options.connections[0].roles = [];
    options.tables.push({ id: 'second', name: 'Expenses', fields: [] });
    mocks.getTableAuthorityOptions.mockResolvedValue({ data: options });
    mocks.getTableAuthorityPolicy.mockResolvedValue({
      data: { ...saved, connectionId: null, policy: { ...saved.policy, rules: [] } },
    });
    mount();
    await screen.findByText('noRoles');
    fireEvent.click(screen.getByRole('button', { name: 'manageRoles' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'createRole' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'createRole' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox', { name: 'roleName' }), {
      target: { value: 'Sales' },
    });
    fireEvent.change(dialog.getByRole('textbox', { name: 'sourceRoleId' }), {
      target: { value: 'sales-external' },
    });
    fireEvent.click(
      within(dialog.getByRole('heading', { name: 'sourceRoleRule' }).closest('section')!).getByRole(
        'button',
        { name: 'addRule' }
      )
    );
    options.connections[0].roles = [{ id: 'sales', name: 'Sales' }];
    fireEvent.click(dialog.getByRole('button', { name: 'saveRole' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.saveDirectoryRole).toHaveBeenCalledWith(
      expect.objectContaining({ corpId: 'corp', name: 'Sales' })
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'chooseRole' })).toBeEnabled());
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'chooseRole' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Sales' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'allTables' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'permissionPreset' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('option', { name: 'editRecords' }));
    fireEvent.click(screen.getByRole('button', { name: 'addRule' }));
    expect(screen.getByRole('checkbox', { name: 'sales table record|update' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'sales second record|delete' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'addRule' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(mocks.saveTableAuthorityPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'connection',
          policy: expect.objectContaining({
            rules: [
              {
                roleId: 'sales',
                tableId: 'table',
                actions: ['table|read', 'record|read', 'record|create', 'record|update'],
              },
              {
                roleId: 'sales',
                tableId: 'second',
                actions: ['table|read', 'record|read', 'record|create', 'record|update'],
              },
            ],
          }),
        })
      )
    );
    expect(await screen.findByText('saveSuccess')).toBeInTheDocument();
  });
  it('requires confirmation before changing enterprise and clearing existing configuration', async () => {
    const options = (await mocks.getTableAuthorityOptions()).data;
    options.connections.push({
      id: 'other',
      name: 'Other enterprise',
      corpId: 'corp-other',
      roles: [],
    });
    mocks.getTableAuthorityOptions.mockResolvedValue({ data: options });
    mount();
    await screen.findByText('Finance');
    const chooseOther = async () => {
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'connection' }), { key: 'ArrowDown' });
      fireEvent.click(await screen.findByRole('option', { name: 'Other enterprise' }));
    };
    await chooseOther();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('switchHelp');
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.getByText('Finance')).toBeInTheDocument();
    await chooseOther();
    fireEvent.click(screen.getByRole('button', { name: 'confirmContinue' }));
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(mocks.saveTableAuthorityPolicy).not.toHaveBeenCalled();
  });
  it('keeps edits when a confirmed reload fails', async () => {
    mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|update' }));
    mocks.getTableAuthorityPolicy.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'reload' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('discardHelp');
    fireEvent.click(screen.getByRole('button', { name: 'confirmContinue' }));
    expect(await screen.findByText('reloadFailed')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'finance table record|update' })).toBeChecked();
  });
  it('does not discard edits when the saved policy refreshes in the background', async () => {
    const { client } = mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|update' }));
    client.setQueryData(['authority-matrix', 'base'], { ...saved, revision: 4 });
    expect(screen.getByRole('checkbox', { name: 'finance table record|update' })).toBeChecked();
    expect(screen.getByText('previewSavedOnly')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() =>
      expect(mocks.saveTableAuthorityPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ expectedRevision: 3 })
      )
    );
  });
  it('binds an employee in place without saving or losing matrix edits', async () => {
    mocks.listDirectoryMembers.mockResolvedValue({
      data: {
        total: 1,
        members: [
          {
            id: 'employee',
            externalId: 'external',
            name: 'Employee',
            email: 'account@example.com',
            active: true,
            userId: null,
            user: null,
            departments: [],
          },
        ],
      },
    });
    mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|update' }));
    fireEvent.click(screen.getByRole('button', { name: 'manageBindings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'bind' }));
    expect(screen.getByRole('textbox', { name: 'accountSearch' })).toHaveValue(
      'account@example.com'
    );
    expect(mocks.searchDirectoryAccounts).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'confirmBind' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'search' }));
    fireEvent.click(await dialog.findByRole('radio'));
    fireEvent.click(dialog.getByRole('button', { name: 'confirmBind' }));
    await waitFor(() =>
      expect(mocks.bindDirectoryMember).toHaveBeenCalledWith({
        corpId: 'corp',
        memberId: 'employee',
        userId: 'account',
        expectedUserId: null,
      })
    );
    expect(screen.getByRole('checkbox', { name: 'finance table record|update' })).toBeChecked();
    expect(mocks.saveTableAuthorityPolicy).not.toHaveBeenCalled();
  });
  it('explains revision conflicts without throwing away the edited rules', async () => {
    mocks.saveTableAuthorityPolicy.mockRejectedValue({ response: { status: 409 } });
    mount();
    await screen.findByText('Finance');
    fireEvent.click(screen.getByRole('checkbox', { name: 'finance table record|update' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saveConflict');
    expect(screen.getByRole('checkbox', { name: 'finance table record|update' })).toBeChecked();
  });
  it('preserves existing role rules when applying a preset to all tables', async () => {
    const options = (await mocks.getTableAuthorityOptions()).data;
    options.tables.push({ id: 'second', name: 'Expenses', fields: [] });
    mocks.getTableAuthorityOptions.mockResolvedValue({ data: options });
    mount();
    await screen.findByText('Finance');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'chooseRole' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Finance' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'allTables' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'permissionPreset' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('option', { name: 'manageRecords' }));
    fireEvent.click(screen.getByRole('button', { name: 'addRule' }));
    expect(screen.getByRole('checkbox', { name: 'finance table record|delete' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'finance second record|delete' })).toBeChecked();
  });
});
