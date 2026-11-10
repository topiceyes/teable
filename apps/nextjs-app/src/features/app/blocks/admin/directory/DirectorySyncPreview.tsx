import type { IDirectorySyncPreviewVo } from '@teable/openapi';
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

export function DirectorySyncPreview({
  preview,
  busy,
  onApply,
  onClose,
}: {
  preview: IDirectorySyncPreviewVo;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [reviewed, setReviewed] = useState(false);
  const sections = [
    { key: 'departments', title: t('departments'), changes: preview.changes.departments },
    { key: 'members', title: t('employees'), changes: preview.changes.members },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('previewTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('previewDescription')}</p>
        {sections.map((section) => (
          <section key={section.key} className="space-y-2">
            <h3 className="font-semibold">{section.title}</h3>
            {(['added', 'updated', 'deactivated'] as const).map((kind) => (
              <details
                key={kind}
                className="rounded border p-3"
                open={kind === 'deactivated' && section.changes[kind].length > 0}
              >
                <summary
                  className={
                    kind === 'deactivated' ? 'text-destructive cursor-pointer' : 'cursor-pointer'
                  }
                >
                  {t(kind)} · {section.changes[kind].length}
                </summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {section.changes[kind].map((item) => (
                    <li key={item.externalId} className="break-all border-t pt-2">
                      <span className="font-medium">{item.name}</span>{' '}
                      <span className="text-muted-foreground">({item.externalId})</span>
                      {'departmentExternalIds' in item && (
                        <p className="text-muted-foreground text-xs">
                          {item.email || '—'} · {item.active ? t('active') : t('inactive')} ·{' '}
                          {t('departments')}: {item.departmentExternalIds.join(', ') || '—'} ·{' '}
                          {t('roles')}: {item.externalRoleIds.join(', ') || '—'}
                        </p>
                      )}
                      {'parentExternalId' in item && (
                        <p className="text-muted-foreground text-xs">
                          {t('parentDepartment')}: {item.parentExternalId || '—'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        ))}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={reviewed}
            onCheckedChange={(value) => setReviewed(value === true)}
            disabled={busy}
          />
          {t('reviewConfirmation')}
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={!reviewed || busy} onClick={onApply}>
            {busy ? t('syncing') : t('applySync')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
