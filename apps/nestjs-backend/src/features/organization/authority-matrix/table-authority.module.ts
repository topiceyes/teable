import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization.module';
import { MemberAuthorityService } from './member-authority.service';
import { TableAuthorityPreviewService } from './table-authority-preview.service';
import { TableAuthorityController } from './table-authority.controller';
import { TableAuthorityService } from './table-authority.service';
import { TableDataAccessService } from './table-data-access.service';

@Module({
  imports: [OrganizationModule],
  controllers: [TableAuthorityController],
  providers: [
    TableAuthorityService,
    TableAuthorityPreviewService,
    TableDataAccessService,
    MemberAuthorityService,
  ],
  exports: [TableAuthorityService, TableDataAccessService],
})
export class TableAuthorityModule {}
