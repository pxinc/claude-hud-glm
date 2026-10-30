# Contributing

For bugs, open an issue with the operating system, Bun, Claude Code, and Claude HUD versions; include steps to reproduce, expected behavior, and actual behavior. Remove API keys, personal paths, usage data, and other private information from any output. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

To propose a change, explain its purpose and validation in a pull request. Follow the [code of conduct](CODE_OF_CONDUCT.md) and keep the English and Chinese READMEs aligned when behavior or installation steps change.

Run the dependency-free checks locally:

```sh
bun run test
```

The tests use temporary directories and mock credentials. To test against an actual Claude HUD source checkout without making quota requests, run:

```sh
CLAUDE_HUD_SOURCE=/path/to/claude-hud bun check-upstream.mjs
```

With Claude Code installed, append `--marketplace` to also test local marketplace registration, plugin installation, and removal in an isolated configuration directory. Use `--remote-marketplace` instead to test the published GitHub marketplace; it requires network access and the published plugin version must match this checkout.

For plugin manifest or marketplace changes, also run `claude plugin validate .` if Claude Code is installed. See [AGENTS.md](AGENTS.md) for the project structure and safe testing boundaries.
