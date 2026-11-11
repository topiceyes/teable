import { useMutation } from '@tanstack/react-query';
import { previewTableAuthority } from '@teable/openapi';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

const actionNames: Record<string, 'table' | 'read' | 'create' | 'update' | 'delete'> = {
  'table|read': 'table',
  'record|read': 'read',
  'record|create': 'create',
  'record|update': 'update',
  'record|delete': 'delete',
};

export function MatrixPermissionPreview({
  baseId,
  tables,
  unsaved = false,
}: {
  baseId: string;
  tables: { id: string; name: string }[];
  unsaved?: boolean;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [email, setEmail] = useState('');
  const [tableId, setTableId] = useState('');
  const preview = useMutation({
    mutationFn: () =>
      previewTableAuthority({ baseId, tableId, email: email.trim() }).then(({ data }) => data),
  });
  return (
    <section aria-label={t('previewTitle')} className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">{t('previewTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('previewHelp')}</p>
      {unsaved && <p className="text-sm font-medium">{t('previewSavedOnly')}</p>}
      <div className="flex flex-wrap gap-2">
        <Input
          type="email"
          className="max-w-xs"
          aria-label={t('previewEmail')}
          placeholder={t('previewEmail')}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            preview.reset();
          }}
        />
        <select
          className="rounded border bg-background p-2 text-sm"
          aria-label={t('chooseTable')}
          value={tableId}
          onChange={(e) => {
            setTableId(e.target.value);
            preview.reset();
          }}
        >
          <option value="">{t('chooseTable')}</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
        <Button
          disabled={!email.trim() || !tableId || preview.isPending}
          onClick={() => preview.mutate()}
        >
          {t('previewAction')}
        </Button>
      </div>
      {preview.isError && <p role="alert">{t('previewFailed')}</p>}
      {preview.data && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            {preview.data.user.name} · {preview.data.user.email}
          </p>
          <p>{t(preview.data.hasBaseAccess ? 'hasBaseAccess' : 'noBaseAccess')}</p>
          <p>
            {t('matchedRoles')}:{' '}
            {preview.data.roles.map((role) => role.name).join('、') || t('none')}
          </p>
          {preview.data.dataScope && (
            <div>
              <p>
                {t('scopeSource')}: {preview.data.dataScope.appliedRole?.name || t('defaultScope')}
              </p>
              <p>
                {t('rowScope')}:{' '}
                {t(
                  preview.data.dataScope.rowScope === 'own'
                    ? 'ownRows'
                    : preview.data.dataScope.rowScope === 'department'
                      ? 'departmentRows'
                      : 'allRows'
                )}
              </p>
              <p>
                {t('hiddenField')}: {preview.data.dataScope.hiddenFields.join('、') || t('none')}
              </p>
              <p>
                {t('readOnlyField')}:{' '}
                {preview.data.dataScope.readOnlyFields.join('、') || t('none')}
              </p>
            </div>
          )}
          <table className="w-full text-start">
            <thead>
              <tr>
                <th>{t('actions')}</th>
                <th>{t('previewResult')}</th>
                <th>{t('previewSource')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.data.actions.map((action) => (
                <tr key={action.action}>
                  <td>{t(actionNames[action.action] || 'actions')}</td>
                  <td>{t(action.allowed ? 'allowed' : 'denied')}</td>
                  <td>{action.sources.map((source) => t(source)).join(' + ') || t('none')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
