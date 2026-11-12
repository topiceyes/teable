import { Controller, Get, Query } from '@nestjs/common';
import { directoryChecksRoSchema, type IDirectoryChecksRo } from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectoryRoleChecksService } from './directory-role-checks.service';
@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectoryRoleChecksController {
  constructor(private readonly service: DirectoryRoleChecksService) {}
  @Get('roleChecks')
  check(@Query(new ZodValidationPipe(directoryChecksRoSchema)) ro: IDirectoryChecksRo) {
    return this.service.check(ro);
  }
}
