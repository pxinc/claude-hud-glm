---
name: setup
description: Set up GLM quota bars in the existing Claude HUD status line.
disable-model-invocation: true
---

Run the following command once using the Bash tool, then report its output to the user:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/setup.mjs" install
```

If it fails, report the actual error. Do not modify the user's configuration manually or retry automatically. The installer checks prerequisites and preserves the previous status line for restoration.
