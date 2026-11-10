import type { ITableAuthorityOptionsVo } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { ShareBaseDialog } from '../components/collaborator/share/ShareBaseDialog';
import { DirectoryMembers } from './admin/directory/DirectoryMembers';
import { DirectoryRoles } from './admin/directory/DirectoryRoles';

export function MatrixSetup({
  connection,
  disabled,
  onChanged,
}: {
  connection?: ITableAuthorityOptionsVo['connections'][number];
  disabled: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [panel, setPanel] = useState<'roles' | 'members'>();
  return (
    <section aria-label={t('setupTitle')} className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">{t('setupTitle')}</h2>
      <ol className="grid gap-4 text-sm lg:grid-cols-3">
        <li className="space-y-2">
          <h3 className="font-medium">{t('setupRoles')}</h3>
          <p className="text-muted-foreground">{t('setupRolesHelp')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!connection || disabled}
            aria-expanded={panel === 'roles'}
            onClick={() => setPanel(panel === 'roles' ? undefined : 'roles')}
          >
            {t('manageRoles')}
          </Button>
        </li>
        <li className="space-y-2">
          <h3 className="font-medium">{t('setupBindings')}</h3>
          <p className="text-muted-foreground">{t('setupBindingsHelp')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!connection || disabled}
            aria-expanded={panel === 'members'}
            onClick={() => setPanel(panel === 'members' ? undefined : 'members')}
          >
            {t('manageBindings')}
          </Button>
        </li>
        <li className="space-y-2">
          <h3 className="font-medium">{t('setupAccess')}</h3>
          <p className="text-muted-foreground">{t('setupAccessHelp')}</p>
          <ShareBaseDialog>
            <Button variant="outline" size="sm" disabled={disabled}>
              {t('manageBaseMembers')}
            </Button>
          </ShareBaseDialog>
        </li>
      </ol>
      <Button asChild variant="link" className="h-auto p-0">
        <Link href="/admin/directory" target="_blank" rel="noopener noreferrer">
          {t('openDirectory')}
        </Link>
      </Button>
      {connection && panel && (
        <div key={`${connection.id}:${panel}`} className="rounded border bg-muted/20 p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('directoryChangesLive')}</p>
          {panel === 'roles' ? (
            <DirectoryRoles corpId={connection.corpId} syncBusy={disabled} onChanged={onChanged} />
          ) : (
            <DirectoryMembers
              corpId={connection.corpId}
              syncBusy={disabled}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </section>
  );
}
