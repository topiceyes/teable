import { tableAuthorityPolicySchema } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { redactRestrictedFields, TableDataAccessService } from './table-data-access.service';

const fields = [
  { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
  {
    id: 'fldPrivate',
    name: 'Private',
    dbFieldName: 'private_column',
    type: 'singleLineText',
  },
  { id: 'fldCreator', name: 'Creator', type: 'createdBy', isComputed: true },
  { id: 'fldFormula', name: 'Formula', type: 'formula', isComputed: true },
].map((field) => ({
  isComputed: false,
  isLookup: false,
  isPrimary: false,
  options: null,
  ...field,
}));
function fixture(rowScope: 'all' | 'own' | 'department' = 'own') {
  const restriction = {
    tableId: 'tblMine',
    hiddenFieldIds: ['fldPrivate'],
    readOnlyFieldIds: ['fldName'],
    rowScope,
  };
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    tableMeta: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'tblMine',
        baseId: 'bseMine',
        dbTableName: 'data.records',
      }),
    },
    tableAuthorityPolicy: {
      findMany: vi.fn().mockResolvedValue([
        {
          baseId: 'bseMine',
          connectionId: 'connMine',
          policy: {
            version: 1,
            enabled: true,
            rules: [],
            restrictions: [restriction],
          },
        },
      ]),
    },
    field: { findMany: vi.fn().mockResolvedValue(fields) },
    directoryMember: {
      findFirst: vi.fn().mockResolvedValue({ memberships: [{ departmentId: 'deptMine' }] }),
      findMany: vi.fn().mockResolvedValue([{ userId: 'usrMine' }, { userId: 'usrPeer' }]),
    },
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    toSQL: () => ({
      toNative: () => ({
        sql: 'bound-query',
        bindings: ['recMine', 'usrMine'],
      }),
    }),
  };
  const router = {
    dataKnexForTable: vi.fn().mockResolvedValue(() => query),
    queryDataPrismaForTable: vi.fn().mockResolvedValue([{ __id: 'recMine' }]),
  };
  const service = new TableDataAccessService(
    prisma as never,
    { get: () => 'usrMine' } as never,
    router as never
  );
  return { service, prisma, router, query };
}
describe('server-side data restrictions', () => {
  it('restricts own rows and hides both private and derived field values', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    expect(scope.creatorIds).toEqual(['usrMine']);
    expect([...scope.hidden]).toEqual(['fldPrivate', 'fldFormula']);
    const result = redactRestrictedFields(
      {
        records: [
          {
            id: 'recMine',
            fields: {
              fldName: 'public',
              fldPrivate: 'secret',
              fldFormula: 'derived',
            },
          },
        ],
        snapshots: [{ id: 'fldPrivate', data: { name: 'Private' } }],
      },
      scope
    );
    expect(result).toMatchObject({
      records: [{ id: 'recMine', fields: { fldName: 'public' } }],
      snapshots: [],
    });
  });
  it('merges ownership with a caller OR filter using AND, including ignoreViewQuery requests', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    const original = {
      conjunction: 'or',
      filterSet: [{ fieldId: 'fldName', operator: 'is', value: 'public' }],
    };
    const query: Record<string, unknown> = {
      orderBy: [],
      groupBy: [],
      filter: JSON.stringify(original),
      ignoreViewQuery: true,
    };
    service.constrainQuery(scope, query);
    expect(JSON.parse(query.filter as string)).toMatchObject({
      conjunction: 'and',
      filterSet: [
        original,
        {
          conjunction: 'or',
          filterSet: [{ fieldId: 'fldCreator', operator: 'is', value: 'usrMine' }],
        },
      ],
    });
    expect(query.projection).toEqual(['fldName', 'fldCreator']);
  });
  it('rejects hidden field filters and query side channels instead of silently weakening them', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    for (const input of [
      { filter: { fieldId: 'fldPrivate', value: 'secret' } },
      { search: ['secret', 'fldPrivate'] },
      { filterByTql: 'secret' },
      { groupBy: [{ fieldId: 'fldPrivate' }] },
      { orderBy: [{ fieldId: 'fldPrivate' }] },
    ]) {
      expect(() => service.constrainQuery(scope, input)).toThrow();
    }
  });
  it('allows visible sorting/grouping and pins all-field searches to visible projected ids', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    const query: Record<string, unknown> = {
      orderBy: JSON.stringify([{ fieldId: 'fldName', order: 'desc' }]),
      groupBy: [{ fieldId: 'fldCreator', order: 'asc' }],
      search: ['Private', '', 'true'],
      projection: ['fldName'],
      queryId: 'cached-unchecked-query',
    };
    service.constrainQuery(scope, query);
    expect(query.search).toEqual(['Private', 'fldName', true]);
    expect(query.orderBy).toEqual([{ fieldId: 'fldName', order: 'desc' }]);
    expect(query.groupBy).toEqual([{ fieldId: 'fldCreator', order: 'asc' }]);
    expect(query.projection).toEqual(['fldName']);
    expect(query.ignoreViewQuery).toBe(true);
    expect(query.queryId).toBeUndefined();
    expect(query.filter).toContain('usrMine');
  });
  it('checks field references structurally without treating literal text as field references', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    const filter = (value: unknown) => ({
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldName', operator: 'is', value }],
    });
    expect(() =>
      service.constrainQuery(scope, { filter: filter('Private fldPrivate') })
    ).not.toThrow();
    for (const value of [
      { type: 'field', fieldId: 'fldPrivate' },
      { type: 'field', fieldId: 'fldName', tableId: 'tblForeign' },
    ])
      expect(() => service.constrainQuery(scope, { filter: filter(value) })).toThrow();
  });
  it('never widens an empty or invalid search projection to all fields', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    for (const input of [
      { search: ['secret'], projection: [] },
      { search: ['secret', 'fldName,fldPrivate'] },
      { search: ['secret', 'unknown'] },
      { search: ['secret'], projection: ['fldPrivate'] },
      { search: ['secret'], projection: 'fldName' },
      { search: '["secret"]' },
      { groupBy: 'invalid-json' },
      { orderBy: [{ fieldId: 'fldName', order: 'invalid' }] },
    ])
      expect(() => service.constrainQuery(scope, input)).toThrow();
    scope.hidden = new Set(scope.fields.map((field) => field.id));
    expect(() => service.constrainQuery(scope, { search: ['secret'] })).toThrow();
  });
  it('checks every batch id before allowing writes and uses bound SQL values', async () => {
    const { service, router, query } = fixture();
    const scope = (await service.scope('tblMine'))!;
    await service.assertRecords(scope, ['recMine']);
    expect(query.whereIn).toHaveBeenCalledWith('__created_by', ['usrMine']);
    expect(router.queryDataPrismaForTable).toHaveBeenCalledWith(
      'tblMine',
      'bound-query',
      'recMine',
      'usrMine'
    );
    await expect(service.assertRecords(scope, ['recMine', 'recForeign'])).rejects.toThrow(
      'outside your data scope'
    );
  });
  it('rejects read-only fields by either id or name', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    for (const key of ['fldName', 'Name', 'Private', 'private_column', 'fldFormula', 'unknown'])
      expect(() => service.assertWritableFields(scope, { [key]: 'value' })).toThrow();
    expect(() => service.assertWritableFields(scope, {})).not.toThrow();
  });
  it('resolves department creators within the same enterprise and direct departments only', async () => {
    const { service, prisma } = fixture('department');
    const scope = (await service.scope('tblMine'))!;
    expect(scope.creatorIds).toEqual(['usrMine', 'usrPeer']);
    expect(prisma.directoryMember.findMany.mock.calls[0][0].where).toMatchObject({
      connectionId: 'connMine',
      inactiveTime: null,
      memberships: { some: { departmentId: { in: ['deptMine'] } } },
    });
  });
  it('denies department records after unbinding without granting all rows', async () => {
    const { service, prisma } = fixture('department');
    prisma.directoryMember.findFirst.mockResolvedValue(null);
    const scope = (await service.scope('tblMine'))!;
    expect(scope.creatorIds).toEqual([]);
    await expect(service.assertRecords(scope, ['recMine'])).rejects.toThrow();
    const query: Record<string, unknown> = {};
    service.constrainQuery(scope, query);
    expect(query.filter).toContain('usrNoAuthorizedCreator');
  });
  it('bypasses restrictions only for an active instance administrator', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin' });
    expect(await service.scope('tblMine', 'admin')).toBeUndefined();
    expect(prisma.user.findFirst.mock.calls[0][0].where).toMatchObject({
      isAdmin: true,
      deletedTime: null,
      deactivatedTime: null,
    });
  });
  it('does not forward protected values in live operations but preserves the document version', async () => {
    const { service } = fixture();
    const message = {
      a: 'op',
      d: 'recMine',
      v: 7,
      op: [
        { p: ['fields', 'fldName'], oi: 'public' },
        { p: ['fields', 'fldPrivate'], oi: 'secret' },
      ],
    };
    await service.sanitizeDocument('usrMine', 'rec', 'tblMine', message);
    expect(message).toMatchObject({
      v: 7,
      op: [{ p: ['fields', 'fldName'], oi: 'public' }],
    });
    expect(JSON.stringify(message)).not.toContain('secret');
  });
  it('keeps the original shared operation untouched when sanitizing one agent', async () => {
    const { service } = fixture();
    const operation = [{ p: ['fields', 'fldPrivate'], oi: 'secret' }];
    const message = { d: 'recMine', op: operation };
    await service.sanitizeDocument('usrMine', 'rec', 'tblMine', message);
    expect(message.op).toEqual([]);
    expect(operation).toHaveLength(1);
  });
  it('preserves DTO and attachment properties when a hidden field uses a reserved name', async () => {
    const { service } = fixture();
    const scope = (await service.scope('tblMine'))!;
    scope.fields = scope.fields.map((field) =>
      field.id === 'fldPrivate' ? { ...field, name: 'id' } : field
    );
    expect(
      redactRestrictedFields(
        {
          id: 'recMine',
          fields: { id: 'secret', fldName: 'public' },
          attachment: { id: 'attOne', name: 'file' },
        },
        scope
      )
    ).toMatchObject({
      id: 'recMine',
      fields: { fldName: 'public' },
      attachment: { id: 'attOne', name: 'file' },
    });
    expect(
      JSON.stringify(redactRestrictedFields({ fields: { id: 'secret' } }, scope))
    ).not.toContain('secret');
  });
  it('redacts entire field-map replacements without mutating the shared old/new values', async () => {
    const { service } = fixture();
    const replacement = {
      p: ['fields'],
      oi: { Private: 'new-secret', fldName: 'new' },
      od: { fldPrivate: 'old-secret', fldName: 'old' },
    };
    const message = { d: 'recMine', op: [replacement] };
    await service.sanitizeDocument('usrMine', 'rec', 'tblMine', message);
    expect(JSON.stringify(message)).not.toContain('secret');
    expect(replacement.oi.Private).toBe('new-secret');
    expect(replacement.od.fldPrivate).toBe('old-secret');
  });
  it.each([
    { a: 'qs', data: [{ d: 'recMine' }, { d: 'recForeign' }] },
    { a: 'qf', data: [{ d: 'recMine' }, { d: 'recForeign' }] },
    { a: 'q', diff: [{ type: 'insert', values: [{ d: 'recForeign' }] }] },
    { a: 'bs', data: { recMine: {}, recForeign: {} } },
    { a: 'bf', data: { recMine: {}, recForeign: {} } },
  ])('revalidates every outbound record in $a messages', async (message) => {
    const { service, router } = fixture();
    router.queryDataPrismaForTable.mockResolvedValue([]);
    await expect(service.sanitizeDocument('usrMine', 'rec', 'tblMine', message)).rejects.toThrow(
      'outside your data scope'
    );
  });
  it('denies hidden field snapshots in a collection query without a top-level document id', async () => {
    const { service } = fixture();
    await expect(
      service.sanitizeDocument('usrMine', 'fld', 'tblMine', {
        a: 'qs',
        data: [{ d: 'fldPrivate', data: { name: 'Private' } }],
      })
    ).rejects.toThrow('Field is unavailable');
  });
  it('protects multi-hop and conditional references across bases, including copy checks', async () => {
    const { service, prisma } = fixture();
    prisma.field.findMany.mockResolvedValue([
      {
        id: 'fldThird',
        tableId: 'tblThird',
        options: null,
        lookupOptions: JSON.stringify({ foreignTableId: 'tblSecond' }),
        table: { baseId: 'bseThird' },
      },
      {
        id: 'fldSecond',
        tableId: 'tblSecond',
        options: JSON.stringify({ foreignTableId: 'tblMine' }),
        lookupOptions: null,
        table: { baseId: 'bseSecond' },
      },
      {
        id: 'fldCycle',
        tableId: 'tblMine',
        options: JSON.stringify({ foreignTableId: 'tblThird' }),
        lookupOptions: null,
        table: { baseId: 'bseMine' },
      },
    ] as never);
    const result = await service.restrictedTables('bseThird');
    expect(result).toMatchObject([
      {
        baseId: 'bseThird',
        restriction: { tableId: 'tblThird', hiddenFieldIds: ['fldThird'] },
      },
    ]);
  });
  it('rejects malformed policies and missing creator fields', async () => {
    const { service, prisma } = fixture();
    prisma.field.findMany.mockResolvedValue(fields.filter((field) => field.type !== 'createdBy'));
    await expect(service.scope('tblMine')).rejects.toThrow('Created By');
    prisma.tableAuthorityPolicy.findMany.mockResolvedValue([{ policy: { invalid: true } }]);
    await expect(service.scope('tblMine')).rejects.toThrow('Invalid stored');
  });
  it('validates duplicate restrictions and keeps existing policies backwards compatible', () => {
    const rule = {
      tableId: 'tblMine',
      hiddenFieldIds: [],
      readOnlyFieldIds: [],
      rowScope: 'all',
    };
    expect(
      tableAuthorityPolicySchema.safeParse({
        version: 1,
        enabled: true,
        rules: [],
      }).success
    ).toBe(true);
    expect(
      tableAuthorityPolicySchema.safeParse({
        version: 1,
        enabled: true,
        rules: [],
        restrictions: [rule, rule],
      }).success
    ).toBe(false);
  });
});
