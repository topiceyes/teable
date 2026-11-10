import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { isFieldReferenceValue, type IFilterSet } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  contentQueryBaseSchema,
  tableAuthorityPolicySchema,
  type ITableDataRestriction,
  type IQueryBaseRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { DatabaseRouter } from '../../../global/database-router.service';
import type { IClsStore } from '../../../types/cls';

type IField = {
  id: string;
  name: string;
  dbFieldName?: string;
  type: string;
  isComputed: boolean | null;
  isLookup: boolean | null;
  isPrimary: boolean | null;
  options: string | null;
};
export type IDataScope = {
  tableId: string;
  baseId: string;
  dbTableName: string;
  connectionId: string;
  restriction: ITableDataRestriction;
  fields: IField[];
  hidden: Set<string>;
  readOnly: Set<string>;
  creatorFieldId?: string;
  creatorIds?: string[];
};

function isViewConfiguration(object: Record<string, unknown>, key: string) {
  return (
    typeof object.id === 'string' &&
    object.id.startsWith('viw') &&
    ['filter', 'sort', 'group', 'groupBy'].includes(key)
  );
}
const restrictedQuerySchema = contentQueryBaseSchema.pick({
  filter: true,
  search: true,
  orderBy: true,
  groupBy: true,
});

function assertFilterFields(
  scope: IDataScope,
  set: IFilterSet,
  assertVisible: (id: string) => void
) {
  for (const item of set.filterSet) {
    if ('filterSet' in item) {
      assertFilterFields(scope, item, assertVisible);
      continue;
    }
    assertVisible(item.fieldId);
    if (!isFieldReferenceValue(item.value)) continue;
    if (item.value.tableId && item.value.tableId !== scope.tableId)
      throw new ForbiddenException('Cross-table filter references are unavailable');
    assertVisible(item.value.fieldId);
  }
}

function constrainSearchProjection(
  query: Record<string, unknown>,
  search: IQueryBaseRo['search'],
  visible: string[],
  assertVisible: (id: string) => void
) {
  const projection = query.projection;
  if (
    projection !== undefined &&
    (!Array.isArray(projection) || projection.some((id) => typeof id !== 'string'))
  )
    throw new BadRequestException('Invalid field projection');
  const projected = projection as string[] | undefined;
  projected?.forEach(assertVisible);
  query.projection = projected ?? visible;
  if (search) {
    const requested = search[1]
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    requested?.forEach(assertVisible);
    const searchFields = (requested?.length ? requested : visible).filter(
      (id) => !projected || projected.includes(id)
    );
    // Some aggregation schemas omit projection. An explicit, nonempty field list keeps
    // every search consumer scoped, including counts and group points, in v1 and v2.
    if (!searchFields.length)
      throw new ForbiddenException('No searchable fields in this projection');
    query.search = [search[0], [...new Set(searchFields)].join(','), search[2] ?? false];
  }
}

export function redactRestrictedFields(
  value: unknown,
  scope: IDataScope,
  cellMap = false
): unknown {
  if (Array.isArray(value))
    return value
      .filter((item) => {
        if (!item || typeof item !== 'object') return true;
        const object = item as Record<string, unknown>;
        return !(typeof object.id === 'string' && scope.hidden.has(object.id));
      })
      .map((item) => redactRestrictedFields(item, scope, cellMap));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const forbidden = new Set(
    scope.fields
      .filter((field) => scope.hidden.has(field.id))
      .flatMap((field) => [field.id, field.name, ...(field.dbFieldName ? [field.dbFieldName] : [])])
  );
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(object)) {
    // Field names may be "id", "name", "type" or "fields". Only cell maps use name aliases;
    // removing these keys from arbitrary DTOs corrupts records, users and attachment metadata.
    if (scope.hidden.has(key) || (cellMap && forbidden.has(key))) continue;
    if (isViewConfiguration(object, key)) continue;
    // User fields can also be encoded in json0 snapshot data, columnMeta, or grouped responses.
    result[key] = redactRestrictedFields(nested, scope, !cellMap && key === 'fields');
  }
  return cellMap ? result : addRestrictedMetadata(object, result, scope);
}

function addRestrictedMetadata(
  object: Record<string, unknown>,
  result: Record<string, unknown>,
  scope: IDataScope
) {
  if (object.fields && !Array.isArray(object.fields) && typeof object.fields === 'object') {
    const previous = object.permissions as
      | { read?: Record<string, boolean>; update?: Record<string, boolean> }
      | undefined;
    result.permissions = {
      read: Object.fromEntries(
        scope.fields
          .filter((field) => !scope.hidden.has(field.id))
          .map((field) => [
            field.id,
            !scope.hidden.has(field.id) && previous?.read?.[field.id] !== false,
          ])
      ),
      update: Object.fromEntries(
        scope.fields
          .filter((field) => !scope.hidden.has(field.id))
          .map((field) => [
            field.id,
            !scope.readOnly.has(field.id) &&
              !field.isComputed &&
              previous?.update?.[field.id] !== false,
          ])
      ),
    };
  }
  if (
    typeof object.id === 'string' &&
    object.id.startsWith('fld') &&
    typeof object.type === 'string'
  ) {
    result.recordCreate = object.recordCreate !== false && !scope.readOnly.has(object.id);
  }
  if (
    typeof object.id === 'string' &&
    object.id.startsWith('rec') &&
    scope.fields.some((field) => field.isPrimary && scope.hidden.has(field.id))
  ) {
    delete result.name;
  }
  return result;
}

function documentIds(message: Record<string, unknown>) {
  const ids = new Set<string>();
  if (typeof message.d === 'string') ids.add(message.d);
  const snapshots = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(snapshots);
    const object = value as Record<string, unknown>;
    if (typeof object.d === 'string') ids.add(object.d);
  };
  if (['qs', 'qf'].includes(String(message.a))) snapshots(message.data);
  if (message.a === 'q' && Array.isArray(message.diff))
    message.diff.forEach((diff) => snapshots((diff as { values?: unknown }).values));
  if (['bf', 'bs'].includes(String(message.a)) && message.data && typeof message.data === 'object')
    Object.keys(message.data).forEach((id) => ids.add(id));
  return [...ids];
}

@Injectable()
export class TableDataAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly router: DatabaseRouter
  ) {}

  async restrictedTables(baseId?: string) {
    const rows = await this.prisma.tableAuthorityPolicy.findMany({});
    const restrictions = rows.flatMap((row) => {
      const parsed = tableAuthorityPolicySchema.safeParse(row.policy);
      if (!parsed.success) throw new ForbiddenException('Invalid stored data access policy');
      return parsed.data.enabled
        ? (parsed.data.restrictions || []).map((restriction) => ({
            baseId: row.baseId,
            connectionId: row.connectionId,
            restriction,
          }))
        : [];
    });
    if (!restrictions.length) return [];
    // Follow incoming references to a fixed point, including cross-base and conditional lookups.
    // A -> B -> restricted C must protect A as well as B, including base-wide copy/export APIs.
    const references = await this.prisma.field.findMany({
      where: {
        deletedTime: null,
        table: { deletedTime: null },
        OR: [{ type: 'link' }, { isLookup: true }, { isConditionalLookup: true }],
      },
      select: {
        id: true,
        tableId: true,
        options: true,
        lookupOptions: true,
        table: { select: { baseId: true } },
      },
    });
    const byTable = new Map(restrictions.map((item) => [item.restriction.tableId, item]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const field of references) {
        const targets = [field.options, field.lookupOptions].flatMap((json) => {
          try {
            const target = JSON.parse(json || '{}').foreignTableId;
            return typeof target === 'string' ? [target] : [];
          } catch {
            return [];
          }
        });
        if (!targets.some((target) => byTable.has(target))) continue;
        let item = byTable.get(field.tableId);
        if (!item) {
          item = {
            baseId: field.table.baseId,
            connectionId: '',
            restriction: {
              tableId: field.tableId,
              hiddenFieldIds: [],
              readOnlyFieldIds: [],
              rowScope: 'all',
            },
          };
          byTable.set(field.tableId, item);
          changed = true;
        }
        if (!item.restriction.hiddenFieldIds.includes(field.id))
          item.restriction = {
            ...item.restriction,
            hiddenFieldIds: [...item.restriction.hiddenFieldIds, field.id],
          };
      }
    }
    return [...byTable.values()].filter((item) => !baseId || item.baseId === baseId);
  }

  async isAdministrator(userId?: string) {
    if (!userId) return false;
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isAdmin: true,
        deletedTime: null,
        deactivatedTime: null,
        permanentDeletedTime: null,
      },
      select: { id: true },
    });
    return Boolean(user);
  }

  async scope(tableId: string, userId = this.cls.get('user.id')): Promise<IDataScope | undefined> {
    if (await this.isAdministrator(userId)) return;
    const table = await this.prisma.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { id: true, baseId: true, dbTableName: true },
    });
    if (!table) return;
    const restrictions = await this.restrictedTables();
    if (!restrictions.length) return;
    const own = restrictions.find((item) => item.restriction.tableId === tableId);
    const fields = await this.prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: {
        id: true,
        name: true,
        dbFieldName: true,
        type: true,
        isComputed: true,
        isLookup: true,
        isPrimary: true,
        options: true,
      },
    });
    const protectedIds = new Set(restrictions.map((item) => item.restriction.tableId));
    const linked = fields.filter((field) => {
      if (field.type !== 'link') return false;
      try {
        return protectedIds.has(JSON.parse(field.options || '{}').foreignTableId);
      } catch {
        return true;
      }
    });
    if (!own && !linked.length) return;
    const restriction: ITableDataRestriction = own?.restriction || {
      tableId,
      hiddenFieldIds: [],
      readOnlyFieldIds: [],
      rowScope: 'all',
    };
    const hidden = new Set([...restriction.hiddenFieldIds, ...linked.map((field) => field.id)]);
    // Computed / linked values may carry protected cells from other records. Until dependency-level
    // redaction is available, omit them rather than returning a derived copy of a hidden value.
    if (hidden.size || restriction.rowScope !== 'all') {
      fields
        .filter(
          (field) =>
            (field.isComputed || field.isLookup || field.type === 'link') &&
            field.type !== 'createdBy' &&
            field.type !== 'lastModifiedBy'
        )
        .forEach((field) => hidden.add(field.id));
    }
    const creatorFieldId = fields.find((field) => field.type === 'createdBy')?.id;
    if (restriction.rowScope !== 'all' && !creatorFieldId)
      throw new ForbiddenException('Data policy requires a Created By field');
    const creatorIds = await this.creators(restriction.rowScope, own?.connectionId || '', userId);
    return {
      tableId,
      baseId: table.baseId,
      dbTableName: table.dbTableName,
      connectionId: own?.connectionId || '',
      restriction,
      fields,
      hidden,
      readOnly: new Set([...hidden, ...restriction.readOnlyFieldIds]),
      creatorFieldId,
      creatorIds,
    };
  }

  private creators(mode: ITableDataRestriction['rowScope'], connectionId: string, userId?: string) {
    if (mode === 'all') return undefined;
    if (mode === 'own') return userId ? [userId] : [];
    return this.departmentUsers(connectionId, userId);
  }

  private async departmentUsers(connectionId: string, userId?: string) {
    if (!userId) return [];
    const self = await this.prisma.directoryMember.findFirst({
      where: {
        connectionId,
        userId,
        inactiveTime: null,
        connection: { enabled: true },
      },
      select: {
        memberships: {
          where: { department: { inactiveTime: null } },
          select: { departmentId: true },
        },
      },
    });
    if (!self) return [];
    const members = await this.prisma.directoryMember.findMany({
      where: {
        connectionId,
        inactiveTime: null,
        userId: { not: null },
        user: {
          deletedTime: null,
          deactivatedTime: null,
          permanentDeletedTime: null,
          OR: [{ isSystem: false }, { isSystem: null }],
        },
        memberships: {
          some: {
            departmentId: {
              in: self.memberships.map((item) => item.departmentId),
            },
          },
        },
      },
      select: { userId: true },
    });
    return [...new Set(members.flatMap((member) => (member.userId ? [member.userId] : [])))];
  }

  async assertRecords(scope: IDataScope, ids: string[]) {
    if (scope.creatorIds === undefined || !ids.length) return;
    if (!scope.creatorIds.length) throw new ForbiddenException('Record is outside your data scope');
    const knex = await this.router.dataKnexForTable(scope.tableId);
    const query = knex(scope.dbTableName)
      .select('__id')
      .whereIn('__id', [...new Set(ids)])
      .whereIn('__created_by', scope.creatorIds);
    const sql = query.toSQL().toNative();
    const rows = await this.router.queryDataPrismaForTable<{ __id: string }[]>(
      scope.tableId,
      sql.sql,
      ...sql.bindings
    );
    if (rows.length !== new Set(ids).size)
      throw new ForbiddenException('Record is outside your data scope');
  }

  assertWritableFields(scope: IDataScope, fields: Record<string, unknown>) {
    for (const key of Object.keys(fields)) {
      const field = scope.fields.find(
        (field) => field.id === key || field.name === key || field.dbFieldName === key
      );
      if (!field || scope.readOnly.has(field.id))
        throw new ForbiddenException('Field is read-only or unavailable');
      // Link side effects require independent target row checks; fail closed in this version.
      if (field.type === 'link')
        throw new ForbiddenException('Link writes are unavailable under a data restriction');
    }
  }

  constrainQuery(scope: IDataScope, query: Record<string, unknown>) {
    if (query.filterByTql || query.filterLinkCellCandidate || query.filterLinkCellSelected)
      throw new ForbiddenException('This query mode is unavailable under a data restriction');
    const parsed = restrictedQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid restricted query');
    const { filter, search, orderBy, groupBy } = parsed.data;
    const visible = scope.fields
      .filter((field) => !scope.hidden.has(field.id))
      .map((field) => field.id);
    const assertVisible = (id: string) => {
      if (!visible.includes(id))
        throw new ForbiddenException('Query references an unavailable field');
    };
    if (filter) assertFilterFields(scope, filter, assertVisible);
    for (const item of [...(orderBy || []), ...(groupBy || [])]) assertVisible(item.fieldId);
    if (orderBy !== undefined) query.orderBy = orderBy;
    if (groupBy !== undefined) query.groupBy = groupBy;

    constrainSearchProjection(query, search, visible, assertVisible);
    // View-owned filters/sorts can also infer hidden cells. Use the explicit request filter only.
    query.ignoreViewQuery = true;
    // Cached query state is not an authorization boundary; only use parameters checked here.
    delete query.queryId;
    if (filter !== undefined) query.filter = JSON.stringify(filter);
    if (scope.creatorIds !== undefined) {
      const own = {
        conjunction: 'or',
        filterSet: (scope.creatorIds.length ? scope.creatorIds : ['usrNoAuthorizedCreator']).map(
          (id) => ({
            fieldId: scope.creatorFieldId,
            operator: 'is',
            value: id,
          })
        ),
      };
      query.filter = JSON.stringify(
        filter ? { conjunction: 'and', filterSet: [filter, own] } : own
      );
    }
  }

  async sanitizeDocument(
    userId: string | undefined,
    type: string,
    parentId: string,
    message: Record<string, unknown>
  ) {
    if (type === 'tbl') {
      if (
        (message.op || message.create) &&
        !(await this.isAdministrator(userId)) &&
        (await this.restrictedTables(parentId)).length
      ) {
        throw new ForbiddenException('Refresh table metadata after data policy changes');
      }
      return;
    }
    const scope = await this.scope(parentId, userId);
    if (!scope) return;
    if (type === 'rec' || type === 'fld') {
      // Initial query replies, inserted query snapshots and bulk fetches have no top-level d.
      const ids = documentIds(message);
      if (type === 'rec') await this.assertRecords(scope, ids);
      else if (ids.some((id) => scope.hidden.has(id)))
        throw new ForbiddenException('Field is unavailable');
    }
    if (Array.isArray(message.op)) {
      // Never edit the pub/sub op shared by other agents. Keep the version progression with an empty op.
      message.op = message.op
        .filter((component) => {
          const path = (component as { p?: unknown[] }).p;
          return (
            path &&
            !path.some((segment) => typeof segment === 'string' && scope.hidden.has(segment))
          );
        })
        .map((component) => {
          const op = component as { p: unknown[]; oi?: unknown; od?: unknown };
          if (op.p.at(-1) !== 'fields') return component;
          return {
            ...op,
            ...('oi' in op ? { oi: redactRestrictedFields(op.oi, scope, true) } : {}),
            ...('od' in op ? { od: redactRestrictedFields(op.od, scope, true) } : {}),
          };
        });
      // Metadata ops can include entire nested field/view definitions: require a fresh HTTP snapshot.
      if (type !== 'rec')
        throw new ForbiddenException('Refresh metadata after data policy changes');
    }
    const safe = redactRestrictedFields(message, scope) as Record<string, unknown>;
    Object.assign(message, safe);
  }
}
