import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IDirectoryMemberVo, IDirectoryMemberRolesVo } from '@teable/openapi';
import { getDirectoryMemberRoles, saveDirectoryMemberRoles } from '@teable/openapi';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { roleErrorKey, useRoleDiscard } from './DirectoryRoleEditing';

export function DirectoryMemberRoles({
  corpId,
  member,
  syncBusy,
  onClose,
  onChanged,
  onDiagnose,
}: {
  corpId: string;
  member: IDirectoryMemberVo;
  syncBusy: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDiagnose?: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const query = useQuery({
    queryKey: ['directory-member-roles', corpId, member.id],
    queryFn: () =>
      getDirectoryMemberRoles({ corpId, memberId: member.id }).then(({ data }) => data),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Do not mount an editor from cached membership while its fresh snapshot is loading.
  if (!query.data || !query.isFetchedAfterMount)
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
              {t('manageRoles')} · {member.name}
            </DialogTitle>
          </DialogHeader>
          {query.isFetching && <p role="status">{t('loading')}</p>}
          {query.isError && (
            <>
              <p role="alert">{t('loadFailed')}</p>
              <Button onClick={() => query.refetch()}>{t('retry')}</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  return (
    <MemberRoleEditor
      corpId={corpId}
      member={member}
      snapshot={query.data}
      syncBusy={syncBusy}
      onClose={onClose}
      onChanged={onChanged}
      onDiagnose={onDiagnose}
    />
  );
}

function MemberRoleEditor({
  corpId,
  member,
  snapshot,
  syncBusy,
  onClose,
  onChanged,
  onDiagnose,
}: {
  corpId: string;
  member: IDirectoryMemberVo;
  snapshot: IDirectoryMemberRolesVo;
  syncBusy: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDiagnose?: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const client = useQueryClient();
  const [initial] = useState(snapshot);
  const [selected, setSelected] = useState(() =>
    initial.roles.filter((role) => role.sources.includes('member')).map((role) => role.id)
  );
  const [reviewed, setReviewed] = useState<string>();
  const assignments = initial.roles
    .filter((role) => selected.includes(role.id) !== role.sources.includes('member'))
    .map((role) => ({
      roleId: role.id,
      expectedVersion: role.version,
      assigned: selected.includes(role.id),
    }));
  const fingerprint = JSON.stringify(assignments);
  const save = useMutation({
    mutationFn: () => saveDirectoryMemberRoles({ corpId, memberId: member.id, assignments }),
    onSuccess: () => {
      onClose();
      for (const key of [
        'directory-member-roles',
        'directory-roles',
        'directory-role-counts',
        'directory-role-roster',
        'directory-role-history',
        'directory-role-checks',
        'directory-role-members',
        'directory-role-impact',
        'member-authority-overview',
        'member-authority-tables',
      ]) {
        void client.invalidateQueries({ queryKey: [key, corpId] });
      }
      onChanged();
      onDiagnose?.();
    },
  });
  const busy = syncBusy || save.isPending;
  const { requestClose, discardDialog } = useRoleDiscard(
    assignments.length > 0,
    save.isPending,
    onClose
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('manageRoles')} · {member.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('manageRolesDescription')}</p>
        {!initial.eligible && <p className="text-sm">{t('memberRolesPending')}</p>}
        <ul className="space-y-3">
          {initial.roles.map((role) => (
            <li key={role.id} className="space-y-1 rounded border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={selected.includes(role.id)}
                  disabled={
                    busy ||
                    (!selected.includes(role.id) &&
                      (!member.active ||
                        (!role.sources.includes('member') && role.rules.length >= 100)))
                  }
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked === true
                        ? [...selected, role.id]
                        : selected.filter((id) => id !== role.id)
                    )
                  }
                />
                {role.name}
              </label>
              <p className="text-muted-foreground text-xs">
                {role.enabled ? t('roleEnabled') : t('roleDisabled')} ·{' '}
                {role.effective ? t('roleEffective') : t('roleNotEffective')}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('roleSources')}:{' '}
                {role.sources.length
                  ? role.sources.map((source) => t(`roleSource_${source}`)).join(' / ')
                  : t('roleNoSource')}
              </p>
            </li>
          ))}
        </ul>
        {!initial.roles.length && <p>{t('noBusinessRoles')}</p>}
        {reviewed === fingerprint && assignments.length > 0 && (
          <section className="space-y-2 rounded border p-3" aria-label={t('previewRoleChanges')}>
            <h3 className="font-semibold">{t('previewRoleChanges')}</h3>
            <p className="text-muted-foreground text-xs">{t('rolePreviewDescription')}</p>
            <ul className="space-y-2 text-sm">
              {assignments.map((assignment) => {
                const role = initial.roles.find((item) => item.id === assignment.roleId)!;
                const remains = role.sources.some((source) => source !== 'member');
                const effective =
                  initial.eligible && role.enabled && (assignment.assigned || remains);
                return (
                  <li key={role.id}>
                    {role.name} ·{' '}
                    {assignment.assigned ? t('directRoleAdded') : t('directRoleRemoved')} ·{' '}
                    {effective
                      ? role.effective
                        ? t('roleChange_retained')
                        : t('roleChange_added')
                      : role.effective
                        ? t('roleChange_removed')
                        : t('roleNotEffective')}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {save.isError && (
          <p role="alert" className="text-destructive text-sm">
            {t(roleErrorKey(save.error))}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={save.isPending} onClick={requestClose}>
            {t('cancel')}
          </Button>
          {reviewed === fingerprint && assignments.length > 0 ? (
            <Button disabled={busy} onClick={() => save.mutate()}>
              {save.isPending ? t('saving') : onDiagnose ? t('saveAndDiagnose') : t('saveRole')}
            </Button>
          ) : (
            <Button
              disabled={busy || !assignments.length || assignments.length > 100}
              onClick={() => setReviewed(fingerprint)}
            >
              {t('previewRoleChanges')}
            </Button>
          )}
        </div>
        {discardDialog}
      </DialogContent>
    </Dialog>
  );
}
