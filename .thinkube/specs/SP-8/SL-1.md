---
uid: read-a-thinking-space-s-board-from-the-central-r
parent: SP-8
status: done
satisfies:
  - 1
  - 3
verified_req_hash: 16a0c53e9dff89d8d5a6176b12909c6a22e2ea43
commit: 41e627bbe67666d182206e1fd14ad1bd9eba954f
---
# Read a Thinking Space's board from the central root

Add the `thinkube.boards.root` setting + env plumbing (KanbanMcpProvider/bundle.ts/vscodeStub), the host-agnostic namespace resolver (`<container>/<rel>` ↔ `<board-root>/<ns>/`), split ThinkubeStore's board-dir from repo-root, and redirect both discovery walks (navigator discoverRepos, MCP BoardRegistry) to enumerate boards under the central root.
Done: with boards at `<board-root>/<container>/<rel>/`, the navigator lists and opens each Thinking Space's board read from the central root — two spaces show together, labeled — nothing read from a co-located `.thinkube/`. (Satisfies AC #1, #3.)
