import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryBindingDialog } from './DirectoryBindingDialog';
import { DirectoryConnectionEditor } from './DirectoryConnectionEditor';
import { DirectoryPage } from './DirectoryPage';

const mocks = vi.hoisted(() => ({
  session: { user: { isAdmin: true } },
  getDirectoryConnections: vi.fn(),
  getDirectorySyncRuns: vi.fn(),
  listDirectoryDepartments: vi.fn(),
  previewDirectorySync: vi.fn(),
  syncDirectory: vi.fn(),
  listDirectoryMembers: vi.fn(),
  bindDirectoryMember: vi.fn(),
  searchDirectoryAccounts: vi.fn(),
  listDirectoryRoles: vi.fn(),
  saveDirectoryRole: vi.fn(),
  getDirectoryRoleMembers: vi.fn(),
  saveDirectoryConnection: vi.fn(),
  testDirectoryConnection: vi.fn(),
}));
vi.mock('@teable/sdk/hooks', () => ({ useSession: () => mocks.session }));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const preview = {
  previewToken: 'a'.repeat(64),
  changes: {
    departments: {
      added: [{ externalId: '1', name: 'Company', parentExternalId: null }],
      updated: [],
      deactivated: [],
    },
    members: { added: [], updated: [], deactivated: [] },
  },
};
const member = {
  id: 'employee',
  externalId: 'external',
  name: 'Employee',
  email: null,
  active: true,
  userId: null,
  user: null,
  departments: [],
  externalRoleIds: [],
};
function mount(ui = <DirectoryPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user.isAdmin = true;
  mocks.getDirectoryConnections.mockResolvedValue({
    data: [{ corpId: 'corp', name: 'Company', provider: 'dingtalk' }],
  });
  mocks.getDirectorySyncRuns.mockResolvedValue({ data: [] });
  mocks.listDirectoryMembers.mockResolvedValue({ data: { members: [], total: 0 } });
  mocks.listDirectoryDepartments.mockResolvedValue({ data: [] });
  mocks.previewDirectorySync.mockResolvedValue({ data: preview });
  mocks.syncDirectory.mockResolvedValue({ data: {} });
  mocks.searchDirectoryAccounts.mockResolvedValue({
    data: [{ id: 'local', name: 'Local account', email: 'local@example.com' }],
  });
  mocks.listDirectoryRoles.mockResolvedValue({ data: [] });
  mocks.saveDirectoryRole.mockResolvedValue({ data: {} });
  mocks.getDirectoryRoleMembers.mockResolvedValue({
    data: {
      total: 1,
      members: [
        {
          memberId: 'member',
          userId: 'local',
          name: 'Matched member',
          email: 'matched@example.com',
        },
      ],
    },
  });
  mocks.bindDirectoryMember.mockResolvedValue({ data: {} });
  mocks.saveDirectoryConnection.mockResolvedValue({
    data: {
      corpId: 'corp',
      name: 'Company',
      appKey: 'key',
      provider: 'dingtalk',
      source: 'database',
      hasSecret: true,
      version: 1,
    },
  });
  mocks.testDirectoryConnection.mockResolvedValue({
    data: { connected: true, departmentName: 'Company' },
  });
});
afterEach(cleanup);
describe('directory admin workflow', () => {
  it('does not query admin APIs for non-admin users', () => {
    mocks.session.user.isAdmin = false;
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('adminRequired');
    expect(mocks.getDirectoryConnections).not.toHaveBeenCalled();
  });
  it('shows deployment guidance when no enterprise is configured', async () => {
    mocks.getDirectoryConnections.mockResolvedValue({ data: [] });
    mount();
    expect(await screen.findByText('noConnections')).toBeInTheDocument();
    expect(mocks.listDirectoryMembers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'addConnection' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'saveConnection' })).toBeDisabled();
  });
  it('tests and saves explicitly entered credentials without auto-syncing', async () => {
    mount(<DirectoryConnectionEditor onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('companyName'), { target: { value: 'Company' } });
    fireEvent.change(screen.getByLabelText('CorpId'), { target: { value: 'corp' } });
    fireEvent.change(screen.getByLabelText('AppKey / ClientId'), { target: { value: 'key' } });
    fireEvent.change(screen.getByLabelText('AppSecret / ClientSecret'), {
      target: { value: 'test-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'testConnection' }));
    expect(await screen.findByRole('status')).toHaveTextContent('connectionTestSucceeded');
    expect(mocks.saveDirectoryConnection).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('companyName'), { target: { value: 'Updated' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'saveConnection' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryConnection).toHaveBeenCalledWith({
        corpId: 'corp',
        name: 'Updated',
        appKey: 'key',
        appSecret: 'test-secret',
        expectedVersion: 0,
        loginEnabled: false,
        autoProvision: false,
      })
    );
    expect(mocks.syncDirectory).not.toHaveBeenCalled();
  });
  it('does not display a stored secret and omits it when keeping the existing credential', async () => {
    mount(
      <DirectoryConnectionEditor
        connection={{
          corpId: 'corp',
          name: 'Company',
          appKey: 'key',
          provider: 'dingtalk',
          source: 'database',
          hasSecret: true,
          version: 3,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByLabelText('CorpId')).toBeDisabled();
    expect(screen.getByLabelText('AppSecret / ClientSecret')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'saveConnection' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryConnection).toHaveBeenCalledWith({
        corpId: 'corp',
        name: 'Company',
        appKey: 'key',
        expectedVersion: 3,
        loginEnabled: false,
        autoProvision: false,
      })
    );
  });
  it('requires a replacement secret after changing the appKey', () => {
    mount(
      <DirectoryConnectionEditor
        connection={{
          corpId: 'corp',
          name: 'Company',
          appKey: 'key',
          provider: 'dingtalk',
          source: 'database',
          hasSecret: true,
          version: 3,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('AppKey / ClientId'), { target: { value: 'new-key' } });
    expect(screen.getByRole('button', { name: 'saveConnection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'testConnection' })).toBeDisabled();
  });
  it('keeps the editor open when save fails and does not expose provider error bodies', async () => {
    mocks.saveDirectoryConnection.mockRejectedValue({
      response: { status: 409, data: { message: 'private-secret' } },
    });
    mount(
      <DirectoryConnectionEditor
        connection={{
          corpId: 'corp',
          name: 'Company',
          appKey: 'key',
          provider: 'dingtalk',
          source: 'database',
          hasSecret: true,
          version: 3,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'saveConnection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connectionConflict');
    expect(screen.queryByText('private-secret')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('requires review confirmation and applies the exact preview token to the selected enterprise', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'previewSync' }));
    const apply = await screen.findByRole('button', { name: 'applySync' });
    expect(apply).toBeDisabled();
    expect(mocks.syncDirectory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(apply);
    await waitFor(() =>
      expect(mocks.syncDirectory).toHaveBeenCalledWith({
        corpId: 'corp',
        previewToken: preview.previewToken,
      })
    );
    expect(await screen.findByText('syncSucceeded')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('discards the preview after a failed apply and requires a new preview', async () => {
    mocks.syncDirectory.mockRejectedValue(new Error('conflict'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'previewSync' }));
    await screen.findByRole('button', { name: 'applySync' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'applySync' }));
    expect(await screen.findByText('syncFailed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.syncDirectory).toHaveBeenCalledTimes(1);
  });
  it('scopes new queries to the selected enterprise and resets employee search', async () => {
    mocks.getDirectoryConnections.mockResolvedValue({
      data: [
        { corpId: 'corp', name: 'Company', provider: 'dingtalk' },
        { corpId: 'other', name: 'Other company', provider: 'dingtalk' },
      ],
    });
    mount();
    fireEvent.change(await screen.findByRole('textbox', { name: 'employeeSearch' }), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() =>
      expect(mocks.listDirectoryMembers).toHaveBeenCalledWith({
        corpId: 'corp',
        search: 'Alice',
        skip: 0,
        take: 50,
      })
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Other company · other' }));
    await waitFor(() =>
      expect(mocks.listDirectoryMembers).toHaveBeenCalledWith({
        corpId: 'other',
        search: undefined,
        skip: 0,
        take: 50,
      })
    );
    expect(screen.getByRole('textbox', { name: 'employeeSearch' })).toHaveValue('');
  });
  it('creates a business role with an explicit source role mapping and an initial revision', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'businessRoles' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'createRole' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'createRole' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'roleName' }), {
      target: { value: 'Finance' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'sourceRoleId' }), {
      target: { value: 'source-finance' },
    });
    const sourceSection = screen
      .getByRole('heading', { name: 'sourceRoleRule' })
      .closest('section')!;
    fireEvent.click(within(sourceSection).getByRole('button', { name: 'addRule' }));
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryRole).toHaveBeenCalledWith({
        corpId: 'corp',
        roleId: undefined,
        expectedVersion: 0,
        name: 'Finance',
        enabled: true,
        rules: [{ type: 'externalRole', externalRoleId: 'source-finance' }],
      })
    );
  });
  it('previews effective members in the selected enterprise without granting permissions', async () => {
    mocks.listDirectoryRoles.mockResolvedValue({
      data: [{ id: 'finance', name: 'Finance', enabled: true, version: 1, rules: [] }],
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'businessRoles' }));
    fireEvent.click(await screen.findByRole('button', { name: 'effectiveMembers' }));
    expect(await screen.findByText('matched@example.com')).toBeInTheDocument();
    expect(mocks.getDirectoryRoleMembers).toHaveBeenCalledWith({
      corpId: 'corp',
      roleId: 'finance',
      skip: 0,
      take: 50,
    });
    expect(mocks.saveDirectoryRole).not.toHaveBeenCalled();
  });
  it('searches accounts explicitly and binds the chosen ID without automatic matching', async () => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mount(
      <DirectoryBindingDialog
        corpId="corp"
        member={member}
        onClose={onClose}
        onChanged={onChanged}
      />
    );
    expect(mocks.searchDirectoryAccounts).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'confirmBind' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'accountSearch' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    fireEvent.click(await screen.findByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'confirmBind' }));
    await waitFor(() =>
      expect(mocks.bindDirectoryMember).toHaveBeenCalledWith({
        corpId: 'corp',
        memberId: 'employee',
        userId: 'local',
        expectedUserId: null,
      })
    );
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
  it('unlinks using the account ID that was displayed to the administrator', async () => {
    mount(
      <DirectoryBindingDialog
        corpId="corp"
        member={{
          ...member,
          userId: 'previous',
          user: { id: 'previous', name: 'Previous', email: 'previous@example.com' },
        }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'confirmUnbind' }));
    await waitFor(() =>
      expect(mocks.bindDirectoryMember).toHaveBeenCalledWith({
        corpId: 'corp',
        memberId: 'employee',
        userId: null,
        expectedUserId: 'previous',
      })
    );
    expect(mocks.searchDirectoryAccounts).not.toHaveBeenCalled();
  });
});
