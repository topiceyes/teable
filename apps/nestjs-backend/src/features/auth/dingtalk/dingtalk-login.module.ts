import { Module } from '@nestjs/common';
import { OrganizationModule } from '../../organization/organization.module';
import { CookieSessionGuard } from '../mobile-auth/cookie-session.guard';
import { SessionModule } from '../session/session.module';
import { DingtalkLoginClient } from './dingtalk-login.client';
import { DingtalkLoginController } from './dingtalk-login.controller';
import { DingtalkLoginService } from './dingtalk-login.service';

@Module({
  imports: [OrganizationModule, SessionModule],
  providers: [DingtalkLoginClient, DingtalkLoginService, CookieSessionGuard],
  controllers: [DingtalkLoginController],
})
export class DingtalkLoginModule {}
