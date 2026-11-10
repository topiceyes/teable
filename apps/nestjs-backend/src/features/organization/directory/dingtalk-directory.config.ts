import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

const connectionSchema = z
  .object({
    corpId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    appKey: z.string().trim().min(1),
    appSecret: z.string().trim().min(1),
  })
  .strict();
export type IDingtalkDirectoryConfig = z.infer<typeof connectionSchema>;

@Injectable()
export class DingtalkDirectoryConfig {
  list(): IDingtalkDirectoryConfig[] {
    try {
      const configs = z
        .array(connectionSchema)
        .parse(JSON.parse(process.env.BACKEND_DINGTALK_DIRECTORY_CONNECTIONS || '[]'));
      if (new Set(configs.map((config) => config.corpId)).size !== configs.length) {
        throw new Error('Duplicate enterprise');
      }
      return configs;
    } catch {
      // Never include validation input or parser errors containing credentials.
      throw new ServiceUnavailableException('Invalid DingTalk directory configuration');
    }
  }

  get(corpId: string) {
    const config = this.list().find((item) => item.corpId === corpId);
    if (!config) throw new NotFoundException('DingTalk directory connection not configured');
    return config;
  }
}
