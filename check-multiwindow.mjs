import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSnapshot, formatLabel } from './glm-hud.mjs';
import { resolveLanguage } from './i18n.mjs';

const base = 'https://open.bigmodel.cn/api/anthropic';
if (process.argv[2] === '--worker') {
  const [, , , root, count, token, resultKind, simulatedNow, language] = process.argv;
  const env = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token, CLAUDE_HUD_GLM_LANG: language };
  process.stdout.write('READY\n');
  await new Promise(resolve => process.stdin.once('data', resolve));
  const result = await getSnapshot({ env, now: simulatedNow ? () => Number(simulatedNow) : Date.now, fetchImpl: async () => {
    await appendFile(count, 'x');
    await new Promise(resolve => setTimeout(resolve, 500));
    if (resultKind === 'error') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ success: true, data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 31 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 48 },
    ] } }));
  } });
  process.stdout.write(`${JSON.stringify({ five: result.quota?.fiveHour?.percent, week: result.quota?.weekly?.percent, error: result.error, label: formatLabel(result, simulatedNow ? Number(simulatedNow) : Date.now(), resolveLanguage(env)) })}\n`);
} else {
  const root = await mkdtemp(join(tmpdir(), 'glm-windows-'));
  const children = [];
  const watchdog = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 30000);
  const script = fileURLToPath(import.meta.url);
  async function windows(countPath, tokens, kind = 'success', dirs = tokens.map(() => root), simulatedNow = '', languages = tokens.map(() => 'en')) {
    const tasks = tokens.map((token, index) => {
      const child = spawn(process.execPath, [script, '--worker', dirs[index], countPath, token, kind, String(simulatedNow), languages[index]], { stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      let output = '', error = '', ready = false;
      const initialized = new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          output += chunk;
          if (!ready && output.includes('READY\n')) { ready = true; resolve(); }
        });
        child.on('error', reject);
        child.on('close', () => { if (!ready) reject(new Error('Window process exited before initialization')); });
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { error += chunk; });
      const finished = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(JSON.parse(output.trim().split('\n').at(-1))) : reject(new Error(error)));
      });
      return { child, initialized, finished };
    });
    await Promise.all(tasks.map(t => t.initialized));
    for (const task of tasks) task.child.stdin.end('go');
    return Promise.all(tasks.map(t => t.finished));
  }
  const complete = results => results.every(x => x.five === 31 && x.week === 48);
  try {
    const count = join(root, 'requests.txt');
    await writeFile(count, '');
    const sameKey = Array(8).fill('fixture-key-A');
    const languages = sameKey.map((_, i) => ['en', 'zh-Hans', 'zh-Hant'][i % 3]);
    const cold = await windows(count, sameKey, 'success', sameKey.map(() => root), '', languages);
    assert.ok(complete(cold), 'cold-start windows should share the first result');
    for (const [i, window] of cold.entries()) {
      assert.match(window.label, [/GLM used .*wk48%/, /GLM已用 .*周48%/, /GLM已用 .*週48%/][i % 3], 'each window renders the shared result in its own language');
    }
    assert.equal((await readFile(count, 'utf8')).length, 1, 'cold-start windows issue one request');
    assert.ok(complete(await windows(count, sameKey)), 'warm-cache windows should display cached data');
    assert.equal((await readFile(count, 'utf8')).length, 1, 'warm-cache windows issue no new requests');

    const differentKeys = Array.from({ length: 8 }, (_, i) => `fixture-key-${i % 2 ? 'B' : 'C'}`);
    assert.ok(complete(await windows(count, differentKeys)), 'different keys should each receive a result');
    assert.equal((await readFile(count, 'utf8')).length, 3, 'different keys use separate requests');

    const otherConfig = join(root, 'other-config');
    await mkdir(otherConfig);
    const sharedKey = Array(8).fill('fixture-key-other-config');
    const configs = sharedKey.map((_, i) => i % 2 ? otherConfig : root);
    assert.ok(complete(await windows(count, sharedKey, 'success', configs)), 'each configuration directory receives a result');
    assert.equal((await readFile(count, 'utf8')).length, 5, 'different configuration directories use separate requests');

    const token = 'fixture-key-orphan';
    const cacheDir = join(root, 'glm-usage', 'cache');
    await mkdir(cacheDir, { recursive: true });
    const id = createHash('sha256').update(`https://open.bigmodel.cn\0${token}`).digest('hex').slice(0, 32);
    const path = join(cacheDir, `${id}.json`);
    const old = Date.now() - 15000;
    await writeFile(path, JSON.stringify({ pendingAt: old, nextAttemptAt: old + 300000 }));
    await writeFile(`${path}.lock`, JSON.stringify({ id: 'stale-fixture' }));
    await utimes(`${path}.lock`, new Date(old), new Date(old));
    const oldGuard = `${path}.lock.reap-${(await stat(`${path}.lock`)).ino}`;
    await writeFile(oldGuard, JSON.stringify({ id: 'abandoned-reaper' }));
    await utimes(oldGuard, new Date(old), new Date(old));
    const interrupted = await windows(count, Array(8).fill(token));
    assert.ok(interrupted.every(result => result.error === 'refreshPending'), 'unfinished refresh should be shown');
    assert.equal((await readFile(count, 'utf8')).length, 5, 'interruption must not trigger an early retry');
    const beforeCooldown = await windows(count, Array(8).fill(token), 'success', Array(8).fill(root), old + 301999);
    assert.ok(beforeCooldown.every(result => result.error === 'refreshPending'));
    assert.equal((await readFile(count, 'utf8')).length, 5, 'the timeout allowance prevents an early retry');
    assert.ok(complete(await windows(count, Array(8).fill(token), 'success', Array(8).fill(root), old + 302001)), 'abandoned refresh should recover after the cooldown');
    assert.equal((await readFile(count, 'utf8')).length, 6, 'recovery issues one request after the cooldown');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).pendingAt, undefined, 'finished refresh clears its pending marker');
    await assert.rejects(() => stat(oldGuard), { code: 'ENOENT' });

    const staleToken = 'fixture-key-stale';
    const staleId = createHash('sha256').update(`https://open.bigmodel.cn\0${staleToken}`).digest('hex').slice(0, 32);
    await writeFile(join(cacheDir, `${staleId}.json`), JSON.stringify({
      pendingAt: old, nextAttemptAt: old + 300000, fetchedAt: old - 300000,
      quota: { fiveHour: { percent: 12 }, weekly: { percent: 34 } },
    }));
    const stale = await getSnapshot({
      env: { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: staleToken },
      fetchImpl: async () => { throw new Error('Interrupted fetch must not retry early'); },
    });
    assert.equal(stale.error, 'refreshPending');
    assert.equal(stale.quota.fiveHour.percent, 12, 'preserve the last quota after interruption');

    const failures = await windows(count, Array(8).fill('fixture-key-error'), 'error');
    assert.ok(failures.every(x => x.error === 'HTTP503'), 'concurrent windows share the first failure');
    assert.equal((await readFile(count, 'utf8')).length, 7, 'shared failure issues one request');
    assert.ok((await windows(count, Array(8).fill('fixture-key-error'), 'error')).every(x => x.error === 'HTTP503'));
    assert.equal((await readFile(count, 'utf8')).length, 7, 'failure must not retry during cooldown');

    const blockedToken = 'fixture-key-blocked';
    const blockedId = createHash('sha256').update(`https://open.bigmodel.cn\0${blockedToken}`).digest('hex').slice(0, 32);
    const blockedPath = join(cacheDir, `${blockedId}.json`);
    const startedAt = Date.now();
    await writeFile(blockedPath, JSON.stringify({ pendingAt: startedAt, nextAttemptAt: startedAt + 300000 }));
    await writeFile(`${blockedPath}.lock`, JSON.stringify({ id: 'active-fixture' }));
    const startWait = performance.now();
    const blocked = await getSnapshot({
      env: { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: blockedToken },
      fetchImpl: async () => { throw new Error('A second query must not start'); },
    });
    const waitedMs = performance.now() - startWait;
    assert.ok(!blocked.quota && !blocked.error, 'an unresolved first fetch remains unknown');
    assert.ok(waitedMs >= 2000 && waitedMs < 5000, 'waiting for the first fetch is bounded');

    // Two windows redraw at different 15-second phases while sharing a five-minute query cooldown.
    let virtualNow = Date.now();
    const start = virtualNow;
    const queryTimes = [];
    const seenNew = {};
    const syncEnv = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'fixture-key-sync' };
    const events = [];
    for (let offset = 0; offset <= 315000; offset += 15000) events.push({ offset, window: 'A' });
    for (let offset = 7000; offset <= 315000; offset += 15000) events.push({ offset, window: 'B' });
    events.sort((a, b) => a.offset - b.offset);
    for (const event of events) {
      virtualNow = start + event.offset;
      const snapshot = await getSnapshot({ env: syncEnv, now: () => virtualNow, fetchImpl: async () => {
        queryTimes.push(virtualNow);
        return new Response(JSON.stringify({ success: true, data: { limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: queryTimes.length * 10 },
        ] } }));
      } });
      if (snapshot.quota.fiveHour.percent === 20 && seenNew[event.window] === undefined) seenNew[event.window] = event.offset;
    }
    assert.deepEqual(queryTimes, [start, start + 300000], 'redraws must not increase the query frequency');
    assert.deepEqual(seenNew, { A: 300000, B: 307000 }, 'each window sees the shared refresh on its next redraw');

    // Cooldown begins no earlier than completion, even when the first request is slow.
    let slowNow = start;
    let slowCalls = 0;
    const slowEnv = { ...syncEnv, ANTHROPIC_AUTH_TOKEN: 'fixture-key-slow' };
    const slowOptions = { env: slowEnv, now: () => slowNow, fetchImpl: async () => {
      slowCalls++;
      slowNow += 1200;
      return new Response(JSON.stringify({ success: true, data: { limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 10 },
      ] } }));
    } };
    await getSnapshot(slowOptions);
    slowNow = start + 300000;
    await getSnapshot(slowOptions);
    assert.equal(slowCalls, 1, 'a slow request must not be repeated early');
    slowNow = start + 301199;
    await getSnapshot(slowOptions);
    assert.equal(slowCalls, 1);
    slowNow++;
    await getSnapshot(slowOptions);
    assert.equal(slowCalls, 2, 'a full cooldown has elapsed since completion');
    console.log('PASS: independent windows share cold and warm results, isolate keys and configuration directories, respect the interrupted-fetch cooldown, and share errors');
  } finally {
    clearTimeout(watchdog);
    for (const child of children) if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
}
