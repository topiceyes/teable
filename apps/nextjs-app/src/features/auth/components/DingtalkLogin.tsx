import type { IDingtalkProvidersVo } from '@teable/openapi';
import { DINGTALK_START, getDingtalkProviders, startDingtalkBinding } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { isValidRedirectPath } from '@/lib/isValidRedirectPath';

const errorKeys = {
  DINGTALK_BIND_REQUIRED: 'bindRequired',
  DINGTALK_BINDING_CONFLICT: 'bindingConflict',
  DINGTALK_EMPLOYEE_UNAVAILABLE: 'employeeUnavailable',
  DINGTALK_ACCOUNT_UNAVAILABLE: 'accountUnavailable',
  DINGTALK_STATE_INVALID: 'expired',
  DINGTALK_LOGIN_UNAVAILABLE: 'unavailable',
  DINGTALK_LOGIN_FAILED: 'failed',
} as const;

export function DingtalkLogin({ binding = false }: { binding?: boolean }) {
  const { t } = useTranslation('common', { keyPrefix: 'dingtalkLogin' });
  const router = useRouter();
  const [providers, setProviders] = useState<IDingtalkProvidersVo>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const error =
    typeof router.query.authError === 'string'
      ? errorKeys[router.query.authError as keyof typeof errorKeys]
      : undefined;
  useEffect(() => {
    let mounted = true;
    getDingtalkProviders()
      .then(({ data }) => {
        if (mounted) setProviders(data);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const start = async (corpId: string) => {
    const requested = typeof router.query.redirect === 'string' ? router.query.redirect : '';
    const redirect = binding
      ? '/space'
      : requested && isValidRedirectPath(requested)
        ? requested
        : '/space';
    if (!binding) {
      window.location.assign(
        '/api' + DINGTALK_START + '?' + new URLSearchParams({ corpId, redirect })
      );
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await startDingtalkBinding({ corpId, redirect });
      const url = new URL(data.url);
      if (url.origin !== 'https://login.dingtalk.com') throw new Error('Invalid login origin');
      window.location.assign(url.href);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (!providers.length && !error) return null;
  return (
    <div className="my-4 space-y-2">
      {binding && <p className="text-sm font-medium">{t('bindTitle')}</p>}
      <p className="text-muted-foreground text-xs">{t(binding ? 'bindHelp' : 'loginHelp')}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(error)}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {t('failed')}
        </p>
      )}
      {providers.map((provider) => (
        <Button
          key={provider.corpId}
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void start(provider.corpId)}
        >
          {t(binding ? 'bindButton' : 'loginButton', { name: provider.name })}
        </Button>
      ))}
    </div>
  );
}
