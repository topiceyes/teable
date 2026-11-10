import { useMutation } from '@tanstack/react-query';
import type { IDirectoryConnectionVo, IDirectorySaveConnectionRo } from '@teable/openapi';
import { saveDirectoryConnection, testDirectoryConnection } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

function connectionErrorKey(error: unknown, saving: boolean) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 409) return 'connectionConflict';
  if (status === 503) return 'connectionEncryptionFailed';
  return saving ? 'connectionSaveFailed' : 'connectionTestFailed';
}

export function DirectoryConnectionEditor({
  connection,
  onClose,
  onSaved,
}: {
  connection?: IDirectoryConnectionVo;
  onClose: () => void;
  onSaved: (connection: IDirectoryConnectionVo) => Promise<void>;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [corpId, setCorpId] = useState(connection?.corpId || '');
  const [name, setName] = useState(connection?.name || '');
  const [appKey, setAppKey] = useState(connection?.appKey || '');
  const [appSecret, setAppSecret] = useState('');
  const [testResult, setTestResult] = useState<string>();
  const payload = (): IDirectorySaveConnectionRo => ({
    corpId: corpId.trim(),
    name: name.trim(),
    appKey: appKey.trim(),
    ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
    expectedVersion: connection?.version ?? 0,
  });
  const save = useMutation({
    gcTime: 0,
    mutationFn: () => saveDirectoryConnection(payload()),
    onSuccess: async ({ data }) => {
      setAppSecret('');
      await onSaved(data);
      onClose();
    },
  });
  const test = useMutation({
    gcTime: 0,
    mutationFn: () => testDirectoryConnection(payload()),
    onSuccess: ({ data }) => setTestResult(data.departmentName),
  });
  const busy = save.isPending || test.isPending;
  const valid =
    corpId.trim() &&
    name.trim() &&
    appKey.trim() &&
    (appSecret.trim() || (connection?.hasSecret && appKey.trim() === connection.appKey));
  const changed = () => {
    setTestResult(undefined);
    test.reset();
    save.reset();
  };
  const error = save.error || test.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(connection ? 'editConnection' : 'addConnection')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) save.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t('connectionSetupHelp')}</p>
          <label className="block space-y-1 text-sm">
            <span>{t('companyName')}</span>
            <Input
              required
              maxLength={100}
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>CorpId</span>
            <Input
              required
              maxLength={100}
              value={corpId}
              disabled={busy || Boolean(connection)}
              onChange={(event) => {
                setCorpId(event.target.value);
                changed();
              }}
            />
          </label>
          {connection && <p className="text-xs text-muted-foreground">{t('corpIdImmutable')}</p>}
          <label className="block space-y-1 text-sm">
            <span>AppKey / ClientId</span>
            <Input
              required
              maxLength={256}
              value={appKey}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => {
                setAppKey(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>AppSecret / ClientSecret</span>
            <Input
              type="password"
              autoComplete="new-password"
              maxLength={2048}
              value={appSecret}
              disabled={busy}
              required={!connection?.hasSecret || appKey.trim() !== connection.appKey}
              placeholder={connection?.hasSecret ? t('keepExistingSecret') : undefined}
              onChange={(event) => {
                setAppSecret(event.target.value);
                changed();
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">{t('secretStorageHelp')}</p>
          <p className="text-xs text-muted-foreground">{t('connectionTestScope')}</p>
          {testResult && (
            <p role="status" className="text-sm">
              {t('connectionTestSucceeded', { name: testResult })}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(connectionErrorKey(error, save.isError))}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!valid || busy}
              onClick={() => {
                setTestResult(undefined);
                save.reset();
                test.mutate();
              }}
            >
              {t(test.isPending ? 'testingConnection' : 'testConnection')}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {t(save.isPending ? 'saving' : 'saveConnection')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
