import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization.module';
import { DirectoryRoleChecksController } from './directory-role-checks.controller';
import { DirectoryRoleChecksService } from './directory-role-checks.service';
import { MemberAuthorityService } from './member-authority.service';
import { TableAuthorityPreviewService } from './table-authority-preview.service';
import { TableAuthorityController } from './table-authority.controller';
import { TableAuthorityService } from './table-authority.service';
import { TableDataAccessService } from './table-data-access.service';

@Module({
  imports: [OrganizationModule],
  controllers: [TableAuthorityController, DirectoryRoleChecksController],
  providers: [
    TableAuthorityService,
    TableAuthorityPreviewService,
    TableDataAccessService,
    MemberAuthorityService,
    DirectoryRoleChecksService,
  ],
  exports: [TableAuthorityService, TableDataAccessService],
})
export class TableAuthorityModule {}
