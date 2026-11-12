import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDirectoryChecksRo, IDirectoryRoleVo } from '@teable/openapi';
import { getDirectoryRoleChecks, listDirectoryMembers, listDirectoryRoles } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { DirectoryAuthorityDialog } from './DirectoryAuthorityDialog';
import { DirectoryBindingDialog } from './DirectoryBindingDialog';
import { RoleEditor } from './DirectoryRoles';
import { DirectoryToolSelect } from './DirectoryToolSelect';

export function DirectoryRoleChecks({ corpId, syncBusy }: { corpId: string; syncBusy: boolean }) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const client = useQueryClient();
  const [kind, setKind] = useState<IDirectoryChecksRo['kind']>('all');
  const [page, setPage] = useState(0);
  const [memberId, setMemberId] = useState<string>();
  const [bindingId, setBindingId] = useState<string>();
  const [editRole, setEditRole] = useState<IDirectoryRoleVo>();
  const [actionError, setActionError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [binding, setBinding] =
    useState<Awaited<ReturnType<typeof listDirectoryMembers>>['data']['members'][number]>();
  const query = useQuery({
    queryKey: ['directory-role-checks', corpId, kind, page],
    queryFn: () =>
      getDirectoryRoleChecks({ corpId, kind, skip: page * 50, take: 50 }).then(({ data }) => data),
    retry: false,
    staleTime: 0,
  });
  const resolveRole = async (roleId: string) => {
    setActionBusy(true);
    setActionError(false);
    try {
      const { data } = await listDirectoryRoles(corpId);
      const role = data.find((row) => row.id === roleId);
      if (!role) throw new Error('Role unavailable');
      setEditRole(role);
    } catch {
      setActionError(true);
    } finally {
      setActionBusy(false);
    }
  };
  const resolveBinding = async (id: string) => {
    setActionBusy(true);
    setActionError(false);
    setBindingId(id);
    try {
      const { data } = await listDirectoryMembers({ corpId, memberIds: [id], take: 1 });
      if (!data.members[0]) throw new Error('Employee unavailable');
      setBinding(data.members[0]);
    } catch {
      setActionError(true);
    } finally {
      setActionBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('roleChecks')}</h2>
        <Button
          variant="outline"
          disabled={query.isFetching || syncBusy}
          onClick={() => query.refetch()}
        >
          {t('refreshChecks')}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">{t('roleChecksDescription')}</p>
      <div className="max-w-md">
        <DirectoryToolSelect
          label={t('filterIssue')}
          value={kind}
          onChange={(value) => {
            setKind(value as typeof kind);
            setPage(0);
          }}
          options={(
            [
              'all',
              'inactiveMember',
              'unboundMember',
              'inactiveAccount',
              'invalidDepartment',
              'missingMember',
              'invalidRules',
              'noBaseAccess',
            ] as const
          ).map((value) => ({ value, label: t(`roleIssue${value}`) }))}
        />
      </div>
      {query.isFetching && <p role="status">{t('checkingRoles')}</p>}
      {(query.isError || actionError) && (
        <p role="alert">
          {t('loadFailed')}{' '}
          <Button
            variant="link"
            onClick={() => {
              setActionError(false);
              void query.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </p>
      )}
      {query.data && (
        <>
          <p className="text-sm">
            {t('totalIssues', { count: query.data.total })} ·{' '}
            {new Date(query.data.checkedAt).toLocaleString()}
          </p>
          {!query.data.connectionEnabled && <p role="alert">{t('checksConnectionDisabled')}</p>}
          {!query.data.total && <p>{t('noRoleIssues')}</p>}
          <ul className="space-y-2">
            {query.data.issues.map((issue) => (
              <li key={JSON.stringify(issue)} className="space-y-2 rounded border p-3 text-sm">
                <p className="font-medium">
                  {t(`roleIssue${issue.kind}`)} · {issue.roleName} ·{' '}
                  {issue.roleEnabled ? t('roleEnabled') : t('roleDisabled')}
                </p>
                <p className="break-all">
                  {issue.memberName || issue.memberId || issue.departmentId}
                  {issue.baseName && ` · ${issue.baseName}`}
                </p>
                <p className="text-muted-foreground">{t(`roleIssueHelp${issue.kind}`)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncBusy || actionBusy}
                    onClick={() => resolveRole(issue.roleId)}
                  >
                    {t('editRole')}
                  </Button>
                  {issue.memberId && !['missingMember'].includes(issue.kind) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionBusy}
                      onClick={() => setMemberId(issue.memberId)}
                    >
                      {t('viewAuthority')}
                    </Button>
                  )}
                  {issue.kind === 'unboundMember' && issue.memberId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={syncBusy || actionBusy}
                      onClick={() => resolveBinding(issue.memberId!)}
                    >
                      {t('bind')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={query.isFetching || page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={query.isFetching || (page + 1) * 50 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </>
      )}
      {memberId && (
        <DirectoryAuthorityDialog
          corpId={corpId}
          memberId={memberId}
          onClose={() => setMemberId(undefined)}
        />
      )}
      {binding && (
        <DirectoryBindingDialog
          key={bindingId}
          corpId={corpId}
          member={binding}
          onClose={() => setBinding(undefined)}
          onChanged={() => {
            for (const key of [
              'directory-members',
              'directory-accounts',
              'directory-role-counts',
              'directory-role-roster',
              'directory-role-checks',
              'directory-member-roles',
              'directory-role-members',
              'member-authority-overview',
              'member-authority-tables',
            ])
              void client.invalidateQueries({ queryKey: [key, corpId] });
          }}
        />
      )}
      {editRole && (
        <RoleEditor
          key={`${editRole.id}:${editRole.version}`}
          corpId={corpId}
          role={editRole}
          onClose={() => setEditRole(undefined)}
          onSaved={() => {
            for (const key of [
              'directory-roles',
              'directory-role-counts',
              'directory-role-roster',
              'directory-role-history',
              'directory-role-checks',
              'directory-member-roles',
              'directory-role-members',
              'member-authority-overview',
              'member-authority-tables',
            ])
              void client.invalidateQueries({ queryKey: [key, corpId] });
          }}
        />
      )}
    </section>
  );
}
