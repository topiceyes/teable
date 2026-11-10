import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableAuthorityPolicy, ITableAuthorityVo } from '@teable/openapi';
import {
  getTableAuthorityOptions,
  getTableAuthorityPolicy,
  saveTableAuthorityPolicy,
} from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import {
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { MatrixDataRestrictions } from './MatrixDataRestrictions';
import { MatrixPermissionPreview } from './MatrixPermissionPreview';

const recordWrites = ['record|create', 'record|update', 'record|delete'] as const;
function MatrixEditor({ saved, onSaved }: { saved: ITableAuthorityVo; onSaved: () => void }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [policy, setPolicy] = useState<ITableAuthorityPolicy>(saved.policy);
  const [connectionId, setConnectionId] = useState(saved.connectionId || '');
  const [roleId, setRoleId] = useState('');
  const [tableId, setTableId] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const options = useQuery({
    queryKey: ['authority-matrix-options', saved.baseId],
    queryFn: () => getTableAuthorityOptions(saved.baseId).then(({ data }) => data),
  });
  const connection = options.data?.connections.find((item) => item.id === connectionId);
  const mutation = useMutation({
    mutationFn: () =>
      saveTableAuthorityPolicy({
        baseId: saved.baseId,
        connectionId,
        expectedRevision: saved.revision,
        policy,
      }),
    onSuccess: onSaved,
  });
  const change = (next: ITableAuthorityPolicy) => {
    setPolicy(next);
    setReviewed(false);
  };
  return (
    <div className="space-y-5">
      <MatrixPermissionPreview baseId={saved.baseId} tables={options.data?.tables || []} />
      <MatrixDataRestrictions
        policy={policy}
        tables={options.data?.tables || []}
        disabled={mutation.isPending}
        onChange={change}
      />
      <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={policy.enabled}
          disabled={mutation.isPending}
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
          disabled={mutation.isPending || options.isLoading}
          onValueChange={(value) => {
            setConnectionId(value);
            setRoleId('');
            change({ ...policy, rules: [], restrictions: [] });
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
      {options.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={roleId}
          onValueChange={setRoleId}
          disabled={mutation.isPending || !connection}
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
          disabled={mutation.isPending || !options.data}
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
        <Button
          variant="outline"
          disabled={
            mutation.isPending ||
            !roleId ||
            !tableId ||
            policy.rules.length >= 1000 ||
            policy.rules.some((rule) => rule.roleId === roleId && rule.tableId === tableId)
          }
          onClick={() =>
            change({
              ...policy,
              rules: [...policy.rules, { roleId, tableId, actions: ['table|read', 'record|read'] }],
            })
          }
        >
          {t('addRule')}
        </Button>
      </div>
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
                      disabled={mutation.isPending}
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
                    disabled={mutation.isPending}
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
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={reviewed}
          disabled={mutation.isPending}
          onCheckedChange={(value) => setReviewed(value === true)}
        />
        {t('review')}
      </label>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('saveFailed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={
            !connectionId || !reviewed || mutation.isPending || (policy.enabled && !options.data)
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? t('saving') : t('save')}
        </Button>
        <Button variant="outline" disabled={mutation.isPending} onClick={onSaved}>
          {t('reload')}
        </Button>
      </div>
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
  return (
    <>
      {query.isLoading && <p role="status">{t('loading')}</p>}
      {query.isError && <p role="alert">{t('loadFailed')}</p>}
      {query.data && (
        <MatrixEditor
          key={`${query.data.revision}:${generation}`}
          saved={query.data}
          onSaved={() => {
            void query.refetch().then(() => setGeneration((value) => value + 1));
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
