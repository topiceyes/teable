import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  directoryConnectionRoSchema,
  directoryRoleMembersRoSchema,
  directorySaveRoleRoSchema,
  type IDirectoryConnectionRo,
  type IDirectoryRoleMembersRo,
  type IDirectorySaveRoleRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectoryRoleService } from './directory-role.service';

@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectoryRoleController {
  constructor(private readonly service: DirectoryRoleService) {}
  @Get('listRoles')
  list(@Query(new ZodValidationPipe(directoryConnectionRoSchema)) ro: IDirectoryConnectionRo) {
    return this.service.list(ro.corpId);
  }
  @Post('saveRole')
  @HttpCode(200)
  save(@Body(new ZodValidationPipe(directorySaveRoleRoSchema)) ro: IDirectorySaveRoleRo) {
    return this.service.save(ro);
  }
  @Get('roleMembers')
  members(@Query(new ZodValidationPipe(directoryRoleMembersRoSchema)) ro: IDirectoryRoleMembersRo) {
    return this.service.members(ro);
  }
}
