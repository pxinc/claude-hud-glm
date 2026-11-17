import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSnapshot, getResetCards, normalizeResetCards, INTERVAL_MS } from './glm-hud.mjs';

const root = await mkdtemp(join(tmpdir(), 'glm-cards-'));
let now = Date.parse('2026-11-17T00:00:00Z');
const token = 'fixture-card-key';
const env = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: token };
const cards = { success: true, data: {
  fiveHourResets: [
    { available: true, expireTime: '2026-11-25 18:00:00', recordId: 'fixture-card-id' },
    { available: false, expireTime: '2026-11-20 18:00:00' },
    { available: true, expireTime: null },
    { available: true, expireTime: '0' },
  ],
  weekResets: [{ available: true, expireTime: '2027-01-02T12:30:00Z' }],
} };
const quota = { success: true, data: { limits: [
  { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 31 },
] } };
let quotaCalls = 0, cardCalls = 0;
const fetchImpl = async (url, options) => {
  assert.equal(options.headers.Authorization, token);
  assert.equal(options.redirect, 'error');
  await new Promise(resolve => setTimeout(resolve, 50));
  if (url.endsWith('/api/monitor/usage/quota/limit')) { quotaCalls++; return Response.json(quota); }
  assert.equal(url, 'https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=PERSONAL');
  cardCalls++;
  return Response.json(cards);
};
const options = { env, now: () => now, fetchImpl };
try {
  assert.deepEqual(normalizeResetCards(cards), {
    fiveHour: [Date.parse('2026-11-25T10:00:00Z'), null, null],
    weekly: [Date.parse('2027-01-02T12:30:00Z')],
  });
  assert.deepEqual(normalizeResetCards({ data: { fiveHourResets: [] } }), { fiveHour: [], weekly: null });
  assert.deepEqual(normalizeResetCards({ data: { fiveHourResets: [{ available: true, expireTime: 1e20 }] } }), { fiveHour: [null], weekly: null });
  assert.throws(() => normalizeResetCards({ success: false, data: cards.data }));
  assert.throws(() => normalizeResetCards({ data: {} }));

  const snapshots = await Promise.all(Array.from({ length: 8 }, async () => Promise.all([
    getSnapshot(options), getResetCards(options),
  ])));
  assert.ok(snapshots.every(([q, c]) => q.quota.fiveHour.percent === 31 && c.cards.fiveHour.length === 3));
  assert.deepEqual([quotaCalls, cardCalls], [1, 1], 'each endpoint has one shared first request');
  now += INTERVAL_MS - 1;
  await Promise.all([getSnapshot(options), getResetCards(options)]);
  assert.deepEqual([quotaCalls, cardCalls], [1, 1], 'each endpoint observes the five-minute cooldown');
  now++;
  await Promise.all([getSnapshot(options), getResetCards(options)]);
  assert.deepEqual([quotaCalls, cardCalls], [2, 2], 'each endpoint refreshes once after its cooldown');

  let phaseQuota = 0, phaseCards = 0;
  const phaseStart = now;
  const phased = { ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-phase-key' }, fetchImpl: async url => {
    if (url.endsWith('/api/monitor/usage/quota/limit')) { phaseQuota++; return Response.json(quota); }
    phaseCards++; return Response.json(cards);
  } };
  await getSnapshot(phased);
  now = phaseStart + 100_000;
  await getResetCards(phased);
  now = phaseStart + 300_000;
  await Promise.all([getSnapshot(phased), getResetCards(phased)]);
  assert.deepEqual([phaseQuota, phaseCards], [2, 1], 'quota can refresh while cards remain in their own cooldown');
  now = phaseStart + 400_000;
  await Promise.all([getSnapshot(phased), getResetCards(phased)]);
  assert.deepEqual([phaseQuota, phaseCards], [2, 2], 'cards refresh independently of quota');

  const separate = { ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-isolated-error' }, fetchImpl: async url =>
    url.endsWith('/api/monitor/usage/quota/limit') ? new Response('{}', { status: 503 }) : Response.json(cards) };
  const [failedQuota, usableCards] = await Promise.all([getSnapshot(separate), getResetCards(separate)]);
  assert.equal(failedQuota.error, 'HTTP503');
  assert.equal(usableCards.cards.weekly.length, 1, 'quota errors do not suppress card results');

  const cacheDir = join(root, 'glm-usage/cache');
  const cardPath = join(cacheDir, (await readdir(cacheDir)).find(name => name.endsWith('.cards.json')));
  const saved = await readFile(cardPath, 'utf8');
  assert.ok(!saved.includes(token) && !saved.includes('fixture-card-id'), 'card cache excludes credentials and identifiers');

  const other = { ...options, env: { ...env, ANTHROPIC_AUTH_TOKEN: 'fixture-card-failure' } };
  let attempts = 0;
  const limited = { ...other, fetchImpl: async () => { attempts++; return new Response('{}', { status: 429, headers: { 'retry-after': '900' } }); } };
  assert.equal((await getResetCards(limited)).error, 'rateLimited');
  now += 899_999;
  await getResetCards(limited);
  assert.equal(attempts, 1, 'card failures respect Retry-After');
  now++;
  await getResetCards(limited);
  assert.equal(attempts, 2);

  let sent = false;
  const unsupported = { ...options, env: { ...env, ANTHROPIC_BASE_URL: 'https://example.invalid' }, fetchImpl: async () => { sent = true; } };
  assert.equal((await getResetCards(unsupported)).label, '');
  assert.equal(sent, false, 'credentials are not sent to unsupported providers');
  console.log('PASS: reset card schema, expiry timezone, independent endpoint cooldowns, sharing, retry limits, credential isolation');
} finally { await rm(root, { recursive: true, force: true }); }
