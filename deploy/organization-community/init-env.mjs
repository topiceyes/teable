import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const origin = process.argv[2];
if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) {
  throw new Error('Usage: node init-env.mjs https://teable.example.com (origin only)');
}
const directory = new URL('./', import.meta.url);
const template = await readFile(new URL('.env.example', directory), 'utf8');
const configured = template
  .replace('PUBLIC_ORIGIN=https://teable.example.com', `PUBLIC_ORIGIN=${origin}`)
  .replaceAll('REPLACE_WITH_RANDOM_HEX', () => randomBytes(32).toString('hex'))
  .replaceAll('REPLACE_16_BYTES', () => randomBytes(8).toString('hex'));
await writeFile(new URL('.env.production.local', directory), configured, {
  flag: 'wx',
  mode: 0o600,
});
console.log('Created .env.production.local (0600). Existing files are never overwritten.');
