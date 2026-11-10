import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDirectoryConnections,
  getDirectorySyncRuns,
  listDirectoryDepartments,
  previewDirectorySync,
  syncDirectory,
} from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { DirectoryConnectionEditor } from './DirectoryConnectionEditor';
import { DirectoryMembers } from './DirectoryMembers';
import { DirectoryRoles } from './DirectoryRoles';
import { DirectorySyncPreview } from './DirectorySyncPreview';

function DirectoryDepartments({ corpId }: { corpId: string }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [parentId, setParentId] = useState<string>();
  const [search, setSearch] = useState('');
  const departments = useQuery({
    queryKey: ['directory-departments', corpId],
    queryFn: () => listDirectoryDepartments({ corpId }).then(({ data }) => data),
  });
  const parent = departments.data?.find((department) => department.id === parentId);
  const visible = departments.data?.filter((department) =>
    search.trim()
      ? department.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
      : department.parentId === parentId
  );
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('departments')}</h2>
      <Input
        className="max-w-lg"
        aria-label={t('departmentSearch')}
        placeholder={t('departmentSearch')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <nav aria-label={t('departmentPath')} className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => {
            setParentId(undefined);
            setSearch('');
          }}
        >
          {t('allDepartments')}
        </Button>
        {parent?.path?.map((id, index) => (
          <span key={id} className="flex items-center gap-2">
            <span>/</span>
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => {
                setParentId(id);
                setSearch('');
              }}
            >
              {parent.pathName?.[index]}
            </Button>
          </span>
        ))}
      </nav>
      {departments.isLoading && <p role="status">{t('loading')}</p>}
      {departments.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('directoryLoadFailed')}{' '}
          <Button variant="link" onClick={() => departments.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {departments.data && (
        <ul className="divide-y rounded border">
          {visible?.map((department) => (
            <li key={department.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-medium">{department.name}</p>
                <p className="text-xs text-muted-foreground">{department.pathName?.join(' / ')}</p>
              </div>
              {department.hasChildren && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setParentId(department.id);
                    setSearch('');
                  }}
                >
                  {t('browse')}
                </Button>
              )}
            </li>
          ))}
          {!visible?.length && (
            <li className="p-3 text-sm text-muted-foreground">{t('noDepartments')}</li>
          )}
        </ul>
      )}
    </section>
  );
}

function DirectoryConnectionPanel({ corpId }: { corpId: string }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const queryClient = useQueryClient();
  const runs = useQuery({
    queryKey: ['directory-runs', corpId],
    queryFn: () => getDirectorySyncRuns({ corpId }).then(({ data }) => data),
  });
  const preview = useMutation({
    mutationFn: () => previewDirectorySync({ corpId }).then(({ data }) => data),
  });
  const refresh = () => {
    for (const key of [
      'directory-runs',
      'directory-members',
      'directory-departments',
      'directory-accounts',
      'directory-role-members',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key, corpId] });
    }
  };
  const sync = useMutation({
    mutationFn: () => syncDirectory({ corpId, previewToken: preview.data!.previewToken }),
    onSuccess: () => {
      preview.reset();
      refresh();
    },
    onError: () => {
      preview.reset();
      refresh();
    },
  });
  const busy = preview.isPending || sync.isPending;
  const [tab, setTab] = useState<'members' | 'departments' | 'roles' | 'runs'>('members');
  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return t('runPending');
      case 'running':
        return t('runRunning');
      case 'succeeded':
        return t('runSucceeded');
      case 'failed':
        return t('runFailed');
      default:
        return t('runUnknown');
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('syncDescription')}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              sync.reset();
              preview.mutate();
            }}
          >
            {preview.isPending ? t('previewing') : t('previewSync')}
          </Button>
        </div>
      </div>
      {preview.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('previewFailed')}
        </p>
      )}
      {sync.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('syncFailed')}
        </p>
      )}
      {sync.isSuccess && (
        <p role="status" className="text-sm">
          {t('syncSucceeded')}
        </p>
      )}
      <div className="flex gap-2 border-b pb-3" role="group" aria-label={t('sections')}>
        {(['members', 'departments', 'roles', 'runs'] as const).map((key) => (
          <Button
            key={key}
            variant={tab === key ? 'default' : 'outline'}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {key === 'members'
              ? t('employees')
              : key === 'departments'
                ? t('departments')
                : key === 'roles'
                  ? t('businessRoles')
                  : t('syncLogs')}
          </Button>
        ))}
      </div>
      {tab === 'members' && (
        <DirectoryMembers
          corpId={corpId}
          syncBusy={busy}
          onChanged={() => {
            preview.reset();
            refresh();
          }}
        />
      )}
      {tab === 'departments' && <DirectoryDepartments corpId={corpId} />}
      {tab === 'roles' && <DirectoryRoles corpId={corpId} syncBusy={busy} />}
      {tab === 'runs' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('syncLogs')}</h2>
          {runs.isLoading && <p role="status">{t('loading')}</p>}
          {runs.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('loadFailed')}
            </p>
          )}
          {runs.data && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-start text-sm">
                <thead className="bg-muted">
                  <tr>
                    {[
                      t('startedTime'),
                      t('finishedTime'),
                      t('status'),
                      t('departments'),
                      t('employees'),
                      t('errorCode'),
                    ].map((label) => (
                      <th className="p-3 font-medium" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="whitespace-nowrap p-3">
                        {new Date(run.startedTime).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {run.finishedTime ? new Date(run.finishedTime).toLocaleString() : '—'}
                      </td>
                      <td className="p-3">{statusLabel(run.status)}</td>
                      <td className="p-3">{run.departmentCount}</td>
                      <td className="p-3">{run.memberCount}</td>
                      <td className="p-3">{run.errorCode || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!runs.data.length && (
                <p className="p-3 text-sm text-muted-foreground">{t('noLogs')}</p>
              )}
            </div>
          )}
        </section>
      )}
      {preview.data && (
        <DirectorySyncPreview
          key={preview.data.previewToken}
          preview={preview.data}
          busy={sync.isPending}
          onClose={() => preview.reset()}
          onApply={() => sync.mutate()}
        />
      )}
    </div>
  );
}

function DirectoryContent() {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: ['directory-connections'],
    queryFn: () => getDirectoryConnections().then(({ data }) => data),
  });
  const [selected, setSelected] = useState<string>();
  const [editor, setEditor] = useState<'new' | 'edit'>();
  const corpId =
    connections.data?.find((connection) => connection.corpId === selected)?.corpId ||
    connections.data?.[0]?.corpId;
  const selectedConnection = connections.data?.find((connection) => connection.corpId === corpId);
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => setEditor('new')}>{t('addConnection')}</Button>
        {selectedConnection?.source === 'database' && (
          <Button variant="outline" onClick={() => setEditor('edit')}>
            {t('editConnection')}
          </Button>
        )}
      </div>
      {connections.isLoading && <p role="status">{t('loading')}</p>}
      {connections.isError && (
        <p role="alert">
          {t('connectionsFailed')}{' '}
          <Button variant="outline" onClick={() => connections.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {connections.data?.length === 0 && (
        <div className="rounded-lg border p-6">
          <h2 className="font-semibold">{t('noConnections')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('setupDescription')}</p>
        </div>
      )}
      {corpId && (
        <>
          <div className="mb-5 max-w-lg space-y-2">
            <label htmlFor="directory-connection" className="text-sm font-medium">
              {t('connection')}
            </label>
            <Select value={corpId} onValueChange={setSelected}>
              <SelectTrigger id="directory-connection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.data?.map((connection) => (
                  <SelectItem key={connection.corpId} value={connection.corpId}>
                    {connection.name} · {connection.corpId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedConnection?.source === 'environment' && (
            <p className="mb-4 text-sm text-muted-foreground">{t('environmentManaged')}</p>
          )}
          <DirectoryConnectionPanel
            key={`${corpId}:${selectedConnection?.version}`}
            corpId={corpId}
          />
        </>
      )}
      {editor && (
        <DirectoryConnectionEditor
          connection={editor === 'edit' ? selectedConnection : undefined}
          onClose={() => setEditor(undefined)}
          onSaved={async (connection) => {
            setSelected(connection.corpId);
            await queryClient.invalidateQueries({ queryKey: ['directory-connections'] });
          }}
        />
      )}
    </>
  );
}

export function DirectoryPage() {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const { user } = useSession();
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-b px-6 py-5">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {user?.isAdmin ? <DirectoryContent /> : <p role="alert">{t('adminRequired')}</p>}
      </div>
    </main>
  );
}
