import { useQuery } from '@tanstack/react-query';
import type { IDirectorySaveRoleRo } from '@teable/openapi';
import { previewDirectoryRole } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { roleErrorKey } from './DirectoryRoleEditing';

export function DirectoryRolePreview({
  draft,
  busy,
  onSave,
}: {
  draft: IDirectorySaveRoleRo;
  busy: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['directory-role-impact', draft, page],
    queryFn: () =>
      previewDirectoryRole({ ...draft, skip: page * 50, take: 50 }).then(({ data }) => data),
    retry: false,
    staleTime: 0,
  });
  return (
    <section className="space-y-3 rounded border p-3" aria-label={t('previewRoleChanges')}>
      <h3 className="font-semibold">{t('previewRoleChanges')}</h3>
      <p className="text-muted-foreground text-xs">{t('rolePreviewDescription')}</p>
      {query.isFetching && <p role="status">{t('loading')}</p>}
      {query.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t(roleErrorKey(query.error))}
        </p>
      )}
      {query.isError && (
        <Button variant="outline" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      )}
      {query.data && (
        <>
          <p className="text-sm">{t('roleImpactTotals', query.data)}</p>
          <p className="text-sm">{t('roleImpactCounts', query.data.counts)}</p>
          {!query.data.total && <p className="text-sm">{t('noRoleChanges')}</p>}
          <ul className="max-h-56 space-y-2 overflow-auto">
            {query.data.members.map((member) => (
              <li key={member.memberId} className="text-sm">
                {member.name} · {member.externalId} · {t(`roleChange_${member.change}`)}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy || query.isFetching || page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || query.isFetching || (page + 1) * 50 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </>
      )}
      <div className="flex justify-end">
        <Button disabled={busy || !query.isSuccess || query.isFetching} onClick={onSave}>
          {busy ? t('saving') : t('saveRole')}
        </Button>
      </div>
    </section>
  );
}
