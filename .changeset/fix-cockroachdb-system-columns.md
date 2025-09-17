---
"@izumisy/kyrage": patch
---

Fix CockroachDB dialect to filter out system-generated `rowid` column during introspection

CockroachDB automatically generates a `rowid` column for tables without an explicit primary key. This system-generated column was being included in introspection results, causing unwanted diffs between the actual database schema and user-defined configuration. The CockroachDB dialect now filters out the `rowid` column to match user expectations and prevent false positives in schema comparisons.
