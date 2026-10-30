# Changelog

## 0.3.1

- Share the first quota response across concurrently starting windows and recover an interrupted refresh after its lock expires.
- Avoid reading Claude settings when both provider and token are already in the environment.
- Add multi-process tests for cold and warm caches, credential isolation, errors, and interrupted refreshes.

## 0.3.0

- Support Claude HUD 0.14.0 while retaining compatibility with 0.0.11.
- Preserve native Claude HUD output when no GLM provider is configured.
- Support a custom `CLAUDE_CODE_PLUGIN_CACHE_DIR` and reject invalid settings or backup files.
- Add isolated compatibility checks against Claude HUD source and document plugin updates.

## 0.2.0

- Add a Claude Code marketplace and setup/uninstall skills.

## 0.1.0

- Add GLM quota bars, reset countdowns, five-minute caching, and status-line installation and restoration.
