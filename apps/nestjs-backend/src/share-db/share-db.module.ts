import { Module } from '@nestjs/common';
import { SessionHandleModule } from '../features/auth/session/session-handle.module';
import { FieldModule } from '../features/field/field.module';
import { TableAuthorityModule } from '../features/organization/authority-matrix/table-authority.module';
import { TableModule } from '../features/table/table.module';
import { RealtimeMetricsModule } from './metrics/realtime-metrics.module';
import { ReadonlyModule } from './readonly/readonly.module';
import { RepairAttachmentOpModule } from './repair-attachment-op/repair-attachment-op.module';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbService } from './share-db.service';

@Module({
  imports: [
    TableModule,
    TableAuthorityModule,
    FieldModule,
    ReadonlyModule,
    RepairAttachmentOpModule,
    RealtimeMetricsModule,
    SessionHandleModule,
  ],
  providers: [ShareDbService, ShareDbAdapter],
  exports: [ShareDbService, RealtimeMetricsModule],
})
export class ShareDbModule {}
