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
}));
vi.mock('@teable/sdk/hooks', () => ({ useSession: () => mocks.session }));
vi.mock('@teable/openapi', () => mocks);
vi.mock('next/router', () => ({ useRouter: () => ({ query: { baseId: 'base' } }) }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
  return render(
    <QueryClientProvider client={client}>
      <AuthorityMatrixPage />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user.isAdmin = true;
  mocks.getTableAuthorityPolicy.mockResolvedValue({ data: structuredClone(saved) });
  mocks.getTableAuthorityOptions.mockResolvedValue({
    data: {
      connections: [
        { id: 'connection', name: 'Company', roles: [{ id: 'finance', name: 'Finance' }] },
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
});
