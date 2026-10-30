#!/usr/bin/env node
// Standalone claude-hud --extra-cmd adapter. No model calls or dependencies.
import { readFile, writeFile, mkdir, rename, open, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const INTERVAL_MS = 300_000;
const TIMEOUT_MS = 2_000;
const HOSTS = new Set(['open.bigmodel.cn', 'api.z.ai']);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

async function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export function normalize(payload) {
  if (payload?.success === false) throw new Error('接口异常');
  const limits = (payload?.data ?? payload)?.limits;
  if (!Array.isArray(limits)) throw new Error('数据格式变化');
  const find = (unit, number) => {
    const item = limits.find(x => x.type === 'TOKENS_LIMIT'
      && Number(x.unit) === unit && Number(x.number) === number);
    if (!item || typeof item.percentage !== 'number'
      || !Number.isFinite(item.percentage) || item.percentage < 0) return null;
    const raw = Number(item.nextResetTime);
    const resetAt = raw > 0 && Number.isFinite(raw) ? (raw < 1e12 ? raw * 1000 : raw) : null;
    return { percent: Math.round(item.percentage), resetAt };
  };
  const quota = { fiveHour: find(3, 5), weekly: find(6, 1) };
  if (!quota.fiveHour && !quota.weekly) throw new Error('未识别配额');
  return quota;
}

export function remaining(resetAt, now) {
  if (!Number.isFinite(resetAt) || resetAt <= 0) return '';
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (!minutes) return '待重置';
  if (minutes >= 1440) {
    const hours = Math.floor(minutes % 1440 / 60);
    return `${Math.floor(minutes / 1440)}d${hours ? `${hours}h` : ''}`;
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
  return `${minutes}m`;
}

export function formatLabel(cache, now) {
  const quota = cache?.quota;
  const stale = Boolean(cache?.error) || (quota && now - cache.fetchedAt >= INTERVAL_MS);
  const parts = [];
  for (const [name, window] of [['5h', quota?.fiveHour], ['周', quota?.weekly]]) {
    if (!window) continue;
    const reset = !stale && remaining(window.resetAt, now);
    parts.push(`${name}${window.percent}%${reset ? `·${reset}` : ''}`);
  }
  let label = parts.length ? `GLM已用 ${parts.join(' ')}` : 'GLM --';
  if (stale && quota) {
    const age = Math.max(0, Math.floor((now - cache.fetchedAt) / 60_000));
    label += ` ⚠${cache.error || '过期'}·${age}m前`;
  } else if (cache?.error) {
    label += `（${cache.error}）`;
  } else if (!quota) {
    label += '（更新中）';
  }
  return label.length <= 50 ? label : `${label.slice(0, 49)}…`;
}

async function acquire(path) {
  const id = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ id })); }
      finally { await handle.close(); }
      return async () => {
        if ((await readJson(path))?.id === id) await unlink(path).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(path)).mtimeMs <= 10_000) return null;
        await unlink(path);
      } catch (error) {
        if (error.code !== 'ENOENT') return null;
      }
    }
  }
  return null;
}

export async function getSnapshot({ env = process.env, now = Date.now, fetchImpl = fetch } = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const settings = await readJson(join(configDir, 'settings.json'));
  const base = env.ANTHROPIC_BASE_URL ?? settings?.env?.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN ?? settings?.env?.ANTHROPIC_AUTH_TOKEN;
  if (!base) return { label: 'GLM --（未配置地址）' };
  let url;
  try { url = new URL(base); } catch { return { label: 'GLM --（地址无效）' }; }
  // Switching to another provider must not send GLM credentials there.
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)
    || url.port || url.username || url.password) return { label: '' };
  if (!token || typeof token !== 'string') return { label: 'GLM --（未配置密钥）' };

  const cacheDir = join(configDir, 'glm-usage', 'cache');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const identity = createHash('sha256').update(`${url.origin}\0${token}`).digest('hex').slice(0, 32);
  const cachePath = join(cacheDir, `${identity}.json`);
  const lockPath = `${cachePath}.lock`;
  let cache = await readJson(cachePath);
  if (cache?.nextAttemptAt > now()) return cache;
  const release = await acquire(lockPath);
  if (!release) return await readJson(cachePath) || {};
  try {
    // Another process may have filled the cache between our first read and lock.
    cache = await readJson(cachePath);
    if (cache?.nextAttemptAt > now()) return cache;
    const startedAt = now();
    cache = { ...cache, nextAttemptAt: startedAt + INTERVAL_MS };
    // Reserve the next attempt before I/O, including if Claude Code cancels us.
    await save(cachePath, cache);
    let retryAfter = 0;
    try {
      const response = await fetchImpl(`${url.origin}/api/monitor/usage/quota/limit`, {
        headers: { Authorization: token, 'Accept-Language': 'en-US,en' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = retry?.trim() ? Number(retry) : NaN;
          retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now();
          throw new Error('限流');
        }
        throw new Error([401, 403].includes(response.status) ? '鉴权失败' : `HTTP${response.status}`);
      }
      const quota = normalize(await response.json());
      cache = { quota, fetchedAt: now(), nextAttemptAt: startedAt + INTERVAL_MS, failures: 0 };
    } catch (error) {
      const failures = Math.min(5, (cache.failures || 0) + 1);
      const known = /^(限流|鉴权失败|HTTP\d+|接口异常|数据格式变化|未识别配额)$/;
      const reason = ['TimeoutError', 'AbortError'].includes(error.name) ? '超时'
        : known.test(error.message) ? error.message : '网络异常';
      const backoff = Math.min(1_800_000, INTERVAL_MS * 2 ** (failures - 1));
      const delay = Math.min(86_400_000, Math.max(backoff, retryAfter || 0));
      cache = { ...cache, failures, error: reason, nextAttemptAt: startedAt + delay };
    }
    await save(cachePath, cache);
    return cache;
  } finally {
    await release();
  }
}

export async function getLabel(options = {}) {
  const snapshot = await getSnapshot(options);
  return typeof snapshot.label === 'string' ? snapshot.label : formatLabel(snapshot, (options.now || Date.now)());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let label;
  try { label = await getLabel(); }
  catch { label = 'GLM --（本地缓存异常）'; }
  process.stdout.write(`${JSON.stringify({ label })}\n`);
}
