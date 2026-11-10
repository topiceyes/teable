import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  tableAuthorityGetRoSchema,
  tableAuthoritySaveRoSchema,
  tableAuthorityPreviewRoSchema,
  type ITableAuthorityPreviewRo,
  type ITableAuthorityGetRo,
  type ITableAuthoritySaveRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TableAuthorityPreviewService } from './table-authority-preview.service';
import { TableAuthorityService } from './table-authority.service';

@Controller('api/authorityMatrix')
@Permissions('instance|update')
export class TableAuthorityController {
  constructor(
    private readonly service: TableAuthorityService,
    private readonly previewService: TableAuthorityPreviewService
  ) {}
  @Get('preview')
  preview(
    @Query(new ZodValidationPipe(tableAuthorityPreviewRoSchema)) ro: ITableAuthorityPreviewRo
  ) {
    return this.previewService.preview(ro);
  }
  @Get('options')
  options(@Query(new ZodValidationPipe(tableAuthorityGetRoSchema)) ro: ITableAuthorityGetRo) {
    return this.service.options(ro.baseId);
  }
  @Get('get')
  get(@Query(new ZodValidationPipe(tableAuthorityGetRoSchema)) ro: ITableAuthorityGetRo) {
    return this.service.get(ro.baseId);
  }
  @Post('save')
  @HttpCode(200)
  save(@Body(new ZodValidationPipe(tableAuthoritySaveRoSchema)) ro: ITableAuthoritySaveRo) {
    return this.service.save(ro);
  }
}
