import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ITableAuthorityOptionsVo,
  ITableAuthorityPolicy,
  ITableAuthorityVo,
} from '@teable/openapi';
import {
  getTableAuthorityOptions,
  getTableAuthorityPolicy,
  saveTableAuthorityPolicy,
} from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import {
  Button,
  Checkbox,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { MatrixDataRestrictions } from './MatrixDataRestrictions';
import { MatrixPermissionPreview } from './MatrixPermissionPreview';
import { MatrixSetup } from './MatrixSetup';

const recordWrites = ['record|create', 'record|update', 'record|delete'] as const;
const recordPresets: Record<
  'readOnly' | 'editRecords' | 'manageRecords',
  ITableAuthorityPolicy['rules'][number]['actions']
> = {
  readOnly: ['table|read', 'record|read'],
  editRecords: ['table|read', 'record|read', 'record|create', 'record|update'],
  manageRecords: ['table|read', 'record|read', 'record|create', 'record|update', 'record|delete'],
};
function saveErrorKey(error: unknown) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 409) return 'saveConflict';
  if (status === 404) return 'saveUnavailable';
  return 'saveFailed';
}
function hasUnavailableReferences(
  policy: ITableAuthorityPolicy,
  connectionId: string,
  options?: ITableAuthorityOptionsVo
) {
  if (!options) return false;
  const connection = options.connections.find((item) => item.id === connectionId);
  if (!connection) return true;
  return (
    policy.rules.some(
      (rule) =>
        !connection.roles.some((role) => role.id === rule.roleId) ||
        !options.tables.some((table) => table.id === rule.tableId)
    ) ||
    (policy.restrictions || []).some(
      (rule) =>
        !options.tables.some((table) => table.id === rule.tableId) ||
        rule.roleOverrides?.some(
          (override) => !connection.roles.some((role) => role.id === override.roleId)
        )
    )
  );
}
function MatrixEditor({
  saved,
  onSaved,
  onReload,
}: {
  saved: ITableAuthorityVo;
  onSaved: (saved: ITableAuthorityVo) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [policy, setPolicy] = useState<ITableAuthorityPolicy>(saved.policy);
  const [selectedConnectionId, setConnectionId] = useState(saved.connectionId || '');
  const [roleId, setRoleId] = useState('');
  const [tableId, setTableId] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [allTables, setAllTables] = useState(false);
  const [preset, setPreset] = useState<'readOnly' | 'editRecords' | 'manageRecords'>('readOnly');
  const [confirmation, setConfirmation] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [identityVersion, setIdentityVersion] = useState(0);
  const options = useQuery({
    queryKey: ['authority-matrix-options', saved.baseId],
    queryFn: () => getTableAuthorityOptions(saved.baseId).then(({ data }) => data),
  });
  useEffect(() => {
    if (!selectedConnectionId && !saved.connectionId && options.data?.connections.length === 1)
      setConnectionId(options.data.connections[0].id);
  }, [options.data, saved.connectionId, selectedConnectionId]);
  const connectionId = selectedConnectionId;
  const connection = options.data?.connections.find((item) => item.id === connectionId);
  const mutation = useMutation({
    mutationFn: () =>
      saveTableAuthorityPolicy({
        baseId: saved.baseId,
        connectionId,
        expectedRevision: saved.revision,
        policy,
      }).then(({ data }) => data),
    onSuccess: onSaved,
  });
  const change = (next: ITableAuthorityPolicy) => {
    setPolicy(next);
    setReviewed(false);
    mutation.reset();
  };
  const busy = mutation.isPending || reloading;
  const dirty =
    JSON.stringify(policy) !== JSON.stringify(saved.policy) ||
    selectedConnectionId !== (saved.connectionId || '');
  useEffect(() => {
    if (!dirty) return;
    const preventClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, [dirty]);
  const switchConnection = (id: string) => {
    setConnectionId(id);
    setRoleId('');
    change({ ...policy, rules: [], restrictions: [] });
  };
  const reload = async () => {
    setReloadFailed(false);
    setReloading(true);
    try {
      await onReload();
    } catch {
      setReloadFailed(true);
    } finally {
      setReloading(false);
    }
  };
  const targetTables = allTables ? options.data?.tables || [] : [{ id: tableId }];
  const additions = targetTables.filter(
    (table) =>
      table.id && !policy.rules.some((rule) => rule.roleId === roleId && rule.tableId === table.id)
  );
  const unavailableReferences = hasUnavailableReferences(policy, connectionId, options.data);
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
      <p className="text-sm font-medium">{t('enterpriseStep')}</p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={policy.enabled}
          disabled={busy}
          onCheckedChange={(value) => change({ ...policy, enabled: value === true })}
        />
        {t('enabled')}
      </label>
      <div className="max-w-lg space-y-2">
        <label htmlFor="matrix-connection" className="text-sm">
          {t('connection')}
        </label>
        <Select
          value={connectionId}
          disabled={busy || options.isLoading}
          onValueChange={(value) => {
            if (value === connectionId) return;
            if (policy.rules.length || policy.restrictions?.length) setConfirmation(value);
            else switchConnection(value);
          }}
        >
          <SelectTrigger id="matrix-connection">
            <SelectValue placeholder={t('chooseConnection')} />
          </SelectTrigger>
          <SelectContent>
            {options.data?.connections.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('connectionChange')}</p>
      </div>
      {options.data && !options.data.connections.length && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noConnections')}
        </p>
      )}
      <MatrixSetup
        connection={connection}
        disabled={busy}
        onChanged={() => {
          void options.refetch();
          setIdentityVersion((value) => value + 1);
          setReviewed(false);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={busy || options.isFetching}
        onClick={() => {
          void options.refetch();
          setReviewed(false);
        }}
      >
        {t('refreshOptions')}
      </Button>
      {options.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
          <Button variant="link" onClick={() => options.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      <h2 className="font-semibold">{t('rulesStep')}</h2>
      {connection && !connection.roles.length && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noRoles')}
        </p>
      )}
      {options.data && !options.data.tables.length && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('noTables')}
        </p>
      )}
      {!policy.enabled && <p className="text-sm text-muted-foreground">{t('policyDisabled')}</p>}
      {policy.enabled && unavailableReferences && (
        <p role="alert" className="text-sm text-destructive">
          {t('invalidReferences')}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={roleId}
          onValueChange={setRoleId}
          disabled={busy || !connection?.roles.length}
        >
          <SelectTrigger className="w-56" aria-label={t('chooseRole')}>
            <SelectValue placeholder={t('chooseRole')} />
          </SelectTrigger>
          <SelectContent>
            {connection?.roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={tableId}
          onValueChange={setTableId}
          disabled={busy || !options.data || allTables}
        >
          <SelectTrigger className="w-56" aria-label={t('chooseTable')}>
            <SelectValue placeholder={t('chooseTable')} />
          </SelectTrigger>
          <SelectContent>
            {options.data?.tables.map((table) => (
              <SelectItem key={table.id} value={table.id}>
                {table.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 self-center text-sm">
          <Checkbox
            checked={allTables}
            disabled={busy}
            onCheckedChange={(value) => setAllTables(value === true)}
          />
          {t('allTables')}
        </label>
        <Select
          value={preset}
          disabled={busy}
          onValueChange={(value) => setPreset(value as typeof preset)}
        >
          <SelectTrigger className="w-44" aria-label={t('permissionPreset')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['readOnly', 'editRecords', 'manageRecords'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={
            busy ||
            !roleId ||
            !connection?.roles.some((role) => role.id === roleId) ||
            !additions.length ||
            policy.rules.length + additions.length > 1000
          }
          onClick={() =>
            change({
              ...policy,
              rules: [
                ...policy.rules,
                ...additions.map((table) => ({
                  roleId,
                  tableId: table.id,
                  actions: [...recordPresets[preset]],
                })),
              ],
            })
          }
        >
          {t('addRule')}
        </Button>
      </div>
      {allTables && <p className="text-xs text-muted-foreground">{t('allTablesHelp')}</p>}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-start text-sm">
          <thead className="bg-muted">
            <tr>
              {[
                t('role'),
                t('table'),
                t('read'),
                t('create'),
                t('update'),
                t('delete'),
                t('actions'),
              ].map((label) => (
                <th key={label} className="p-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {policy.rules.map((rule, index) => (
              <tr key={`${rule.roleId}:${rule.tableId}`} className="border-t">
                <td className="p-3">
                  {connection?.roles.find((role) => role.id === rule.roleId)?.name ||
                    t('unavailableRole')}
                </td>
                <td className="p-3">
                  {options.data?.tables.find((table) => table.id === rule.tableId)?.name ||
                    t('unavailableTable')}
                </td>
                <td className="p-3">{t('included')}</td>
                {recordWrites.map((action) => (
                  <td className="p-3" key={action}>
                    <Checkbox
                      aria-label={`${rule.roleId} ${rule.tableId} ${action}`}
                      checked={rule.actions.includes(action)}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        change({
                          ...policy,
                          rules: policy.rules.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  actions:
                                    value === true
                                      ? [...item.actions, action]
                                      : item.actions.filter((entry) => entry !== action),
                                }
                              : item
                          ),
                        })
                      }
                    />
                  </td>
                ))}
                <td className="p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      change({ ...policy, rules: policy.rules.filter((_, i) => i !== index) })
                    }
                  >
                    {t('remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!policy.rules.length && <p className="p-3 text-sm text-muted-foreground">{t('empty')}</p>}
      </div>
      <MatrixDataRestrictions
        policy={policy}
        tables={options.data?.tables || []}
        disabled={busy || !connection}
        roles={connection?.roles || []}
        onChange={change}
      />
      <div className="sticky bottom-0 space-y-3 rounded border bg-background p-4 shadow-sm">
        <p className="text-sm">
          {t(dirty ? 'unsavedChanges' : 'savedState', {
            revision: saved.revision,
            rules: policy.rules.length,
            restrictions: policy.restrictions?.length || 0,
          })}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={reviewed}
            disabled={busy}
            onCheckedChange={(value) => setReviewed(value === true)}
          />
          {t('review')}
        </label>
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t(saveErrorKey(mutation.error))}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            disabled={
              !connectionId ||
              !reviewed ||
              busy ||
              (policy.enabled && (!options.data || unavailableReferences))
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t('saving') : t('save')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => (dirty ? setConfirmation('reload') : void reload())}
          >
            {t('reload')}
          </Button>
        </div>
        {reloadFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t('reloadFailed')}
          </p>
        )}
      </div>
      <MatrixPermissionPreview
        key={`${saved.revision}:${identityVersion}`}
        baseId={saved.baseId}
        tables={options.data?.tables || []}
        unsaved={dirty}
      />
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirmation === 'reload' ? 'discardTitle' : 'switchTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(confirmation === 'reload' ? 'discardHelp' : 'switchHelp')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmation === 'reload') void reload();
                else if (confirmation) switchConnection(confirmation);
                setConfirmation(undefined);
              }}
            >
              {t('confirmContinue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MatrixContent({ baseId }: { baseId: string }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['authority-matrix', baseId],
    queryFn: () => getTableAuthorityPolicy(baseId).then(({ data }) => data),
  });
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<ITableAuthorityVo>();
  const [savedNotice, setSavedNotice] = useState(false);
  useEffect(() => {
    if (query.data) setSnapshot((current) => current || query.data);
  }, [query.data]);
  return (
    <>
      {query.isLoading && <p role="status">{t('loading')}</p>}
      {query.isError && (
        <p role="alert">
          {t('loadFailed')}{' '}
          <Button variant="link" onClick={() => query.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {savedNotice && (
        <p role="status" className="mb-4 text-sm text-green-700">
          {t('saveSuccess')}
        </p>
      )}
      {snapshot && (
        <MatrixEditor
          key={`${snapshot.revision}:${generation}`}
          saved={snapshot}
          onReload={async () => {
            const { data } = await query.refetch({ throwOnError: true });
            setSnapshot(data);
            setGeneration((value) => value + 1);
            setSavedNotice(false);
          }}
          onSaved={(next) => {
            setSnapshot(next);
            setGeneration((value) => value + 1);
            setSavedNotice(true);
            client.setQueryData(['authority-matrix', baseId], next);
            void client.invalidateQueries({ queryKey: ['authority-matrix-options', baseId] });
            // Current table UI refreshes on navigation; server authorization is live on every request.
            void client.invalidateQueries({
              predicate: ({ queryKey }) => queryKey.some((key) => key === baseId),
            });
          }}
        />
      )}
    </>
  );
}

export function AuthorityMatrixPage() {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const { user } = useSession();
  const router = useRouter();
  const baseId = typeof router.query.baseId === 'string' ? router.query.baseId : undefined;
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <Head>
        <title>{t('title')}</title>
      </Head>
      <header className="border-b px-8 py-6">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-8">
        {user?.isAdmin && baseId ? (
          <MatrixContent key={baseId} baseId={baseId} />
        ) : (
          <p role="alert">{t('adminRequired')}</p>
        )}
      </div>
    </main>
  );
}
