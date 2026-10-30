#!/usr/bin/env bun
import { readFile, writeFile, mkdir, copyFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { configDir, findHud } from './hud-path.mjs';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const quote = text => `'${text.replace(/'/g, `'"'"'`)}'`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function readText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomic(path, data, expected) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    if (expected !== undefined && await readText(path) !== expected) throw new Error('配置已变化，停止写入。');
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

async function checkHud(dir) {
  const path = await findHud(dir);
  const src = dirname(path);
  const [main, renderer, colors, terminal, stdin] = await Promise.all([
    import(pathToFileURL(path).href),
    import(pathToFileURL(join(src, 'render/index.ts')).href),
    import(pathToFileURL(join(src, 'render/colors.ts')).href),
    import(pathToFileURL(join(src, 'utils/terminal.ts')).href),
    import(pathToFileURL(join(src, 'stdin.ts')).href),
  ]);
  const required = [main.main, renderer.render, colors.quotaBar, colors.getQuotaColor, colors.label, colors.warning, stdin.readStdin];
  const legacy = typeof terminal.getAdaptiveBarWidth === 'function';
  const modern = typeof terminal.getTerminalWidth === 'function' && typeof renderer.renderLines === 'function';
  const modernConfig = modern ? await import(pathToFileURL(join(src, 'config.ts')).href) : null;
  if (required.some(x => typeof x !== 'function') || (!legacy && !modern)
    || (modern && typeof modernConfig.loadConfig !== 'function')) {
    throw new Error('claude-hud 接口不兼容，未修改配置；请查看项目文档中的已验证版本。');
  }
  const hudConfig = JSON.parse(await readText(join(dir, 'plugins', 'claude-hud', 'config.json')) || '{}');
  const override = modern ? JSON.parse(await readText(join(dir, 'claude-hud.json')) || '{}') : {};
  const combined = { ...hudConfig, ...override };
  const effective = typeof modernConfig?.mergeConfig === 'function' ? modernConfig.mergeConfig(combined) : combined;
  const layout = effective.lineLayout ?? (typeof effective.layout === 'string' ? 'compact' : effective.layout?.lineLayout);
  if (layout === 'compact' || (Array.isArray(effective.elementOrder) && !effective.elementOrder.includes('context'))) {
    throw new Error('需要启用 claude-hud expanded 布局并显示 Context；请先运行 /claude-hud:configure。');
  }
  return path;
}

export async function setup(action, dir = configDir()) {
  if (process.platform === 'win32') throw new Error('安装器目前支持 macOS/Linux；Windows 尚未验证。');
  if (!['install', 'uninstall', 'check'].includes(action)) throw new Error('用法：bun setup.mjs install|uninstall|check');
  if (action === 'check') {
    const hud = await checkHud(dir);
    return `claude-hud 接口检查通过：${hud}`;
  }
  const folder = join(dir, 'claude-hud-glm');
  const settingsPath = join(dir, 'settings.json');
  const statePath = join(folder, 'install-state.json');
  const original = await readText(settingsPath);
  const settings = JSON.parse(original ?? '{}'); // Invalid JSON must never be overwritten.
  const stateText = await readText(statePath);
  let state = stateText === null ? null : JSON.parse(stateText);

  if (action === 'uninstall') {
    if (!state) return '尚未安装，无需恢复。';
    if (!same(settings.statusLine, state.installed)) {
      if (same(settings.statusLine, state.previous)) return '状态栏已恢复。';
      throw new Error('状态栏在安装后被修改；停止自动恢复，请检查 install-state.json。');
    }
    if (state.previous === undefined) delete settings.statusLine;
    else settings.statusLine = state.previous;
    await atomic(settingsPath, settings, original);
    return '已恢复原状态栏，其他设置保留。脚本和备份保留以便再次安装。';
  }

  await checkHud(dir);
  if (state && !same(settings.statusLine, state.installed) && !same(settings.statusLine, state.previous)) {
    throw new Error('已有安装记录且状态栏被修改；请先检查备份，不会覆盖新配置。');
  }
  await mkdir(folder, { recursive: true, mode: 0o700 });
  state ||= { previous: settings.statusLine };
  const command = `${quote(process.execPath)} --env-file /dev/null ${quote(join(folder, 'hud-with-glm.mjs'))}`;
  const installed = { ...settings.statusLine, type: 'command', command, refreshInterval: 15 };
  state.installed = installed;
  // Save only statusLine, never the credential-bearing settings object.
  await atomic(statePath, state);
  for (const name of ['glm-hud.mjs', 'hud-with-glm.mjs', 'hud-path.mjs']) {
    const src = join(sourceDir, name);
    const dest = join(folder, name);
    if (resolve(src) === resolve(dest)) continue;
    const temp = `${dest}.${randomUUID()}.tmp`;
    try { await copyFile(src, temp); await rename(temp, dest); }
    finally { await unlink(temp).catch(() => {}); }
  }
  settings.statusLine = installed;
  await atomic(settingsPath, settings, original);
  return '已安装：状态栏约每 15 秒重绘，GLM 额度最多每 5 分钟查询一次。当前窗口未更新时重启 Claude Code。';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await setup(process.argv[2] || 'install')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
