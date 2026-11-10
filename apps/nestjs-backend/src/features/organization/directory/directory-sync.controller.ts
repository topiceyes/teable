import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  directoryConnectionRoSchema,
  directorySyncRoSchema,
  type IDirectoryConnectionRo,
  type IDirectorySyncRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { DirectorySyncService } from './directory-sync.service';

@Controller('api/admin/organization/dingtalk')
@Permissions('instance|update')
export class DirectorySyncController {
  constructor(private readonly service: DirectorySyncService) {}

  @Get('connections')
  listConnections() {
    return this.service.listConnections();
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodValidationPipe(directoryConnectionRoSchema)) ro: IDirectoryConnectionRo) {
    return this.service.preview(ro.corpId);
  }

  @Post('sync')
  @HttpCode(200)
  sync(@Body(new ZodValidationPipe(directorySyncRoSchema)) ro: IDirectorySyncRo) {
    return this.service.sync(ro.corpId, ro.previewToken);
  }

  @Get('runs')
  runs(@Query(new ZodValidationPipe(directoryConnectionRoSchema)) ro: IDirectoryConnectionRo) {
    return this.service.runs(ro.corpId);
  }
}
