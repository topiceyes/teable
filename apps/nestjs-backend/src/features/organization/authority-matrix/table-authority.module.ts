import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization.module';
import { TableAuthorityPreviewService } from './table-authority-preview.service';
import { TableAuthorityController } from './table-authority.controller';
import { TableAuthorityService } from './table-authority.service';
import { TableDataAccessService } from './table-data-access.service';

@Module({
  imports: [OrganizationModule],
  controllers: [TableAuthorityController],
  providers: [TableAuthorityService, TableAuthorityPreviewService, TableDataAccessService],
  exports: [TableAuthorityService, TableDataAccessService],
})
export class TableAuthorityModule {}
