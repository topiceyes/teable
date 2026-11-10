import { Module } from '@nestjs/common';
import { DingtalkDirectoryClient } from './directory/dingtalk-directory.client';
import { DingtalkDirectoryConfig } from './directory/dingtalk-directory.config';
import { DirectoryConnectionController } from './directory/directory-connection.controller';
import { DirectoryConnectionService } from './directory/directory-connection.service';
import { DirectoryMemberController } from './directory/directory-member.controller';
import { DirectoryMemberService } from './directory/directory-member.service';
import { DirectoryRoleController } from './directory/directory-role.controller';
import { DirectoryRoleService } from './directory/directory-role.service';
import { DirectorySyncController } from './directory/directory-sync.controller';
import { DirectorySyncService } from './directory/directory-sync.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [
    OrganizationController,
    DirectoryConnectionController,
    DirectorySyncController,
    DirectoryMemberController,
    DirectoryRoleController,
  ],
  exports: [DirectoryRoleService, DirectoryConnectionService],
  providers: [
    DingtalkDirectoryConfig,
    DirectoryConnectionService,
    DingtalkDirectoryClient,
    DirectorySyncService,
    DirectoryMemberService,
    OrganizationService,
    DirectoryRoleService,
  ],
})
export class OrganizationModule {}
