import type {
  ITableAuthorityOptionsVo,
  ITableAuthorityPolicy,
  ITableDataRestriction,
  ITableRoleRestriction,
} from '@teable/openapi';
import { Button, Checkbox } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

type ScopeValues = Pick<ITableDataRestriction, 'rowScope' | 'hiddenFieldIds' | 'readOnlyFieldIds'>;
function ScopeEditor({
  scope,
  table,
  labelPrefix,
  disabled,
  onChange,
}: {
  scope: ScopeValues;
  table?: ITableAuthorityOptionsVo['tables'][number];
  labelPrefix: string;
  disabled: boolean;
  onChange: (patch: Partial<ScopeValues>) => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        {t('rowScope')}
        <select
          aria-label={`${labelPrefix} ${t('rowScope')}`}
          disabled={disabled}
          className="rounded border bg-background p-2"
          value={scope.rowScope}
          onChange={(event) =>
            onChange({ rowScope: event.target.value as ScopeValues['rowScope'] })
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
      {table && !table.fields?.some((field) => field.type === 'createdBy') && (
        <p className="text-sm text-muted-foreground">{t('creatorFieldRequired')}</p>
      )}
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
                    aria-label={`${labelPrefix === table?.id ? '' : labelPrefix + ' '}${field.id} ${key}`}
                    checked={scope[key].includes(field.id)}
                    disabled={disabled || (key === 'hiddenFieldIds' && Boolean(field.isPrimary))}
                    onCheckedChange={(checked) =>
                      onChange({
                        [key]:
                          checked === true
                            ? [...scope[key], field.id]
                            : scope[key].filter((id) => id !== field.id),
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
}

function RoleScopes({
  rule,
  table,
  roles,
  disabled,
  onChange,
}: {
  rule: ITableDataRestriction;
  table?: ITableAuthorityOptionsVo['tables'][number];
  roles: { id: string; name: string }[];
  disabled: boolean;
  onChange: (overrides: ITableRoleRestriction[]) => void;
}) {
  const { t } = useTranslation('common', { keyPrefix: 'admin.matrix' });
  const [roleId, setRoleId] = useState('');
  const overrides = rule.roleOverrides || [];
  const move = (index: number, delta: number) => {
    const next = [...overrides];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return (
    <section aria-label={`${rule.tableId} ${t('roleScopes')}`} className="space-y-3 border-t pt-4">
      <h4 className="font-semibold">{t('roleScopes')}</h4>
      <p className="text-sm text-muted-foreground">{t('roleScopesHelp')}</p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={`${rule.tableId} ${t('restrictionRole')}`}
          className="rounded border bg-background p-2 text-sm"
          value={roleId}
          disabled={disabled}
          onChange={(event) => setRoleId(event.target.value)}
        >
          <option value="">{t('chooseRole')}</option>
          {roles
            .filter((role) => !overrides.some((item) => item.roleId === role.id))
            .map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={
            disabled ||
            !roles.some((role) => role.id === roleId) ||
            overrides.length >= 100 ||
            overrides.some((item) => item.roleId === roleId)
          }
          onClick={() => {
            onChange([
              ...overrides,
              {
                roleId,
                rowScope: rule.rowScope,
                hiddenFieldIds: [...rule.hiddenFieldIds],
                readOnlyFieldIds: [...rule.readOnlyFieldIds],
              },
            ]);
            setRoleId('');
          }}
        >
          {t('addRoleScope')}
        </Button>
      </div>
      {overrides.map((scope, index) => (
        <div key={scope.roleId} className="space-y-3 rounded border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="font-medium">
              {index + 1}.{' '}
              {roles.find((role) => role.id === scope.roleId)?.name || t('unavailableRole')}
            </h5>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={`${scope.roleId} ${t('moveUp')}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                {t('moveUp')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${scope.roleId} ${t('moveDown')}`}
                disabled={disabled || index === overrides.length - 1}
                onClick={() => move(index, 1)}
              >
                {t('moveDown')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${scope.roleId} ${t('removeRoleScope')}`}
                disabled={disabled}
                onClick={() => onChange(overrides.filter((_, i) => i !== index))}
              >
                {t('remove')}
              </Button>
            </div>
          </div>
          <ScopeEditor
            scope={scope}
            table={table}
            labelPrefix={`${rule.tableId}:${scope.roleId}`}
            disabled={disabled}
            onChange={(patch) =>
              onChange(overrides.map((item, i) => (i === index ? { ...item, ...patch } : item)))
            }
          />
        </div>
      ))}
    </section>
  );
}

export function MatrixDataRestrictions({
  policy,
  tables,
  disabled,
  roles = [],
  onChange,
}: {
  policy: ITableAuthorityPolicy;
  tables: ITableAuthorityOptionsVo['tables'];
  disabled: boolean;
  roles?: { id: string; name: string }[];
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
            <h4 className="font-medium">{t('defaultScope')}</h4>
            <p className="text-xs text-muted-foreground">{t('defaultScopeHelp')}</p>
            <ScopeEditor
              scope={rule}
              table={table}
              labelPrefix={rule.tableId}
              disabled={disabled}
              onChange={(patch) => change(index, patch)}
            />
            <p className="text-xs text-muted-foreground">{t('rowScopeHelp')}</p>
            <RoleScopes
              rule={rule}
              table={table}
              roles={roles}
              disabled={disabled}
              onChange={(roleOverrides) => change(index, { roleOverrides })}
            />
          </div>
        );
      })}
    </section>
  );
}
