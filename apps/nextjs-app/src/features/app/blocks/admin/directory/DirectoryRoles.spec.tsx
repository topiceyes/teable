import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IDirectoryRoleVo } from '@teable/openapi';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryRoles } from './DirectoryRoles';

const mocks = vi.hoisted(() => ({
  listDirectoryRoles: vi.fn(),
  listDirectoryMembers: vi.fn(),
  listDirectoryDepartments: vi.fn(),
  saveDirectoryRole: vi.fn(),
  getDirectoryRoleMembers: vi.fn(),
}));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const employee = {
  id: 'employee',
  name: 'Alice',
  externalId: 'dt-alice',
  active: true,
  userId: null,
  user: null,
  email: null,
  departments: [],
  externalRoleIds: [],
};
const departmentRule = {
  type: 'department' as const,
  departmentId: 'dept',
  includeDescendants: false,
};
const role: IDirectoryRoleVo = {
  id: 'role',
  name: 'Approvers',
  enabled: true,
  version: 3,
  rules: [departmentRule, { type: 'member', memberId: 'employee' }],
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DirectoryRoles corpId="corp" syncBusy={false} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDirectoryRoles.mockResolvedValue({ data: [role] });
  mocks.listDirectoryDepartments.mockResolvedValue({
    data: [{ id: 'dept', name: 'Finance', pathName: ['Finance'] }],
  });
  mocks.listDirectoryMembers.mockResolvedValue({ data: { members: [employee], total: 1 } });
  mocks.saveDirectoryRole.mockResolvedValue({ data: role });
});
afterEach(cleanup);
describe('specified role people', () => {
  it('restores people by exact IDs and removes only direct assignments while preserving department rules', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'editRole' }));
    const selected = within(screen.getByRole('list', { name: 'selectedRolePeople' }));
    expect(await selected.findByText('Alice')).toBeInTheDocument();
    expect(mocks.listDirectoryMembers).toHaveBeenCalledWith({
      corpId: 'corp',
      memberIds: ['employee'],
      take: 100,
    });
    expect(screen.getByText('removeRoleMemberDescription')).toBeInTheDocument();
    fireEvent.click(selected.getByRole('button', { name: 'removeRoleMember Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryRole).toHaveBeenCalledWith({
        corpId: 'corp',
        roleId: 'role',
        expectedVersion: 3,
        name: 'Approvers',
        enabled: true,
        rules: [departmentRule],
      })
    );
  });
  it('searches people and saves a member-only role without a department rule', async () => {
    mocks.listDirectoryRoles.mockResolvedValue({ data: [] });
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'createRole' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'createRole' }));
    expect(mocks.listDirectoryMembers).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'roleName' }), {
      target: { value: 'Named people' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'rolePeopleSearch' }), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'addRoleMember Alice' }));
    expect(screen.getByRole('button', { name: 'addRoleMember Alice' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    await waitFor(() =>
      expect(mocks.saveDirectoryRole).toHaveBeenCalledWith({
        corpId: 'corp',
        roleId: undefined,
        expectedVersion: 0,
        name: 'Named people',
        enabled: true,
        rules: [{ type: 'member', memberId: 'employee' }],
      })
    );
  });
  it('paginates search results and prevents adding departed or duplicate people', async () => {
    mocks.listDirectoryMembers.mockImplementation(async (ro) => ({
      data: {
        members: ro.memberIds
          ? [employee]
          : [employee, { ...employee, id: 'gone', name: 'Departed', active: false }],
        total: 55,
      },
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'editRole' }));
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(await screen.findByRole('button', { name: 'addRoleMember Alice' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'addRoleMember Departed' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() =>
      expect(mocks.listDirectoryMembers).toHaveBeenCalledWith({
        corpId: 'corp',
        search: '',
        skip: 50,
        take: 50,
      })
    );
  });
  it('keeps the editor and unsaved choices visible when a stale save fails', async () => {
    mocks.saveDirectoryRole.mockRejectedValue(new Error('Role changed'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'editRole' }));
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'saveRole' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('roleSaveFailed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'removeRoleMember Alice' })).toBeEnabled();
  });
});
