# Agent guide

## Purpose and entry points

This project adds GLM Coding Plan quota bars and reset countdowns after Context in an existing Claude HUD status line. Start with [README.md](README.md) for user-facing setup; [README.zh-CN.md](README.zh-CN.md) is its Chinese counterpart. Keep both aligned when changing behavior or installation instructions.

- `glm-hud.mjs` reads GLM credentials, fetches and normalizes quota data, and manages the five-minute cache, request lock, timeout, and backoff.
- `hud-with-glm.mjs` calls the installed HUD's internal modules and adds quota bars after Context. `hud-path.mjs` locates an installed HUD version.
- `setup.mjs` checks compatibility, installs the adapter, and restores the previous `statusLine` on uninstall. It must preserve unrelated settings and refuse to overwrite later status-line changes.
- `.claude-plugin/` defines the plugin and its marketplace; `skills/setup/` and `skills/uninstall/` expose the corresponding Claude Code commands.

## Working safely

The integration touches a user's Claude settings. Do not run installation, uninstallation, or a live quota query against the real user environment unless the task calls for it. Use a temporary `CLAUDE_CONFIG_DIR` and mock credentials when testing. Never print or commit API keys, user settings, cache files, or real quota data. Preserve the official HTTPS allowlist, credential isolation, cache locking, and error handling when changing the fetch path.

The runtime depends on Bun and Claude HUD internals; version 0.0.11 is tested. Keep the five-minute refresh, expanded layout behavior, missing/stale-data indicators, and existing status-line restoration intact unless the task explicitly changes them. The international Z.ai endpoint has not been verified with a real account.

## Validation

Run `bun run test`. The checks use temporary directories and do not need a real key, Claude Code, or Claude HUD. For plugin metadata changes, also run `claude plugin validate .` if Claude Code is installed. When the repository contains both marketplace and plugin manifests, that command validates the marketplace; validate the plugin manifest separately with a temporary copy that omits `marketplace.json`.

The project is licensed under MIT; retain [LICENSE](LICENSE).
