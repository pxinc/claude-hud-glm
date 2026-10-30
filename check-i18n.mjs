import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { messages, resolveLanguage, t, errorText } from './i18n.mjs';
import { getSnapshot, formatLabel, remaining } from './glm-hud.mjs';
import { appendQuota } from './hud-with-glm.mjs';

assert.equal(resolveLanguage({}), 'en');
assert.equal(resolveLanguage({ LANG: 'en_US.UTF-8' }), 'en');
assert.equal(resolveLanguage({ LANG: 'zh_CN.UTF-8' }), 'zh-Hans');
assert.equal(resolveLanguage({ LANG: 'zh_SG.UTF-8' }), 'zh-Hans');
assert.equal(resolveLanguage({ LANG: 'zh_TW.UTF-8' }), 'zh-Hant');
assert.equal(resolveLanguage({ LANG: 'zh_HK.UTF-8' }), 'zh-Hant');
assert.equal(resolveLanguage({ LANG: 'zh_MO.UTF-8' }), 'zh-Hant');
assert.equal(resolveLanguage({ LANG: 'zh-Hant-CN' }), 'zh-Hant');
assert.equal(resolveLanguage({ LANG: 'fr_FR.UTF-8' }), 'en');
assert.equal(resolveLanguage({ LC_ALL: 'C.UTF-8', LANG: 'zh_CN.UTF-8' }), 'en');
assert.equal(resolveLanguage({ LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' }), 'zh-Hant');
assert.equal(resolveLanguage({ CLAUDE_HUD_GLM_LANG: 'en', LANG: 'zh_CN.UTF-8' }), 'en');
assert.equal(resolveLanguage({ CLAUDE_HUD_GLM_LANG: 'zh-Hant', LANG: 'en_US.UTF-8' }), 'zh-Hant');
assert.equal(resolveLanguage({ CLAUDE_HUD_GLM_LANG: 'auto', LANG: 'zh_CN.UTF-8' }), 'zh-Hans');
assert.equal(resolveLanguage({ CLAUDE_HUD_GLM_LANG: 'unknown', LANG: 'zh_CN.UTF-8' }), 'en');
assert.equal(errorText('超时', 'en'), 'timeout');
assert.equal(errorText('刷新未完成', 'zh-Hant'), '更新未完成');
assert.equal(errorText('HTTP503', 'en'), 'HTTP503');
assert.equal(errorText('untrusted details', 'en'), 'unknown error');
assert.equal(remaining(1000, 1001, 'en'), 'reset due');
assert.equal(remaining(1000, 1001, 'zh-Hans'), '待重置');
assert.equal(remaining(1000, 1001, 'zh-Hant'), '待重置');

const keys = ['fiveHour','week','shortWeek','used','resetDue','stale','loading','minutesAgo','invalidUrl','missingToken','cacheError','timeout','rateLimited','authFailed','apiError','badResponse','quotaUnavailable','networkError','refreshPending','unknownError','settingsChanged','incompatibleHud','layoutRequired','unsupportedWindows','setupUsage','hudCheckPassed','notInstalled','alreadyRestored','restoreConflict','restored','installConflict','installed','hudNotInstalled','hudNotFound'];
for (const language of ['en', 'zh-Hans', 'zh-Hant']) {
  for (const key of keys) {
    assert.ok(Object.hasOwn(messages[language], key), `${language}: missing ${key}`);
    assert.equal(typeof t(key, language), 'string', `${language}: ${key}`);
  }
}

const colors = { label: x => x, warning: x => x, getQuotaColor: () => '', quotaBar: (_p, w) => '░'.repeat(w), RESET: '' };
const now = Date.now();
const data = { fetchedAt: now, quota: { fiveHour: { percent: 30 }, weekly: { percent: 45 } } };
for (const [language, five, week] of [['en', '5h used', 'Week used'], ['zh-Hans', '5h已用', '周已用'], ['zh-Hant', '5h已用', '週已用']]) {
  const output = appendQuota(['Context 42%'], data, colors, 6, 120, now, language).join('\n');
  assert.ok(output.indexOf(five) > output.indexOf('Context'));
  assert.ok(output.indexOf(week) > output.indexOf(five));
}

const root = await mkdtemp(join(tmpdir(), 'glm-i18n-'));
try {
  const base = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'fixture-only-key' };
  let calls = 0;
  const fetchImpl = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 100)); throw new Error('private fixture'); };
  const snapshots = await Promise.all(['en', 'zh-Hans', 'zh-Hant'].map(language => getSnapshot({ env: { ...base, CLAUDE_HUD_GLM_LANG: language }, fetchImpl })));
  assert.equal(calls, 1, 'different languages must share a single request');
  assert.ok(snapshots.every(snapshot => snapshot.error === 'networkError'));
  assert.match(formatLabel(snapshots[0], now, 'en'), /network error/);
  assert.match(formatLabel(snapshots[1], now, 'zh-Hans'), /网络异常/);
  assert.match(formatLabel(snapshots[2], now, 'zh-Hant'), /網路異常/);
  const dir = join(root, 'glm-usage/cache');
  const cache = await readFile(join(dir, (await readdir(dir)).find(name => name.endsWith('.json'))), 'utf8');
  assert.equal(JSON.parse(cache).error, 'networkError');
  assert.ok(!cache.includes('fixture-only-key') && !cache.includes('private fixture'));
  console.log('PASS: locale precedence and fallback, en/zh-Hans/zh-Hant, legacy errors, shared cache and language-specific rendering');
} finally { await rm(root, { recursive: true, force: true }); }
