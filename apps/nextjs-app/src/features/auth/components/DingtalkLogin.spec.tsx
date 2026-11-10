import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DingtalkLogin } from './DingtalkLogin';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  bind: vi.fn(),
  router: { query: {} as Record<string, string> },
}));
vi.mock('@teable/openapi', () => ({
  DINGTALK_START: '/auth/dingtalk/start',
  getDingtalkProviders: mocks.get,
  startDingtalkBinding: mocks.bind,
}));
vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? key + ' ' + options.name : key,
  }),
}));
vi.mock('@teable/ui-lib/shadcn', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
beforeEach(() => {
  mocks.get.mockResolvedValue({ data: [{ corpId: 'corp', name: 'Company' }] });
  mocks.router.query = {};
  mocks.bind.mockReset();
});
afterEach(cleanup);
describe('DingTalk sign-in and authenticated linking', () => {
  it('renders enterprise sign-in without embedding secrets or SDK scripts', async () => {
    render(<DingtalkLogin />);
    expect(await screen.findByRole('button', { name: 'loginButton Company' })).toBeVisible();
  });
  it('hides the option when no enterprise has enabled sign-in', async () => {
    mocks.get.mockResolvedValue({ data: [] });
    const { container } = render(<DingtalkLogin />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
  it('shows actionable existing-account binding instructions', async () => {
    mocks.router.query.authError = 'DINGTALK_BIND_REQUIRED';
    render(<DingtalkLogin />);
    expect(screen.getByRole('alert')).toHaveTextContent('bindRequired');
    await screen.findByRole('button');
  });
  it('never renders an arbitrary provider error from the URL', async () => {
    mocks.router.query.authError = '<script>secret</script>';
    render(<DingtalkLogin />);
    await screen.findByRole('button');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('uses the authenticated binding endpoint and reports errors', async () => {
    mocks.bind.mockRejectedValue(new Error('denied'));
    render(<DingtalkLogin binding />);
    fireEvent.click(await screen.findByRole('button', { name: 'bindButton Company' }));
    await waitFor(() =>
      expect(mocks.bind).toHaveBeenCalledWith({ corpId: 'corp', redirect: '/space' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('failed');
  });
});
