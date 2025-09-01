---
"@izumisy/kyrage": minor
---

Add `kyrage dev start` command for long-running development database instances. This command starts a development database with migrations applied by default and keeps it running for continuous development workflow.

## Usage Examples

```bash
# Start dev database with migrations applied (foreground mode)
kyrage dev start

# Start empty dev database without migrations (for fresh start)
kyrage dev start --no-apply

# When using reuse:true config, runs in background mode
# Otherwise runs in foreground with Ctrl+C cleanup
```

This complements the existing `kyrage generate --dev` workflow by providing a persistent development database instance that stays running between migration generations, improving developer productivity for iterative schema development.
