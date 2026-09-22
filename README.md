# Thinkube Tandem

A VS Code extension and an MCP server for building a change with Claude Code, from what a person asks for to a delivery the person accepts.

**Tandem** is ground-truth-first pair development: you say what you want in
your own words; the machine grounds every intention in the actual code and
keeps it grounded; you sign a cut; workers build from exact work orders; you
accept the delivery by experiencing it.

Two gates, three artifacts:

- **Asks** — your words, verbatim.
- **Cuts** — what you signed to build now.
- **Deliveries** — what you accepted, with its proof.

Everything the machine derives carries a stamp proving what repo state it
was true for, and every artifact has two faces: a decision-sized abstract
for you, and the machine's data one gesture away.

## What it does

- **Runs go end to end:** sign, dispatch, closing gate, delivery, accept,
  merge. Two vetoes hold a delivery back: an unkept promise, and a product
  that does not build. Everything else the machine cannot settle rides the
  delivery as a finding for the person to weigh.
- **The Tandem view.** The *Tandem* icon in the activity bar opens two views.
  *Projects* shows products, the repositories filed under each, and their
  thinking spaces. *Configuration* shows the Claude Code configuration:
  hooks, commands, skills, agents, MCP servers and permissions, with
  commands to add, open and delete them.
- **The store.** Spaces, products and the defect ledger are kept in the
  tandem store, by default `~/thinkube-tandem-store`
  (`thinkubeTandem.storeRoot`).
- **The MCP server.** `out/mcp/server.js` serves Tandem's tools to Claude
  Code over stdio. The extension registers it in `~/.claude.json` as
  `thinkube-tandem`, through a path that each install points at the
  installed version. The server works on the same store as the editor, so
  the editor shows its changes. `src/surfaces/actions.ts` declares which
  actions are the person's alone, among them signing a cut and accepting a
  delivery. The server refuses those, and refuses any action not declared
  there.
- **Explorer menu.** *Claude Code → Open Here* on a folder in the Explorer.

## How it reaches a user

It is built into every code-server workspace. The code-server playbook of
[Thinkube](https://github.com/thinkube/thinkube)
(`ansible/40_thinkube/core/code-server/15_configure_environment.yaml`)
clones this repository, runs `scripts/deploy.sh --no-bump`, and code-server
installs the extension. The playbook `code-server/13_clone_repositories.yaml`
clones the store to `/home/thinkube/thinkube-tandem-store`, from
`<github_username>/thinkube-tandem-store` unless `THINKUBE_TANDEM_REPO`
names another repository. It is not installed on its own.

## MCP tools

Registered in `src/mcp/tools.ts`. Tools that act on a thinking space take
`space` (its name, as `list_spaces` reports it) and `repo` (the project
directory, when the server has no default from `--repo` or `TANDEM_REPO`).

| Tool | What it does |
|---|---|
| `list_products` | The products the store knows, and the repositories under each. |
| `new_product` | Makes a product. It only names it; nothing is created anywhere else. |
| `list_templates` | The starting points the platform offers for a new application, from thinkube-control's catalog. |
| `new_app` | Makes an application from a template: the platform creates the repository with its CI, it is cloned into `~/apps`, and it is filed under a product. `replace` deploys over an app the platform already knows. |
| `list_spaces` | Every enabled project and the thinking spaces under each. |
| `read_space` | A space's asks, how many promises were derived, its phase, open questions, and whether a signed cut is waiting. |
| `read_run` | The current or last run: every unit and its state, and the run's note. |
| `look_at` | Opens a deployed address and reports what a person would notice: a blank page, nothing to press, a page with no height, errors the page threw. Findings only. |
| `read_delivery` | The latest delivery: its proofs, its findings, and whether it was withheld. |
| `read_log` | The tail of a step's log, or of the run's own log when no step is given. |
| `save_draft` | Puts text in the capture box, one ask per line. It only drafts; turning drafts into asks is the person's act. |
| `read_asks` | Reads the recorded asks again, applies the reading, and groups the subjects into sets. |
| `group_into_sets` | Groups the subjects into sets to build one at a time. A person picks the set. |
| `reground` | Reads the code again and re-places every promise that has drifted. |
| `rerun` | Starts the signed work again and returns at once. Refused when nothing is signed or a run is in flight. |
| `full_rerun` | Starts the signed work again from nothing: the earlier run's branch is discarded and kept under a `discarded/…` tag. Same refusals as `rerun`. |
| `stop_run` | Asks the run to stop. The process that owns the run ends it at its next heartbeat. |
| `answer_worker` | Answers a parked worker's question, by unit id. |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `thinkubeTandem.storeRoot` | empty (`~/thinkube-tandem-store`) | Root of the tandem store. Spaces are kept at `<root>/spaces/<workspace>`. |
| `thinkubeTandem.groundingModel` | `opus` | Model for the grounding round. |
| `thinkubeTandem.volumeModel` | `sonnet` | Model for the volume rounds (classification, naming, answers, check proposals, repository digest). |
| `thinkubeTandem.workerModel` | `sonnet` | Base model for every run worker. |
| `thinkubeTandem.workerModelByRole` | `{}` | Per-role models that raise a role above the base, for example `{"judge": "opus"}`. |
| `thinkubeTandem.maxConcurrent` | `4` | Workers that run at the same time. |
| `thinkubeTandem.suiteCommand` | `npm test` | The project's test suite. Its verdict is a delivery proof. |
| `thinkubeTandem.prepareCommand` | empty | Build or typecheck command run before checks execute. |
| `thinkubeTandem.docsGateMode` | `blocking` | Whether an unmet documentation obligation blocks accepting a delivery (`blocking`) or not (`advisory`). Documentation is required for every cut at signing either way. |
| `thinkubeTandem.giteaToken` | empty | API token for the platform's Gitea. Not used for github.com remotes. |
| `thinkubeTandem.controlUrl` | empty | thinkube-control address for the template catalog. Empty reads the connected MCP server's config. |
| `thinkubeTandem.controlToken` | empty | thinkube-control API token. Empty reads the connected MCP server's config. |

## Documentation

- **Using Tandem:** the Antora site under [docs/](docs/) — start at
  [`docs/modules/tandem/pages/index.adoc`](docs/modules/tandem/pages/index.adoc).
- **Changing Tandem:** [docs/README.md](docs/README.md) maps the internal
  set. [`docs/PROCESS.md`](docs/PROCESS.md) is the operating design,
  [`docs/RULES.md`](docs/RULES.md) the eleven rules and what each one
  deletes, [`docs/TERMINOLOGY.md`](docs/TERMINOLOGY.md) the canonical
  vocabulary.
- **The specification:** `SPEC.md` in the tandem store — always that file,
  evolved by edits, never replaced by a successor document.

## Working on it

```bash
npm ci && npm --prefix webview/map ci
npm run compile                # tsc, then the map webview build
npm test                       # the suite, with TANDEM_NO_MODEL=1
npm run docs                   # the Antora site, into docs/build/site
npm run deploy                 # bump the patch version, build, test, package, install, commit and push
npm run deploy -- --no-bump    # install the version in package.json
```

`npm run deploy` runs `scripts/deploy.sh`, the same script in every Thinkube
extension. It needs the Node major version named in `.nvmrc`.
`scripts/deploy-hook.sh` adds this repository's steps: it installs the map
webview's packages, records the tool's own repairs in the store's defect
ledger, writes `out/builtFrom.json` with the repository the build came
from, and after the install points `extension-current` in the extension's
global storage at the installed version.

## License

Apache License 2.0 - See [LICENSE](LICENSE)
