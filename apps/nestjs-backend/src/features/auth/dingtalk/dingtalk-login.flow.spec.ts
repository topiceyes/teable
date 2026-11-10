import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { IUserMeVo } from '@teable/openapi';
import type { Request, Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { CookieSessionGuard } from '../mobile-auth/cookie-session.guard';
import type { SessionService } from '../session/session.service';
import { DingtalkLoginController } from './dingtalk-login.controller';
import type { DingtalkLoginService } from './dingtalk-login.service';

function fixture() {
  const user = { id: 'user' } as IUserMeVo;
  const service = {
    callback: vi.fn().mockResolvedValue({ user, redirect: '/space' }),
    start: vi.fn(),
  };
  const sessions = { recordSignin: vi.fn() };
  const save = vi.fn((done: (error?: Error) => void) => done());
  const req = {
    login: vi.fn((_user: unknown, done: (error?: Error) => void) => done()),
    session: { save },
  } as unknown as Request;
  const res = { clearCookie: vi.fn(), redirect: vi.fn() };
  const controller = new DingtalkLoginController(
    service as unknown as DingtalkLoginService,
    sessions as unknown as SessionService,
    {} as ClsService<IClsStore>
  );
  return { controller, service, sessions, req, res, save, user };
}
describe('DingTalk callback session lifecycle', () => {
  it('uses normal passport login, records the method and saves before redirecting', async () => {
    const f = fixture();
    await f.controller.callback(
      { state: 'a'.repeat(64), authCode: 'code' },
      f.req,
      f.res as unknown as Response
    );
    expect(f.req.login).toHaveBeenCalledWith(f.user, expect.any(Function));
    expect(f.sessions.recordSignin).toHaveBeenCalledWith(f.req, 'dingtalk');
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.res.redirect).toHaveBeenCalledWith('/space');
    expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(
      f.res.redirect.mock.invocationCallOrder[0]
    );
  });
  it('requires a cookie session for the explicit binding endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DingtalkLoginController.prototype.bind)).toContain(
      CookieSessionGuard
    );
  });
  it('never authenticates malformed callbacks or leaks upstream exceptions in redirect URLs', async () => {
    const f = fixture();
    await f.controller.callback(
      { state: ['a'.repeat(64)], authCode: 'code' },
      f.req,
      f.res as unknown as Response
    );
    expect(f.service.callback).not.toHaveBeenCalled();
    expect(f.req.login).not.toHaveBeenCalled();
    f.service.callback.mockRejectedValueOnce(new Error('private-app-secret'));
    await f.controller.callback(
      { state: 'a'.repeat(64), authCode: 'code' },
      f.req,
      f.res as unknown as Response
    );
    expect(f.req.login).not.toHaveBeenCalled();
    expect(f.res.redirect).toHaveBeenLastCalledWith('/auth/login?authError=DINGTALK_LOGIN_FAILED');
  });
});
