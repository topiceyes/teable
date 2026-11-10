import { Body, Controller, Get, Header, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { dingtalkCallbackRoSchema, dingtalkStartRoSchema } from '@teable/openapi';
import type { IDingtalkStartRo } from '@teable/openapi';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Public } from '../decorators/public.decorator';
import { CookieSessionGuard } from '../mobile-auth/cookie-session.guard';
import { SessionService } from '../session/session.service';
import { DINGTALK_LOGIN_COOKIE, DingtalkLoginService } from './dingtalk-login.service';

@Controller('api/auth/dingtalk')
export class DingtalkLoginController {
  constructor(
    private readonly service: DingtalkLoginService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Public()
  @Get('providers')
  @Header('Cache-Control', 'no-store')
  providers() {
    return this.service.providers();
  }

  @Public()
  @Get('start')
  @Header('Cache-Control', 'no-store')
  async start(
    @Query(new ZodValidationPipe(dingtalkStartRoSchema)) ro: IDingtalkStartRo,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const result = await this.service.start(req, ro.corpId, ro.redirect);
    this.setBrowserProof(res, result);
    return res.redirect(result.url);
  }

  @Post('bind')
  @UseGuards(CookieSessionGuard)
  @Header('Cache-Control', 'no-store')
  async bind(
    @Body(new ZodValidationPipe(dingtalkStartRoSchema)) ro: IDingtalkStartRo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.service.start(req, ro.corpId, ro.redirect, this.cls.get('user.id'));
    this.setBrowserProof(res, result);
    return { url: result.url };
  }

  private setBrowserProof(res: Response, result: { nonce: string; secure: boolean }) {
    res.cookie(DINGTALK_LOGIN_COOKIE, result.nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: result.secure,
      path: '/api/auth/dingtalk',
      maxAge: 600000,
    });
  }

  @Public()
  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async callback(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    try {
      const ro = dingtalkCallbackRoSchema.parse(query);
      const result = await this.service.callback(req, ro.state, ro.authCode);
      res.clearCookie(DINGTALK_LOGIN_COOKIE, { path: '/api/auth/dingtalk' });
      await new Promise<void>((resolve, reject) =>
        req.login(result.user, (error) => (error ? reject(error) : resolve()))
      );
      await this.sessions.recordSignin(req, 'dingtalk');
      await new Promise<void>((resolve, reject) =>
        req.session.save((error) => (error ? reject(error) : resolve()))
      );
      return res.redirect(result.redirect);
    } catch (error) {
      // Fixed, translatable errors only; query codes and upstream messages never enter HTML.
      const message = error instanceof Error ? error.message : '';
      const reason = [
        'DINGTALK_BIND_REQUIRED',
        'DINGTALK_BINDING_CONFLICT',
        'DINGTALK_EMPLOYEE_UNAVAILABLE',
        'DINGTALK_ACCOUNT_UNAVAILABLE',
        'DINGTALK_STATE_INVALID',
        'DINGTALK_LOGIN_UNAVAILABLE',
      ].includes(message)
        ? message
        : 'DINGTALK_LOGIN_FAILED';
      return res.redirect('/auth/login?authError=' + reason);
    }
  }
}
