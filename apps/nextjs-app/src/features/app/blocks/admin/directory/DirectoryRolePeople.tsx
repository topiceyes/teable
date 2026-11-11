import { useQuery } from '@tanstack/react-query';
import { listDirectoryMembers } from '@teable/openapi';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export function DirectoryRolePeople({
  corpId,
  memberIds,
  disabled,
  ruleCount,
  onChange,
}: {
  corpId: string;
  memberIds: string[];
  disabled: boolean;
  ruleCount: number;
  onChange: (memberIds: string[]) => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<string>();
  const [page, setPage] = useState(0);
  const selected = useQuery({
    queryKey: ['directory-role-selected-people', corpId, memberIds],
    queryFn: () => listDirectoryMembers({ corpId, memberIds, take: 100 }).then(({ data }) => data),
    enabled: memberIds.length > 0,
    staleTime: 0,
  });
  const candidates = useQuery({
    queryKey: ['directory-role-people', corpId, submittedSearch, page],
    queryFn: () =>
      listDirectoryMembers({ corpId, search: submittedSearch, skip: page * 50, take: 50 }).then(
        ({ data }) => data
      ),
    enabled: submittedSearch !== undefined,
    staleTime: 0,
  });
  return (
    <section className="space-y-2 rounded border p-3" aria-label={t('specifiedPeople')}>
      <h3 className="text-sm font-semibold">{t('specifiedPeople')}</h3>
      <p className="text-xs text-muted-foreground">{t('specifiedPeopleDescription')}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (page === 0 && submittedSearch === search.trim()) void candidates.refetch();
          setPage(0);
          setSubmittedSearch(search.trim());
        }}
      >
        <Input
          aria-label={t('rolePeopleSearch')}
          placeholder={t('rolePeopleSearch')}
          value={search}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={disabled || candidates.isFetching}>
          {t('search')}
        </Button>
      </form>
      {candidates.isFetching && <p role="status">{t('loading')}</p>}
      {(candidates.isError || selected.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
          <Button
            type="button"
            variant="link"
            onClick={() => {
              if (memberIds.length) void selected.refetch();
              if (submittedSearch !== undefined) void candidates.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </p>
      )}
      {candidates.data && !candidates.isFetching && (
        <>
          <ul className="max-h-56 space-y-2 overflow-auto" aria-label={t('rolePeopleResults')}>
            {candidates.data.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 border-b p-2">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{member.name}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    {member.externalId} · {member.departments.map((item) => item.name).join(' / ')}
                    {' · '}
                    {!member.active ? t('inactive') : member.user?.email || t('unbound')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${t('addRoleMember')} ${member.name}`}
                  disabled={
                    disabled || !member.active || memberIds.includes(member.id) || ruleCount >= 100
                  }
                  onClick={() => onChange([...memberIds, member.id])}
                >
                  {memberIds.includes(member.id) ? t('roleMemberAdded') : t('addRoleMember')}
                </Button>
              </li>
            ))}
          </ul>
          {!candidates.data.members.length && <p className="text-sm">{t('noEmployees')}</p>}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{t('total', { count: candidates.data.total })}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || (page + 1) * 50 >= candidates.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </>
      )}
      <p className="text-sm font-medium">
        {t('specifiedPeopleCount', { count: memberIds.length })}
      </p>
      {selected.isFetching && memberIds.length > 0 && <p role="status">{t('loading')}</p>}
      <ul className="max-h-56 space-y-2 overflow-auto" aria-label={t('selectedRolePeople')}>
        {memberIds.map((id) => {
          const member = selected.data?.members.find((item) => item.id === id);
          return (
            <li key={id} className="flex items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0 text-sm">
                <p>{member?.name || id}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {member
                    ? `${member.externalId} · ${!member.active ? t('inactive') : member.user?.email || t('unbound')}`
                    : !selected.isFetching && !selected.isError
                      ? t('unavailableRoleMember')
                      : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${t('removeRoleMember')} ${member?.name || id}`}
                disabled={disabled}
                onClick={() => onChange(memberIds.filter((value) => value !== id))}
              >
                {t('removeRoleMember')}
              </Button>
            </li>
          );
        })}
      </ul>
      {ruleCount >= 100 && <p className="text-xs text-muted-foreground">{t('roleRulesLimit')}</p>}
      <p className="text-xs text-muted-foreground">{t('removeRoleMemberDescription')}</p>
    </section>
  );
}
