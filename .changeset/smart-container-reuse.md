---
"@izumisy/kyrage": minor
---

Replace configuration-based container reuse with smart runtime detection. The `generate --dev` command now automatically detects and reuses containers started by `dev start`, falling back to one-off containers when none are running.

**New behavior:**
- Removed `reuse: true` configuration option from dev container config
- Added `kyrage dev start` command to start persistent containers with migration baseline
- `kyrage generate --dev` automatically detects running dev-start containers
- Smart fallback to temporary one-off containers when dev-start not available

**Example workflow:**
```bash
# Start persistent dev container
kyrage dev start

# Generate migrations - automatically reuses dev container. Without dev start, creates temporary container
kyrage generate --dev
```
