#!/usr/bin/env bun
// Reuse the installed HUD and its colors/bars, without changing plugin files.
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getSnapshot, INTERVAL_MS, remaining } from './glm-hud.mjs';
import { findHud } from './hud-path.mjs';
import { resolveLanguage, t, errorText } from './i18n.mjs';

const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '');

export function appendQuota(lines, snapshot, colors, barWidth, columns, now = Date.now(), language = resolveLanguage()) {
  if (snapshot.label === '') return lines;
  const index = lines.findIndex(line => /^\s*(?:Context\b|上下文)/.test(stripAnsi(line)));
  if (index < 0) return lines; // Keep other layouts intact if Context is hidden.
  const { quotaBar, getQuotaColor, label, warning, RESET } = colors;
  const stale = Boolean(snapshot.error) || (snapshot.quota && now - snapshot.fetchedAt >= INTERVAL_MS);
  const parts = [];
  for (const [name, window] of [[t('fiveHour', language), snapshot.quota?.fiveHour], [t('week', language), snapshot.quota?.weekly]]) {
    if (!window || !Number.isFinite(window.percent)) {
      parts.push(`${label(name)} ${label('--')}`);
      continue;
    }
    const reset = remaining(window.resetAt, now, language);
    parts.push(`${label(name)} ${quotaBar(window.percent, barWidth)} ${getQuotaColor(window.percent)}${window.percent}%${RESET}${reset ? label(`·${reset}`) : ''}`);
  }
  if (stale || snapshot.message || snapshot.label) {
    const age = snapshot.quota ? `·${t('minutesAgo', language, { n: Math.max(0, Math.floor((now - snapshot.fetchedAt) / 60_000)) })}` : '';
    const reason = snapshot.error ? errorText(snapshot.error, language)
      : snapshot.message ? t(snapshot.message, language) : t('stale', language);
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

function runNativeHud(hudPath, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file', '/dev/null', hudPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Claude HUD exited with status ${code}`)));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

function getColors(palette, overrides) {
  return {
    label: text => palette.label(text, overrides),
    warning: text => palette.warning(text, overrides),
    quotaBar: (percent, width) => palette.quotaBar(percent, width, overrides),
    getQuotaColor: percent => palette.getQuotaColor(percent, overrides),
    RESET: palette.RESET,
  };
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
  const enabled = stdin && !(typeof hud.isHudDisabled === 'function' && hud.isHudDisabled());
  const language = resolveLanguage();
  const snapshot = enabled ? await getSnapshot().catch(() => ({ message: 'cacheError' })) : { label: '' };
  if (typeof rendering.renderLines === 'function' && typeof terminal.getTerminalWidth === 'function') {
    const configModule = await import(pathToFileURL(join(src, 'config.ts')).href);
    const config = await configModule.loadConfig();
    // Do not mistake Claude rate limits for GLM quota. Other providers keep the original input.
    const input = stdin && snapshot.label !== '' ? { ...stdin, rate_limits: null } : stdin;
    const raw = await runNativeHud(hudPath, input ? JSON.stringify(input) : '');
    const lines = raw.replace(/\n$/, '').split('\n');
    if (raw === '' || snapshot.label === '') { process.stdout.write(raw); return; }
    const columns = terminal.getTerminalWidth();
    const outputWidth = config.forceMaxWidth && config.maxWidth ? config.maxWidth : (columns ?? config.maxWidth ?? 0);
    const width = columns === null || columns >= 100 ? 10 : columns >= 60 ? 6 : 4;
    for (const line of appendQuota(lines, snapshot, getColors(palette, config.colors), width, outputWidth, Date.now(), language)) console.log(line);
    return;
  }
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
      const colors = getColors(palette, ctx.config.colors);
      const columns = Number.parseInt(process.env.COLUMNS || '', 10)
        || process.stdout.columns || process.stderr.columns || 0;
      let result = lines;
      try { result = appendQuota(lines, snapshot, colors, terminal.getAdaptiveBarWidth(), columns, Date.now(), language); }
      catch { /* Preserve the original HUD even if an updated renderer is incompatible. */ }
      for (const line of result) output(line);
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run(process.argv[2]);
}
