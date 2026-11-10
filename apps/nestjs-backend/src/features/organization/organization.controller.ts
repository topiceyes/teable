import { Controller, Get, Query } from '@nestjs/common';
import {
  getDepartmentListRoSchema,
  getDepartmentUserRoSchema,
  organizationQueryRoSchema,
  type IGetDepartmentListRo,
  type IGetDepartmentListVo,
  type IGetDepartmentUserRo,
  type IGetDepartmentUserVo,
  type IOrganizationMeVo,
  type IOrganizationQueryRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { OrganizationService } from './organization.service';

@Controller('api/organization')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}
  @Get('me')
  getOrganizationMe(
    @Query(new ZodValidationPipe(organizationQueryRoSchema)) ro: IOrganizationQueryRo
  ): Promise<IOrganizationMeVo> {
    return this.service.me(ro);
  }
  @Get('department-user')
  getDepartmentUsers(
    @Query(new ZodValidationPipe(getDepartmentUserRoSchema)) ro: IGetDepartmentUserRo
  ): Promise<IGetDepartmentUserVo> {
    return this.service.users(ro);
  }
  @Get('department')
  getDepartmentList(
    @Query(new ZodValidationPipe(getDepartmentListRoSchema)) ro: IGetDepartmentListRo
  ): Promise<IGetDepartmentListVo> {
    return this.service.departments(ro);
  }
}
