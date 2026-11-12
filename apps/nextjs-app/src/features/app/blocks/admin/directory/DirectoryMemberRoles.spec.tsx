import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IDirectoryMemberVo } from '@teable/openapi';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryMemberRoles } from './DirectoryMemberRoles';
import { roleErrorKey } from './DirectoryRoleEditing';
const mocks = vi.hoisted(() => ({
  getDirectoryMemberRoles: vi.fn(),
  saveDirectoryMemberRoles: vi.fn(),
}));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const member = { id: 'employee', name: 'Alice', active: true } as IDirectoryMemberVo;
const roles = [
  {
    id: 'a',
    name: 'Finance',
    enabled: true,
    version: 2,
    rules: [{ type: 'member', memberId: 'employee' }],
    sources: ['member', 'department'],
    effective: true,
  },
  { id: 'b', name: 'HR', enabled: true, version: 4, rules: [], sources: [], effective: false },
];
const onClose = vi.fn();
const onChanged = vi.fn();
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DirectoryMemberRoles
        corpId="corp"
        member={member}
        syncBusy={false}
        onClose={onClose}
        onChanged={onChanged}
      />
    </QueryClientProvider>
  );
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDirectoryMemberRoles.mockResolvedValue({ data: { eligible: true, roles } });
  mocks.saveDirectoryMemberRoles.mockResolvedValue({ data: [] });
});
afterEach(cleanup);
describe('employee role management', () => {
  it('shows inherited sources and saves multiple direct changes in a single request', async () => {
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Finance' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    expect(screen.getByText(/roleSource_member \/ roleSource_department/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'previewRoleChanges' }));
    expect(screen.getByText(/roleChange_retained/)).toBeInTheDocument();
    expect(mocks.saveDirectoryMemberRoles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryMemberRoles).toHaveBeenCalledWith({
        corpId: 'corp',
        memberId: 'employee',
        assignments: [
          { roleId: 'a', expectedVersion: 2, assigned: false },
          { roleId: 'b', expectedVersion: 4, assigned: true },
        ],
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it('keeps selections and reports a stale revision without closing', async () => {
    mocks.saveDirectoryMemberRoles.mockRejectedValue(
      new Error('Role changed or unavailable; refresh before editing')
    );
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'HR' }));
    fireEvent.click(screen.getByRole('button', { name: 'previewRoleChanges' }));
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('roleErrorConflict');
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('preserves edits during a background refresh and requires review again after editing', async () => {
    const client = mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'HR' }));
    fireEvent.click(screen.getByRole('button', { name: 'previewRoleChanges' }));
    await client.invalidateQueries({ queryKey: ['directory-member-roles'] });
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Finance' }));
    expect(screen.queryByRole('button', { name: 'saveRole' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'continueEditing' }));
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('supports preconfiguration for unbound employees and labels it ineffective', async () => {
    mocks.getDirectoryMemberRoles.mockResolvedValue({ data: { eligible: false, roles } });
    mount();
    expect(await screen.findByText('memberRolesPending')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    fireEvent.click(screen.getByRole('button', { name: 'previewRoleChanges' }));
    expect(screen.getByText(/HR · directRoleAdded · roleNotEffective/)).toBeInTheDocument();
  });
  it.each([
    ['Role name already exists in this enterprise', 'roleErrorName'],
    ['Active employee not found in this enterprise', 'roleErrorEmployee'],
    ['Active department not found in this enterprise', 'roleErrorDepartment'],
    ['Directory update already running', 'roleErrorBusy'],
    ['Directory connection disabled', 'roleErrorConnection'],
    ['Role rule limit exceeded', 'roleErrorLimit'],
    ['network disconnected', 'roleSaveFailed'],
  ])('maps error %s to actionable feedback', (message, key) => {
    expect(roleErrorKey(new Error(message))).toBe(key);
  });
  it('opens permission diagnosis after a successful employee role save', async () => {
    const diagnose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DirectoryMemberRoles
          corpId="corp"
          member={member}
          syncBusy={false}
          onClose={onClose}
          onChanged={onChanged}
          onDiagnose={diagnose}
        />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'HR' }));
    fireEvent.click(screen.getByRole('button', { name: 'previewRoleChanges' }));
    fireEvent.click(screen.getByRole('button', { name: 'saveAndDiagnose' }));
    await waitFor(() => expect(diagnose).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
