import { useMutation, useQuery } from '@tanstack/react-query';
import type { IDirectoryMemberVo } from '@teable/openapi';
import { bindDirectoryMember, searchDirectoryAccounts } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export function DirectoryBindingDialog({
  corpId,
  member,
  onClose,
  onChanged,
}: {
  corpId: string;
  member: IDirectoryMemberVo;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.directory' });
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [userId, setUserId] = useState<string>();
  const accounts = useQuery({
    queryKey: ['directory-accounts', corpId, submittedSearch],
    queryFn: () =>
      searchDirectoryAccounts({ corpId, search: submittedSearch }).then(({ data }) => data),
    enabled: !member.userId && submittedSearch.length >= 2,
  });
  const mutation = useMutation({
    mutationFn: () =>
      bindDirectoryMember({
        corpId,
        memberId: member.id,
        userId: member.userId ? null : userId!,
        expectedUserId: member.userId,
      }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
    onError: () => onChanged(),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {member.userId ? t('unbindTitle') : t('bindTitle')} · {member.name}
          </DialogTitle>
        </DialogHeader>
        {member.userId ? (
          <p className="text-sm">
            {t('unbindDescription', { account: member.user?.email || member.userId })}
          </p>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setUserId(undefined);
                setSubmittedSearch(search.trim());
              }}
            >
              <Input
                aria-label={t('accountSearch')}
                placeholder={t('accountSearch')}
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                disabled={mutation.isPending}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={search.trim().length < 2 || mutation.isPending}
              >
                {t('search')}
              </Button>
            </form>
            {accounts.isFetching && <p role="status">{t('loading')}</p>}
            {accounts.isError && (
              <p role="alert" className="text-destructive text-sm">
                {t('loadFailed')}
              </p>
            )}
            {accounts.data && !accounts.isFetching && (
              <fieldset className="max-h-60 space-y-2 overflow-auto">
                <legend className="text-muted-foreground text-sm">{t('chooseAccount')}</legend>
                {accounts.data.length === 0 && <p className="text-sm">{t('noAccounts')}</p>}
                {accounts.data.map((account) => (
                  <label
                    key={account.id}
                    className="flex cursor-pointer items-center gap-3 rounded border p-3"
                  >
                    <input
                      type="radio"
                      name="directory-account"
                      value={account.id}
                      checked={userId === account.id}
                      disabled={mutation.isPending}
                      onChange={() => setUserId(account.id)}
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">{account.name}</span>
                      <span className="text-muted-foreground break-all">{account.email}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="text-muted-foreground text-xs">{t('bindingDescription')}</p>
          </>
        )}
        {mutation.isError && (
          <p role="alert" className="text-destructive text-sm">
            {t('bindingFailed')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={member.userId ? 'destructive' : 'default'}
            disabled={mutation.isPending || (!member.userId && !userId)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('saving')
              : member.userId
                ? t('confirmUnbind')
                : t('confirmBind')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
