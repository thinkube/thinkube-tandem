# code-server deploy provisions the sidecar board repo

The final piece of ADR-0008: the thinkube code-server deployment provisions the
central sidecar board repo, **`thinkube-tandem`**. Riding the existing SSH-key
clone loop and settings/workspace templating, the deploy creates `thinkube-tandem`
in the user's GitHub org if it's absent, clones it to
`/home/thinkube/thinkube-tandem` as a 4th workspace root, and points the
extension at it via `thinkube.boards.root`. This spec lives on the **extension's**
board (an exception to ADR-0006's per-project rule — thinkube/core isn't migrated
or clean yet) even though the deploy code lands in `core/thinkube`.

## Acceptance Criteria

- [x] Running the code-server config playbook **creates `thinkube-tandem` in the
      org if absent** (`gh repo create`) and **clones it to
      `/home/thinkube/thinkube-tandem`** — idempotent (a second run pulls, never
      errors or duplicates).
- [x] `thinkube-tandem` appears as a **"Tandem" workspace root** in the generated
      `thinkube.code-workspace` (a 4th folder alongside Apps / User-Templates /
      Platform).
- [x] The code-server `User/settings.json` sets **`thinkube.boards.root` =
      `/home/thinkube/thinkube-tandem`**, pointing the extension at the sidecar.
- [x] **`18_test.yaml` validates the provisioning** — `thinkube-tandem` cloned,
      workspace root present, setting configured — and passes on a real run.

## Constraints

- **Edit + commit in `core/thinkube`** — that repo is the source of truth; the
  installer clones it to `/tmp` for execution (never edit the `/tmp` clone).
  The spec lives on the extension board (the ADR-0006 exception), the code does
  not.
- **Reuse the deploy's existing seams** — the render→`kubectl cp`→`exec`→cleanup
  clone pattern, the in-pod `gh auth`, the workspace + `combine(recursive)`
  settings merge. No new deploy machinery.
- **Idempotent** — create-if-absent, clone-or-pull, and the settings merge
  preserves the user's existing keys.
- **The board-repo name is a variable** (`board_repo_name`, default
  `thinkube-tandem`); the path follows (`/home/thinkube/{{ board_repo_name }}`).
- **Least privilege / secrets** — reuse the installer-injected
  `github_token` / `github_org`; `no_log` the auth; never commit a token.

## Design

The deploy already clones repos via a render→`kubectl cp`→`kubectl exec`→cleanup
pattern over the `github_ed25519` SSH key
(`15_configure_environment.yaml:537-575`), authenticates `gh` in the pod
(`:763`), renders the workspace file to the host-mounted `shared-code` (`:985`),
and merges `User/settings.json` preserving custom keys (`:1070-1136`). SP-10
rides each seam.

**Clone + create.** A new `clone_board_repo.sh.j2` (modeled on
`clone_user_repos.sh.j2`) does create-if-absent then clone:
`gh repo view {{ github_org }}/{{ board_repo_name }} || gh repo create … --private`,
then clone `git@github.com:{{ github_org }}/{{ board_repo_name }}.git` to
`{{ board_repo_path }}` (idempotent: exists → pull). Its render→cp→exec→cleanup
block lands **after the `gh auth login` at `:772`** so `gh repo create` is
authenticated, plus the per-repo `git config core.sshCommand` for the new path
(mirroring `:730`). Vars `board_repo_name` / `board_repo_path` default in the
playbook `vars:` (`:24`) and `18_test.yaml` (`:23`); `github_org`/`github_token`
are installer-injected.

**Workspace root + setting.** Add a 4th
`{ "name": "Tandem", "path": "{{ board_repo_path }}" }` folder to
`thinkube.code-workspace.j2`, and `"thinkube.boards.root": "{{ board_repo_path }}"`
to `vscode-settings.json.j2` (merged into `User/settings.json` at `:1110`,
preserving existing keys).

**Validation.** `18_test.yaml` reuses the `code_server_pod_info` (`:214`) and
adds `kubernetes.core.k8s_exec` checks — `test -d {{ board_repo_path }}`, a grep
for the `"Tandem"` workspace root, and a grep for `thinkube.boards.root` in
`User/settings.json` — each `assert`ed.

**Verification:** run the board provisioning against this live code-server
(`./scripts/tk_ansible …/code-server/15_configure_environment.yaml`, the new
tasks tagged so they can run in isolation), then `…/18_test.yaml`. Running the
board step creates the real `thinkube-tandem` repo in the org (authorized).

**Spike:** confirm the `:763` `gh auth login` makes `gh repo create` work in the
pod exec, and that tagging the new tasks lets them run without re-running the
full environment config.

## File Structure Plan

All under `core/thinkube/ansible/40_thinkube/core/code-server/`:

- `templates/clone_board_repo.sh.j2` _(new)_ — create-if-absent (`gh`) +
  clone/pull over the SSH key.
- `15_configure_environment.yaml` — `board_repo_name`/`board_repo_path` vars
  (`:24`); the render→cp→exec→cleanup board block after the `gh auth` (`:772`);
  the per-repo `git config core.sshCommand` for the new path (`:730`).
- `templates/thinkube.code-workspace.j2` — the 4th "Tandem" folder.
- `templates/vscode-settings.json.j2` — `thinkube.boards.root`.
- `18_test.yaml` — board vars (`:23`) + the three `k8s_exec` assertions
  (`:232`).
