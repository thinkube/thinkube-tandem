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
| `ansible-component` | a `copier.yaml` at the root | runs the component's `18_test.yaml` on the live cluster |
| `template` | `manifest.yaml` with `kind: TemplateManifest` **and** a `thinkube.yaml` | nothing |
| `ansible` | any `18_test*.yaml` under `ansible/`, depth ≤ 4 | runs the component's `18_test.yaml` on the live cluster |
| `package` | `src-tauri/` at the root or under `frontend/` | nothing — a person attests |
| `script` | none of the above | nothing |

**The evidence is not proportional to the consequence.** `template` needs two
agreeing facts and does nothing afterwards. `ansible` needs one filename
found by a walk and afterwards touches the live cluster. `script` is the
fallback, and being wrong there is silent under-verification with no action —
which makes it the right default.

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

**Progress is pushed to control; Tandem pulls it back out.** Corrected
2026-08-31 by the platform's owner — an earlier version of this file said
"pull-only, nothing reports back", which was wrong. Gitea, Argo and Kaniko
call control's API to register progress as a build moves, and the VS Code
CI/CD extension renders that flow. Tandem then reads it from control over
HTTPS with the token at `~/.thinkube/api-token`; those endpoints carry no
`operation_id`, so they are not MCP-exposed.

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

**Danger, verified:** `backend/run_tests.sh` reads `DATABASE_URL` from the
environment and `DROP TABLE … CASCADE`s ten tables before pytest — against
the live cluster PostgreSQL. Tandem must never run it as it stands. It was
recorded as a natural first ask *for* control, not as a Tandem change.

The person's own correction, recorded because it overrode a constraint the
machine had invented: this is deployed like a template, and downtime here is
acceptable — that is the owner's call, not the methodology's. Case 3 is
case 1, not a special case.

**Why control cannot become an app** (asked and answered 2026-08-31). It
shares the app architecture, so converting it looks attractive: it would
inherit the one chain that already works and gain the continuous integration
it has never had. It cannot, because the machinery that deploys apps lives in
control, and every build of every app calls control's API to register its
progress. An app-shaped control would participate in its own deployment, and
a broken control could not ship its own fix.

What remains available, and is the thing to look at instead: **testing and
deploying are separable.** Control's containers could be built and its tests
run the way an app's are — the half of the chain that ends at Harbor — while
deployment stays ansible and person-approved. That addresses twenty pytest
modules run by hand and touches the bootstrap not at all. Whether the
platform can express "test and build me, do not deploy me" is unchecked; it
is the same shape as the per-container `test.enabled` flag, one level up.

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

## What is still open

- **A converging tool that is not Ansible has no row.** The shape is general
  — validate, preview, apply, ask again and be told nothing is left to change
  — and the tool knowledge belongs in configuration, not in code.
- **Declaration has no home, and the discussion that would give it one was
  never finished.** The proposal was that a repository declares itself once —
  per-part commands, watched outputs, dependencies, how it deploys — with the
  door proving it and stamping `provenAt`, instead of the inference we have
  now. Inference is why `out` was never lent: `builds` listed `out-test`
  because a build was watched producing it, and omitted `out` because nobody
  watched the product build.

  The objection that stopped it: for anything template-shaped, much of that
  already lives in `thinkube.yaml` — containers, test commands, images. A
  descriptor restating them breaks the rule the whole design rests on, that
  those files are read at the moment of use and never copied.

  So the shape was right and the boundary was never drawn. The open question
  is **what a repository declares about itself that no platform file already
  says** — and a converging tool's sequence is the first concrete answer,
  because it is neither watched into existence nor written in
  `thinkube.yaml`.
- **The flow is never shown to anyone.** It is chosen silently and is
  invisible until it acts on the world. The weight of a gate is set by the
  cost of being wrong; the evidence required to pick a flow is not.
