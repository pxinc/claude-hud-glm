#!/usr/bin/env bun
// Reuse the installed HUD and its colors/bars, without changing plugin files.
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getSnapshot, INTERVAL_MS, remaining } from './glm-hud.mjs';
import { findHud } from './hud-path.mjs';

const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '');

export function appendQuota(lines, snapshot, colors, barWidth, columns, now = Date.now()) {
  if (snapshot.label === '') return lines;
  const index = lines.findIndex(line => /^Context\b/.test(stripAnsi(line)));
  if (index < 0) return lines; // Keep other layouts intact if Context is hidden.
  const { quotaBar, getQuotaColor, label, warning, RESET } = colors;
  const stale = Boolean(snapshot.error) || (snapshot.quota && now - snapshot.fetchedAt >= INTERVAL_MS);
  const parts = [];
  for (const [name, window] of [['5h已用', snapshot.quota?.fiveHour], ['周已用', snapshot.quota?.weekly]]) {
    if (!window || !Number.isFinite(window.percent)) {
      parts.push(`${label(name)} ${label('--')}`);
      continue;
    }
    const reset = remaining(window.resetAt, now);
    parts.push(`${label(name)} ${quotaBar(window.percent, barWidth)} ${getQuotaColor(window.percent)}${window.percent}%${RESET}${reset ? label(`·${reset}`) : ''}`);
  }
  if (stale || snapshot.label) {
    const age = snapshot.quota ? `·${Math.max(0, Math.floor((now - snapshot.fetchedAt) / 60_000))}m前` : '';
    const reason = snapshot.error || snapshot.label?.replace(/^GLM --[（(]?|[）)]$/g, '') || '过期';
    parts.push(warning(`⚠ ${reason}${age}`));
  }
  // Add segments after Context. Wrap whole segments when the terminal is narrow.
  const additions = [];
  let current = lines[index];
  for (const part of parts) {
    const next = `${current} ${label('│')} ${part}`;
    if (columns > 0 && Bun.stringWidth(next) > columns) {
      additions.push(`${current}${RESET}`);
      current = `${RESET}${part}`;
    } else {
      current = next;
    }
  }
  additions.push(`${current}${RESET}`);
  return [...lines.slice(0, index), ...additions, ...lines.slice(index + 1)];
}

export async function run(hudPath) {
  hudPath ||= await findHud();
  const src = dirname(resolve(hudPath));
  const [hud, rendering, palette, terminal, stdinModule] = await Promise.all([
    import(pathToFileURL(join(src, 'index.ts')).href),
    import(pathToFileURL(join(src, 'render/index.ts')).href),
    import(pathToFileURL(join(src, 'render/colors.ts')).href),
    import(pathToFileURL(join(src, 'utils/terminal.ts')).href),
    import(pathToFileURL(join(src, 'stdin.ts')).href),
  ]);
  const stdin = await stdinModule.readStdin();
  const snapshot = stdin ? await getSnapshot().catch(() => ({ label: 'GLM --（本地缓存异常）' })) : { label: '' };
  await hud.main({
    readStdin: async () => stdin,
    parseExtraCmdArg: () => null,
    render(ctx) {
      const lines = [];
      const output = console.log;
      try {
        console.log = line => lines.push(String(line));
        rendering.render(snapshot.label === '' ? ctx : { ...ctx, usageData: null });
      } finally {
        console.log = output;
      }
      const colors = Object.fromEntries(['label', 'warning', 'quotaBar', 'getQuotaColor'].map(name => [
        name, (...args) => palette[name](...args, ctx.config.colors),
      ]));
      colors.RESET = palette.RESET;
      const columns = Number.parseInt(process.env.COLUMNS || '', 10)
        || process.stdout.columns || process.stderr.columns || 0;
      let result = lines;
      try { result = appendQuota(lines, snapshot, colors, terminal.getAdaptiveBarWidth(), columns); }
      catch { /* Preserve the original HUD even if an updated renderer is incompatible. */ }
      for (const line of result) output(line);
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run(process.argv[2]);
}
