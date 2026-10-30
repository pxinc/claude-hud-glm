#!/usr/bin/env node
// Standalone claude-hud --extra-cmd adapter. No model calls or dependencies.
import { readFile, writeFile, mkdir, rename, open, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configDir as getConfigDir } from './hud-path.mjs';
import { resolveLanguage, t, errorText } from './i18n.mjs';

export const INTERVAL_MS = 300_000;
const TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 10_000;
const FIRST_FETCH_WAIT_MS = 2_200;
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
  if (payload?.success === false) throw new Error('apiError');
  const limits = (payload?.data ?? payload)?.limits;
  if (!Array.isArray(limits)) throw new Error('badResponse');
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
  if (!quota.fiveHour && !quota.weekly) throw new Error('quotaUnavailable');
  return quota;
}

export function remaining(resetAt, now, language = resolveLanguage()) {
  if (!Number.isFinite(resetAt) || resetAt <= 0) return '';
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (!minutes) return t('resetDue', language);
  if (minutes >= 1440) {
    const hours = Math.floor(minutes % 1440 / 60);
    return `${Math.floor(minutes / 1440)}d${hours ? `${hours}h` : ''}`;
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
  return `${minutes}m`;
}

export function formatLabel(cache, now, language = resolveLanguage()) {
  const quota = cache?.quota;
  const stale = Boolean(cache?.error) || (quota && now - cache.fetchedAt >= INTERVAL_MS);
  const parts = [];
  for (const [name, window] of [['5h', quota?.fiveHour], [t('shortWeek', language), quota?.weekly]]) {
    if (!window) continue;
    const reset = !stale && remaining(window.resetAt, now, language);
    parts.push(`${name}${window.percent}%${reset ? `·${reset}` : ''}`);
  }
  let label = parts.length ? `${t('used', language)} ${parts.join(' ')}` : 'GLM --';
  const reason = cache?.error ? errorText(cache.error, language)
    : cache?.message ? t(cache.message, language) : null;
  if (stale && quota) {
    const age = Math.max(0, Math.floor((now - cache.fetchedAt) / 60_000));
    label += ` ⚠${reason || t('stale', language)}·${t('minutesAgo', language, { n: age })}`;
  } else if (reason) {
    label += ` (${reason})`;
  } else if (!quota) {
    label += ` (${t('loading', language)})`;
  }
  return label.length <= 50 ? label : `${label.slice(0, 49)}…`;
}

async function acquire(path) {
  const id = randomUUID();
  async function claim() {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ id })); }
    finally { await handle.close(); }
    return async () => {
      if ((await readJson(path))?.id === id) await unlink(path).catch(() => {});
    };
  }
  try { return await claim(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }

  let oldLock;
  try {
    oldLock = await stat(path);
    if (Date.now() - oldLock.mtimeMs <= LOCK_STALE_MS) return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  // Serialize recovery of this stale inode so another window's new lock is not removed.
  const guardPath = `${path}.reap-${oldLock.ino}`;
  const guardId = randomUUID();
  let guard;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      guard = await open(guardPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(guardPath)).mtimeMs <= LOCK_STALE_MS) return null;
        await unlink(guardPath);
      } catch (error) {
        if (error.code !== 'ENOENT') return null;
      }
    }
  }
  if (!guard) return null;
  try {
    try { await guard.writeFile(JSON.stringify({ id: guardId })); }
    finally { await guard.close(); }
    const current = await stat(path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!current || current.ino !== oldLock.ino || Date.now() - current.mtimeMs <= LOCK_STALE_MS) return null;
    await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    try { return await claim(); }
    catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  } finally {
    if ((await readJson(guardPath))?.id === guardId) await unlink(guardPath).catch(() => {});
  }
}

async function waitForFirstSnapshot(cachePath, lockPath, now) {
  const deadline = performance.now() + FIRST_FETCH_WAIT_MS;
  while (performance.now() < deadline) {
    const current = await readJson(cachePath);
    if (current?.quota || current?.error) return current;
    try {
      await stat(lockPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // A stale lock may be briefly absent while another window replaces it.
        if (!current || current.nextAttemptAt > now()) break;
      } else {
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(75, deadline - performance.now()))));
  }
  return await readJson(cachePath) || {};
}

function interrupted(cache, now) {
  return Number.isFinite(cache?.pendingAt) && now - cache.pendingAt >= LOCK_STALE_MS;
}

function availableAt(cache) {
  if (!cache) return 0;
  return Math.max(
    Number.isFinite(cache.nextAttemptAt) ? cache.nextAttemptAt : 0,
    Number.isFinite(cache.fetchedAt) ? cache.fetchedAt + INTERVAL_MS : 0,
    Number.isFinite(cache.pendingAt) ? cache.pendingAt + INTERVAL_MS + TIMEOUT_MS : 0,
  );
}

export async function getSnapshot({ env = process.env, now = Date.now, fetchImpl = fetch } = {}) {
  const configDir = getConfigDir(env);
  const needsSettings = env.ANTHROPIC_BASE_URL == null || env.ANTHROPIC_AUTH_TOKEN == null;
  const settings = needsSettings ? await readJson(join(configDir, 'settings.json')) : null;
  const base = env.ANTHROPIC_BASE_URL ?? settings?.env?.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN ?? settings?.env?.ANTHROPIC_AUTH_TOKEN;
  // No custom base URL means Claude Code may be using Anthropic directly.
  if (!base) return { label: '' };
  let url;
  try { url = new URL(base); } catch { return { message: 'invalidUrl' }; }
  // Switching to another provider must not send GLM credentials there.
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)
    || url.port || url.username || url.password) return { label: '' };
  if (!token || typeof token !== 'string') return { message: 'missingToken' };

  const cacheDir = join(configDir, 'glm-usage', 'cache');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const identity = createHash('sha256').update(`${url.origin}\0${token}`).digest('hex').slice(0, 32);
  const cachePath = join(cacheDir, `${identity}.json`);
  const lockPath = `${cachePath}.lock`;
  let cache = await readJson(cachePath);
  if (availableAt(cache) > now()) {
    if (interrupted(cache, now())) return { ...cache, error: 'refreshPending' };
    return cache.quota || cache.error ? cache : waitForFirstSnapshot(cachePath, lockPath, now);
  }
  const release = await acquire(lockPath);
  if (!release) {
    cache = await readJson(cachePath);
    return cache?.quota || cache?.error ? cache : waitForFirstSnapshot(cachePath, lockPath, now);
  }
  try {
    // Another process may have filled the cache between our first read and lock.
    cache = await readJson(cachePath);
    if (availableAt(cache) > now()) return cache;
    const startedAt = now();
    cache = { ...cache, pendingAt: startedAt, nextAttemptAt: startedAt + INTERVAL_MS + TIMEOUT_MS };
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
          throw new Error('rateLimited');
        }
        throw new Error([401, 403].includes(response.status) ? 'authFailed' : `HTTP${response.status}`);
      }
      const quota = normalize(await response.json());
      const fetchedAt = now();
      cache = { quota, fetchedAt, nextAttemptAt: fetchedAt + INTERVAL_MS, failures: 0 };
    } catch (error) {
      const failures = Math.min(5, (cache.failures || 0) + 1);
      const known = /^(rateLimited|authFailed|HTTP\d{3}|apiError|badResponse|quotaUnavailable)$/;
      const reason = ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout'
        : known.test(error.message) ? error.message : 'networkError';
      const backoff = Math.min(1_800_000, INTERVAL_MS * 2 ** (failures - 1));
      const delay = Math.min(86_400_000, Math.max(backoff, retryAfter || 0));
      const { pendingAt: _pendingAt, ...previous } = cache;
      cache = { ...previous, failures, error: reason, nextAttemptAt: now() + delay };
    }
    await save(cachePath, cache);
    return cache;
  } finally {
    await release();
  }
}

export async function getLabel(options = {}) {
  const snapshot = await getSnapshot(options);
  const language = options.language || resolveLanguage(options.env || process.env);
  return typeof snapshot.label === 'string' ? snapshot.label : formatLabel(snapshot, (options.now || Date.now)(), language);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let label;
  const env = { ...process.env };
  try {
    if (env.CLAUDE_HUD_GLM_LANG == null) {
      const settings = await readJson(join(getConfigDir(env), 'settings.json'));
      if (typeof settings?.env?.CLAUDE_HUD_GLM_LANG === 'string') env.CLAUDE_HUD_GLM_LANG = settings.env.CLAUDE_HUD_GLM_LANG;
    }
    label = await getLabel({ env });
  } catch { label = `GLM -- (${t('cacheError', resolveLanguage(env))})`; }
  process.stdout.write(`${JSON.stringify({ label })}\n`);
}
