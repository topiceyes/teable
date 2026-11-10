/* eslint-disable @typescript-eslint/naming-convention -- Prisma compound unique selector. */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { DirectoryConnection } from '@teable/db-main-prisma';
import type { IDirectoryConnectionVo, IDirectorySaveConnectionRo } from '@teable/openapi';
import { ThirdPartyCredentialCodec } from '../../../utils/third-party-credential-encryption';
import { AuditScope } from '../../audit/audit-scope';
import { DingtalkDirectoryClient, DingtalkDirectoryError } from './dingtalk-directory.client';
import { DingtalkDirectoryConfig } from './dingtalk-directory.config';
import type { IDingtalkDirectoryConfig } from './dingtalk-directory.config';

export type IResolvedDirectoryConfig = IDingtalkDirectoryConfig & { configurationVersion: number };

@Injectable()
export class DirectoryConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: DingtalkDirectoryConfig,
    private readonly client: DingtalkDirectoryClient,
    private readonly audit: AuditScope
  ) {}

  private view(row: DirectoryConnection): IDirectoryConnectionVo {
    return {
      corpId: row.tenantId,
      name: row.name,
      provider: 'dingtalk',
      source: 'database',
      appKey: row.appKey!,
      hasSecret: Boolean(row.appSecret),
      version: row.configurationVersion,
      loginEnabled: row.loginEnabled,
      autoProvision: row.autoProvision,
    };
  }

  async list(): Promise<IDirectoryConnectionVo[]> {
    const environment = this.environment.list();
    const rows = await this.prisma.directoryConnection.findMany({
      where: { provider: 'dingtalk', appKey: { not: null }, appSecret: { not: null } },
      orderBy: { createdTime: 'asc' },
    });
    const environmentIds = new Set(environment.map(({ corpId }) => corpId));
    return [
      ...environment.map(({ corpId, name, appKey }) => ({
        corpId,
        name,
        appKey,
        provider: 'dingtalk' as const,
        source: 'environment' as const,
        hasSecret: true,
        version: 0,
      })),
      ...rows.filter((row) => !environmentIds.has(row.tenantId)).map((row) => this.view(row)),
    ];
  }

  private decrypt(value: string) {
    try {
      return new ThirdPartyCredentialCodec().decryptValueStrict(value);
    } catch {
      throw new ServiceUnavailableException('DIRECTORY_CREDENTIAL_DECRYPTION_FAILED');
    }
  }

  async get(corpId: string): Promise<IResolvedDirectoryConfig> {
    const environment = this.environment.list().find((item) => item.corpId === corpId);
    if (environment) return { ...environment, configurationVersion: 0 };
    const row = await this.prisma.directoryConnection.findUnique({
      where: { provider_tenantId: { provider: 'dingtalk', tenantId: corpId } },
    });
    if (!row?.appKey || !row.appSecret)
      throw new NotFoundException('Directory connection not configured');
    return {
      corpId,
      name: row.name,
      appKey: row.appKey,
      appSecret: this.decrypt(row.appSecret),
      configurationVersion: row.configurationVersion,
    };
  }

  private assertEditable(corpId: string) {
    if (this.environment.list().some((item) => item.corpId === corpId)) {
      throw new ConflictException('DIRECTORY_CONNECTION_ENVIRONMENT_MANAGED');
    }
  }

  private assertVersion(row: DirectoryConnection | null, ro: IDirectorySaveConnectionRo) {
    if ((row?.configurationVersion ?? 0) !== ro.expectedVersion) {
      throw new ConflictException('DIRECTORY_CONNECTION_CHANGED');
    }
    if (!ro.appSecret && !row?.appSecret) {
      throw new BadRequestException('DIRECTORY_APP_SECRET_REQUIRED');
    }
    // A secret belongs to the appKey: changing the app requires a new secret.
    if (row?.appKey && row.appKey !== ro.appKey && !ro.appSecret) {
      throw new BadRequestException('DIRECTORY_APP_SECRET_REQUIRED');
    }
  }

  async save(ro: IDirectorySaveConnectionRo) {
    this.assertEditable(ro.corpId);
    const codec = new ThirdPartyCredentialCodec();
    if (codec.usesPublicDefaultRoot) {
      throw new ServiceUnavailableException('DIRECTORY_ENCRYPTION_NOT_CONFIGURED');
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.directoryConnection.findUnique({
          where: { provider_tenantId: { provider: 'dingtalk', tenantId: ro.corpId } },
        });
        // Share the sync lock: credentials cannot change while reconciliation commits.
        const lockId = existing?.id ?? `dingtalk:${ro.corpId}`;
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${lockId}, 0)) AS acquired
        `;
        if (!lock?.acquired) throw new ConflictException('DIRECTORY_CONNECTION_BUSY');
        this.assertVersion(existing, ro);
        const data = {
          name: ro.name,
          appKey: ro.appKey,
          ...(ro.appSecret ? { appSecret: codec.encryptValue(ro.appSecret) } : {}),
          configurationVersion: ro.expectedVersion + 1,
          ...(ro.loginEnabled !== undefined ? { loginEnabled: ro.loginEnabled } : {}),
          ...(ro.autoProvision !== undefined ? { autoProvision: ro.autoProvision } : {}),
        };
        if (!existing)
          return tx.directoryConnection.create({
            data: { provider: 'dingtalk', tenantId: ro.corpId, ...data },
          });
        const updated = await tx.directoryConnection.updateMany({
          where: { id: existing.id, configurationVersion: ro.expectedVersion },
          data,
        });
        if (updated.count !== 1) throw new ConflictException('DIRECTORY_CONNECTION_CHANGED');
        return tx.directoryConnection.findUniqueOrThrow({ where: { id: existing.id } });
      });
      await this.audit.emitAtomic({
        action: 'organization.directory.connection.save',
        resourceId: row.id,
        params: {
          corpId: ro.corpId,
          version: row.configurationVersion,
          secretReplaced: Boolean(ro.appSecret),
        },
      });
      return this.view(row);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('DIRECTORY_CONNECTION_CHANGED');
      }
      throw error;
    }
  }

  async test(ro: IDirectorySaveConnectionRo) {
    // Testing is read-only: no saved configuration, directory rows or sync runs change.
    this.assertEditable(ro.corpId);
    const row = await this.prisma.directoryConnection.findUnique({
      where: { provider_tenantId: { provider: 'dingtalk', tenantId: ro.corpId } },
    });
    this.assertVersion(row, ro);
    const config = { ...ro, appSecret: ro.appSecret ?? this.decrypt(row!.appSecret!) };
    try {
      return await this.client.testConnection(config);
    } catch (error) {
      throw new BadGatewayException(
        error instanceof DingtalkDirectoryError ? error.code : 'DINGTALK_CONNECTION_FAILED'
      );
    }
  }
}
