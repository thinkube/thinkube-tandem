---
uid: wire-the-extension-to-the-sidecar-workspace-root
parent: SP-10
status: done
depends_on:
  - SP-10_SL-1
satisfies:
  - 2
  - 3
verified_req_hash: 0b18cda074e4a46ac40149fadff76728b7dd641e
commit: 15e1369f9a4dab0234d0e987452ade3237bd4f04
---
# Wire the extension to the sidecar (workspace root + setting)

Add a 4th { "name": "Tandem", "path": "{{board_repo_path}}" } folder to thinkube.code-workspace.j2, and "thinkube.boards.root": "{{board_repo_path}}" to vscode-settings.json.j2 (merged into User/settings.json via combine(recursive), preserving the user's keys).
Done: after the deploy, the generated thinkube.code-workspace has the Tandem root and User/settings.json sets thinkube.boards.root = /home/thinkube/thinkube-tandem. (Satisfies AC #2, #3.)

**Delivered:** code in thinkube/thinkube#103. Verified live: after a real deploy, /home/thinkube/thinkube.code-workspace has the "Tandem" root and User/settings.json sets thinkube.boards.root = /home/thinkube/thinkube-tandem.