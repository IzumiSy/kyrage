---
mode: agent
model: Claude Sonnet 4
tools: ['codebase', 'changes', 'fetch', 'editFiles', 'get_issue', 'get_issue_comments', 'get_pull_request', 'get_pull_request_comments', 'get_pull_request_diff', 'get_pull_request_files', 'get_pull_request_reviews']
description: Create changeset for code modifications
---
You are tasked with writing a changeset markdown file under `.changeset` directory that should contain the code modifications made in the repository.

The changeset should basically be concise summary of the changes made in 1-2 lines, but it should also provide enough context for users to understand the impact of the changes.

Add examples if something new is introduced.
