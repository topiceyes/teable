import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

export function roleErrorKey(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Role changed or unavailable')) return 'roleErrorConflict';
  if (message.includes('Role name already exists')) return 'roleErrorName';
  if (message.includes('employee not found') || message.includes('Employee not found'))
    return 'roleErrorEmployee';
  if (message.includes('Active department not found')) return 'roleErrorDepartment';
  if (message.includes('Directory update already running')) return 'roleErrorBusy';
  if (message.includes('Directory connection disabled')) return 'roleErrorConnection';
  if (message.includes('Role rule limit exceeded')) return 'roleErrorLimit';
  return 'roleSaveFailed';
}

export function useRoleDiscard(dirty: boolean, busy: boolean, onClose: () => void) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!dirty && !busy) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, busy]);
  return {
    requestClose: () => {
      if (!busy) {
        if (dirty) setConfirm(true);
        else onClose();
      }
    },
    discardDialog: (
      <DiscardChangesDialog open={confirm} onOpenChange={setConfirm} onDiscard={onClose} />
    ),
  };
}
function DiscardChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('discardRoleTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('discardRoleDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('continueEditing')}</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>{t('discardChanges')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
