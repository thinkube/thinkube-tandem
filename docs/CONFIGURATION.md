# What a repository tells Tandem about itself

> This analysis was made in a planning session, kept only in a plan file
> outside any repository, and very nearly lost — one plan file in that
> directory had already been overwritten once. It lives here now, beside the
> code it describes, because a document both of us must read cannot live
> somewhere only one of us can reach.
>
> **Read the two halves differently.** Everything outside "The six shapes,
> case by case" was read from this repository's code on 2026-08-31 and is
> current. That section is carried from the planning session: its facts were
> checked against the other repositories once, on a date nobody recorded, and
> have NOT been re-checked. Its "verified" labels mean somebody verified this
> then — not that it holds now. Re-checking it against
> `user-templates/`, `components/`, `thinkube-platform/` and `apps/` is the
> first work this document needs.

## The one decision underneath everything

Tandem was built for one shape of project: five shell commands proved in a
worktree, every promise settled by a check that runs here and now. The
platform has six shapes, and what a run may honestly do differs in each.

One function decides which: `downstreamOf(repoRoot)` in
[survey.ts](../src/run/survey.ts). It reads evidence in the repository and
returns one word. Nothing is chosen by a person, and nobody is told.

That word steers three things: the sentence grounding is given about where
this target settles what a worktree cannot run; what happens after an
accepted delivery; and — since the look was built — whether a browser is
driven against a URL derived from the remote.

## How each shape is recognised, today

Order matters and is load-bearing: an app in `apps/` still carries the
`manifest.yaml` of the template it was copied from, so the remote is asked
first. Otherwise every app is identified as a template.

| word | evidence | what the accept does today |
|---|---|---|
| `gitops-app` | the origin URL contains `/thinkube-deployments/` | watches the pipeline; stamps pending proofs; drives the look |
| `ansible-component` | a `copier.yaml` at the root | runs the component's `18_test.yaml` on the cluster |
| `template` | `manifest.yaml` with `kind: TemplateManifest` **and** a `thinkube.yaml` | nothing |
| `ansible` | any `18_test*.yaml` under `ansible/`, depth ≤ 4 | runs the component's `18_test.yaml` on the cluster |
| `package` | `src-tauri/` at the root or under `frontend/` | nothing — a person attests |
| `script` | none of the above | nothing |

**The evidence is not proportional to the consequence.** `template` needs two
agreeing facts and does nothing afterwards. `ansible` needs one filename
found by a walk and afterwards runs a playbook. `script` is the fallback, and
being wrong there is silent under-verification with no action — which makes
it the right default.

**And keep the stakes in proportion.** This is a development platform.
Nothing here serves customers, and the cost of a wrong answer is running it
again. Earlier drafts of this file called the cluster "live" and built
approval rules around it — production instinct imported into a workshop,
which manufactures machinery to manage risks that are not present. The
weight of a gate follows the cost of being wrong; here that cost is a
re-run.

Two consequences worth holding on to:

- A repository using a converging tool that is not Ansible — Terraform,
  Pulumi, kubectl, Helm — has no row here. With an ordinary remote and no
  `18_test.yaml`, no `copier.yaml` and no Tauri, it is `script`: the
  meta-development fallback. That is a question about this table, not about
  any runner.
- `gitops-app` derives the deployed URL as `https://<basename of the
  directory>.<platform domain>`. A directory whose name does not match the
  deployed app sends the look to a different app.

## The configuration that exists

Four surfaces, with four different provenances. Telling them apart is the
whole discipline.

**`.tandem/setup.json` — proved.** Written by the door the moment it proves
an answer on an untouched checkout: `provision`, `prepare`, `runOne`,
`build`, `suite`, `dependencies` and `builds` (both *watched*, not named),
and `parts` for a repository that is several toolchains. Its own doctrine
says it is never a configuration a person maintains, and a wrong file costs
one run before the door overwrites it.

`downstream` sits in that file and is the exception: it is a filesystem
inference wearing the same clothes and carried with the same authority as a
watched command. Grounding prefers the remembered value over a fresh survey,
so a wrong answer persists and a repository that changes shape keeps the old
word.

**`thinkube.yaml`, `manifest.yaml`, `copier.yaml` — authoritative, read
live.** The platform's own declarations. Read at the moment of use through
[thinkubeYaml.ts](../src/core/thinkubeYaml.ts) and never copied into
Tandem's files. A CI test command and its image live there and are read when
binding criteria, not persisted.

**`knip.json`, `tsconfig.json` — this repository's own gates.** `knip.json`
says what the reachability gate looks at; `tsconfig.json` says what ships.
Both were, until this week, quietly shaped around the problem rather than at
it: `src/engine` was excluded from the gate, and a dead CLI was declared an
entry point.

**Nothing is declared by a person.** There is no file in which somebody
writes what this repository is or how it should be verified. That is the gap
a testless workflow runs into: the sequence for a converging tool is neither
proved by watching nor readable from a platform manifest. It is declared, and
declaration currently has no home.

## The six shapes, case by case

Compiled from the planning session; facts verified against the real
repositories **as of that session**, not as of today.

### 0 — this extension (`script`)

Everything before the merge, all Tandem-driven, `deploy.sh` plus a reload.
The already-working case. Its wrinkle: deploying disturbs a run in flight, so
"deployed" here means the built bundle, served and driven, with no editor in
the way. Rollback is real — the last ten versions are kept and one a live
process is reading is never pruned.

### 1 — a template under development (`user-templates/tkt-*`)

**Verified.** Plain code, no jinja, no copier config — `copier.yml` is
*generated* at deploy time by control's `copier_generator.py`. Remote is
github.com. No CI of any kind; `test.enabled: false` in all three current
templates; no local runner. Control fetches `manifest.yaml` from
`raw.githubusercontent.com/<org>/<repo>/main`, so **only what is pushed to
`main` exists** as far as the platform is concerned.

A template is validated by deploying it. The intended harvest — call
`deploy_template` for a scratch app, follow `get_deployment_status` — **is
not built**; `harvest.ts` has no template harvester and nothing in the
source names `deploy_template`.

**Risk found:** the Dockerfile cannot build standalone (`ARG
CONTAINER_REGISTRY` with no default), and every validation is a full deploy.

### 2 — an app in `apps/` (`gitops-app`)

**Verified.** Push → Gitea webhook → Argo Events Sensor (a Lua filter skips
the adapter's own `.argocd-source-*` commits) → Workflow from the
`<app>-build` template → per container `test-<c>` then `build-<c>` with
`dependencies: [test-<c>]`, so **failing tests block the build** → Kaniko →
Harbor → the adapter commits `k8s/.argocd-source-<app>.yaml` pinning the new
tag and triggers an ArgoCD sync. `todo` has tests enabled for both
containers.

**Nothing in the pipeline calls control. Everything reads.** Checked
2026-08-31 in the files themselves, after a claim to the contrary was
recorded here and had to be withdrawn:

- Gitea's webhook targets `https://argo-events.<domain>/gitea`
  (`ansible/roles/gitea/configure_webhook/defaults/main.yaml`).
- `templates/k8s/build-workflow.j2` makes no outbound call but a `git clone`.
- The Harbor webhook adapter runs in the `argocd` namespace and reads
  workflow state from the Kubernetes API directly. Its header states its
  purpose: *"Bootstrap capability: Can deploy before thinkube-control
  exists."*
- Control's own CLAUDE.md agrees: *"CI/CD data is queried directly from
  Kubernetes (Argo Workflows)."*

So the chain is bootstrap-safe by design at every step, and control is a
reader of it. The CI/CD view in the editor reads that same Argo workflow
data. Tandem reads it from control over HTTPS with the token at
`~/.thinkube/api-token`; those endpoints carry no `operation_id`, so they are
not MCP-exposed.

Two facts about the working copy: the remote moves without Tandem (the
adapter's own build commits), so a run refreshes from origin first; and a
pre-commit hook regenerates `k8s/` when `thinkube.yaml` is staged.

This is the best fit for the whole loop and the case NEXT.md says to prove it
on, because deployment here is already automatic.

### 3 — thinkube-control (`ansible-component`)

**Verified.** The repository is itself a copier template; the runtime copy is
copier-overwritten and never edited. Its own `ansible/` directory is runtime
machinery control executes, **not** its deployment — deployment lives in the
core repo under `ansible/40_thinkube/core/thinkube-control/`, where the
orchestrator is `00_install.yaml` and the main deploy is `12_deploy.yaml`
(not `10_…`; three stale references were found). The documented dev loop is
`12_deploy_dev.yaml`. `18_test.yaml` exists as a post-deploy smoke test and
is not part of the orchestrator.

Tests today: 20 backend pytest modules and 2 Go proxy tests, in-cluster and
manual only; the frontend has vitest installed and no tests; no CI.

That is **more first-party testing than any other non-app case here** — the
templates and the installer have none — and no CI is the normal state of
everything that is not an app. Nothing about this repository is
badly-configured, and earlier drafts of this file said otherwise without
grounds.

**One constraint on Tandem, not a flaw in control:**
`backend/run_tests.sh` reads `DATABASE_URL` from the environment and
`DROP TABLE … CASCADE`s ten tables before pytest. That is ordinary test-suite
setup; it is only dangerous if something runs it blindly against whatever
`DATABASE_URL` happens to hold, which is what a worktree run would do. So the
rule belongs on the runner: this command is never auto-run. Giving it a test
database of its own is a natural early ask *for* control, and not a change
Tandem makes.

The person's own correction, recorded because it overrode a constraint the
machine had invented: this is deployed like a template, and downtime here is
acceptable — that is the owner's call, not the methodology's. Case 3 is
case 1, not a special case.

**Why control cannot become an app** (asked and answered 2026-08-31). It
shares the app architecture, so converting it looks attractive. It cannot,
and the reason is narrow: **the machinery that deploys an app lives inside
control** — creating the Gitea repository, generating the copier answers,
submitting the build workflow. Control cannot use its own machinery to
deploy itself, so it is deployed by ansible and copier instead.

It is *not* because the pipeline depends on control. It does not — see case 2
above, where every step is bootstrap-safe by design and the adapter says so
in its own header. An earlier version of this file gave that as the reason,
and it was wrong.

**Control already goes through the app build chain.** Per its own CLAUDE.md:
push to GitHub, run `12_deploy_dev.yaml`, and copier syncs to the runtime
location — after which a webhook triggers the Argo Workflow build and ArgoCD
deploys automatically. So it is not ansible-deployed end to end. Ansible
performs the copier sync; the same chain as an app does the rest.

Which makes the remaining gap small and concrete: control's containers are
built by the pipeline but nothing runs its tests there, because it has no
`thinkube.yaml` in which to declare `test.enabled` per container. Twenty
pytest modules run by hand for want of a file that every app and every
optional component already has.

### 4 — playbooks (`ansible`)

**Verified.** Convention per component: `00_install` (orchestrator, importing
10..17), `10_deploy`, `17_configure_discovery`, `18_test`, `19_rollback`
(destructive, explicit confirmation required). Seventeen optional components
follow it, with one deviation — prometheus has no VERSION file.
`18_test.yaml` runs `hosts: k8s_control_plane`: on the control-plane node,
over SSH, checking Kubernetes resources through that node's kubeconfig.

**This pod can run them, checked item by item:** `./scripts/tk_ansible`,
`~/.env` with `ANSIBLE_BECOME_PASSWORD`, `~/.venv` with ansible and
`kubernetes.core`, `sshpass`, the shared inventory, and SSH config with
per-node ProxyCommand and the cluster key — all present. **Assumed:** actual
reachability to `tkamd1` over the tailscale overlay was never exercised.

This is the case NEXT.md wants testless. Ansible is declarative, so a check
asserting what a task declares is testing Ansible rather than the work. The
verification is the tool's own, and it splits at the only line that matters —
side effects:

```
lint · syntax-check · --check --diff    changes nothing — safe before the merge
run · run again                          this IS the deploy — only after a
                                         person approves it
```

`failed=0` is the verdict; a second run reporting anything `changed` means
the playbook does not settle, which is a real defect nobody writes a test for.
Expect a first pass to flag every `shell`/`command` task with no `creates` or
`when` guard — correctly.

`18_test.yaml` survives for behaviour beyond declared state: the endpoint
answers, the token authenticates.

### 5 — the installer (`package`)

**Verified.** Tauri (deb/dmg), React 19 frontend (the README says Vue and is
stale), FastAPI backend bundled as a Tauri resource — 13 routers,
ansible-runner and asyncssh. **Zero first-party tests**: the only `*test*`
paths are a screenshot and a checked-in `venv-test/` inside the bundle path,
itself a packaging risk. No CI.

Headless development is explicitly supported — `scripts/dev-services.sh` runs
the backend and Vite as web services for headless boxes and Playwright-driven
sessions, and the seventeen wizard screenshots in its documentation were
produced that way. So the wizard is drivable here; the install itself is not.
Real validation is installing onto SSH-reachable Ubuntu servers, and the
delivery carries an attestation instead — `attest` in
[harvest.ts](../src/run/harvest.ts) is the built half of this case.

## Where the plan and the code have drifted

Named rather than quietly reconciled, because the drift is itself the
evidence for keeping this file in the repository.

- The plan calls the descriptor `.tandem/pipeline.json`. The code writes
  `.tandem/setup.json`.
- The plan's detection for `ansible` is "an `ansible/40_thinkube` tree". The
  code walks `ansible/` to depth 4 for any `18_test*.yaml` — much broader,
  and it is the branch that touches the cluster.
- The plan's harvest has four harvesters. Three exist: `gitops-app`,
  `ansible`/`ansible-component`, and the `package` attestation. The
  `template` harvester does not.
- The plan describes settling points, pending proofs and delivery grouping as
  changes to make; they are built.

## The boundary, drawn

The question that stalled the descriptor discussion — *what does a repository
declare about itself that no platform file already says?* — has an answer,
and it is not a new file.

**How it is made live, and how its own tool says the work holds.** Nothing
else. `thinkube.yaml` already says what the containers are and how the build
tests them; it said nothing about deploying, and nothing about repositories
whose work is declarative. It says both now:

```yaml
spec:
  deploy:
    run: bash scripts/deploy.sh      # or a playbook, or a call into control
    in: /elsewhere                   # when the command lives in another repo
    at: https://…                    # where the result can be seen
  verify:
    still: [ … ]                     # commands that change nothing
    apply: …                         # the command that does the work
    ask: …                           # what says whether anything is left
    settled: "changed=0"             # what that answer must say
```

The boundary is not which file. It is **who can know it**: a machine can
watch a command and learn what it produces, and that stays proved in
`setup.json`; only a person knows how a repository reaches production and
which tool converges it, and that is declared here.

Both are lists of commands rather than named methods, because a method name
is a branch waiting to be written. `makeLive` and `askTheTool` run the
strings and know what none of them mean — the check that proves it drives
ansible and terraform through the same code path with no branch between
them. Adding a tool is a line of configuration.

Two things this retired. The look was driving a URL assembled from the
directory name, and now uses the declared address. And this extension's own
`scripts/deploy.sh` had always worked while nothing knew about it, so
deploying was something a person remembered to do outside the loop; it is
one line of `thinkube.yaml` now.

## What is still open

- **`downstream` is still a guess.** The six-way filesystem inference in
  `survey.ts` remains, and it still decides what happens after an accept for
  repositories that declare nothing. Where a repository declares, the
  declaration wins and the guess stands down — so the guess retires by
  repositories saying what they are, one at a time, rather than by being
  deleted.
- **Two repositories have no `thinkube.yaml` at all** — the core playbooks
  and control. Control's containers are built by the pipeline but its tests
  never run there, for want of `test.enabled` in a file every app and every
  optional component already has. That is a file to write, not a problem to
  solve.
- **The flow is never shown to anyone.** It is chosen silently and is
  invisible until it acts.
