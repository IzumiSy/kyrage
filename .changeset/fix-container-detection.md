---
"@izumisy/kyrage": patch
---

Fix container detection for dev database commands by properly matching multiple Docker labels. This resolves the issue where users would see "No running dev containers found" even when containers were actually running.

The `kyrage dev status`, `kyrage dev clean`, and `kyrage dev get-url` commands were unable to detect running containers due to incomplete label matching in the container detection logic.
