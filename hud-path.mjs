import { readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export function configDir(env = process.env) {
  const value = env.CLAUDE_CONFIG_DIR?.trim();
  if (!value) return join(homedir(), '.claude');
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export async function findHud(dir = configDir()) {
  const pluginRoot = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(dir, 'plugins');
  const cache = join(pluginRoot, 'cache', 'claude-hud', 'claude-hud');
  let versions;
  try { versions = (await readdir(cache, { withFileTypes: true })).filter(x => x.isDirectory() && /^\d+\.\d+\.\d+$/.test(x.name)).map(x => x.name); }
  catch { throw new Error('claude-hud 未安装。请先安装 claude-hud 并完成 setup。'); }
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const src = join(cache, version, 'src');
    try {
      await Promise.all(['index.ts', 'stdin.ts', 'render/index.ts', 'render/colors.ts', 'utils/terminal.ts'].map(p => access(join(src, p))));
      return resolve(src, 'index.ts');
    } catch { /* Ignore incomplete cached versions. */ }
  }
  throw new Error('未找到兼容的 claude-hud 源码；已验证版本为 0.0.11。');
}
