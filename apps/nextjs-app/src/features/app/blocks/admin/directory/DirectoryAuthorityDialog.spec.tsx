import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryAuthorityDialog } from './DirectoryAuthorityDialog';

const mocks = vi.hoisted(() => ({
  getMemberAuthorityOverview: vi.fn(),
  getMemberAuthorityTables: vi.fn(),
}));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const overview = {
  checkedAt: '2026-11-11T00:00:00Z',
  employee: {
    id: 'employee',
    name: 'Employee',
    active: true,
    connectionEnabled: true,
    account: {
      id: 'usr-user',
      name: 'User',
      email: 'user@example.com',
      active: true,
      isAdmin: false,
    },
    departments: [{ id: 'department', name: 'Sales' }],
    roles: [{ id: 'writer', name: 'Writer' }],
  },
  diagnostics: [],
  total: 11,
  bases: [
    {
      id: 'base',
      name: 'Orders',
      spaceName: 'Business',
      hasBaseAccess: true,
      memberships: [{ resourceType: 'space', role: 'viewer' }],
      policyState: 'enabled',
      diagnostics: [],
    },
  ],
};
const tables = {
  checkedAt: '2026-11-11T00:00:00Z',
  base: { id: 'base', name: 'Orders', spaceName: 'Business' },
  total: 11,
  tables: [
    {
      id: 'table',
      name: 'Invoices',
      hasBaseAccess: true,
      actions: [{ action: 'record|update', allowed: true, sources: ['collaborator', 'matrix'] }],
      dataScope: {
        rowScope: 'department',
        hiddenFields: ['Private'],
        readOnlyFields: ['Locked'],
        emptyRowScope: true,
      },
      diagnostics: ['collaboratorWrite', 'matrixWrite', 'emptyDepartmentScope'],
    },
  ],
};
function mount(memberId = 'employee') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectoryAuthorityDialog corpId="corp" memberId={memberId} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMemberAuthorityOverview.mockResolvedValue({ data: structuredClone(overview) });
  mocks.getMemberAuthorityTables.mockResolvedValue({ data: structuredClone(tables) });
});
afterEach(cleanup);
describe('employee authority overview', () => {
  it('loads employee identity and base memberships, then explicitly inspects table permissions', async () => {
    mount();
    await screen.findByText(/Sales/);
    expect(screen.getByText(/Writer/)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(mocks.getMemberAuthorityTables).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'inspectTables' }));
    expect(await screen.findByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('collaborator + matrix')).toBeInTheDocument();
    expect(screen.getByText('diagnostics.collaboratorWrite')).toBeInTheDocument();
    expect(screen.getByText('diagnostics.emptyDepartmentScope')).toBeInTheDocument();
    expect(screen.getByText(/Private/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'openMatrix' })).toHaveAttribute(
      'href',
      '/base/base/authority-matrix'
    );
    expect(mocks.getMemberAuthorityTables).toHaveBeenCalledWith({
      corpId: 'corp',
      memberId: 'employee',
      baseId: 'base',
      skip: 0,
      take: 10,
      search: undefined,
    });
  });
  it('keeps base and table searches and pagination scoped to the selected employee', async () => {
    mount();
    await screen.findByText(/Sales/);
    fireEvent.click(screen.getByRole('button', { name: 'inspectTables' }));
    await screen.findByText('Invoices');
    const region = within(screen.getByRole('region', { name: 'tableDetails' }));
    fireEvent.click(region.getByRole('button', { name: 'nextTables' }));
    await waitFor(() =>
      expect(mocks.getMemberAuthorityTables).toHaveBeenLastCalledWith(
        expect.objectContaining({ corpId: 'corp', memberId: 'employee', baseId: 'base', skip: 10 })
      )
    );
    fireEvent.change(region.getByRole('textbox', { name: 'tableSearch' }), {
      target: { value: ' invoice ' },
    });
    fireEvent.click(region.getByRole('button', { name: 'search' }));
    await waitFor(() =>
      expect(mocks.getMemberAuthorityTables).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'invoice', skip: 0 })
      )
    );
    const bases = within(screen.getByRole('region', { name: 'bases' }));
    fireEvent.change(bases.getByRole('textbox', { name: 'baseSearch' }), {
      target: { value: ' Sales ' },
    });
    fireEvent.submit(bases.getByRole('textbox', { name: 'baseSearch' }).closest('form')!);
    await waitFor(() =>
      expect(mocks.getMemberAuthorityOverview).toHaveBeenLastCalledWith({
        corpId: 'corp',
        memberId: 'employee',
        search: 'Sales',
        skip: 0,
        take: 10,
      })
    );
    expect(screen.queryByRole('region', { name: 'tableDetails' })).not.toBeInTheDocument();
  });
  it('shows unbound and departed identity diagnostics instead of implying automatic access', async () => {
    mocks.getMemberAuthorityOverview.mockResolvedValue({
      data: {
        ...overview,
        employee: { ...overview.employee, account: null, active: false, roles: [] },
        diagnostics: ['accountUnbound', 'employeeInactive'],
        bases: [
          {
            ...overview.bases[0],
            hasBaseAccess: false,
            memberships: [],
            diagnostics: ['noBaseAccess'],
          },
        ],
      },
    });
    mount();
    expect(await screen.findByText('diagnostics.accountUnbound')).toBeInTheDocument();
    expect(screen.getByText('diagnostics.employeeInactive')).toBeInTheDocument();
    expect(screen.getByText('diagnostics.noBaseAccess')).toBeInTheDocument();
    expect(screen.getByText(/noAccount/)).toBeInTheDocument();
  });
  it('rechecks both the identity and expanded table results after refresh', async () => {
    mount();
    await screen.findByText(/Sales/);
    fireEvent.click(screen.getByRole('button', { name: 'inspectTables' }));
    await screen.findByText('Invoices');
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => {
      expect(mocks.getMemberAuthorityOverview).toHaveBeenCalledTimes(2);
      expect(mocks.getMemberAuthorityTables).toHaveBeenCalledTimes(2);
    });
  });
  it('offers retry when calculation fails and does not render false denials', async () => {
    mocks.getMemberAuthorityOverview.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('loadFailed');
    expect(screen.queryByText('noBaseAccess')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText(/Sales/)).toBeInTheDocument();
  });
});
