// Run against a separately checked-out Claude HUD without accessing a real account.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const source = process.env.CLAUDE_HUD_SOURCE;
if (!source) {
  console.log('SKIP: set CLAUDE_HUD_SOURCE to test a real Claude HUD checkout');
  process.exit(0);
}
const sourceDir = resolve(source);
const version = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8')).version;
const root = await mkdtemp(join(tmpdir(), 'glm-real-hud-'));
const base = 'https://open.bigmodel.cn/api/anthropic';
const token = 'test-fixture-not-a-real-key';
const now = Date.now();
const input = JSON.stringify({
  cwd: root, model: { id: 'glm-test', display_name: 'GLM Test' },
  workspace: { current_dir: root, project_dir: root },
  context_window: { used_percentage: 42, context_window_size: 200000, current_usage: { input_tokens: 84000, output_tokens: 100 } },
  rate_limits: { five_hour: { used_percentage: 99, resets_at: Math.floor((now + 3600000) / 1000) } },
  transcript_path: '',
});
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ANTHROPIC_'))), CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_PLUGIN_CACHE_DIR: join(root, 'plugins'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token, CLAUDE_HUD_DISABLE: '0', DEBUG: '', COLUMNS: '120' };
function execute(args, inputValue = '') {
  const result = spawnSync(process.execPath, args, { input: inputValue, encoding: 'utf8', env, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
  return result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
}
try {
  const hud = join(root, 'plugins/cache/claude-hud/claude-hud', version);
  await mkdir(hud, { recursive: true });
  await symlink(join(sourceDir, 'src'), join(hud, 'src'));
  await writeFile(join(root, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'original-hud' } }));
  const cache = join(root, 'glm-usage/cache');
  await mkdir(cache, { recursive: true });
  const identity = createHash('sha256').update(`https://open.bigmodel.cn\0${token}`).digest('hex').slice(0, 32);
  await writeFile(join(cache, `${identity}.json`), JSON.stringify({
    quota: { fiveHour: { percent: 30, resetAt: now + 3600000 }, weekly: { percent: 45, resetAt: now + 86400000 } },
    fetchedAt: now, nextAttemptAt: now + 300000,
  }));
  let setupPath = 'setup.mjs';
  const remoteMarketplace = process.argv.includes('--remote-marketplace');
  const marketplace = remoteMarketplace || process.argv.includes('--marketplace');
  const pluginId = 'claude-hud-glm@claude-hud-glm-marketplace';
  const claude = args => {
    const result = spawnSync('claude', args, { encoding: 'utf8', env, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
  };
  if (marketplace) {
    claude(['plugin', 'marketplace', 'add', remoteMarketplace ? 'pxinc/claude-hud-glm' : process.cwd()]);
    claude(['plugin', 'install', pluginId]);
    const pluginVersion = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8')).version;
    setupPath = join(root, 'plugins/cache/claude-hud-glm-marketplace/claude-hud-glm', pluginVersion, 'setup.mjs');
    const skill = await readFile(join(dirname(setupPath), 'skills/setup/SKILL.md'), 'utf8');
    assert.ok(skill.includes('${CLAUDE_PLUGIN_ROOT}/setup.mjs'));
  }
  assert.match(execute([setupPath, 'check']), /检查通过/);
  assert.match(execute([setupPath, 'install']), /已安装/);
  for (const language of ['en', 'zh-Hans']) {
    const config = join(root, 'plugins/claude-hud/config.json');
    await mkdir(join(config, '..'), { recursive: true });
    await writeFile(config, JSON.stringify({ language, lineLayout: 'expanded' }));
    const output = execute(['hud-with-glm.mjs'], input);
    assert.doesNotMatch(output, /\[claude-hud\] Error/);
    assert.ok(/Context|上下文/.test(output), output);
    assert.ok(output.indexOf('5h已用') > output.search(/Context|上下文/), output);
    assert.match(output, /5h已用 [█░]+ 30%/);
    assert.match(output, /周已用 [█░]+ 45%/);
    assert.doesNotMatch(output, /99%/, 'Claude limits must not be presented as GLM quota');
  }
  if (version === '0.14.0') {
    const override = join(root, 'claude-hud.json');
    for (const value of [{ lineLayout: 'compact' }, { elementOrder: ['project'] }]) {
      await writeFile(override, JSON.stringify(value));
      const result = spawnSync(process.execPath, ['setup.mjs', 'check'], { encoding: 'utf8', env, timeout: 10000 });
      assert.notEqual(result.status, 0, 'unsupported HUD override must be rejected');
      assert.match(result.stderr, /expanded/);
    }
    await writeFile(override, JSON.stringify({ maxWidth: 40, forceMaxWidth: true }));
    const narrow = execute(['hud-with-glm.mjs'], input).trim().split('\n');
    assert.ok(narrow.every(line => Bun.stringWidth(line) <= 40), 'respect HUD forced width');
    assert.match(narrow.join('\n'), /5h已用/);
    assert.match(narrow.join('\n'), /周已用/);
    await rm(override);
  }
  env.ANTHROPIC_BASE_URL = 'https://example.invalid';
  const otherProvider = execute(['hud-with-glm.mjs'], input);
  assert.doesNotMatch(otherProvider, /5h已用|周已用/);
  assert.match(otherProvider, /Context|上下文/);
  env.ANTHROPIC_BASE_URL = '';
  const directClaude = execute(['hud-with-glm.mjs'], input);
  const nativeClaude = execute([join(hud, 'src/index.ts')], input);
  assert.equal(directClaude, nativeClaude, 'default Claude provider must retain the native HUD');
  assert.match(execute([setupPath, 'uninstall']), /已恢复/);
  assert.equal(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8')).statusLine.command, 'original-hud');
  if (marketplace) claude(['plugin', 'uninstall', pluginId]);
  console.log(`PASS: real Claude HUD ${version}, ${marketplace ? 'marketplace install, ' : ''}isolated setup, English/Chinese layout, quota bars, other provider, uninstall`);
} finally { await rm(root, { recursive: true, force: true }); }
