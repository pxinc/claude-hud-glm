---
name: uninstall
description: Restore the status line that preceded the GLM quota integration.
disable-model-invocation: true
---

Run the following command once using the Bash tool, then report its output to the user:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/setup.mjs" uninstall
```

If the status line was changed after installation, report the error without overriding those changes. This restores the status line only; to remove the plugin itself, the user can then run `/plugin uninstall claude-hud-glm@claude-hud-glm-marketplace`.
