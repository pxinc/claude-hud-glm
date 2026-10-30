import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLabel, normalize, formatLabel, INTERVAL_MS } from './glm-hud.mjs';

const root = await mkdtemp(join(tmpdir(), 'glm-hud-check-'));
const clock = Date.now();
const payload = { success: true, data: { limits: [
  { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 1 },
  { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 30, nextResetTime: clock + 172800000 },
  { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0, nextResetTime: clock + 3600000 },
] } };
const response = () => new Response(JSON.stringify(payload));
const env = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'fixture-key-A' };
let time = clock;
let calls = 0;
const options = { env, now: () => time, fetchImpl: async (url, opts) => {
  calls++;
  assert.equal(url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(opts.headers.Authorization, 'fixture-key-A');
  assert.equal(opts.redirect, 'error');
  return response();
} };
try {
  const quota = normalize(payload);
  assert.equal(quota.fiveHour.percent, 0);
  assert.equal(quota.weekly.percent, 30);
  assert.equal(normalize({ limits: [payload.data.limits[2]] }).weekly, null);
  assert.throws(() => normalize({ data: { limits: [payload.data.limits[0]] } }));
  assert.throws(() => normalize({ success: false, data: payload.data }));
  assert.match(await getLabel(options), /5h0%/);
  await getLabel(options);
  time += INTERVAL_MS - 1;
  await getLabel(options);
  assert.equal(calls, 1, 'fresh cache suppresses event-triggered requests');
  time++;
  await getLabel(options);
  assert.equal(calls, 2, 'cache refreshes at 300 seconds');

  const dir = join(root, 'glm-usage', 'cache');
  const file = join(dir, (await readdir(dir)).find(x => x.endsWith('.json')));
  assert.ok(!(await readFile(file, 'utf8')).includes('fixture-key'));
  time += INTERVAL_MS;
  const timeout = { ...options, fetchImpl: async () => { throw new DOMException('private message', 'TimeoutError'); } };
  const stale = await getLabel(timeout);
  assert.match(stale, /5h0%/);
  assert.match(stale, /超时/);
  assert.ok(!stale.includes('private message'));
  const before = calls;
  await getLabel(options);
  assert.equal(calls, before, 'failure retries are throttled');

  time += INTERVAL_MS;
  let limitedCalls = 0;
  const limited = { ...options, fetchImpl: async () => {
    limitedCalls++;
    return new Response('{}', { status: 429, headers: { 'retry-after': '900' } });
  } };
  assert.match(await getLabel(limited), /限流/);
  time += 899000;
  await getLabel(limited);
  assert.equal(limitedCalls, 1);
  time += 1000;
  assert.match(await getLabel(options), /5h0%/);

  time += INTERVAL_MS;
  await writeFile(`${file}.lock`, '{}');
  const old = new Date(Date.now() - 20000);
  await utimes(`${file}.lock`, old, old);
  await getLabel(options);
  assert.ok(!(await readdir(dir)).some(x => x.endsWith('.lock')), 'stale lock recovered');

  let otherCalls = 0;
  const other = { ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-key-B' }, fetchImpl: async () => {
    otherCalls++;
    await new Promise(resolve => setTimeout(resolve, 40));
    return response();
  } };
  await Promise.all(Array.from({ length: 8 }, () => getLabel(other)));
  assert.equal(otherCalls, 1, 'concurrent windows share a single request');
  assert.equal((await readdir(dir)).filter(x => x.endsWith('.json')).length, 2, 'account caches are isolated');

  let sent = false;
  assert.equal(await getLabel({ ...options, env: { ...env, ANTHROPIC_BASE_URL: 'https://example.com' }, fetchImpl: async () => { sent = true; } }), '');
  assert.equal(sent, false, 'no credentials sent to unsupported providers');
  assert.match(await getLabel({ ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: '' } }), /未配置密钥/);
  await writeFile(join(root, 'settings.json'), JSON.stringify({ env }));
  assert.match(await getLabel({ ...options, env: { CLAUDE_CONFIG_DIR: root } }), /GLM已用/);
  await writeFile(file, 'broken json');
  assert.match(await getLabel(options), /GLM已用/, 'corrupt cache recovers');
  const authError = await getLabel({ ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-key-C' }, fetchImpl: async () => new Response('{}', { status: 401 }) });
  assert.match(authError, /鉴权失败/);
  assert.ok(!authError.includes('0%'), 'unknown usage is not rendered as zero');
  const started = performance.now();
  const timedOut = await getLabel({ ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-key-D' }, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.match(timedOut, /超时/);
  assert.ok(performance.now() - started < 2900, 'timeout fits the HUD 3-second budget');
  for (const label of [stale, formatLabel(null, clock), formatLabel({ quota, fetchedAt: clock }, clock)]) assert.ok(label.length <= 50);
  console.log('PASS: schema, 300s cache, stale data, backoff, Retry-After, stale locks, concurrency, account isolation, credentials, corrupt cache, authentication, real 2s timeout, HUD label length');
} finally {
  await rm(root, { recursive: true, force: true });
}
