import { of, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TableDataAccessInterceptor } from './table-data-access.interceptor';

function fixture() {
  const scope = {
    fields: [],
    hidden: new Set(['fldPrivate']),
    readOnly: new Set(),
    creatorIds: ['usrMe'],
  };
  const service = {
    isAdministrator: vi.fn().mockResolvedValue(false),
    restrictedTables: vi.fn().mockResolvedValue([{ tableId: 'tblMe' }]),
    scope: vi.fn().mockResolvedValue(scope),
    constrainQuery: vi.fn(),
    assertRecords: vi.fn(),
    assertWritableFields: vi.fn(),
  };
  const interceptor = new TableDataAccessInterceptor(
    service as never,
    { get: () => 'usrMe' } as never
  );
  const run = async (method: string, path: string, overrides = {}, response: unknown = {}) => {
    const req = {
      method,
      path,
      params: { tableId: 'tblMe' },
      query: {},
      body: {},
      ...overrides,
    };
    const next = { handle: vi.fn(() => of(response)) };
    const stream = await interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => req }) } as never,
      next
    );
    const value = await firstValueFrom(stream);
    return { req, next, value };
  };
  return { service, run };
}
describe('data restriction HTTP boundary', () => {
  it('passes list, grouping and search endpoints through the same scope constraint', async () => {
    const { service, run } = fixture();
    await run('GET', '/api/table/tblMe/record');
    for (const route of [
      'row-count',
      'group-points',
      'search-count',
      'search-cell-count',
      'search-index',
      'search-matches',
    ])
      await run('GET', '/api/table/tblMe/aggregation/' + route);
    expect(service.constrainQuery).toHaveBeenCalledTimes(7);
  });
  it('checks record ownership before locating a row index', async () => {
    const { service, run } = fixture();
    await run('GET', '/api/table/tblMe/aggregation/record-index', {
      query: { recordId: 'recMe' },
    });
    expect(service.assertRecords).toHaveBeenCalledWith(expect.anything(), ['recMe']);
    expect(service.constrainQuery).toHaveBeenCalledTimes(1);
    service.assertRecords.mockRejectedValue(new Error('foreign record'));
    await expect(
      run('GET', '/api/table/tblMe/aggregation/record-index', {
        query: { recordId: 'recOther' },
      })
    ).rejects.toThrow('foreign record');
    expect(service.constrainQuery).toHaveBeenCalledTimes(1);
  });
  it('scopes POST doc-id queries before the controller pipes execute', async () => {
    const { service, run } = fixture();
    const { req } = await run('POST', '/api/table/tblMe/record/socket/doc-ids');
    expect(service.constrainQuery).toHaveBeenCalledWith(expect.anything(), req.body);
  });
  it('requires explicit string ids for both snapshot recovery and batch delete', async () => {
    const { run } = fixture();
    await expect(
      run('POST', '/api/table/tblMe/record/socket/snapshot-bulk', {
        body: { ids: [3] },
      })
    ).rejects.toThrow();
    await expect(
      run('DELETE', '/api/table/tblMe/record', {
        query: { recordIds: 'recMe' },
      })
    ).rejects.toThrow();
  });
  it('checks the complete batch before passing it to the handler', async () => {
    const { service, run } = fixture();
    service.assertRecords.mockRejectedValue(new Error('foreign record'));
    await expect(
      run('PATCH', '/api/table/tblMe/record', {
        body: {
          records: [
            { id: 'recMe', fields: {} },
            { id: 'recOther', fields: {} },
          ],
        },
      })
    ).rejects.toThrow('foreign record');
    expect(service.assertRecords).toHaveBeenCalledWith(expect.anything(), ['recMe', 'recOther']);
  });
  it('denies unimplemented data routes and field schema mutations', async () => {
    const { run } = fixture();
    for (const [method, suffix] of [
      ['GET', 'aggregation'],
      ['GET', 'record/history'],
      ['PATCH', 'selection/paste'],
      ['POST', 'record/upsert'],
      ['POST', 'field'],
    ]) {
      await expect(run(method, '/api/table/tblMe/' + suffix)).rejects.toThrow('unavailable');
    }
  });
  it('preserves safe metadata reads needed to open a base', async () => {
    const { run } = fixture();
    for (const suffix of [
      '',
      '/permission',
      '/table',
      '/table/socket/doc-ids',
      '/table/socket/snapshot-bulk',
      '/node/list',
      '/node/tree',
    ]) {
      await expect(
        run('GET', '/api/base/bseMe' + suffix, { params: { baseId: 'bseMe' } })
      ).resolves.toBeDefined();
    }
  });
  it('marks optional realtime channels unavailable in base and table permission responses', async () => {
    const { run } = fixture();
    const base = await run('GET', '/api/base/bseMe/permission', {
      params: { baseId: 'bseMe' },
    });
    const table = await run('GET', '/api/base/bseMe/table/tblMe/permission');
    expect(base.value).toMatchObject({ realtimeEnabled: false });
    expect(table.value).toMatchObject({
      realtimeEnabled: false,
      dataRestrictionsEnabled: true,
    });
  });
  it('does not allow base-wide export to bypass the table boundary', async () => {
    const { run } = fixture();
    await expect(
      run('GET', '/api/base/bseMe/export', { params: { baseId: 'bseMe' } })
    ).rejects.toThrow();
  });
  it.each(['/api/base/duplicate', '/api/base/duplicate-stream'])(
    'checks the source independently of the destination on %s',
    async (path) => {
      const { service, run } = fixture();
      service.restrictedTables.mockImplementation(async (baseId?: string) =>
        baseId === 'bseSource' ? [{ tableId: 'tblMe' }] : []
      );
      await expect(
        run('POST', path, {
          params: {},
          body: { fromBaseId: 'bseSource', baseId: 'bseDestination' },
        })
      ).rejects.toThrow('unrestricted base');
      expect(service.restrictedTables).toHaveBeenCalledWith('bseSource');
      expect(service.restrictedTables).toHaveBeenCalledWith('bseDestination');
    }
  );
  it('filters hidden field ids out of socket field query results', async () => {
    const { run } = fixture();
    const result = await run(
      'GET',
      '/api/table/tblMe/field/socket/doc-ids',
      {},
      { ids: ['fldVisible', 'fldPrivate'] }
    );
    expect(result.value).toEqual({ ids: ['fldVisible'] });
  });
});
