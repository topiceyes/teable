import { Global, Module } from '@nestjs/common';
import { TableAuthorityModule } from '../organization/authority-matrix/table-authority.module';
import { PermissionGuard } from './guard/permission.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  imports: [TableAuthorityModule],
  providers: [PermissionService, PermissionGuard],
  exports: [PermissionService, PermissionGuard],
})
export class PermissionModule {}
