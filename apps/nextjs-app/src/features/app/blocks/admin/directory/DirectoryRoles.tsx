import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDirectoryRoleRule, IDirectoryRoleVo } from '@teable/openapi';
import {
  getDirectoryRoleMembers,
  listDirectoryDepartments,
  listDirectoryRoles,
  saveDirectoryRole,
} from '@teable/openapi';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

function RoleEditor({
  corpId,
  role,
  onClose,
  onSaved,
}: {
  corpId: string;
  role?: IDirectoryRoleVo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [name, setName] = useState(role?.name || '');
  const [enabled, setEnabled] = useState(role?.enabled ?? true);
  const [rules, setRules] = useState<IDirectoryRoleRule[]>(role?.rules || []);
  const [departmentId, setDepartmentId] = useState('');
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [externalRoleId, setExternalRoleId] = useState('');
  const departments = useQuery({
    queryKey: ['directory-departments', corpId],
    queryFn: () => listDirectoryDepartments({ corpId }).then(({ data }) => data),
  });
  const save = useMutation({
    mutationFn: () =>
      saveDirectoryRole({
        corpId,
        roleId: role?.id,
        expectedVersion: role?.version ?? 0,
        name: name.trim(),
        enabled,
        rules,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? t('editRole') : t('createRole')}</DialogTitle>
        </DialogHeader>
        <label className="space-y-1 text-sm">
          {t('roleName')}
          <Input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            disabled={save.isPending}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={save.isPending}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          {t('roleEnabled')}
        </label>
        <p className="text-sm text-muted-foreground">{t('roleRulesDescription')}</p>
        <section className="space-y-2 rounded border p-3">
          <h3 className="text-sm font-semibold">{t('departmentRule')}</h3>
          {departments.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('loadFailed')}
            </p>
          )}
          <Input
            aria-label={t('roleDepartmentSearch')}
            placeholder={t('roleDepartmentSearch')}
            value={departmentSearch}
            disabled={save.isPending}
            maxLength={200}
            onChange={(event) => setDepartmentSearch(event.target.value)}
          />
          <Select
            value={departmentId}
            onValueChange={setDepartmentId}
            disabled={save.isPending || departments.isLoading}
          >
            <SelectTrigger aria-label={t('chooseDepartment')}>
              <SelectValue placeholder={t('chooseDepartment')} />
            </SelectTrigger>
            <SelectContent>
              {departments.data
                ?.filter(
                  (department) =>
                    department.id === departmentId ||
                    (department.pathName?.join(' / ') || department.name)
                      .normalize('NFKC')
                      .toLocaleLowerCase()
                      .includes(departmentSearch.trim().normalize('NFKC').toLocaleLowerCase())
                )
                .map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.pathName?.join(' / ') || department.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeDescendants}
              disabled={save.isPending}
              onCheckedChange={(checked) => setIncludeDescendants(checked === true)}
            />
            {t('includeDescendants')}
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={
              save.isPending ||
              !departmentId ||
              rules.length >= 100 ||
              rules.some((rule) => rule.type === 'department' && rule.departmentId === departmentId)
            }
            onClick={() => {
              setRules([...rules, { type: 'department', departmentId, includeDescendants }]);
              setDepartmentId('');
            }}
          >
            {t('addRule')}
          </Button>
        </section>
        <section className="space-y-2 rounded border p-3">
          <h3 className="text-sm font-semibold">{t('sourceRoleRule')}</h3>
          <Input
            aria-label={t('sourceRoleId')}
            value={externalRoleId}
            maxLength={200}
            disabled={save.isPending}
            placeholder={t('sourceRoleId')}
            onChange={(event) => setExternalRoleId(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={
              save.isPending ||
              !externalRoleId.trim() ||
              rules.length >= 100 ||
              rules.some(
                (rule) =>
                  rule.type === 'externalRole' && rule.externalRoleId === externalRoleId.trim()
              )
            }
            onClick={() => {
              setRules([...rules, { type: 'externalRole', externalRoleId: externalRoleId.trim() }]);
              setExternalRoleId('');
            }}
          >
            {t('addRule')}
          </Button>
        </section>
        <ul className="space-y-2">
          {rules.map((rule, index) => (
            <li
              key={
                rule.type === 'department'
                  ? `department:${rule.departmentId}`
                  : `role:${rule.externalRoleId}`
              }
              className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
            >
              <span>
                {rule.type === 'department'
                  ? `${departments.data?.find((department) => department.id === rule.departmentId)?.pathName?.join(' / ') || t('unavailableDepartment')} · ${rule.includeDescendants ? t('includeDescendants') : t('directDepartment')}`
                  : `${t('sourceRoleRule')}: ${rule.externalRoleId}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
              >
                {t('removeRule')}
              </Button>
            </li>
          ))}
        </ul>
        {!rules.length && <p className="text-sm text-muted-foreground">{t('noRoleRules')}</p>}
        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('roleSaveFailed')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {save.isPending ? t('saving') : t('saveRole')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoleMembers({
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
    queryKey: ['directory-role-members', corpId, role.id, page],
    queryFn: () =>
      getDirectoryRoleMembers({ corpId, roleId: role.id, skip: page * 50, take: 50 }).then(
        ({ data }) => data
      ),
    staleTime: 0,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('effectiveMembers')} · {role.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('effectiveMembersDescription')}</p>
        {query.isFetching && <p role="status">{t('loading')}</p>}
        {query.isError && <p role="alert">{t('loadFailed')}</p>}
        {query.data && (
          <>
            <p className="text-sm">{t('total', { count: query.data.total })}</p>
            <ul className="max-h-72 space-y-2 overflow-auto">
              {query.data.members.map((member) => (
                <li className="rounded border p-2 text-sm" key={member.memberId}>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-muted-foreground">{member.email}</p>
                </li>
              ))}
            </ul>
            {!query.data.members.length && <p className="text-sm">{t('noEffectiveMembers')}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * 50 >= query.data.total || query.isFetching}
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

export function DirectoryRoles({
  corpId,
  syncBusy,
  onChanged,
}: {
  corpId: string;
  syncBusy: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const client = useQueryClient();
  const roles = useQuery({
    queryKey: ['directory-roles', corpId],
    queryFn: () => listDirectoryRoles(corpId).then(({ data }) => data),
  });
  const [editor, setEditor] = useState<IDirectoryRoleVo | 'new'>();
  const [members, setMembers] = useState<IDirectoryRoleVo>();
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('businessRoles')}</h2>
        <Button
          disabled={syncBusy || roles.isError || roles.isLoading}
          onClick={() => setEditor('new')}
        >
          {t('createRole')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('rolesDescription')}</p>
      {roles.isLoading && <p role="status">{t('loading')}</p>}
      {roles.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('directoryLoadFailed')}{' '}
          <Button variant="link" onClick={() => roles.refetch()}>
            {t('retry')}
          </Button>
        </p>
      )}
      {roles.data && !roles.data.length && <p className="text-sm">{t('noBusinessRoles')}</p>}
      <ul className="space-y-2">
        {roles.data?.map((role) => (
          <li key={role.id} className="flex items-center justify-between gap-3 rounded border p-3">
            <div>
              <h3 className="font-medium">{role.name}</h3>
              <p className="text-xs text-muted-foreground">
                {role.enabled ? t('roleEnabled') : t('roleDisabled')} ·{' '}
                {t('ruleCount', { count: role.rules.length })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={syncBusy}
                onClick={() => setMembers(role)}
              >
                {t('effectiveMembers')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={syncBusy}
                onClick={() => setEditor(role)}
              >
                {t('editRole')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {editor && (
        <RoleEditor
          key={editor === 'new' ? 'new' : `${editor.id}:${editor.version}`}
          corpId={corpId}
          role={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            void client.invalidateQueries({ queryKey: ['directory-roles', corpId] });
            void client.invalidateQueries({ queryKey: ['directory-role-members', corpId] });
            onChanged?.();
          }}
        />
      )}
      {members && (
        <RoleMembers
          key={members.id}
          corpId={corpId}
          role={members}
          onClose={() => setMembers(undefined)}
        />
      )}
    </section>
  );
}
