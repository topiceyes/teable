import {
  ForbiddenException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { map } from 'rxjs';
import type { IClsStore } from '../../../types/cls';
import {
  redactRestrictedFields,
  TableDataAccessService,
  type IDataScope,
} from './table-data-access.service';

type IRequest = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: {
    baseId?: string;
    ids?: string[];
    record?: { fields?: Record<string, unknown> };
    records?: { id: string; fields?: Record<string, unknown> }[];
    [key: string]: unknown;
  };
};
type IMode = 'list' | 'recordIndex' | 'docIds' | 'snapshot' | 'single' | 'batch' | 'metadata';
const routes: { method: RegExp; path: RegExp; mode: IMode }[] = [
  {
    method: /^GET$/,
    path: /^\/api\/table\/[^/]+\/aggregation\/(?:row-count|group-points|search-count|search-cell-count|search-index|search-matches)$/,
    mode: 'list',
  },
  {
    method: /^GET$/,
    path: /^\/api\/table\/[^/]+\/aggregation\/record-index$/,
    mode: 'recordIndex',
  },
  { method: /^GET$/, path: /^\/api\/table\/[^/]+\/record$/, mode: 'list' },
  {
    method: /^POST$/,
    path: /^\/api\/table\/[^/]+\/record\/socket\/doc-ids$/,
    mode: 'docIds',
  },
  {
    method: /^POST$/,
    path: /^\/api\/table\/[^/]+\/record\/socket\/snapshot-bulk$/,
    mode: 'snapshot',
  },
  {
    method: /^(GET|PATCH|DELETE)$/,
    path: /^\/api\/table\/[^/]+\/record\/rec[^/]+$/,
    mode: 'single',
  },
  {
    method: /^(POST|PATCH|DELETE)$/,
    path: /^\/api\/table\/[^/]+\/record$/,
    mode: 'batch',
  },
  {
    method: /^GET$/,
    path: /^\/api\/table\/[^/]+\/field(?:\/fld[^/]+|\/socket\/(?:doc-ids|snapshot-bulk))?$/,
    mode: 'metadata',
  },
  {
    method: /^GET$/,
    path: /^\/api\/table\/[^/]+\/view(?:\/viw[^/]+|\/socket\/(?:doc-ids|snapshot-bulk))?$/,
    mode: 'metadata',
  },
  {
    method: /^GET$/,
    path: /^\/api\/base\/[^/]+\/table\/[^/]+(?:\/(?:permission|default-view-id))?$/,
    mode: 'metadata',
  },
];
function requireIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
    throw new ForbiddenException('Explicit record ids required');
  return value;
}

@Injectable()
export class TableDataAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly access: TableDataAccessService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<IRequest>();
    const userId = this.cls.get('user.id');
    if (await this.access.isAdministrator(userId)) return next.handle();
    const tableId = req.params.tableId;
    if (!tableId) {
      const restricted = await this.checkBaseRequest(req);
      if (!restricted || !req.path.endsWith('/permission')) return next.handle();
      return next.handle().pipe(map((value) => ({ ...(value as object), realtimeEnabled: false })));
    }
    const scope = await this.access.scope(tableId, userId);
    if (!scope) return next.handle();
    const mode = routes.find(
      (route) => route.method.test(req.method) && route.path.test(req.path)
    )?.mode;
    if (!mode)
      throw new ForbiddenException(
        'This operation is unavailable under field or record restrictions'
      );
    // Express 5 query is a getter. Freeze one request-local parsed object before Nest pipes run.
    Object.defineProperty(req, 'query', {
      configurable: true,
      writable: true,
      value: { ...req.query },
    });
    await this.prepareRequest(scope, mode, req, userId);
    return next.handle().pipe(map((value) => this.sanitizeResponse(scope, req, value)));
  }

  private async checkBaseRequest(req: IRequest) {
    // Copy APIs name the source fromBaseId and may also carry a different destination baseId.
    const baseIds = [
      req.params.baseId,
      req.body?.baseId,
      req.body?.fromBaseId,
      req.query?.baseId,
    ].filter((id): id is string => typeof id === 'string');
    const dataChannel =
      /(?:^|\/)(?:sql|query|export|import|share|attachments|app|apps|automation|workflow|ai|data-query)(?:\/|$)/i.test(
        req.path
      );
    if (dataChannel && (await this.access.restrictedTables()).length)
      throw new ForbiddenException('This data channel requires unrestricted access');
    const restrictions = await Promise.all(
      [...new Set(baseIds)].map((baseId) => this.access.restrictedTables(baseId))
    );
    if (!restrictions.some((items) => items.length)) return;
    const metadataOnly =
      req.method === 'GET' &&
      /^\/api\/base\/[^/]+(?:\/permission|\/table(?:\/socket\/(?:doc-ids|snapshot-bulk))?|\/node\/(?:list|tree))?$/.test(
        req.path
      );
    if (!metadataOnly) throw new ForbiddenException('Operation requires unrestricted base access');
    return true;
  }

  private async prepareRequest(scope: IDataScope, mode: IMode, req: IRequest, userId: string) {
    switch (mode) {
      case 'list':
        this.access.constrainQuery(scope, req.query);
        return;
      case 'recordIndex':
        if (typeof req.query.recordId !== 'string')
          throw new ForbiddenException('Explicit record id required');
        await this.access.assertRecords(scope, [req.query.recordId]);
        this.access.constrainQuery(scope, req.query);
        return;
      case 'docIds':
        this.access.constrainQuery(scope, req.body);
        return;
      case 'snapshot':
        await this.access.assertRecords(scope, requireIds(req.body.ids));
        return;
      case 'single':
        await this.access.assertRecords(scope, [req.params.recordId]);
        if (req.method === 'PATCH')
          this.access.assertWritableFields(scope, req.body.record?.fields || {});
        return;
      case 'batch':
        await this.prepareBatch(scope, req, userId);
        return;
      case 'metadata':
        if (scope.hidden.has(req.params.fieldId)) throw new ForbiddenException('Field unavailable');
        return;
    }
  }

  private async prepareBatch(scope: IDataScope, req: IRequest, userId: string) {
    if (req.method === 'DELETE') {
      await this.access.assertRecords(scope, requireIds(req.query.recordIds));
      return;
    }
    const records = req.body.records;
    if (!Array.isArray(records)) throw new ForbiddenException('Explicit records required');
    if (req.method === 'POST' && scope.creatorIds && !scope.creatorIds.includes(userId))
      throw new ForbiddenException('No permitted creator identity');
    if (req.method === 'PATCH')
      await this.access.assertRecords(scope, requireIds(records.map((record) => record.id)));
    for (const record of records) this.access.assertWritableFields(scope, record.fields || {});
  }

  private sanitizeResponse(scope: IDataScope, req: IRequest, value: unknown) {
    const safe = redactRestrictedFields(value, scope);
    if (req.path.endsWith('/permission') && safe && typeof safe === 'object') {
      Object.assign(safe, {
        realtimeEnabled: false,
        dataRestrictionsEnabled: true,
      });
    }
    const fieldIds = req.path.includes('/field/') && req.path.endsWith('/doc-ids');
    if (fieldIds && safe && typeof safe === 'object' && 'ids' in safe) {
      const ids = (safe as { ids: string[] }).ids;
      (safe as { ids: string[] }).ids = ids.filter((id) => !scope.hidden.has(id));
    }
    return safe;
  }
}
