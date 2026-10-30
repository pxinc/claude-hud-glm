import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSnapshot } from './glm-hud.mjs';

const base = 'https://open.bigmodel.cn/api/anthropic';
if (process.argv[2] === '--worker') {
  const [, , , root, count, token, resultKind] = process.argv;
  const env = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token };
  process.stdout.write('READY\n');
  await new Promise(resolve => process.stdin.once('data', resolve));
  const result = await getSnapshot({ env, fetchImpl: async () => {
    await appendFile(count, 'x');
    await new Promise(resolve => setTimeout(resolve, 500));
    if (resultKind === 'error') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ success: true, data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 31 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 48 },
    ] } }));
  } });
  process.stdout.write(`${JSON.stringify({ five: result.quota?.fiveHour?.percent, week: result.quota?.weekly?.percent, error: result.error })}\n`);
} else {
  const root = await mkdtemp(join(tmpdir(), 'glm-windows-'));
  const children = [];
  const watchdog = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 30000);
  const script = fileURLToPath(import.meta.url);
  async function windows(countPath, tokens, kind = 'success', dirs = tokens.map(() => root)) {
    const tasks = tokens.map((token, index) => {
      const child = spawn(process.execPath, [script, '--worker', dirs[index], countPath, token, kind], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    assert.ok(complete(await windows(count, sameKey)), 'cold-start windows should share the first result');
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
    assert.ok(complete(await windows(count, Array(8).fill(token))), 'abandoned cold refresh should recover');
    assert.equal((await readFile(count, 'utf8')).length, 6, 'recovery issues one request');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).pendingAt, undefined, 'finished refresh clears its pending marker');

    const failures = await windows(count, Array(8).fill('fixture-key-error'), 'error');
    assert.ok(failures.every(x => x.error === 'HTTP503'), 'concurrent windows share the first failure');
    assert.equal((await readFile(count, 'utf8')).length, 7, 'shared failure issues one request');

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
    console.log('PASS: independent windows share cold and warm results, isolate keys and configuration directories, recover abandoned refreshes, and share errors');
  } finally {
    clearTimeout(watchdog);
    for (const child of children) if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
}
