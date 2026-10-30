# claude-hud-glm

English | [简体中文](README.zh-CN.md)

Display **GLM Coding Plan five-hour and weekly quota bars and reset countdowns** after Context in your existing [Claude HUD](https://github.com/jarrodwatts/claude-hud) status line.

```text
[GLM] │ my-project git:(main)
Context ████░░░░░░ 42% │ 5h已用 ███░░░░░░░ 30%·2h15m │ 周已用 ████░░░░░░ 45%·3d4h
```

The labels `5h已用` and `周已用` mean five-hour usage and weekly usage. Percentages show the amount **used**. Status labels and setup messages are currently in Chinese. The adapter runs locally without model calls or a background daemon.

## Features

- Reuses Claude HUD's bars and colors and keeps its model, project, Context, and other status lines.
- Refreshes automatically every **five minutes**. Message-triggered redraws recalculate countdowns and use cached quota until the next query is due.
- Shares a cache and request lock across windows using the same Claude configuration directory, provider, and API key. Other credentials or configuration directories use separate caches.
- Keeps the last quota and indicates its age on timeout, network error, or rate limiting; backs off after failures.
- Installs without modifying Claude HUD's plugin files and backs up the previous status line for restoration.

## Requirements

- macOS or Linux and [Bun](https://bun.sh/) 1.3 or later. The installer does not support Windows.
- Claude Code and Claude HUD installed, with HUD setup completed.
- A Claude Code version that supports `statusLine.refreshInterval`.
- HUD's **expanded layout** with Context visible. Compact layout is not supported.
- A personal GLM Coding Plan configured in Claude Code.

Tested with Claude HUD **0.0.11** and **0.14.0**. This adapter imports HUD's internal rendering modules; other versions may require changes. The installer checks required interfaces. After updating HUD, run `bun setup.mjs check` again.

If Claude HUD is not installed, run these commands inside Claude Code:

```text
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

## Install from the plugin marketplace

Run inside Claude Code:

```text
/plugin marketplace add pxinc/claude-hud-glm
/plugin install claude-hud-glm@claude-hud-glm-marketplace
/reload-plugins
/claude-hud-glm:setup
```

The first command registers this third-party marketplace. The second opens the plugin details; choose an installation scope to install it. The final command configures the status line. Claude Code plugin settings cannot currently configure the main `statusLine`, so this one-time setup is required; it checks prerequisites and saves the previous status line.

To remove the integration, run `/claude-hud-glm:uninstall` before uninstalling the plugin through `/plugin`, so the restoration command remains available.

## Install from source

```sh
git clone https://github.com/pxinc/claude-hud-glm.git
cd claude-hud-glm
bun setup.mjs check
bun setup.mjs install
```

The installer uses the Bun executable running the setup command, locates the newest complete Claude HUD cache, copies three runtime files to `~/.claude/claude-hud-glm/`, and sets `statusLine.refreshInterval` to `300` seconds. It supports `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_CACHE_DIR` and preserves other Claude settings.

The separate official GLM usage-query plugin is not required. If an existing Claude Code window does not update automatically, restart it.

## Credentials and data

The adapter reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from the process environment, falling back to the `env` object in Claude Code's `settings.json` when run independently. **You do not need to enter or save an API key in this project.**

| Provider | Claude Code base URL |
|---|---|
| Zhipu China | `https://open.bigmodel.cn/api/anthropic` |
| Z.ai international | `https://api.z.ai/api/anthropic` |

The Chinese personal Coding Plan was tested with a real account using Claude HUD 0.0.11; HUD 0.14.0 was tested with simulated quota data. International endpoint support is implemented but has not been tested with a real account. HTTPS requests go only to the official domain allowlist and redirects are disabled. Other providers retain the original HUD without the GLM extension.

Quota data comes from `/api/monitor/usage/quota/limit`, also used by the [official usage-query plugin](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin). Endpoint fields and availability may change.

Missing quota windows show `--`. Missing reset times omit the countdown. Once a reset time passes, `待重置` means the adapter is waiting for fresh server data. `d`, `h`, and `m` mean days, hours, and minutes.

Requests time out after two seconds. On a cold start, concurrent windows without cached quota wait about 2.2 seconds at most for the first request; existing quota stays available during a refresh. If a refresh is interrupted, a later redraw can recover an abandoned lock after 10 seconds. For HTTP 429 the adapter uses `Retry-After`, capped at 24 hours; repeated failures extend the retry interval.

Each window has its own Context and redraw schedule. Shared quota becomes visible in another window when that window redraws, so updates need not appear at the same instant. Five minutes is the normal query target, subject to provider reporting delays, Claude Code scheduling, and terminal redraw behavior. Queries stop when Claude Code closes.

The cache contains quota values, reset times, and request state, not the API key. The installation backup contains only the `statusLine` field, not the complete settings file; a command in that field could itself contain sensitive data. Do not commit your personal Claude configuration, cache, or actual usage records.

## Troubleshooting

- If quota bars do not appear, check that Claude HUD uses the expanded layout and shows Context. Run `/claude-hud-glm:setup` again after updating the plugin or HUD.
- If a quota shows `--` or a warning, check the displayed reason and your GLM endpoint and credential configuration. Missing quota windows remain `--`; failed requests use the last cached values when available.
- If Claude Code still shows an older status line after setup, restart the session.

## Update and uninstall

For a plugin installation, run in a terminal:

```sh
claude plugin marketplace update claude-hud-glm-marketplace
claude plugin update claude-hud-glm@claude-hud-glm-marketplace
```

Then run `/reload-plugins` and `/claude-hud-glm:setup` in Claude Code. Setup copies the updated runtime files into the installation directory.

For a source installation, run in the cloned directory:

```sh
git pull
bun setup.mjs check
bun setup.mjs install
```

To restore the previous status line:

```sh
bun setup.mjs uninstall
```

Repeated installation retains the original backup. If the status line has been changed after installation, the installer and uninstaller stop rather than overwrite it; inspect `~/.claude/claude-hud-glm/install-state.json`. Uninstall leaves the runtime files and backup for future use and preserves other settings.

## Development and tests

No dependency installation is required:

```sh
bun run test
```

Tests use temporary directories and mock credentials; they do not require a real key, Claude Code, or Claude HUD. They cover cache boundaries, retry backoff, multi-process request deduplication and recovery, credential isolation, countdowns, narrow layouts, installation paths with spaces or quotes, repeated installation, and restoration. CI also tests against a [pinned Claude HUD 0.14.0 revision](https://github.com/jarrodwatts/claude-hud/tree/a235aa9e05e6b988a70dc54cf78fcbf6e98853c2).

To inspect a quota label in JSON format:

```sh
bun glm-hud.mjs
```

See [CHANGELOG.md](CHANGELOG.md) for version changes, [CONTRIBUTING.md](CONTRIBUTING.md) for development and issue reports, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)
