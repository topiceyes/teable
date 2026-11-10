import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { directorySaveConnectionRoSchema, type IDirectorySaveConnectionRo } from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectoryConnectionService } from './directory-connection.service';

@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectoryConnectionController {
  constructor(private readonly service: DirectoryConnectionService) {}

  @Post('saveConnection')
  @HttpCode(200)
  save(
    @Body(new ZodValidationPipe(directorySaveConnectionRoSchema)) ro: IDirectorySaveConnectionRo
  ) {
    return this.service.save(ro);
  }

  @Post('testConnection')
  @HttpCode(200)
  test(
    @Body(new ZodValidationPipe(directorySaveConnectionRoSchema)) ro: IDirectorySaveConnectionRo
  ) {
    return this.service.test(ro);
  }
}
