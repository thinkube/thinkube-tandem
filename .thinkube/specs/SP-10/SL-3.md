---
uid: 18-test-validates-the-board-repo-provisioning
parent: SP-10
status: done
depends_on:
  - SP-10_SL-1
  - SP-10_SL-2
satisfies:
  - 4
verified_req_hash: 0b18cda074e4a46ac40149fadff76728b7dd641e
commit: 15e1369f9a4dab0234d0e987452ade3237bd4f04
---

# 18_test validates the board-repo provisioning

Add board_repo vars + three kubernetes.core.k8s_exec assertions to 18_test.yaml (reusing code_server_pod_info): the board repo dir exists (test -d {{board_repo_path}}), the workspace has the "Tandem" root (grep thinkube.code-workspace), and User/settings.json has thinkube.boards.root (grep).
Done: 18_test.yaml asserts all three and passes on a real run against the live code-server. (Satisfies AC #4.)

**Delivered:** code in thinkube/thinkube#103 + #104 (board-test tags). Verified: `tk_ansible …/18_test.yaml --tags board-test` → all 3 board assertions green. (The full 18_test is blocked upstream by a pre-existing auth-redirect assert in the mid-migration cluster — out of SP-10 scope.)
