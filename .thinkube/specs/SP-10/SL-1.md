---
uid: deploy-creates-clones-thinkube-tandem
parent: SP-10
status: done
satisfies:
  - 1
verified_req_hash: 0b18cda074e4a46ac40149fadff76728b7dd641e
commit: 15e1369f9a4dab0234d0e987452ade3237bd4f04
---
# Deploy creates + clones thinkube-tandem

New clone_board_repo.sh.j2 (gh repo view || gh repo create {{github_org}}/{{board_repo_name}} --private, then clone/pull git@github.com:.../{{board_repo_name}}.git → {{board_repo_path}} over the github_ed25519 SSH key) + the render→kubectl cp→exec→cleanup block after the gh auth (15_configure_environment.yaml:772) + the per-repo git config core.sshCommand + board_repo_name/path vars (default thinkube-tandem).
Done: running the board provisioning creates thinkube-tandem in the org if absent and clones it to /home/thinkube/thinkube-tandem; a second run pulls (idempotent). (Satisfies AC #1.)

**Delivered:** code in thinkube/thinkube#103 (cross-repo, per the ADR-0006 exception — board lives here, code in core/thinkube). Verified live: cmxela/thinkube-tandem created (private) + cloned to /home/thinkube/thinkube-tandem; second run idempotent (pull, no duplicate).