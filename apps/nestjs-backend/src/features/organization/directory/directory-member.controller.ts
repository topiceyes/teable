import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  directoryAccountSearchRoSchema,
  directoryConnectionRoSchema,
  directoryBindMemberRoSchema,
  directoryMembersRoSchema,
  type IDirectoryAccountSearchRo,
  type IDirectoryConnectionRo,
  type IDirectoryBindMemberRo,
  type IDirectoryMembersRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectoryMemberService } from './directory-member.service';

@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectoryMemberController {
  constructor(private readonly service: DirectoryMemberService) {}
  @Get('listMembers')
  list(@Query(new ZodValidationPipe(directoryMembersRoSchema)) ro: IDirectoryMembersRo) {
    return this.service.list(ro);
  }
  @Get('listDepartments')
  departments(
    @Query(new ZodValidationPipe(directoryConnectionRoSchema)) ro: IDirectoryConnectionRo
  ) {
    return this.service.departments(ro.corpId);
  }
  @Get('searchAccounts')
  accounts(
    @Query(new ZodValidationPipe(directoryAccountSearchRoSchema)) ro: IDirectoryAccountSearchRo
  ) {
    return this.service.accounts(ro);
  }
  @Post('bindMember')
  @HttpCode(200)
  bind(@Body(new ZodValidationPipe(directoryBindMemberRoSchema)) ro: IDirectoryBindMemberRo) {
    return this.service.bind(ro);
  }
}
