import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IDirectoryRoleVo,
  IDirectoryRoleRosterRo,
  IDirectorySetRolePeopleRo,
} from '@teable/openapi';
import {
  getDirectoryRoleRoster,
  listDirectoryDepartments,
  setDirectoryRolePeople,
} from '@teable/openapi';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { roleErrorKey, useRoleDiscard } from './DirectoryRoleEditing';
import { DirectoryRolePreview } from './DirectoryRolePreview';
import { DirectoryToolSelect } from './DirectoryToolSelect';

export function DirectoryRoleRoster({
  corpId,
  role,
  syncBusy,
  onClose,
  onDiagnose,
}: {
  corpId: string;
  role: IDirectoryRoleVo;
  syncBusy: boolean;
  onClose: () => void;
  onDiagnose: (memberId: string) => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(0);
  const [departmentId, setDepartmentId] = useState('all');
  const [binding, setBinding] = useState<IDirectoryRoleRosterRo['binding']>('all');
  const [source, setSource] = useState<IDirectoryRoleRosterRo['source']>('all');
  const [scope, setScope] = useState<IDirectoryRoleRosterRo['scope']>('matched');
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<{
    request: IDirectorySetRolePeopleRo;
    role: IDirectoryRoleVo;
  }>();
  const departments = useQuery({
    queryKey: ['directory-departments', corpId],
    queryFn: () => listDirectoryDepartments({ corpId }).then(({ data }) => data),
  });
  const query = useQuery({
    queryKey: [
      'directory-role-roster',
      corpId,
      role.id,
      submitted,
      departmentId,
      binding,
      source,
      scope,
      page,
    ],
    queryFn: () =>
      getDirectoryRoleRoster({
        corpId,
        roleId: role.id,
        search: submitted || undefined,
        departmentId: departmentId === 'all' ? undefined : departmentId,
        binding,
        source,
        scope,
        skip: page * 50,
        take: 50,
      }).then(({ data }) => data),
    retry: false,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: () => setDirectoryRolePeople(plan!.request),
    onSuccess: () => {
      setPlan(undefined);
      setSelected([]);
      for (const key of [
        'directory-roles',
        'directory-role-counts',
        'directory-role-roster',
        'directory-role-history',
        'directory-member-roles',
        'directory-role-members',
        'directory-role-checks',
        'member-authority-overview',
        'member-authority-tables',
      ])
        void client.invalidateQueries({ queryKey: [key, corpId] });
    },
  });
  const busy = syncBusy || save.isPending;
  const { requestClose, discardDialog } = useRoleDiscard(
    !!plan || selected.length > 0,
    save.isPending,
    onClose
  );
  const changeFilter = (set: (value: string) => void, value: string) => {
    set(value);
    setPage(0);
    setSelected([]);
    setPlan(undefined);
    save.reset();
  };
  const prepare = (assigned: boolean) => {
    if (!query.data) return;
    save.reset();
    setPlan({
      request: {
        corpId,
        roleId: role.id,
        expectedVersion: query.data.role.version,
        memberIds: selected,
        assigned,
      },
      role: query.data.role,
    });
  };
  const draftRules =
    plan?.role.rules.filter(
      (rule) => rule.type !== 'member' || !plan.request.memberIds.includes(rule.memberId)
    ) ?? [];
  if (plan?.request.assigned)
    draftRules.push(
      ...plan.request.memberIds.map((memberId) => ({ type: 'member' as const, memberId }))
    );
  const selectedRows = query.data?.members.filter((member) => selected.includes(member.id)) ?? [];
  const selectable = query.data?.members ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('manageRoleMembers')} · {role.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('batchRoleDescription')}</p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter(setSubmitted, search.trim());
          }}
        >
          <Input
            aria-label={t('employeeSearch')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={busy || !!plan}
            maxLength={200}
          />
          <Button disabled={busy || !!plan} type="submit" variant="outline">
            {t('search')}
          </Button>
        </form>
        <div className="grid grid-cols-2 gap-2">
          <DirectoryToolSelect
            label={t('filterDepartment')}
            value={departmentId}
            disabled={busy || !!plan}
            onChange={(value) => changeFilter(setDepartmentId, value)}
            options={[
              { value: 'all', label: t('allDepartments') },
              ...(departments.data ?? []).map((d) => ({
                value: d.id,
                label: d.pathName?.join(' / ') || d.name,
              })),
            ]}
          />
          <DirectoryToolSelect
            label={t('filterBinding')}
            value={binding}
            disabled={busy || !!plan}
            onChange={(value) => changeFilter((v) => setBinding(v as typeof binding), value)}
            options={(['all', 'bound', 'unbound'] as const).map((value) => ({
              value,
              label: t(`bindingFilter_${value}`),
            }))}
          />
          <DirectoryToolSelect
            label={t('filterSource')}
            value={source}
            disabled={busy || !!plan}
            onChange={(value) => changeFilter((v) => setSource(v as typeof source), value)}
            options={(['all', 'member', 'department', 'externalRole'] as const).map((value) => ({
              value,
              label: value === 'all' ? t('allSources') : t(`roleSource_${value}`),
            }))}
          />
          <DirectoryToolSelect
            label={t('filterRosterScope')}
            value={scope}
            disabled={busy || !!plan}
            onChange={(value) => changeFilter((v) => setScope(v as typeof scope), value)}
            options={(['matched', 'all'] as const).map((value) => ({
              value,
              label: t(`rosterScope_${value}`),
            }))}
          />
        </div>
        {departments.isError && (
          <p role="alert">
            {t('loadFailed')}{' '}
            <Button variant="link" onClick={() => departments.refetch()}>
              {t('retry')}
            </Button>
          </p>
        )}
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
            <p className="text-sm">
              {t('roleCounts', query.data.counts)} · {t('total', { count: query.data.total })}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={t('selectCurrentPage')}
                checked={selectable.length > 0 && selected.length === selectable.length}
                disabled={busy || !!plan || query.isFetching}
                onCheckedChange={(checked) =>
                  setSelected(checked === true ? selectable.map((member) => member.id) : [])
                }
              />
              {t('selectCurrentPage')}
            </label>
            <ul className="max-h-64 space-y-2 overflow-auto">
              {query.data.members.map((member) => (
                <li
                  className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                  key={member.id}
                >
                  <label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={member.name}
                      checked={selected.includes(member.id)}
                      disabled={busy || !!plan || query.isFetching}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked === true
                            ? [...selected, member.id]
                            : selected.filter((id) => id !== member.id)
                        )
                      }
                    />
                    <span>
                      {member.name} ·{' '}
                      {!member.active ? t('inactive') : member.userId ? t('bound') : t('unbound')}
                      <br />
                      <span className="text-muted-foreground text-xs">
                        {member.sources.map((value) => t(`roleSource_${value}`)).join(' / ') ||
                          t('roleNoSource')}{' '}
                        · {member.effective ? t('roleEffective') : t('roleNotEffective')}
                      </span>
                    </span>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!plan}
                    onClick={() => onDiagnose(member.id)}
                  >
                    {t('viewAuthority')}
                  </Button>
                </li>
              ))}
            </ul>
            {!query.data.members.length && <p>{t('noEmployees')}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !!plan ||
                  query.isFetching ||
                  !selected.length ||
                  selectedRows.some((row) => !row.active)
                }
                onClick={() => prepare(true)}
              >
                {t('batchAddPeople')}
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !!plan ||
                  query.isFetching ||
                  !selectedRows.some((row) => row.sources.includes('member'))
                }
                onClick={() => prepare(false)}
              >
                {t('batchRemovePeople')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!plan || query.isFetching || page === 0}
                onClick={() => {
                  setPage(page - 1);
                  setSelected([]);
                }}
              >
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!plan || query.isFetching || (page + 1) * 50 >= query.data.total}
                onClick={() => {
                  setPage(page + 1);
                  setSelected([]);
                }}
              >
                {t('next')}
              </Button>
            </div>
          </>
        )}
        {plan && (
          <>
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                setPlan(undefined);
                save.reset();
              }}
            >
              {t('continueEditing')}
            </Button>
            {draftRules.length <= 100 ? (
              <DirectoryRolePreview
                key={JSON.stringify(plan)}
                draft={{
                  corpId,
                  roleId: role.id,
                  expectedVersion: plan.role.version,
                  name: plan.role.name,
                  enabled: plan.role.enabled,
                  rules: draftRules,
                }}
                busy={busy}
                onSave={() => save.mutate()}
              />
            ) : (
              <p role="alert">{t('roleErrorLimit')}</p>
            )}
          </>
        )}
        {save.isError && <p role="alert">{t(roleErrorKey(save.error))}</p>}
        {save.isSuccess && <p role="status">{t('batchRoleSaved')}</p>}
        <Button variant="outline" disabled={save.isPending} onClick={requestClose}>
          {t('close')}
        </Button>
        {discardDialog}
      </DialogContent>
    </Dialog>
  );
}
