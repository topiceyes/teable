import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  directoryConnectionRoSchema,
  type IDirectoryConnectionRo,
  directoryRoleRosterRoSchema,
  directorySetRolePeopleRoSchema,
  directoryRoleHistoryRoSchema,
  type IDirectoryRoleRosterRo,
  type IDirectorySetRolePeopleRo,
  type IDirectoryRoleHistoryRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectoryRoleHistoryService } from './directory-role-history.service';
import { DirectoryRoleToolsService } from './directory-role-tools.service';
@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectoryRoleToolsController {
  constructor(
    private readonly tools: DirectoryRoleToolsService,
    private readonly history: DirectoryRoleHistoryService
  ) {}
  @Get('roleCounts')
  counts(@Query(new ZodValidationPipe(directoryConnectionRoSchema)) ro: IDirectoryConnectionRo) {
    return this.tools.counts(ro.corpId);
  }
  @Get('roleRoster')
  roster(@Query(new ZodValidationPipe(directoryRoleRosterRoSchema)) ro: IDirectoryRoleRosterRo) {
    return this.tools.roster(ro);
  }
  @Post('setRolePeople')
  @HttpCode(200)
  setPeople(
    @Body(new ZodValidationPipe(directorySetRolePeopleRoSchema)) ro: IDirectorySetRolePeopleRo
  ) {
    return this.tools.setPeople(ro);
  }
  @Get('roleHistory')
  historyList(
    @Query(new ZodValidationPipe(directoryRoleHistoryRoSchema)) ro: IDirectoryRoleHistoryRo
  ) {
    return this.history.list(ro);
  }
}
