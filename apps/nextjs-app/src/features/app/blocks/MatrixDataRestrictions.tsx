import type {
  ITableAuthorityOptionsVo,
  ITableAuthorityPolicy,
  ITableDataRestriction,
} from '@teable/openapi';
import { Button, Checkbox } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export function MatrixDataRestrictions({
  policy,
  tables,
  disabled,
  onChange,
}: {
  policy: ITableAuthorityPolicy;
  tables: ITableAuthorityOptionsVo['tables'];
  disabled: boolean;
  onChange: (policy: ITableAuthorityPolicy) => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [selected, setSelected] = useState('');
  const restrictions = policy.restrictions || [];
  const change = (index: number, patch: Partial<ITableDataRestriction>) =>
    onChange({
      ...policy,
      restrictions: restrictions.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    });
  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">{t('dataRestrictionsTitle')}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('dataRestrictionsHelp')}</p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={t('restrictionTable')}
          className="rounded border bg-background p-2 text-sm"
          value={selected}
          disabled={disabled}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t('chooseTable')}</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={disabled || !selected || restrictions.some((rule) => rule.tableId === selected)}
          onClick={() =>
            onChange({
              ...policy,
              restrictions: [
                ...restrictions,
                { tableId: selected, rowScope: 'all', hiddenFieldIds: [], readOnlyFieldIds: [] },
              ],
            })
          }
        >
          {t('addRestriction')}
        </Button>
      </div>
      {restrictions.map((rule, index) => {
        const table = tables.find((table) => table.id === rule.tableId);
        return (
          <div key={rule.tableId} className="space-y-3 rounded border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">{table?.name || t('unavailableTable')}</h3>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onChange({ ...policy, restrictions: restrictions.filter((_, i) => i !== index) })
                }
              >
                {t('remove')}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              {t('rowScope')}
              <select
                aria-label={`${rule.tableId} ${t('rowScope')}`}
                disabled={disabled}
                className="rounded border bg-background p-2"
                value={rule.rowScope}
                onChange={(event) =>
                  change(index, {
                    rowScope: event.target.value as ITableDataRestriction['rowScope'],
                  })
                }
              >
                <option value="all">{t('allRows')}</option>
                <option
                  value="own"
                  disabled={!table?.fields?.some((field) => field.type === 'createdBy')}
                >
                  {t('ownRows')}
                </option>
                <option
                  value="department"
                  disabled={!table?.fields?.some((field) => field.type === 'createdBy')}
                >
                  {t('departmentRows')}
                </option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">{t('rowScopeHelp')}</p>
            <table className="w-full text-start text-sm">
              <thead>
                <tr>
                  <th>{t('fieldName')}</th>
                  <th>{t('hiddenField')}</th>
                  <th>{t('readOnlyField')}</th>
                </tr>
              </thead>
              <tbody>
                {table?.fields?.map((field) => (
                  <tr key={field.id}>
                    <td className="py-2">{field.name}</td>
                    {(['hiddenFieldIds', 'readOnlyFieldIds'] as const).map((key) => (
                      <td key={key}>
                        <Checkbox
                          aria-label={`${field.id} ${key}`}
                          checked={rule[key].includes(field.id)}
                          disabled={
                            disabled || (key === 'hiddenFieldIds' && Boolean(field.isPrimary))
                          }
                          onCheckedChange={(checked) =>
                            change(index, {
                              [key]:
                                checked === true
                                  ? [...rule[key], field.id]
                                  : rule[key].filter((id) => id !== field.id),
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
