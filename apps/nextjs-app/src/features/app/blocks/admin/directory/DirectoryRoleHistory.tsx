import { useQuery } from '@tanstack/react-query';
import type { IDirectoryRoleVo, IDirectoryRoleRule } from '@teable/openapi';
import { getDirectoryRoleHistory } from '@teable/openapi';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export function roleRuleDiff(before: IDirectoryRoleRule[], after: IDirectoryRoleRule[]) {
  const old = new Set(before.map((rule) => JSON.stringify(rule)));
  const next = new Set(after.map((rule) => JSON.stringify(rule)));
  return {
    added: after.filter((rule) => !old.has(JSON.stringify(rule))),
    removed: before.filter((rule) => !next.has(JSON.stringify(rule))),
  };
}
export function DirectoryRoleHistory({
  corpId,
  role,
  onClose,
}: {
  corpId: string;
  role: IDirectoryRoleVo;
  onClose: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['directory-role-history', corpId, role.id, page],
    queryFn: () =>
      getDirectoryRoleHistory({ corpId, roleId: role.id, skip: page * 20, take: 20 }).then(
        ({ data }) => data
      ),
    staleTime: 0,
    retry: false,
  });
  const formatRule = (rule: IDirectoryRoleRule) => {
    if (rule.type === 'member') return `${t('roleSource_member')} · ${rule.memberId}`;
    if (rule.type === 'externalRole')
      return `${t('roleSource_externalRole')} · ${rule.externalRoleId}`;
    return `${t('roleSource_department')} · ${rule.departmentId} · ${rule.includeDescendants ? t('includeDescendants') : t('directDepartmentOnly')}`;
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('roleHistory')} · {role.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('roleHistoryDescription')}</p>
        {query.isFetching && <p role="status">{t('loading')}</p>}
        {query.isError && (
          <p role="alert">
            {t('loadFailed')}{' '}
            <Button variant="link" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          </p>
        )}
        {query.data && (
          <>
            {!query.data.entries.length && <p>{t('noRoleHistory')}</p>}
            <ul className="space-y-3">
              {query.data.entries.map((entry) => {
                const diff = roleRuleDiff(entry.before?.rules ?? [], entry.after.rules);
                return (
                  <li key={entry.id} className="space-y-2 rounded border p-3 text-sm">
                    <h3 className="font-medium">
                      {new Date(entry.createdAt).toLocaleString()} ·{' '}
                      {entry.actor.name || entry.actor.id || t('unknownActor')}
                    </h3>
                    <p>
                      {t('historyRevision', {
                        before: entry.before?.version ?? '—',
                        after: entry.after.version,
                      })}
                    </p>
                    {!entry.before && <p>{t('roleCreated')}</p>}
                    {entry.before?.name !== entry.after.name && (
                      <p>
                        {t('roleName')}: {entry.before?.name || '—'} → {entry.after.name}
                      </p>
                    )}
                    {entry.before?.enabled !== entry.after.enabled && (
                      <p>
                        {t('status')}:{' '}
                        {entry.before
                          ? entry.before.enabled
                            ? t('roleEnabled')
                            : t('roleDisabled')
                          : '—'}{' '}
                        → {entry.after.enabled ? t('roleEnabled') : t('roleDisabled')}
                      </p>
                    )}
                    <ul>
                      {diff.added.map((rule) => (
                        <li key={JSON.stringify(rule)}>+ {formatRule(rule)}</li>
                      ))}
                      {diff.removed.map((rule) => (
                        <li key={JSON.stringify(rule)}>− {formatRule(rule)}</li>
                      ))}
                    </ul>
                    {!diff.added.length && !diff.removed.length && <p>{t('noRuleChanges')}</p>}
                  </li>
                );
              })}
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
                disabled={query.isFetching || (page + 1) * 20 >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
