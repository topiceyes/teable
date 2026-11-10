import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingtalkDirectoryConfig } from './dingtalk-directory.config';
afterEach(() => vi.unstubAllEnvs());
describe('directory connection config', () => {
  it('defaults to disabled', () => {
    vi.stubEnv('BACKEND_DINGTALK_DIRECTORY_CONNECTIONS', '');
    expect(new DingtalkDirectoryConfig().list()).toEqual([]);
  });
  it('sanitizes malformed input', () => {
    vi.stubEnv('BACKEND_DINGTALK_DIRECTORY_CONNECTIONS', '{secret:private}');
    expect(() => new DingtalkDirectoryConfig().list()).toThrow(
      /^Invalid DingTalk directory configuration$/
    );
  });
  it('rejects duplicate enterprises', () => {
    const config = { corpId: 'corp', name: 'Company', appKey: 'key', appSecret: 'secret' };
    vi.stubEnv('BACKEND_DINGTALK_DIRECTORY_CONNECTIONS', JSON.stringify([config, config]));
    expect(() => new DingtalkDirectoryConfig().list()).toThrow(
      'Invalid DingTalk directory configuration'
    );
  });
});
