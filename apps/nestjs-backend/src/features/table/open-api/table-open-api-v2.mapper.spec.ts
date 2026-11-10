import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType, ViewType, CellValueType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { mapLegacyCreateTableToV2Input } from './table-open-api-v2.mapper';

type ILegacyCreateField = IFieldRo &
  Partial<Pick<IFieldVo, 'cellValueType' | 'isMultipleCellValue'>>;

describe('mapLegacyCreateTableToV2Input', () => {
  const foreignTableId = 'tblForeign';
  const revenueFieldId = 'fldRevenue';
  const sumValuesExpression = 'sum({values})';

  it('maps legacy rollup fields into v2 create-table config', () => {
    const legacyFields = [
      {
        id: 'fldRollup',
        name: 'Revenue Total',
        type: FieldType.Rollup,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {
          expression: sumValuesExpression,
          timeZone: 'UTC',
        },
        lookupOptions: {
          linkFieldId: 'fldLink',
          foreignTableId,
          lookupFieldId: revenueFieldId,
        },
      },
    ] satisfies ILegacyCreateField[];
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Rollup Table',
      fields: legacyFields,
      views: [{ type: ViewType.Grid, name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldRollup',
        name: 'Revenue Total',
        type: 'rollup',
        cellValueType: CellValueType.Number,
        options: {
          expression: sumValuesExpression,
          timeZone: 'utc',
        },
        config: {
          linkFieldId: 'fldLink',
          foreignTableId,
          lookupFieldId: revenueFieldId,
        },
      },
    ]);
  });

  it('maps legacy conditional rollup and conditional lookup fields into v2 create-table inputs', () => {
    const legacyFields = [
      {
        id: 'fldConditionalRollup',
        name: 'High Revenue Total',
        type: FieldType.ConditionalRollup,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {
          foreignTableId,
          lookupFieldId: revenueFieldId,
          expression: sumValuesExpression,
          timeZone: 'UTC',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
          },
        },
      },
      {
        id: 'fldConditionalLookup',
        name: 'High Revenue Company',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        isMultipleCellValue: true,
        options: {
          formatting: { type: 'singleLineText' },
        },
        lookupOptions: {
          foreignTableId,
          lookupFieldId: 'fldName',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
          },
        },
      },
    ] satisfies ILegacyCreateField[];
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Conditional Table',
      fields: legacyFields,
      views: [{ type: ViewType.Grid, name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldConditionalRollup',
        name: 'High Revenue Total',
        type: 'conditionalRollup',
        cellValueType: CellValueType.Number,
        options: {
          expression: sumValuesExpression,
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: revenueFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
      },
      {
        id: 'fldConditionalLookup',
        name: 'High Revenue Company',
        type: 'conditionalLookup',
        isMultipleCellValue: true,
        options: {
          foreignTableId,
          lookupFieldId: 'fldName',
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
        innerOptions: {
          formatting: { type: 'singleLineText' },
        },
      },
    ]);
  });

  it('preserves db table and field names in v2 create-table inputs', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Custom Names',
      dbTableName: 'bseTest.custom_table',
      fields: [
        {
          id: 'fldName',
          name: 'Name',
          dbFieldName: 'db_field_name',
          type: FieldType.SingleLineText,
        },
      ],
      views: [{ type: ViewType.Grid, name: 'Grid' }],
      records: [],
    });

    expect(input.dbTableName).toBe('bseTest.custom_table');
    expect(input.fields).toEqual([
      {
        id: 'fldName',
        name: 'Name',
        dbFieldName: 'db_field_name',
        type: 'singleLineText',
      },
    ]);
  });

  it('normalizes legacy UTC values for generic field options', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Date Table',
      fields: [
        {
          id: 'fldDate',
          name: 'Due Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'HH:mm',
              timeZone: 'UTC',
            },
          },
        },
      ],
      views: [{ type: ViewType.Grid, name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldDate',
        name: 'Due Date',
        type: 'date',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      },
    ]);
  });
});

describe('lookup unique values table creation', () => {
  it.each([true, false])(
    'preserves isUnique=%s for regular and conditional lookup fields',
    (isUnique) => {
      const input = mapLegacyCreateTableToV2Input('bseTest', {
        name: 'Lookups',
        fields: [false, true].map((isConditionalLookup) => ({
          name: 'Values',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup,
          lookupOptions: {
            foreignTableId: 'tblForeign',
            lookupFieldId: 'fldValue',
            ...(isConditionalLookup
              ? { filter: { conjunction: 'and' as const, filterSet: [] } }
              : { linkFieldId: 'fldLink' }),
            isUnique,
          },
        })),
        views: [{ type: ViewType.Grid, name: 'Grid' }],
        records: [],
      });
      expect(input.fields).toEqual([
        expect.objectContaining({ type: 'lookup', options: expect.objectContaining({ isUnique }) }),
        expect.objectContaining({
          type: 'conditionalLookup',
          options: expect.objectContaining({ isUnique }),
        }),
      ]);
    }
  );
});
