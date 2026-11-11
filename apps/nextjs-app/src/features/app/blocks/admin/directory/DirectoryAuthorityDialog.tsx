import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IMemberAuthorityDiagnostic, IMemberAuthorityTablesVo } from '@teable/openapi';
import { getMemberAuthorityOverview, getMemberAuthorityTables } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

function Diagnostics({ codes }: { codes: IMemberAuthorityDiagnostic[] }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.authority' });
  if (!codes.length) return null;
  return (
    <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
      {[...new Set(codes)].map((code) => (
        <li key={code}>{t(`diagnostics.${code}`)}</li>
      ))}
    </ul>
  );
}

const actionLabels = {
  'table|read': 'tableRead',
  'record|read': 'recordRead',
  'record|create': 'recordCreate',
  'record|update': 'recordUpdate',
  'record|delete': 'recordDelete',
} as const;
function TableResult({ table }: { table: IMemberAuthorityTablesVo['tables'][number] }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.authority' });
  return (
    <article className="space-y-3 rounded border p-3">
      <h4 className="font-semibold">{table.name}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr>
              <th>{t('operation')}</th>
              <th>{t('result')}</th>
              <th>{t('source')}</th>
            </tr>
          </thead>
          <tbody>
            {table.actions.map((action) => (
              <tr key={action.action}>
                <td className="py-1">
                  {t(actionLabels[action.action as keyof typeof actionLabels])}
                </td>
                <td>{t(action.allowed ? 'allowed' : 'denied')}</td>
                <td>{action.sources.map((source) => t(source)).join(' + ') || t('none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.dataScope && (
        <div className="space-y-1 text-sm">
          <p>
            {t('scopeSource')}: {table.dataScope.appliedRole?.name || t('defaultScope')}
          </p>
          <p>
            {t('rowScope')}: {t(`scopes.${table.dataScope.rowScope}`)}
          </p>
          <p>
            {t('hiddenFields')}: {table.dataScope.hiddenFields.join('、') || t('none')}
          </p>
          <p>
            {t('readOnlyFields')}: {table.dataScope.readOnlyFields.join('、') || t('none')}
          </p>
        </div>
      )}
      <Diagnostics codes={table.diagnostics} />
    </article>
  );
}

function MemberTables({
  corpId,
  memberId,
  baseId,
}: {
  corpId: string;
  memberId: string;
  baseId: string;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.authority' });
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = useQuery({
    queryKey: ['member-authority-tables', corpId, memberId, baseId, submitted, page],
    queryFn: () =>
      getMemberAuthorityTables({
        corpId,
        memberId,
        baseId,
        search: submitted || undefined,
        skip: page * 10,
        take: 10,
      }).then(({ data }) => data),
    staleTime: 0,
  });
  return (
    <section aria-label={t('tableDetails')} className="space-y-3 border-t pt-4">
      <h3 className="font-semibold">{t('tableDetails')}</h3>
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setSubmitted(search.trim());
        }}
      >
        <Input
          aria-label={t('tableSearch')}
          placeholder={t('tableSearch')}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {t('search')}
        </Button>
      </form>
      {query.isFetching && (
        <p role="status" className="text-sm">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}{' '}
          <Button variant="link" onClick={() => query.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {query.data && (
        <>
          <p className="text-sm">
            {query.data.base.spaceName} / {query.data.base.name || t('unnamedBase')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('checkedAt', { time: new Date(query.data.checkedAt).toLocaleString() })}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/base/${baseId}/authority-matrix`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('openMatrix')}
            </Link>
          </Button>
          {query.data.tables.map((table) => (
            <TableResult key={table.id} table={table} />
          ))}
          {!query.data.tables.length && <p className="text-sm">{t('noTables')}</p>}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{t('totalTables', { count: query.data.total })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!page || query.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('previousTables')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 10 >= query.data.total || query.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t('nextTables')}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function DirectoryAuthorityDialog({
  corpId,
  memberId,
  onClose,
}: {
  corpId: string;
  memberId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.authority' });
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [baseId, setBaseId] = useState<string>();
  const query = useQuery({
    queryKey: ['member-authority-overview', corpId, memberId, submitted, page],
    queryFn: () =>
      getMemberAuthorityOverview({
        corpId,
        memberId,
        search: submitted || undefined,
        skip: page * 10,
        take: 10,
      }).then(({ data }) => data),
    staleTime: 0,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['member-authority-overview', corpId, memberId] });
    void client.invalidateQueries({ queryKey: ['member-authority-tables', corpId, memberId] });
  };
  const employee = query.data?.employee;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('title')}
            {employee ? ` · ${employee.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('help')}</p>
        <div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={query.isFetching}>
            {t('refresh')}
          </Button>
        </div>
        {query.isFetching && (
          <p role="status" className="text-sm">
            {t('loading')}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('loadFailed')}{' '}
            <Button variant="link" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          </p>
        )}
        {employee && (
          <>
            <section aria-label={t('identity')} className="space-y-2 rounded border p-3 text-sm">
              <h3 className="font-semibold">{t('identity')}</h3>
              <p>
                {t('employeeStatus')}: {t(employee.active ? 'active' : 'inactive')}
              </p>
              <p>
                {t('account')}:{' '}
                {employee.account
                  ? `${employee.account.name} · ${employee.account.email} · ${t(employee.account.active ? 'active' : 'inactive')}`
                  : t('noAccount')}
              </p>
              <p>
                {t('departments')}:{' '}
                {employee.departments.map((item) => item.name).join('、') || t('none')}
              </p>
              <p>
                {t('businessRoles')}:{' '}
                {employee.roles.map((item) => item.name).join('、') || t('none')}
              </p>
              <Diagnostics codes={query.data!.diagnostics} />
            </section>
            <p className="text-xs text-muted-foreground">
              {t('checkedAt', { time: new Date(query.data!.checkedAt).toLocaleString() })}
            </p>
          </>
        )}
        <section aria-label={t('bases')} className="space-y-3">
          <h3 className="font-semibold">{t('bases')}</h3>
          <p className="text-sm text-muted-foreground">{t('baseHelp')}</p>
          <form
            className="flex max-w-lg gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setBaseId(undefined);
              setSubmitted(search.trim());
            }}
          >
            <Input
              aria-label={t('baseSearch')}
              placeholder={t('baseSearch')}
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit" variant="outline">
              {t('search')}
            </Button>
          </form>
          {query.data && (
            <>
              <ul className="space-y-3">
                {query.data.bases.map((base) => (
                  <li key={base.id} className="space-y-2 rounded border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {base.spaceName} / {base.name || t('unnamedBase')}
                      </span>
                      <Button
                        size="sm"
                        variant={baseId === base.id ? 'default' : 'outline'}
                        aria-expanded={baseId === base.id}
                        onClick={() => setBaseId(baseId === base.id ? undefined : base.id)}
                      >
                        {t('inspectTables')}
                      </Button>
                    </div>
                    <p>{t(base.hasBaseAccess ? 'hasBaseAccess' : 'noBaseAccess')}</p>
                    <p>
                      {t('membershipSources')}:{' '}
                      {base.memberships
                        .map(
                          (item) =>
                            `${t(item.resourceType)} · ${t(`roleNames.${item.role}`, { defaultValue: item.role })}`
                        )
                        .join('；') || t('none')}
                    </p>
                    <p>
                      {t('policyState')}: {t(`policies.${base.policyState}`)}
                    </p>
                    <Diagnostics codes={base.diagnostics} />
                    {baseId === base.id && (
                      <MemberTables
                        key={`${corpId}:${memberId}:${base.id}`}
                        corpId={corpId}
                        memberId={memberId}
                        baseId={base.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {!query.data.bases.length && <p className="text-sm">{t('noBases')}</p>}
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{t('totalBases', { count: query.data.total })}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!page || query.isFetching}
                    onClick={() => {
                      setBaseId(undefined);
                      setPage(page - 1);
                    }}
                  >
                    {t('previousBases')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(page + 1) * 10 >= query.data.total || query.isFetching}
                    onClick={() => {
                      setBaseId(undefined);
                      setPage(page + 1);
                    }}
                  >
                    {t('nextBases')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
