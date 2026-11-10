import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDirectoryMemberVo } from '@teable/openapi';
import { listDirectoryMembers } from '@teable/openapi';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { DirectoryBindingDialog } from './DirectoryBindingDialog';

export function DirectoryMembers({
  corpId,
  onChanged,
  syncBusy,
}: {
  corpId: string;
  onChanged: () => void;
  syncBusy: boolean;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [binding, setBinding] = useState<IDirectoryMemberVo>();
  const members = useQuery({
    queryKey: ['directory-members', corpId, submittedSearch, page],
    queryFn: () =>
      listDirectoryMembers({
        corpId,
        search: submittedSearch || undefined,
        skip: page * 50,
        take: 50,
      }).then(({ data }) => data),
  });
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('employees')}</h2>
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setSubmittedSearch(search.trim());
        }}
      >
        <Input
          aria-label={t('employeeSearch')}
          placeholder={t('employeeSearch')}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {t('search')}
        </Button>
      </form>
      {members.isLoading && <p role="status">{t('loading')}</p>}
      {members.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t('directoryLoadFailed')}{' '}
          <Button variant="link" onClick={() => members.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {members.data && (
        <>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-start text-sm">
              <thead className="bg-muted">
                <tr>
                  {[
                    t('employee'),
                    t('departments'),
                    t('status'),
                    t('localAccount'),
                    t('actions'),
                  ].map((title) => (
                    <th key={title} className="p-3 font-medium">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.data.members.map((member) => (
                  <tr key={member.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{member.name}</div>
                      <div className="text-muted-foreground text-xs">{member.externalId}</div>
                    </td>
                    <td className="p-3">
                      {member.departments.map((department) => department.name).join(', ') || '—'}
                    </td>
                    <td className="p-3">{member.active ? t('active') : t('inactive')}</td>
                    <td className="p-3">{member.user?.email || member.userId || t('unbound')}</td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncBusy || (!member.active && !member.userId)}
                        onClick={() => setBinding(member)}
                      >
                        {member.userId ? t('unbind') : t('bind')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!members.data.members.length && (
            <p className="text-muted-foreground text-sm">{t('noEmployees')}</p>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <p>{t('total', { count: members.data.total })}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || members.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * 50 >= members.data.total || members.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </>
      )}
      {binding && (
        <DirectoryBindingDialog
          key={binding.id}
          corpId={corpId}
          member={binding}
          onClose={() => setBinding(undefined)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['directory-members', corpId] });
            void queryClient.invalidateQueries({ queryKey: ['directory-accounts', corpId] });
            void queryClient.invalidateQueries({ queryKey: ['organization-me'] });
            void queryClient.invalidateQueries({ queryKey: ['department-list'] });
            void queryClient.invalidateQueries({ queryKey: ['department-users'] });
            void queryClient.invalidateQueries({ queryKey: ['directory-role-members', corpId] });
            onChanged();
          }}
        />
      )}
    </section>
  );
}
