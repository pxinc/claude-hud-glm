import assert from 'node:assert/strict';
import { appendQuota } from './hud-with-glm.mjs';
import { remaining } from './glm-hud.mjs';
process.env.CLAUDE_HUD_GLM_LANG = 'zh-Hans';
// Minimal palette fixture: production uses the installed HUD's real palette.
const colors = {
  RESET: '\x1b[0m', label: text => text, warning: text => text,
  getQuotaColor: percent => percent >= 90 ? '\x1b[31m' : '\x1b[94m',
  quotaBar: (percent, width) => {
    const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  },
};

const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const initial = ['[GLM] │ project', '\x1b[0mContext ████░░░░░░ 42%', 'Tool status unchanged'];
const now = Date.now();
const snapshot = { fetchedAt: now, quota: {
  fiveHour: { percent: 30, resetAt: now + 135 * 60_000 },
  weekly: { percent: 85, resetAt: now + (3 * 24 + 4) * 3600_000 },
} };
for (const columns of [40, 60, 80, 120]) {
  const rendered = appendQuota(initial, snapshot, colors, columns < 60 ? 4 : columns < 100 ? 6 : 10, columns, now);
  assert.equal(rendered[0], initial[0]);
  assert.equal(rendered.at(-1), initial.at(-1));
  const text = rendered.map(plain).join('\n');
  assert.ok(text.indexOf('5h已用') > text.indexOf('Context'));
  assert.ok(text.indexOf('周已用') > text.indexOf('5h已用'));
  assert.ok(!plain(rendered[0]).includes('已用'));
  assert.match(text, /5h已用 [█░]+ 30%·2h15m/);
  assert.match(text, /周已用 [█░]+ 85%·3d4h/);
  assert.ok(rendered.every(line => Bun.stringWidth(line) <= columns));
  if (columns === 120) assert.ok(plain(rendered[1]).includes('周已用'), 'wide terminals keep both bars after Context on one row');
}
const full = appendQuota(initial, { ...snapshot, quota: { fiveHour: { percent: 100 }, weekly: { percent: 0 } } }, colors, 10, 120, now).map(plain).join('\n');
assert.match(full, /5h已用 █{10} 100%/);
assert.match(full, /周已用 ░{10} 0%/);
const partial = appendQuota(initial, { ...snapshot, quota: { fiveHour: { percent: 30 } } }, colors, 6, 120, now).map(plain).join('\n');
assert.match(partial, /周已用 --/);
const stale = appendQuota(initial, { ...snapshot, error: '超时' }, colors, 6, 120, now).map(plain).join('\n');
assert.match(stale, /超时/);
assert.match(stale, /30%/);
assert.deepEqual(appendQuota(initial, { label: '' }, colors, 6, 80), initial);
assert.deepEqual(appendQuota(['[GLM]'], snapshot, colors, 6, 80), ['[GLM]']);
const chinese = appendQuota(['[GLM]', '上下文 ████░░░░░░ 42%'], snapshot, colors, 6, 120, now).map(plain).join('\n');
assert.ok(chinese.indexOf('5h已用') > chinese.indexOf('上下文'));
assert.equal(remaining(null, now), '');
assert.equal(remaining(NaN, now), '');
assert.equal(remaining(now - 1, now), '待重置');
assert.equal(remaining(now + 1, now), '1m');
assert.equal(remaining(now + 60 * 60_000, now), '1h');
assert.equal(remaining(now + 24 * 3600_000, now), '1d');
assert.equal(remaining(snapshot.quota.fiveHour.resetAt, now + 3 * 60_000), '2h12m');
const expired = appendQuota(initial, { ...snapshot, quota: { fiveHour: { percent: 30, resetAt: now - 1 } } }, colors, 6, 120, now).map(plain).join('\n');
assert.match(expired, /30%·待重置/);
assert.ok(!partial.includes('undefined') && !partial.includes('NaN'));
console.log('PASS: native styles, Context placement, 40/60/80/120-column wrapping, independent countdowns, minute/hour/day boundaries, missing/expired reset times, stale data');
