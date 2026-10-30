import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { setup } from './setup.mjs';
import { findHud } from './hud-path.mjs';

const root = await mkdtemp(join(tmpdir(), "hud-glm space's-"));
const settingsPath = join(root, 'settings.json');
const original = { statusLine: { type: 'command', command: 'original-hud', padding: 2 }, env: { ANTHROPIC_AUTH_TOKEN: 'fixture-only-not-a-real-key' } };
try {
  await writeFile(settingsPath, JSON.stringify(original));
  await assert.rejects(() => setup('install', root), /未安装/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), original);
  for (const version of ['0.0.9', '0.0.11']) {
    const src = join(root, 'plugins/cache/claude-hud/claude-hud', version, 'src');
    const modules = {
      'index.ts': 'export async function main(deps) { if (await deps.readStdin()) deps.render({config:{colors:{}},stdin:{},usageData:null}); }',
      'stdin.ts': "export async function readStdin() { let text=''; for await (const x of process.stdin) text+=x; return text.trim()?JSON.parse(text):null; }",
      'render/index.ts': "export function render() { console.log('[fixture HUD]'); console.log('Context 42%'); }",
      'render/colors.ts': "export const RESET=''; export const label=x=>x, warning=x=>x, getQuotaColor=x=>''; export const quotaBar=(percent,width)=>'░'.repeat(width);",
      'utils/terminal.ts': 'export const getAdaptiveBarWidth=()=>6;',
    };
    for (const [name, content] of Object.entries(modules)) {
      const path = join(src, name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content);
    }
  }
  await mkdir(join(root, 'plugins/cache/claude-hud/claude-hud/0.0.12/src'), { recursive: true });
  assert.ok((await findHud(root)).includes('0.0.11'));
  await setup('install', root);
  const installed = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(installed.statusLine.refreshInterval, 300);
  assert.equal(installed.statusLine.padding, 2);
  assert.deepEqual(installed.env, original.env);
  const statePath = join(root, 'claude-hud-glm/install-state.json');
  const backup = await readFile(statePath, 'utf8');
  assert.ok(!backup.includes(original.env.ANTHROPIC_AUTH_TOKEN));
  assert.deepEqual(JSON.parse(backup).previous, original.statusLine);
  await setup('install', root);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')).previous, original.statusLine);
  const output = execSync(installed.statusLine.command, {
    input: '{}', encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: 'https://example.invalid' },
  });
  assert.match(output, /fixture HUD/);
  assert.match(output, /Context 42%/);
  installed.changedLater = true;
  await writeFile(settingsPath, JSON.stringify(installed));
  await setup('uninstall', root);
  let restored = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.deepEqual(restored.statusLine, original.statusLine);
  assert.equal(restored.changedLater, true);
  await setup('install', root);
  restored = JSON.parse(await readFile(settingsPath, 'utf8'));
  restored.statusLine.command = 'new-user-command';
  await writeFile(settingsPath, JSON.stringify(restored));
  await assert.rejects(() => setup('uninstall', root), /被修改/);
  await assert.rejects(() => setup('install', root), /被修改/);
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).statusLine.command, 'new-user-command');
  await writeFile(settingsPath, 'broken json');
  await assert.rejects(() => setup('install', root));
  assert.equal(await readFile(settingsPath, 'utf8'), 'broken json');
  console.log('PASS: HUD discovery, missing dependency, complete-version selection, portable install, spaces/quotes, credential-free backup, repeat install, rollback, changed settings, invalid JSON');
} finally { await rm(root, { recursive: true, force: true }); }
