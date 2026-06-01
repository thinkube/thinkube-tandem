# Integration Plan: thinkube-ai-integration

> Revision 5 — adds the **Claude Code methodology bundle** (the `.claude/` half of the product) alongside the GitHub-native methodology and `.thinkube/` overflow store.
> Start with [`docs/VISION.md`](VISION.md) (mission/vision) and [`docs/METHODOLOGY.md`](METHODOLOGY.md) (the method); this file is the technical plan. Companion: issue [`thinkube/thinkube-control#9`](https://github.com/thinkube/thinkube-control/issues/9). (The earlier `REDESIGN_PROPOSAL.md` — a worktree/agent-workspace vision — was superseded by this plan and removed.)

This extension supports a **pair-programming methodology** in which a human and Claude Code work together across an **epic → story → spec → task** hierarchy. The kanban board is _one_ surface inside this methodology — the most visible one, but not the goal.

The goal is the methodology. The kanban, the roadmap, the MCP server, the spec files, **and the pre-authored Claude Code configuration** (agents, skills, hooks, settings, CLAUDE.md fragment): all of them exist to make the methodology smooth.

**Source of truth: GitHub.** Issues, sub-issues, Projects v2, milestones, comments — everything that fits there, lives there. **Overflow: the same repo's `.thinkube/` folder** (versioned alongside the code). **Claude's behaviour: a methodology bundle the extension installs into the project's `.claude/`.** No custom backend, no external service.

This plan folds together:

1. The **pair-programming methodology** + epic→story→spec→task hierarchy (§0).
2. The **Claude Code methodology bundle** — the pre-authored agents/skills/hooks/settings that make Claude an active participant in the methodology (§3, new in rev 5).
3. The **kanban + MCP-server** capability from issue #9, scoped to Task-level (§5–§6 onward).
4. The **config-manager redesign** (existing tree + chat) — repurposed in rev 5 as the inspector/editor for the methodology bundle (§3.3).
5. The **process-wrapper launcher** (replaces the terminal launcher).

**Market position (May 2026):** the combination of _Claude-Code-native + GitHub-Issues-anchored + kanban-aware + pair-programming-shaped (not autonomous-dispatch)_ is currently unoccupied. cc-sdd and BMAD-METHOD are the closest skill bundles but neither anchors to GitHub Issues or ships a kanban; GitHub Copilot Workspace is the closest competitive offering but it's Microsoft-controlled and not an open extensibility bundle. See §3.7 for full landscape.

---

## 0. The methodology (the goal)

### 0.1 Pair programming, human + AI

- **Navigator** — the human. Decides what to build, in what order, whether it's good enough. Owns scope.
- **Driver** — Claude Code (the live, interactive session in the editor). Implements, tests, manages mechanical board state via MCP tools.
- These roles **swap** depending on the layer of work:

| Layer     | Navigator                                                                                       | Driver                        |
| --------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| **Epic**  | Human (always). Claude proposes; human decides.                                                 | Claude drafts the artifact.   |
| **Story** | Human.                                                                                          | Claude drafts, human refines. |
| **Spec**  | Mixed. Often Claude drafts the technical bones; human owns the constraints/acceptance criteria. | Claude.                       |
| **Task**  | Claude (drives the loop). Picks up the next Ready task, codes, moves cards.                     | Claude. Human reviews.        |

The board surfaces the work; the chat is where the pair-programming happens. The extension's job is to make the artifacts the pair produces — epics, stories, specs, tasks, ADRs, retros — first-class, navigable, and reviewable.

### 0.2 The hierarchy

```
Epic                                  (an initiative — "rebuild auth")
  ├── Story                           (a slice of value — "log in with Google")
  │     ├── Spec                      (a technical contract — design, constraints, acceptance)
  │     │     ├── Task                (a unit of work — "OAuth callback handler")
  │     │     ├── Task
  │     │     └── Task
  │     └── Spec
  └── Story
        └── Spec
              └── Task
```

Each level is a **conversation between human and Claude** that produces a durable artifact (a GitHub issue + optionally a markdown file). The artifact at each level is what the next level's conversation starts from.

### 0.3 Where things live (data model)

**Hierarchy in GitHub** (issues + sub-issues + Projects v2):

| Concept                          | GitHub representation                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic                             | Issue with type `Epic` (or label `epic` if Issue Types not enabled).                                                                                                                                                                                |
| Story                            | Issue with type `Story` (or label `story`), **sub-issue of** an Epic.                                                                                                                                                                               |
| Spec                             | Issue with type `Spec` (or label `spec`), **sub-issue of** a Story.                                                                                                                                                                                 |
| Task                             | Issue with type `Task` (or label `task`), **sub-issue of** a Spec.                                                                                                                                                                                  |
| Sprint / Release                 | Milestone. Cards (any level) can belong to a milestone.                                                                                                                                                                                             |
| Kanban column (Task-level)       | Projects v2 single-select field `Status` with options: Spec, Ready, In Progress, Review, Verify, Done. _(Note: the column name "Spec" here is the **status** of a Task that's awaiting its spec to be finalized — distinct from a Spec **issue**.)_ |
| Comments / decisions in dialogue | Issue comments.                                                                                                                                                                                                                                     |
| Cross-cutting tags               | Labels.                                                                                                                                                                                                                                             |

**Overflow in the repo** (everything that doesn't fit cleanly in an issue):

```
my-app/
├── src/                           ← code
└── .thinkube/                     ← methodology artifacts, versioned with the code
    ├── epics/
    │   └── EP-12.md               ← long-form epic doc (vision, scope, constraints)
    ├── stories/
    │   └── ST-34.md               ← user story + full acceptance criteria
    ├── specs/
    │   ├── SP-50.md               ← technical spec / design doc
    │   └── SP-50-tasks.md         ← task decomposition; materialised into Task issues by chunk 9
    ├── decisions/
    │   └── ADR-001-auth-flow.md   ← architectural decision records
    └── retros/
        └── 2026-05-19.md          ← retrospective notes
```

**The folder convention is fixed.** The extension owns the schema; users don't reconfigure paths. This keeps MCP-tool prompts predictable across projects.

**Frontmatter convention** (every `.thinkube/` markdown file):

```yaml
---
kind: epic | story | spec | task-decomposition | decision | retro
issue: 12 # the GitHub issue number this extends
parent_issue: 7 # optional: the parent in the hierarchy
repo: owner/name # optional but recommended
status: draft | active | done # for retros / decisions; not for issue-backed kinds
---
```

The frontmatter is what lets us round-trip between a card on the board and the file on disk — open a card, jump to its `.thinkube/` file; edit the file, the card shows the latest body.

### 0.4 Day-in-the-life — Tuesday morning, building

Alex opens VS Code in `~/my-app`. The extension has three surfaces:

- **Roadmap panel** (left) — tree of Epics → Stories → Specs.
- **Kanban panel** (center, when opened) — Tasks flowing through Spec → Ready → In Progress → Review → Verify → Done.
- **Claude Code chat** (right) — the interactive session.

Alex's last-week work landed `Spec SP-50 "Google OAuth flow"` into the Ready column with five Tasks. They open Claude Code (the absorbed launcher cd's into the repo):

> _"Pick up the next Ready task under SP-50."_

Claude (same chat) calls MCP `list_board(filter: {parent_spec: 50})`, sees `Task #74 "OAuth callback handler"` is top of Ready, calls `move_task(74, "In Progress")`. The card slides in the kanban in front of Alex. Claude reads `.thinkube/specs/SP-50.md` for the design context, reads issue #74's body for the task's acceptance criteria, edits files. Alex watches the diff stream by in the chat, types clarifications when needed.

When Claude is satisfied, it calls `add_comment(74, "Diff: src/auth/oauth/* ...")` and `move_task(74, "Review")`. Alex switches to the kanban, opens the card, scrolls the diff, drags it to Verify. The host shells out `npm test`; on green, the card auto-advances to Done. Issue closes on GitHub. The kanban refreshes via polling within ~30s; or Alex hits refresh.

### 0.5 Day-in-the-life — Sunday evening, planning

Alex wants to plan a new initiative. They open the Roadmap panel, click "+ Epic". A side editor opens with a frontmatter+markdown template. Alex types a one-paragraph pitch and pings Claude:

> _"Help me shape this Epic into stories. We want to support multi-tenant orgs."_

Claude reads the draft via `get_epic_draft()`, asks two clarifying questions in chat, then calls `create_epic(title, body)` — which produces:

- A GitHub issue with type `Epic`, body filled in.
- A new file `.thinkube/epics/EP-{newIssueNumber}.md` with extended detail, frontmatter linking back.

The Epic appears in the Roadmap. Alex and Claude continue the dialogue, producing Stories (each one a `create_story_under_epic(EP-..., title, body)` call from Claude). Each Story shows up in the tree under the Epic.

For one of the stories, Alex says _"break this one into specs."_ Claude proposes 2-3 specs in chat, Alex accepts, Claude calls `create_spec_under_story(...)` for each. Each Spec gets its own `.thinkube/specs/SP-{n}.md` file. The specs sit in the Roadmap awaiting decomposition into tasks — that's the next pair-programming session, driven by the bundle's `/spec-prepare` and `/tasks-decompose` skills, producing a `SP-{n}-tasks.md` file that the chunk-9 materialiser turns into Task issues in Ready.

### 0.6 What this is **not**

- Not autonomous-agent dispatch. `ai-agent-board` does that; we don't.
- Not a Claude Code replacement. Claude Code runs the show; we give it MCP tools and the human a board.
- Not a custom backend. No SQLite, no Postgres, no Postgres adapter. GitHub + repo files.
- Not a methodology straitjacket. The hierarchy is opinionated, but the dialogues at each level are free-form pair programming. We just make the artifacts first-class.

---

## 1. Goals & non-goals

### Goals (this cycle, MVP)

- The **GitHub-native data model** in §0.3 is implemented end-to-end: read epics, stories, specs, tasks via Issues + Sub-issues + Projects v2; write the same.
- The **Roadmap panel** renders the Epic→Story→Spec tree and supports navigation + creation.
- The **Kanban panel** (forked from `mayank1513/vscode-extension-trello-kanban-board`) renders Tasks flowing through the six methodology columns; drag-and-drop drives the Projects v2 Status field.
- The **`.thinkube/` overflow store** is read, written, and watched by the extension. Frontmatter binds files to issues.
- The **MCP server** exposes tools at every layer (epic / story / spec / task) for the Claude Code session.
- **Spec-tasks materialiser**: when a `SP-{n}-tasks.md` file lands under `.thinkube/specs/`, we offer to materialise the tasks as GitHub Task issues + place them in the Ready column. The bundle's `/tasks-decompose` skill is the canonical producer of these files; the materialiser doesn't care who wrote it.
- **Launcher**: the terminal-based `Ctrl+Shift+C` launcher is replaced by a process-wrapper approach (correct cwd on new + resume).
- Must run in **code-server** (browser VS Code).
- Preserve **merge-don't-replace** discipline for `.claude/settings.json`.

### Non-goals (this cycle)

- Worktree manager, agent workspaces, template browser (the earlier Era-1 vision) — deferred.
- Autonomous task dispatch / background agents (the `ai-agent-board` pattern) — out of scope.
- Multi-agent personas (BMAD's PM/Architect/Developer) — defer; methodology may inspire later.
- Custom authentication. Reuse `gh auth` / `GITHUB_TOKEN` / VSCode `SecretStorage`.
- Migrating `ChatPanel` / `ConfigTreeProvider` to React. Only the new Roadmap + Kanban panels are React.

---

## 2. Reuse — what we keep, what we don't

Issue #9 lists four prior-art projects. They were cloned under `/Users/alexmc/Developer/` for analysis.

### 2.1 `mayank1513/vscode-extension-trello-kanban-board` — **REUSE THE DESIGN, NOT THE APP**

- MIT, marketplace-published v0.8.2 VSCode extension.
- React + Vite + `react-beautiful-dnd` for drag, markdown rendering, theming, color picker.
- Clean split: `extension/panel.ts` (118 lines, WebviewPanel host with `MessageType` protocol) + `src/` (React app).
- Data model `Board { columns, tasks }` maps directly to what we need for the Task-level kanban.
- **Reuse (corrected):** the upstream is a _Trello clone_ — user-editable columns, free
  HSL color picker, ~13 deps (particles, webgl trails, toastify, theme switcher). Our
  model is different: **fixed 6 methodology columns; cards are GitHub-issue-backed and
  the board is a two-way PM editor** (see `docs/VISION.md`). So we **reuse the upstream's
  visual design + markdown rendering**, on **our own data model and `postMessage`
  protocol** — we do **not** vendor its app or gimmick deps. Keep: card/column look,
  drag-and-drop (`@hello-pangea/dnd`), **markdown**, and "theme system" = inherit VS
  Code's CSS variables (not a bundled theme switcher). Storage is the
  `GitHubProjectsAdapter`. (Note: an earlier pass shipped a from-scratch minimal board
  with no markdown — being corrected to this.)

### 2.2 `DanWahlin/ai-agent-board` — **DIFFERENT PROBLEM**

- Standalone web app (Express + React + WebSockets + SQLite/Postgres + xterm.js).
- Fires off autonomous agents from a kanban (Copilot / Claude Code / Codex / OpenCode).
- **Wrong UX for us.** Our flow is interactive pair programming. Their flow is fire-and-watch autonomy. Adopting their patterns would push us away from the methodology the user wants.
- **Action:** read once, do not pattern-copy. Park in `docs/REFERENCES.md` if/when we ever consider background dispatch.

### 2.3 `gotalab/cc-sdd` — **CONSIDERED, DECLINED**

- MIT npm package (`cc-sdd@latest`) installing ~17 Claude Code skills implementing the Kiro IDE's spec-driven flow: `/kiro-spec-init`, `/kiro-spec-requirements`, `/kiro-spec-design`, `/kiro-spec-tasks`, etc.
- **Considered as a hard dependency in earlier revs of this plan; declined after deeper review.** Two compounding reasons:
  1. **Methodology shape mismatch.** cc-sdd splits a spec into three local files (`requirements.md` + `design.md` + `tasks.md`) and tracks phases via a local `spec.json` with approval booleans. Thinkube's spec is **one GitHub issue + one `.thinkube/specs/SP-{n}.md` sidecar**, and phase tracking **is the Projects v2 Status field** (Spec / Ready / In Progress / Review / Verify / Done). The cc-sdd prompts are tightly coupled to their `{{KIRO_DIR}}/specs/`, `{{KIRO_DIR}}/settings/templates/`, `{{KIRO_DIR}}/steering/` infrastructure — there's no clean path to fork just a prompt without dragging that directory tree through.
  2. **Competitive positioning.** Thinkube positions itself against Kiro. Making a hard dependency on a Kiro-derivative package (skills literally named `/kiro-*`, docs that point at "Kiro provenance") would train users to think of spec-driven development as "the Kiro way" — free marketing for the competitor. Even with renaming under MIT, the lineage shows in code reviews, onboarding, and conversations.
- **What we keep from the comparison:** two methodology principles that aren't prompt text and carry no lineage —
  - **Task sizing:** atomic tasks ~1–3 hours each.
  - **Parallel marker:** the `(P)` annotation in our own tasks-list format flags tasks that can run concurrently with their siblings.
- **What we own instead:** the methodology bundle (§3) authors the spec-preparation and task-decomposition skills in-house, designed against Thinkube's issue-backed spec model and Projects v2 phase tracking from day one.

### 2.4 `bmad-code-org/BMAD-METHOD` — **METHODOLOGY INSPIRATION**

- MIT Node CLI installing an "Agile AI-driven Development" methodology with 12+ specialized agent personas (PM, Architect, Developer, UX, …) and structured workflows across analysis / planning / architecture / implementation.
- **Relationship to us:** BMAD is methodology-as-CLI; we're methodology-as-VSCode-extension-with-GitHub-backing. The personas are markdown — interesting but not directly reusable as code.
- **Action:** _steal the methodology shape, not the implementation._ Specifically:
  - The **analysis → planning → architecture → implementation** phasing maps roughly onto our **epic → story → spec → task** hierarchy.
  - The **persona** idea is a possible future feature (`Mode: ask the Architect persona` toggle in the kanban) — defer.
  - We document explicitly in `docs/METHODOLOGY.md` that BMAD-METHOD is an _upstream methodology source_ the user can choose to adopt; nothing in our extension prevents using it on top.
- **No code dependency. No personas shipped.**

### Summary

| Concern                                                                          | Source                      | Action                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Kanban UI (Task layer)                                                           | `trello-kanban-board`       | **Reuse its visual design + markdown** on our own data model/protocol; not a verbatim fork.   |
| Roadmap UI (Epic→Story→Spec tree)                                                | (none)                      | **Build** — simple TreeView or a small React component.                                       |
| GitHub data layer (issues, sub-issues, Projects v2)                              | (none)                      | **Build** — Octokit GraphQL + REST.                                                           |
| Spec → tasks decomposition                                                       | (none)                      | **Author in-house** as part of the methodology bundle (§3).                                   |
| Methodology framing (epic→story→spec→task, navigator/driver)                     | `BMAD-METHOD` (inspiration) | **Reference** in `docs/METHODOLOGY.md`; no code dep.                                          |
| Claude Code skills/agents/hooks for the methodology (the **methodology bundle**) | (none)                      | **Author + ship** under `templates/methodology-bundle/`. See §3 — this is the rev-5 addition. |
| In-process MCP server                                                            | (none)                      | **Build**.                                                                                    |
| Autonomous dispatch                                                              | `ai-agent-board`            | **Not in scope.**                                                                             |

---

## 3. The Claude Code methodology bundle

The methodology in §0 only works if Claude Code is actually configured to play along. Empty `.claude/` means Claude doesn't know about the epic/story/spec/task hierarchy, doesn't have shortcuts for the common operations, has no idea what "navigator mode" means, and won't reach for our MCP tools without being told to.

So the extension ships a **pre-authored bundle** of Claude Code configuration that, when installed into a project, makes Claude an active participant in the methodology. This is the missing piece between "we describe a methodology" and "Claude actually behaves that way in dialogue." It is also the **purpose the existing config tree was always reaching for** — the tree's job becomes "inspect and edit the bundle that powers the methodology" instead of generic `.claude/` CRUD.

The bundle's composition is anchored to current Anthropic guidance (May 2026) — citations in §3.7. Three guidance points dictate the shape:

1. **Slash commands have been merged into skills.** `.claude/commands/*.md` still works but is deprecated; the canonical primitive is `.claude/skills/<name>/SKILL.md` (slash-invocable). The bundle ships skills only.
2. **Prefer `gh` CLI inside skills over MCP for one-shot GitHub reads.** Our MCP server is for _shared live state with the kanban panel_; for "create an issue" the skill just shells out.
3. **Hooks are for actions that must happen every time with zero exceptions.** MVP ships one hook only.

### 3.1 What's in the bundle

**Skills** (`.claude/skills/<name>/SKILL.md`; slash-invocable unless marked otherwise).

The bundle owns the full methodology end-to-end — no peer skill pack, no upstream chase. Skills are authored against Thinkube's actual data model (one GitHub issue per layer + `.thinkube/*.md` sidecar; Projects v2 Status as the phase model).

| Skill                       | Purpose                                                                                                                                                                                                                                   | Layer         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `/epic-new`                 | Create a typed `epic` issue from a brief; writes `.thinkube/epics/EP-{n}.md`.                                                                                                                                                             | Epic          |
| `/story-new`                | Split an epic into story issues with acceptance criteria; writes `.thinkube/stories/ST-{n}.md`.                                                                                                                                           | Story         |
| `/spec-prepare <story>`     | Walks the user through filling a `.thinkube/specs/SP-{n}.md` body for an existing Spec issue: acceptance criteria checklist, constraints, design notes, file plan. Authored against our spec shape (one issue + one sidecar).             | Spec          |
| `/tasks-decompose <spec>`   | Reads a Spec, decomposes into 4–12 atomic tasks (~1–3h each), detects parallel-eligible tasks, writes `.thinkube/specs/SP-{n}-tasks.md` in Thinkube's tasks-list format (checkbox list, optional `(P)` marker, optional dependency hint). | Spec → Task   |
| `/tasks-materialize <spec>` | Triggers the chunk-9 materializer: creates GitHub Task sub-issues from the tasks file and places them in the kanban Ready column.                                                                                                         | Task          |
| `/pair-start <story>`       | Load steering + spec + tasks; enter pair-programming mode for that story.                                                                                                                                                                 | Orchestration |
| `/pair-next`                | Advance to the next Ready task with verification gate; delegates to `verifier` subagent.                                                                                                                                                  | Orchestration |
| `/board`                    | Open the kanban panel (alias for the `Open Kanban` command).                                                                                                                                                                              | Orchestration |
| `/retro`                    | Facilitate retrospective; append to `.thinkube/retros/{YYYY-MM-DD}.md`.                                                                                                                                                                   | Orchestration |
| `/pair-start-quick <desc>`  | Ceremony defuser: collapses spec-prepare → tasks-decompose → tasks-materialize into a single inline flow for small bugfix-shape work, then drops into pair-programming mode. See §3.4.                                                    | Quick path    |
| `methodology-context`       | `user-invocable: false` — vocabulary + state machine + workflow descriptions. Loaded on demand by other skills.                                                                                                                           | Reference     |
| `repo-conventions`          | `user-invocable: false` — branch/PR/commit conventions for this project.                                                                                                                                                                  | Reference     |

**Subagents** (`.claude/agents/<name>.md`):

| Agent      | Role                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| `explorer` | Read-only codebase research; preserves the main pair-programming context.                    |
| `reviewer` | Adversarial review of a diff against the story's acceptance criteria.                        |
| `verifier` | Runs `npm test` / `pytest` / `cargo test` etc. + lint/typecheck; returns pass/fail evidence. |

(cc-sdd and BMAD ship **zero subagents**, a real gap we fill. Subagents preserve main context for side tasks — Anthropic's recommended pattern when a side task would flood the chat.)

**Hook** (`.claude/settings.json`):

| Event          | Action                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart` | Shell out `gh issue list --label in-progress --json number,title,labels` and inject the result as system context. Claude knows what's hot the moment the session opens. |

(`PostToolUse: Edit|Write` lint/test hooks are explicitly **v2** per Anthropic's "every time, no exceptions" rule — premature in MVP.)

**`.claude/settings.json` permissions** (merged into the user's existing settings, never replacing):

```json
{
  "permissions": {
    "allow": [
      "Bash(gh issue:*)",
      "Bash(gh pr:*)",
      "Bash(gh project:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(npm test:*)",
      "Bash(pytest:*)",
      "Bash(cargo test:*)",
      "Read",
      "Grep",
      "Glob"
    ],
    "deny": ["Bash(rm -rf:*)", "Bash(git push --force:*)"]
  }
}
```

**`.mcp.json`** — pre-register our MCP-2 endpoint (kanban tools) for the project so Claude discovers them without manual config.

**`CLAUDE.md` fragment** (under ~30 lines, delimited block, idempotent):

```markdown
<!-- thinkube-methodology:start v1.0.0 -->

## Thinkube methodology

We pair-program human + Claude on a GitHub-Issues-backed kanban.
Hierarchy: epic → story → spec → task.

- Source of truth: GitHub Issues (typed Epic/Story/Spec/Task; sub-issue links).
- Sidecar: .thinkube/{epics,stories,specs,decisions,retros}/\*.md, frontmatter-linked to issues.
- Specs live as one issue + one .thinkube/specs/SP-{n}.md, decomposed into .thinkube/specs/SP-{n}-tasks.md (checkbox list, optional `(P)` for parallel-eligible).
- Phase model: the Projects v2 Status field. Columns Spec / Ready / In Progress / Review / Verify / Done are the methodology's state machine.

Skills (all owned by this bundle):

- /epic-new, /story-new — top of the hierarchy.
- /spec-prepare, /tasks-decompose, /tasks-materialize — spec authoring → tasks list → GitHub Task issues + Ready column.
- /pair-start, /pair-next, /board, /retro — pair-programming orchestration over the workflow.
- /pair-start-quick — ceremony defuser for small bugfix-shape work.

Subagents:

- explorer — read-only codebase research; preserves main context.
- reviewer — adversarial diff review against acceptance criteria.
- verifier — runs tests + lint + typecheck; returns pass/fail evidence. Gates Review → Verify.

Rules:

- Verify every task: tests + lint + typecheck before marking done. No green = not done.
- Never push to main; always open a PR.
- Mode awareness: in navigator mode you may read and propose, but not write the board or files.
<!-- thinkube-methodology:end -->
```

### 3.2 Where the bundle lives in the extension repo

```
thinkube-ai-integration/
└── templates/
    └── methodology-bundle/
        ├── VERSION                    "1.0.0" — stamped into installed projects
        ├── manifest.json              what files belong to the bundle (for drift detection)
        ├── skills/
        │   ├── epic-new/SKILL.md
        │   ├── story-new/SKILL.md
        │   ├── spec-prepare/SKILL.md            # walks the user through filling SP-{n}.md
        │   ├── tasks-decompose/SKILL.md         # decomposes a spec into SP-{n}-tasks.md
        │   ├── tasks-materialize/SKILL.md       # triggers chunk-9 materialiser → Task issues
        │   ├── pair-start/SKILL.md
        │   ├── pair-next/SKILL.md
        │   ├── pair-start-quick/SKILL.md        # ceremony defuser — collapses spec/tasks/materialise inline
        │   ├── board/SKILL.md
        │   ├── retro/SKILL.md
        │   ├── methodology-context/SKILL.md
        │   └── repo-conventions/SKILL.md
        ├── agents/
        │   ├── explorer.md
        │   ├── reviewer.md
        │   └── verifier.md
        ├── settings.json              fragment to merge into .claude/settings.json
        ├── mcp.json                   fragment to merge into .mcp.json
        └── CLAUDE.md                  delimited block to insert/update
```

### 3.3 Install / update / drift handling

Install is a non-destructive merge driven by `ClaudeConfigService` (the existing service that already preserves unknown fields). The flow:

1. Copy `skills/*` and `agents/*` to the project's `.claude/skills/` and `.claude/agents/`. Each file gets a frontmatter line `thinkube-bundle: 1.0.0` so we can detect drift.
2. `settings.json` permissions: merge our `allow`/`deny` arrays into the user's (de-dup; never overwrite user entries).
3. `mcp.json`: add our entry under `mcpServers.thinkube-kanban`; never touch other entries.
4. `CLAUDE.md`: insert/update the `<!-- thinkube-methodology:start -->` … `<!-- thinkube-methodology:end -->` block. Idempotent.
5. Stamp `.thinkube/.bundle-version` with installed version + install date.

Drift detection (on activation, lazily): compute a manifest hash of installed bundle files vs. the version stamped in `templates/methodology-bundle/`. Four states surfaced as a top-level node "Thinkube Methodology Bundle" in the existing config tree (the new home for the tree that previously felt purposeless):

| State                | UI                                                                         |
| -------------------- | -------------------------------------------------------------------------- |
| **Not installed**    | "Install Thinkube Methodology Bundle" button + brief explanation           |
| **Up to date**       | Green check; "Bundle v1.0.0 installed (12 skills, 3 agents)"               |
| **Update available** | Amber dot; "Bundle v1.0.0 → v1.1.0 — view diff, update"                    |
| **Locally modified** | Blue dot; "Bundle v1.0.0 (3 files modified). Diff · Re-apply · Keep local" |

Expanding the node shows the bundle's files grouped by category (Skills, Subagents, Settings, MCP entry, CLAUDE.md fragment). Each leaf shows install/modified/missing status individually. Non-bundle user-authored files still show in the existing categories (Skills, Agents, Commands, Hooks, MCP) and are clearly distinguished.

### 3.4 The `--quick` path (ceremony defuser)

The four-tier hierarchy is overkill for solo bugfix work. `/pair-start-quick "fix the login redirect bug"` collapses the ceremony into a single inline flow: drafts an in-place spec (one file, no Epic/Story scaffolding), generates a one-task `SP-{n}-tasks.md`, materialises a single Task in Ready, and drops straight into pair-programming mode. Same artefacts as the full flow so the work stays first-class on the kanban; just no parent Epic / Story / multi-task spread. Documented prominently in `docs/METHODOLOGY.md` to defuse the "this is ceremony-heavy" complaint.

### 3.5 Bundle versioning & evolution

Bundle version is independent of extension version (a 0.2.1 → 0.2.2 extension upgrade may ship the same bundle). Each bundle release is reviewed before shipping. Breaking changes to a skill go in a new file (`pair-next-v2/SKILL.md`); the old one is marked deprecated; users update at their own pace.

### 3.6 Why this answers the "config tree was never well understood" problem

The current config tree is a generic CRUD UI over `.claude/{settings,commands,skills,agents,hooks}` — useful but goal-less. Users see all the knobs and don't know which to turn. Rev 5 reframes it: the **primary** entry is the methodology bundle (install/update/diff/reset), with the **secondary** entries being user-authored config that lives alongside. The tree's job is now obvious: _manage the methodology bundle, and any custom Claude config you've added on top of it._

### 3.7 Market scan — why this is a unique offering

| Tool                                  | Has skills/preset bundles?                            | GitHub-Issues-anchored?      | Kanban?                                           | Pair-programming-shaped?                                                      |
| ------------------------------------- | ----------------------------------------------------- | ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| **cc-sdd**                            | Yes (17 skills)                                       | No                           | No                                                | No (autonomous-impl bias)                                                     |
| **BMAD-METHOD**                       | Yes (~32 skills via plugin marketplace)               | No                           | No                                                | No (persona-driven, agile lifecycle)                                          |
| **Cursor 2.5 Marketplace**            | Yes (plugins bundle skills/subagents/MCP/hooks/rules) | No                           | Yes (in-Cursor agent kanban) but not GitHub-bound | No — plugins are domain-of-work (Atlassian, Datadog), not methodology-of-work |
| **Windsurf**                          | Rules + Memories + Workflows                          | No                           | No                                                | Built-in planning agent, not pair-shaped                                      |
| **GitHub Copilot Workspace / Spaces** | Closed/Microsoft                                      | **Yes (closest competitor)** | Issues tree, not kanban                           | Agentic, fixed methodology                                                    |
| **JetBrains Junie**                   | Ask/Brave modes only                                  | No                           | No                                                | No                                                                            |
| **Cline / Aider / Continue**          | `.rules` files only                                   | No                           | No                                                | No                                                                            |

The combination we're proposing is currently empty. Copilot Workspace is the only thing approaching it; it's not an open extensibility bundle.

### 3.8 Risks specific to shipping a bundle

| Risk                                                                                                                                                                                                            | Mitigation                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Skills-vs-commands churn.** Anthropic recently merged commands into skills. Anything we author against `.claude/commands/` today is deprecated; cc-sdd's legacy `commands/` dir is already a cautionary tale. | Author all bundle content as **skills only**. No commands. Locked in §3.1.                                                  |
| **Methodology-opinionatedness backlash.** BMAD and cc-sdd both get called ceremony-heavy. A four-tier hierarchy + phase gates + mandatory pair-programming will get the same.                                   | Ship `pair-start-quick` from day one (§3.4). Document the escape hatch prominently.                                         |
| **GitHub coupling.** Hard-binding to `gh` CLI + Issues labels makes the bundle useless to Linear/Jira/Shortcut.                                                                                                 | Own it. Position as "GitHub-native" in marketing/README; don't half-abstract.                                               |
| **Bundle drift in user repos.** Users modify skills locally; our update overwrites.                                                                                                                             | Manifest-hash diff + "Locally modified" state in the config tree (§3.3). Never overwrite without explicit user action.      |
| **`vscode.lm.registerMCPServer` API instability.** Some bundle skills depend on the MCP-2 server (e.g. `/pair-next` calls `move_task`).                                                                         | Each MCP-dependent skill gracefully degrades to `gh` CLI when MCP unavailable. The stdio fallback (§7.1) is the safety net. |

---

## 4. Target architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       thinkube-ai-integration (one extension)             │
│                                                                           │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  ┌──────┐ │
│  │ Roadmap Panel    │  │ Kanban Panel     │  │ Card Detail    │  │ MCP  │ │
│  │ (new)            │  │ (forked)         │  │ View (new)     │  │ Srv  │ │
│  │                  │  │                  │  │                │  │(new) │ │
│  │ Epic → Story →   │  │ Tasks flowing    │  │ Issue body +   │  │      │ │
│  │ Spec tree        │  │ Spec → Ready →   │  │ linked         │  │      │ │
│  │ + creation       │  │ … → Done         │  │ .thinkube/ md  │  │      │ │
│  │ wizards          │  │ (drag & drop)    │  │ + frontmatter  │  │      │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬───────┘  └──┬───┘ │
│           │                     │                     │              │     │
│           ├─────────────────────┴─────────────────────┴──────────────┤     │
│           │                                                          │     │
│           ▼                                                          ▼     │
│  ┌──────────────────────────────┐    ┌────────────────────────────────┐   │
│  │ GitHubService                 │    │ ThinkubeStore (file layer)    │   │
│  │   • Issues + Sub-issues       │    │   • read/write .thinkube/*.md │   │
│  │   • Projects v2 (Status field)│    │   • frontmatter parse/write   │   │
│  │   • Milestones                │    │   • FileSystemWatcher         │   │
│  │   • GraphQL + REST            │    │                                │   │
│  └──────────────────────────────┘    └────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Existing Config Manager (untouched in this cycle)                  │   │
│  │   ChatPanel · ConfigTreeProvider · ClaudeConfigService             │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ LauncherService (process-wrapper launcher)                         │   │
│  │   wires claudeCode.claudeProcessWrapper to bundled wrapper         │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ BundleInstaller  (new in rev 5)                                    │   │
│  │   reads templates/methodology-bundle/                              │   │
│  │   merges into <project>/.claude/ + .mcp.json + CLAUDE.md           │   │
│  │   surfaces install/update/diff state in the existing config tree   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Three command namespaces (unchanged)

| Prefix              | Owns                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thinkube-ai.*`     | Launcher + app/deploy scaffolding.                                                                                                                                                                                                     |
| `thinkube.*`        | Existing config manager (hook/command/skill/agent/MCP-entry CRUD).                                                                                                                                                                     |
| `thinkube.kanban.*` | **New**: Roadmap + Kanban + MCP provider. (Kept under this prefix even though it covers more than the kanban — the panel containers will be named `roadmap` and `kanban` but the command id space stays one namespace for simplicity.) |

### File-level deltas

| Path                                      | Action              | Notes                                                                                                                                                               |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                        | **Refactor**        | Shrink ~70% via chunk 1.                                                                                                                                            |
| `src/integration/claude.ts`               | **Delete**          | Terminal-launcher gone.                                                                                                                                             |
| `src/services/LauncherService.ts`         | **New**             | Wraps claude-cwd-proxy logic.                                                                                                                                       |
| `wrapper/claude-cwd-wrapper.{sh,cmd,ps1}` | **Vendor MIT**      | Copy from claude-cwd-proxy.                                                                                                                                         |
| `src/methodology/`                        | **New folder**      | Pair-programming types + role/persona constants.                                                                                                                    |
| `src/github/GitHubService.ts`             | **New**             | Octokit-based; issues, sub-issues, Projects v2.                                                                                                                     |
| `src/github/AuthService.ts`               | **New**             | env / `gh auth token` / SecretStorage fallback.                                                                                                                     |
| `src/store/ThinkubeStore.ts`              | **New**             | `.thinkube/*` reader/writer + FileSystemWatcher.                                                                                                                    |
| `src/store/frontmatter.ts`                | **New**             | YAML frontmatter parse/serialize.                                                                                                                                   |
| `src/views/roadmap/RoadmapPanel.ts`       | **New**             | TreeView or WebviewView; epic→story→spec tree.                                                                                                                      |
| `src/views/kanban/KanbanPanel.ts`         | **New**             | Hosts the vendored React app.                                                                                                                                       |
| `src/views/detail/CardDetailPanel.ts`     | **New**             | Card detail (issue body + .thinkube/ markdown).                                                                                                                     |
| `webview/kanban/`                         | **Vendor + extend** | Copy of trello-kanban; React app + Vite.                                                                                                                            |
| `src/mcp/KanbanMcpProvider.ts`            | **New**             | `vscode.lm.registerMCPServer` (or fallback stdio adapter).                                                                                                          |
| `src/methodology/TasksMaterializer.ts`    | **New**             | Parses `.thinkube/specs/SP-{n}-tasks.md` and materialises rows into Task issues + Projects v2 items in Ready.                                                       |
| `src/methodology/BundleInstaller.ts`      | **New**             | Installs / updates / diffs the methodology bundle into the project's `.claude/`. Uses existing `ClaudeConfigService` for merge discipline.                          |
| `templates/methodology-bundle/`           | **New folder**      | The pre-authored Claude Code config (skills, agents, settings, mcp.json, CLAUDE.md fragment). Source of truth for what gets installed into user projects. See §3.2. |
| `docs/METHODOLOGY.md`                     | **New**             | The pair-programming method, explicitly written down.                                                                                                               |
| `docs/INTEGRATION_PLAN.md`                | (this file)         |                                                                                                                                                                     |
| `NOTICE.md`                               | **New**             | MIT attributions (wrapper + kanban fork).                                                                                                                           |
| `package.json`                            | **Modify**          | New view containers, new settings, removed `Ctrl+Shift+C` keybindings, license/publisher unchanged.                                                                 |

---

## 5. The two MCPs (disambiguation, expanded tool list)

**MCP-1: config-side MCP server management** (existing). Users add/edit `.claude/settings.json` `mcpServers` entries. **Rename UI label** to "MCP Entries (.claude/.mcp.json)" in chunk 8 polish to avoid confusion with MCP-2. Code path: `src/services/ClaudeConfigService.ts`. Untouched in this cycle.

**MCP-2: the extension is an MCP server provider** (new). Registered via `vscode.lm.registerMCPServer` (verify API; see §7.1 risk). Exposes the following — _every layer of the hierarchy_, not just tasks:

| Tool                      | Layer  | Purpose                                                                                                                                    |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_epics`              | Epic   | All epics in the configured repo.                                                                                                          |
| `list_stories_in_epic`    | Story  | Sub-issues of an Epic.                                                                                                                     |
| `list_specs_in_story`     | Spec   | Sub-issues of a Story.                                                                                                                     |
| `list_tasks_in_spec`      | Task   | Sub-issues of a Spec (this is the kanban contents).                                                                                        |
| `list_board`              | Task   | All tasks across the repo with current Status.                                                                                             |
| `get_issue`               | any    | Full issue body + comments + linked `.thinkube/` file.                                                                                     |
| `get_thinkube_file`       | any    | Read a specific `.thinkube/*.md` file.                                                                                                     |
| `create_epic`             | Epic   | Create issue (type=Epic) + `.thinkube/epics/EP-{n}.md`.                                                                                    |
| `create_story_under_epic` | Story  | + `.thinkube/stories/ST-{n}.md`.                                                                                                           |
| `create_spec_under_story` | Spec   | + `.thinkube/specs/SP-{n}.md`.                                                                                                             |
| `create_tasks_from_spec`  | Task   | Reads `.thinkube/specs/SP-{n}-tasks.md`, creates Task issues, places in Ready.                                                             |
| `move_task`               | Task   | Set Projects v2 Status field.                                                                                                              |
| `update_issue`            | any    | Title / body / labels / milestone.                                                                                                         |
| `add_comment`             | any    | Issue comment.                                                                                                                             |
| `close_issue`             | any    | Close with optional reason.                                                                                                                |
| `write_decision`          | ADR    | Create `.thinkube/decisions/ADR-{n}.md` + link issue.                                                                                      |
| `write_retro_note`        | Retro  | Append to today's `.thinkube/retros/{date}.md`.                                                                                            |
| `decompose_spec`          | bridge | Calls the bundle's `/tasks-decompose` skill, which produces `.thinkube/specs/SP-{n}-tasks.md` for `create_tasks_from_spec` to materialise. |

Resources:

| Resource URI                    | Returns                                             |
| ------------------------------- | --------------------------------------------------- |
| `board_state`                   | Snapshot of the Task-level board (columns + cards). |
| `roadmap`                       | Tree of Epic → Story → Spec.                        |
| `issue/{number}`                | Issue + linked `.thinkube/` file.                   |
| `thinkube_file/{relative-path}` | A specific `.thinkube/*.md` file.                   |

All tools that create issues also write the paired `.thinkube/*.md` file (if applicable for that layer) and stamp it with frontmatter.

---

## 6. Phased roadmap

Chunks are 1–2 day work units. "Blocking" means later chunks need types or files this one introduces.

### Chunk 1 — Refactor `extension.ts` into modules (unchanged)

Move command bodies out of the 1622-line `extension.ts` into `src/commands/{configCommands,launcherCommands,projectContext}.ts`. No behavior change. **Blocking** for chunks 2 and 3.

### Chunk 2 — Process-wrapper launcher

Ship the cwd-patching wrapper scripts under `wrapper/`; build copies them to `dist/wrapper/`. `LauncherService` sets `claudeCode.claudeProcessWrapper` on activate and writes the per-invocation `.target-cwd` / `.target-prefix` handoff files. Delete `src/integration/claude.ts`. Remove `Ctrl+Shift+C` keybindings.

### Chunk 3 — `GitHubService` + `AuthService` (foundation)

- `src/github/GitHubService.ts`:
  - GraphQL client (`@octokit/graphql`) + REST client (`@octokit/rest`).
  - Read methods: `getRepo`, `listIssues({type, parent})`, `getIssue(num)`, `listSubIssues(num)`, `getProject(owner, number)`, `listProjectItems(projectId)`, `getStatusField(projectId)`.
  - Write methods: `createIssue({type, title, body, labels, milestone})`, `addSubIssue(parent, child)`, `setStatus(itemId, optionId)`, `updateIssue(...)`, `addComment(...)`, `closeIssue(...)`.
  - Handle pagination + rate limits centrally.
- `src/github/AuthService.ts`: token order — `GITHUB_TOKEN` → `gh auth token` → SecretStorage.
- `src/github/issueTypes.ts`: detect whether the target repo has Issue Types configured; if not, fall back to label-based discrimination (`epic`/`story`/`spec`/`task`).
- **Acceptance:** in a workspace with `thinkube.kanban.repo` and `thinkube.kanban.projectNumber` set, a smoke-test command `thinkube.kanban.dumpRoadmap` writes the full epic→story→spec→task tree to the output channel as JSON. No UI yet.
- **Blocking** for chunks 4–10.

### Chunk 4 — `ThinkubeStore` + frontmatter binding

- `src/store/frontmatter.ts`: parse + serialize YAML frontmatter using `yaml`.
- `src/store/ThinkubeStore.ts`:
  - `getFile(relativePath)`, `writeFile(relativePath, frontmatter, body)`.
  - `listKind(kind: 'epic'|'story'|'spec'|'decision'|'retro')`.
  - `watch(kind?, cb)` — `FileSystemWatcher` for the relevant subfolders.
  - Helpers: `pathFor(kind, issueNum)`, `linkIssueToFile(issueNum) → relativePath | undefined`.
- **Acceptance:** writing a test `.thinkube/specs/SP-50.md` is round-trippable; watcher fires on edit; `linkIssueToFile(50)` returns the path.
- **Blocking** for chunks 6, 8, 9.

### Chunk 5 — Kanban panel (fork + in-memory smoke test)

- Reuse the visual design of `mayank1513/vscode-extension-trello-kanban-board` (card/column styling + markdown) in a fresh React app under `webview/kanban/`, on our own data model + `postMessage` protocol; host code in `src/views/kanban/host/`. Record provenance in `webview/kanban/UPSTREAM.md`. (Do NOT vendor the upstream app or its gimmick deps — see §2.1.)
- Define `StorageAdapter` interface; refactor vendored `Panel` to inject it.
- Implement `InMemoryAdapter` seeded with the six methodology columns.
- Swap `react-beautiful-dnd` → `@hello-pangea/dnd`.
- Add `thinkube.kanban.openKanban` command + a webview panel.
- Build pipeline: root `compile` runs `tsc` + `node scripts/build-assets.mjs` + `vite build --config webview/kanban/vite.config.ts`.
- **Acceptance:** opening the kanban shows six columns with seeded demo tasks; drag-and-drop reorders within and between columns. No GitHub yet.
- **Blocking** for chunk 7.

### Chunk 6 — Roadmap panel

- `src/views/roadmap/RoadmapPanel.ts` — VS Code `TreeDataProvider` rooted at Epics → Stories → Specs.
- Each tree node knows its issue number; clicking opens the card detail (chunk 8).
- Toolbar buttons: refresh, new Epic, new Story (when an Epic is selected), new Spec (when a Story is selected). New-thing buttons open the corresponding wizard in chunk 8.
- New view container `thinkube-roadmap` in the activity bar.
- **Acceptance:** in a workspace with the repo + project configured, the Roadmap tree mirrors the issue hierarchy. Refresh re-fetches.
- **Blocking** for chunk 8.

### Chunk 7 — `GitHubProjectsAdapter` for the kanban

- `src/views/kanban/host/storage/GitHubProjectsAdapter.ts` implements `StorageAdapter` against `GitHubService`.
- On `load()`: pull Tasks for the configured repo + project, mapped to the six methodology columns via the Projects v2 Status field. Validate that the field's options match our six-column names; if not, surface a "Run setup" toast that calls `thinkube.kanban.configureProject`.
- On `save()`: drag-and-drop updates the Status field via mutation.
- Optimistic update + rollback on error. Rate-limit telemetry.
- `thinkube.kanban.configureProject`: wizard to set repo + project number + ensure the Status field has the six options, creating any missing.
- **Acceptance:** dragging a card from Ready → In Progress updates the GitHub Projects field. Refresh shows the change persists. Tasks created in github.com appear in the kanban after refresh.
- **Blocking** for chunk 10 (MCP write tools share these paths).

### Chunk 8 — Card detail + creation wizards

- `src/views/detail/CardDetailPanel.ts` — a webview that renders the issue body + the linked `.thinkube/` markdown (if any) side-by-side, with editing for the markdown side.
- Wizards (small panels or QuickPicks):
  - **New Epic** — title + one-paragraph pitch; creates issue + `.thinkube/epics/EP-{n}.md`.
  - **New Story under Epic** — title + body; creates issue + `.thinkube/stories/ST-{n}.md`; links as sub-issue.
  - **New Spec under Story** — title + body; creates issue + `.thinkube/specs/SP-{n}.md`; links as sub-issue.
- **Acceptance:** the three wizards work end-to-end. Clicking a Roadmap node opens the card detail. Editing the markdown saves to `.thinkube/`.
- **Blocking** for nothing.

### Chunk 9 — Spec-tasks materializer

(Repurposed from the rev-5 "cc-sdd bridge" — see §2.3 for why. The materializer doesn't care who wrote the tasks file; it just parses Thinkube's tasks-list format and creates the corresponding GitHub issues + Projects v2 items.)

- **Tasks-list format** (Thinkube's own; documented for the methodology bundle to follow):
  - Plain GitHub-flavored markdown checkboxes, one task per line: `- [ ] <title> — <optional one-line description>`.
  - Optional `(P)` marker after the title flags a task as parallel-eligible with its siblings: `- [ ] (P) <title>`.
  - Optional `→ depends-on: 3` annotation references another task's 1-based index within the file for explicit ordering.
  - File lives at `.thinkube/specs/SP-{n}-tasks.md` next to the spec. Frontmatter carries `kind: task-decomposition`, `issue: <spec-issue>`, `parent_issue: <spec-issue>`.
- `src/methodology/TasksMaterializer.ts`:
  - `parseTasksFile(text)` — extracts the list of tasks with title, description, parallel flag, dependency index. Tolerant of extra prose between sections.
  - `materialize(specIssue, tasks)` — for each unchecked task: calls `GitHubService.createIssue({type: 'task', title, body})`, calls `addSubIssue(specIssue.nodeId, taskIssue.nodeId)`, calls `GitHubService.addItemToProject(projectId, taskIssue.nodeId)`, then calls `setStatus(...)` to place the new item in the `Ready` column. Parallel-eligible tasks get a `parallel-eligible` label. Reports per-task success/failure to the output channel.
- **Watcher**: subscribe to `ThinkubeStore.watch('spec', cb)` so we receive change events for `SP-*-tasks.md` (the existing watcher emits `task-decomposition` kind events for those files). On a `created`/`changed` event with at least one unchecked task that hasn't been materialized yet, surface a notification: _"Materialize N tasks for SP-{n}?"_ with Accept / Dismiss. Track materialized state via a `thinkube-materialized: true` per-task line marker (rewritten into the file as `- [x]` on success — leveraging the existing checkbox semantics so re-runs don't double-create).
- **Commands**:
  - `thinkube.kanban.materializeTasks` — runs the materializer against a chosen `SP-*-tasks.md` (picks active editor's file or prompts via QuickPick).
  - `thinkube.kanban.refreshFromGitHub` — re-pulls the kanban / roadmap state without re-rendering UI from scratch (drops the GitHubProjectsAdapter's diff baseline and re-loads).
- **GitHubService addition**: `addItemToProject(projectId, contentNodeId)` via the GraphQL `addProjectV2ItemById` mutation.
- **Acceptance:** with a populated `.thinkube/specs/SP-50-tasks.md` (six checkboxes, two of them `(P)`), the toast appears; on Accept the six Task issues are created, linked under SP-50, added to the Projects v2 with `Status = Ready`, and appear in the kanban Ready column. Re-running materializer on the same file is idempotent — already-materialized rows are not duplicated.

### Chunk 10 — MCP server (read + write tools across all layers)

- `src/mcp/KanbanMcpProvider.ts`:
  - Verify `vscode.lm.registerMCPServer` availability (or whichever stable API the target code-server build ships); see §7.1 risk.
  - Register all tools listed in §5 and all resources.
  - Tool handlers delegate to `GitHubService` + `ThinkubeStore`. Single source of truth: the same code the UI calls.
  - **Permission gate**: every mutating tool checks `thinkube.kanban.allowAIWrites` (default true; settable to false for read-only mode).
- **Fallback**: a `dist/kanban-mcp-stdio.js` standalone stdio MCP server, ready to add to `.mcp.json` if the in-process registration API is unavailable.
- **Acceptance:** in a Claude Code chat session running in the same VS Code, the tools appear and work: list epics, create story under epic, decompose spec, move task. Each action is reflected in the Roadmap / Kanban surfaces within seconds.

### Chunk 11 — Quality gates + navigator/driver mode

- `src/methodology/qualityGates.ts`: pure functions over a card/issue that return `{ ok: true } | { ok: false, reason: string }`.
  - Spec → Ready: spec issue's acceptance_criteria checklist not empty.
  - In Progress → Review: at least one comment from this work cycle.
  - Review → Verify: all acceptance_criteria checked.
- **Mode toggle**: `thinkube.kanban.mode` setting — `navigator | driver | both`. In navigator mode, `allowAIWrites` is forced false (Claude can read + propose but not commit board changes). In driver mode, both can write. Default `both`.
- UI: a mode indicator badge in the Kanban panel header.
- **Acceptance:** trying to drag a Spec card with empty acceptance criteria → Ready surfaces the gate's reason. Switching to navigator mode disables Claude's writes (verifiable via MCP tool error).

### Chunk 12 — Methodology bundle (templates + installer + config-tree integration)

- **Goal:** ship the pre-authored `.claude/` config that makes Claude an active participant in the methodology. See §3 for the full bundle spec.
- **Changes:**
  - **Author `templates/methodology-bundle/` v1.0.0** with the exact contents in §3.1: **9 skills** (`epic-new`, `story-new`, `spec-prepare`, `tasks-materialize`, `pair-start`, `pair-next`, `pair-start-quick`, `board`, `retro`) + 2 utility skills (`methodology-context`, `repo-conventions`), 3 subagents (`explorer`, `reviewer`, `verifier`), settings fragment, mcp.json fragment, CLAUDE.md delimited block, plus `VERSION` and `manifest.json`. Hand-authored markdown; each skill carries proper frontmatter (`description`, optionally `disable-model-invocation`, `allowed-tools`).
  - **`src/methodology/BundleInstaller.ts`** with operations:
    - `getStatus(workspacePath)` → `not-installed | up-to-date | update-available | locally-modified`, computed from a manifest-hash diff vs. the installed `.thinkube/.bundle-version`.
    - `install(workspacePath, opts)` — copies skills/agents (frontmatter-stamped with `thinkube-bundle: <ver>`); merges settings via existing `ClaudeConfigService` (preserves unknown fields); merges `.mcp.json` (touches only our key); inserts/updates the delimited CLAUDE.md block; stamps `.thinkube/.bundle-version`.
    - `diff(workspacePath)` → returns a list of `{ path, status: 'unchanged'|'modified'|'missing' }`.
    - `update(workspacePath, strategy: 'reapply' | 'merge-modified-only')`.
  - **Config-tree integration**: new top-level node "Thinkube Methodology Bundle" in the existing `ConfigTreeProvider` showing the four states from §3.3 with action buttons (`Install`, `Update`, `View diff`, `Re-apply`, `Reset`). Each leaf under the node is a bundle file with individual install/modified/missing status. Non-bundle user-authored files keep showing in their existing sections clearly distinguished from bundle members (icon + tooltip).
  - **New command** `thinkube.kanban.installBundle` for first-run installs from the command palette.
  - **Doc:** the bundle's skills reference `methodology-context` and `repo-conventions` (the two utility skills) on demand, so they share consistent vocabulary. The CLAUDE.md fragment points users at `docs/METHODOLOGY.md` for the full method.
- **Acceptance:**
  - On a fresh repo: `thinkube.kanban.installBundle` produces `.claude/skills/*`, `.claude/agents/*`, merges `.claude/settings.json`, merges `.mcp.json`, inserts CLAUDE.md block. All files stamped `thinkube-bundle: 1.0.0`. `.thinkube/.bundle-version` written.
  - In Claude Code session: typing `/board` invokes the `board` skill which shells out `gh issue list ...` and renders the kanban state.
  - In Claude Code session: typing `/pair-next` calls our MCP-2 `move_task` (after pair-programming dialogue confirms the move) and the kanban panel updates.
  - Modify a bundle file by hand → re-running install detects "locally modified" and prompts before overwriting.
  - The config tree shows "Thinkube Methodology Bundle: v1.0.0 installed" with expandable file list.
- **Blocking:** no — chunk 13 polishes everything.

---

### Chunk 13 — Polish, docs, packaging

- **`docs/METHODOLOGY.md`** written end-to-end: pair programming, navigator/driver, hierarchy, examples, where things live, the bundle's skill catalogue, where BMAD fits as further reading, the `--quick` escape hatch.
- Rename existing "MCP Servers" tree section to "MCP Entries (.claude/.mcp.json)" to disambiguate from MCP-2 and from the bundle's own MCP entry.
- Standalone `claude-cwd-proxy` migration toast (§7.6).
- Engine bump if `vscode.lm.registerMCPServer` needs ≥1.103 (TBD per §7.1).
- README rewrite: four features (config manager / **methodology bundle** / kanban+roadmap / launcher) and two MCPs disambiguation.
- CHANGELOG; version → `0.2.0`.

---

## 7. Risks & open questions

### 7.1 `vscode.lm.registerMCPServer` availability in code-server

Same risk as before — needs verification in the target code-server build. **Mitigation:** ship the stdio fallback (`dist/kanban-mcp-stdio.js`) alongside the in-process registration so we have insurance.

### 7.2 GitHub Issue Types + Sub-issues API status

GitHub introduced Issue Types and native Sub-issues over 2024–2025. As of 2026-05 we should assume they're GA but verify:

- **Issue Types**: per-repo configured via the org/repo settings. Querying via GraphQL needs the right type fragment. Fallback: discriminate by label (`epic`, `story`, `spec`, `task`).
- **Sub-issues**: native parent/child link, queryable via GraphQL. Fallback: parse `Tasks:` blocks in issue bodies (the older tasklist convention).

**Mitigation:** the `GitHubService` is built with a strategy seam (`IssueClassifier`) so we can swap between Issue Types and labels without rewriting downstream code.

### 7.3 GraphQL rate limits

Same as before. Implement a single `GraphQLClient` wrapper with rate-limit telemetry; surface "rate limited, paused" in the status bar. Default polling interval 30s while a panel is visible; paused when hidden.

### 7.4 `.thinkube/` adoption in existing repos

A repo that hasn't onboarded won't have `.thinkube/`. On `thinkube.kanban.configureProject`, offer to scaffold the folder structure + a small README explaining the convention. Don't auto-create silently.

### 7.5 Vendored upstream maintenance

`webview/kanban/` carries upstream's deps; renovate quarterly, audit separately, switch `react-beautiful-dnd` → `@hello-pangea/dnd` in chunk 5. Record upstream SHA in `UPSTREAM.md`.

### 7.6 `claude-cwd-proxy` migration

Same as rev 2: detect a competing wrapper path in `claudeCode.claudeProcessWrapper`, show a one-time toast offering to uninstall the standalone.

### 7.7 Methodology owned in-house (replaces the rev-5 cc-sdd-dependency risk)

The earlier revisions made `cc-sdd` a required peer skill pack and surfaced its install/version/drift risks here. That decision was reversed (see §2.3) — the methodology bundle is now authored fully in-house, so there is no peer-skill-pack dependency to fail. The risks that remain are smaller and ours to own:

- **Prompt-craft quality.** Our spec-prepare and tasks-decompose skills are first-party prompts we maintain. Mitigation: iterate them on real projects; ship the methodology bundle with a `VERSION` and `manifest.json` so we can roll updates cleanly via `BundleInstaller`.
- **Tasks-list format stability.** Our parser must remain a small surface — checkbox list + optional `(P)` marker + optional `→ depends-on: N`. If we add fields later, do so additively and version the format in the bundle's manifest.
- **No upstream chase.** The §7.7 risk write-up in rev 5 (upstream evolution / install friction / skill-removal / spec-format drift) does not apply — we have no upstream.

### 7.8 BMAD-METHOD scope creep

Tempting to import their personas. Resist. We document them in `docs/METHODOLOGY.md` as an upstream-method the user can layer on top, no extension code involvement.

### 7.9 Privacy / data exposure via `.thinkube/`

`.thinkube/*.md` is committed to the repo. Don't write anything secret there. The chunk-9 materialiser that reads tasks-list files and the bundle's skills that author specs: ensure we don't accidentally exfiltrate environment secrets the human pasted into a chat. **Action:** chunk 4's `ThinkubeStore.writeFile` runs a basic secret-scan (regex for common token patterns) and refuses with a warning. Conservative; user can override.

### 7.10 Three new panels = activity-bar crowding

We add Roadmap + Kanban + (existing) Thinkube AI container. That's three icons. Consider grouping Roadmap + Kanban under a single `thinkube-board` container with two views. **Decision in chunk 6:** one container, two views.

---

## 8. v0.1.0 — Definition of done

**Cut policy.** v0.1.0 is a single complete release, not a staged alpha/beta progression. All 13 chunks are implemented and the test matrix below passes before a vsix ships. There are no public v0.0.x cuts — the alpha drops live as private dogfooding only.

**Scope locked.** v0.1.0 includes chunks 1–13 as documented above. Anything in §9 ("Explicitly deferred") is v0.2.0 or later. Anything new requested during the v0.1.0 cycle gets logged against v0.2.0 unless it's a defect on existing scope.

**Test matrix.** A v0.1.0 cut requires _every_ row green. "Green" means manually exercised on a real workspace, not just "compiles."

| Layer                   | What "well tested" means                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher                | Right-click → Open Here works on macOS + Linux; resume of an existing session recovers the original cwd from the JSONL.                                                                                  |
| GitHub stack            | All read + write methods exercised against a real repo with Issue Types **and** against a fallback repo without (label-based discrimination). Rate-limit failures land in the output channel.            |
| `.thinkube/` store      | Smoke command writes / round-trips a sample spec; watcher fires; secret-scan refuses a token-shaped string in the body.                                                                                  |
| Roadmap                 | Tree populates correctly when settings are missing (welcome screen) and when they're set (Epic → Story → Spec). Refresh re-fetches. Click opens CardDetailPanel.                                         |
| Kanban                  | InMemoryAdapter renders six columns with seeded tasks. GitHubProjectsAdapter loads from a real project. Drag updates the Status field. Mode badge reflects `thinkube.kanban.mode`.                       |
| Card detail             | Issue body + linked `.thinkube/` file render side-by-side. Save persists to the sidecar. Open-in-editor opens a real editor split.                                                                       |
| Wizards                 | All three (newEpic / newStory / newSpec) create issue + sidecar + sub-issue link end-to-end.                                                                                                             |
| Spec-tasks materialiser | Toast fires on file create. Materialiser is idempotent on re-run. Per-row failures are surfaced and don't block sibling rows.                                                                            |
| MCP server              | Boots via stdio. Every tool exercised at least once from a Claude session running in the same VS Code. Permission gate (allowAIWrites / mode = navigator) verifiably refuses mutating tools.             |
| Quality gates           | Spec → Ready, In Progress → Review, Review → Verify all surface their reasons when the underlying condition is unmet.                                                                                    |
| Methodology bundle      | Install on a fresh project produces 18 files (skills + agents + settings merge + mcp.json merge + CLAUDE.md block + stamp). Modify-one + reapply with merge-modified-only preserves the user's edit.     |
| Bundle tree view        | Status node reflects current state; expanding shows per-file rows with hashes; refresh updates after an install.                                                                                         |
| Packaging               | `npx vsce package` produces a vsix; `.claude/` dev config is excluded; `templates/methodology-bundle/` ships; total size ≈ 500 KB. Install on a stock VS Code 1.101+ via `--install-extension` succeeds. |

**Iteration period.** The methodology bundle skill prompts get exercised on at least two real methodology cycles (epic → story → spec → tasks → pair → done) before v0.1.0 ships. Bugs surfaced during iteration are fixed; the prompts can be tightened. Public release waits on that. There is no "ship now, iterate publicly" path for v0.1.0 — quality bar is "we'd defend this to a skeptic."

**Out of scope, deferred to v0.2.0+:** see §9. Worktree manager, agent workspaces, template browser, MCP server marketplace UI, hooks/permissions visual editors, BMAD persona toggle, velocity/retro analytics, ChatPanel React migration.

---

## Historical: chunk-by-chunk delivery order

The 13 chunks landed in roughly this order. Each was reviewable in isolation; later chunks built on the types and files earlier chunks introduced. This section is preserved for git-archaeology context only.

- Chunk 1 — refactor `extension.ts` into command modules.
- Chunks 2–9 — process-wrapper launcher, GitHub stack, `.thinkube` store, kanban panel, roadmap tree, GitHubProjectsAdapter, card detail + wizards, spec-tasks materialiser.
- Chunk 10 — MCP server (stdio subprocess + provider).
- Chunk 11 — quality gates + navigator/driver mode.
- Chunk 12 — methodology bundle (skills + agents + installer).
- Chunk 13 — polish, docs, packaging.

---

## 9. Explicitly deferred (do NOT do this cycle)

From the earlier Era-1 vision (the removed `REDESIGN_PROPOSAL.md`) and elsewhere:

| Feature                                        | Why deferred                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Worktree manager                               | Independent of this plan; useful later.                          |
| Agent workspaces                               | Builds on worktrees + autonomy model we explicitly aren't doing. |
| Template library browser                       | The existing `PluginService` covers part of this.                |
| MCP server marketplace UI (MCP-1)              | The existing tree CRUD covers the basic case.                    |
| Custom-MCP-server scaffold generator           | Bigger scope.                                                    |
| Hooks visual editor (full webview)             | Current quick-pick works.                                        |
| Permissions visual editor (full webview)       | Same.                                                            |
| Multi-agent personas (BMAD-style)              | Methodology-only reference; no extension code.                   |
| Background dispatch / autonomous task runners  | Wrong UX model (see §2.2).                                       |
| Velocity/retro analytics panel (issue #9 v1.2) | Wait for stable methodology MVP.                                 |
| `ChatPanel` migration to React                 | No driver; existing string-template works.                       |

---

## Appendix A: build pipeline shape after chunk 7

```
package.json scripts:
  compile          tsc -p ./ && node scripts/build-assets.mjs && npm run compile:webview
  compile:webview  vite build --config webview/kanban/vite.config.ts
  watch            (parallel) tsc -watch & vite build --watch
  package          npm run compile && vsce package

scripts/build-assets.mjs:
  - copy wrapper/* → dist/wrapper/*  (chmod +x on POSIX)
  - copy resources/* → dist/resources/*  (unchanged)

webview/kanban/              (fresh React app; visual design reused from trello-kanban-board)
  ├─ UPSTREAM.md             (provenance + license + intentional exclusions)
  ├─ vite.config.ts          (outDir: ../../media/kanban)
  ├─ index.html
  ├─ src/                    (our React app: own data model + protocol, upstream look)
  └─ package.json            (minimal deps: react, @hello-pangea/dnd, react-markdown)
host code: src/views/kanban/host/ (Panel + StorageAdapter + GitHubProjectsAdapter)
```

## Appendix B: `.thinkube/` schema & frontmatter

**Folder layout (fixed):**

```
.thinkube/
├── epics/      EP-{issue}.md       kind: epic
├── stories/    ST-{issue}.md       kind: story
├── specs/      SP-{issue}.md       kind: spec
├── specs/      SP-{issue}-tasks.md kind: task-decomposition (Thinkube tasks-list format)
├── decisions/  ADR-{n}.md          kind: decision
└── retros/     {YYYY-MM-DD}.md     kind: retro
```

**Frontmatter (every file):**

```yaml
---
kind: epic | story | spec | task-decomposition | decision | retro
issue: 50 # GitHub issue number this extends (omit for retros/ADRs not pinned to one issue)
parent_issue: 34 # the parent in the hierarchy (omit for top-level epics)
repo: cmxela/my-app # owner/name; defaults to settings.thinkube.kanban.repo
status: draft | active | done # used for retros/decisions; ignored for issue-backed kinds
created: 2026-05-19 # ISO date
---
```

**Body convention:** plain markdown. The bundle's `/spec-prepare` skill writes specs with the standard sections `## Acceptance Criteria` (a checklist), `## Constraints`, `## Design`, `## File Structure Plan` — these are the sections quality gates (chunk 11) and MCP tools recognise. Hand-written specs that adopt the same section names get the same treatment; specs that don't, work too — they just won't pass the acceptance-criteria-not-empty gate until the checklist exists.

## Appendix C: GitHub label / type conventions

Two-tier:

1. **If the target repo has Issue Types configured (preferred):** use them — `Epic`, `Story`, `Spec`, `Task`.
2. **Otherwise (fallback):** use labels — `epic`, `story`, `spec`, `task`. The extension's `IssueClassifier` reads either.

Sub-issue links use GitHub's native sub-issue API. Older repos using tasklist syntax (`- [ ] #34` in issue body) are also recognized as a fallback by `IssueClassifier`.

The kanban column field is a Projects v2 single-select field. Default name `Status`. Options (in order): `Spec`, `Ready`, `In Progress`, `Review`, `Verify`, `Done`. The configure-project wizard creates any missing options.

## Appendix D: critical files for chunks 0–4

Files an implementer should keep open while working through the first four chunks:

- `/Users/alexmc/Developer/thinkube-ai-integration/src/extension.ts` — refactor target (chunk 1).
- `/Users/alexmc/Developer/thinkube-ai-integration/src/services/ClaudeConfigService.ts` — read-modify-write discipline; reference style for `ThinkubeStore`.
- `/Users/alexmc/Developer/claude-cwd-proxy/src/extension.ts` — copy source for `LauncherService` (chunk 2).
- `/Users/alexmc/Developer/claude-cwd-proxy/claude-cwd-wrapper.sh` — vendor verbatim (chunk 2).
- `/Users/alexmc/Developer/thinkube-ai-integration/package.json` — add settings + view container + remove keybindings.
- `/Users/alexmc/Developer/vscode-extension-trello-kanban-board/` — fork target for chunk 5 kanban (extension/panel.ts, extension/interface.ts, src/, vite.config.ts).
- `/Users/alexmc/Developer/BMAD-METHOD/docs/` — methodology reference for `docs/METHODOLOGY.md` (chunk 12).
- `docs/VISION.md` — product mission, vision, and principles (read first).

## Appendix E: Methodology bundle file shapes (sketches)

The full skill / agent / settings authoring is chunk 12 work. These sketches lock the _shape_ so the chunk can move fast.

**Example skill** — `templates/methodology-bundle/skills/pair-next/SKILL.md`:

```markdown
---
description: Advance to the next Ready task in the current story; load context, verify previous task, move card.
argument-hint: (no args; uses active story from session state)
allowed-tools: ["Bash", "Read", "Grep", "Glob", "mcp__thinkube-kanban__*"]
---

# /pair-next

Advance to the next Ready task under the currently-active story.

## Procedure

1. Call `mcp__thinkube-kanban__list_tasks_in_spec` (or `gh issue list` as fallback) for the active story.
2. Identify the top Ready task. If none, summarise the story's status and stop.
3. Delegate to the `verifier` subagent to run tests + lint against the previous task's commits. If verifier returns red, block and report.
4. Call `mcp__thinkube-kanban__move_task` to move the Ready task to In Progress.
5. Load the task's issue body + the parent spec from `.thinkube/specs/SP-<n>.md` for context.
6. Hand the loaded context back to the main conversation for pair-programming on the task.
```

**Example subagent** — `templates/methodology-bundle/agents/explorer.md`:

```markdown
---
name: explorer
description: Read-only codebase research; preserves main pair-programming context.
tools: ["Read", "Grep", "Glob", "Bash"]
model: inherit
---

You are a read-only research assistant. Your job is to answer questions about code without modifying it. Return findings as a concise summary with file:line references. Never edit, write, or execute mutating commands. If asked to change something, refuse and remind the caller this is a read-only role.
```

**Example settings.json fragment** — `templates/methodology-bundle/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(gh issue:*)",
      "Bash(gh pr:*)",
      "Bash(gh project:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(npm test:*)",
      "Bash(pytest:*)",
      "Bash(cargo test:*)",
      "Read",
      "Grep",
      "Glob"
    ],
    "deny": ["Bash(rm -rf:*)", "Bash(git push --force:*)"]
  }
}
```

**Example `.mcp.json` fragment** — `templates/methodology-bundle/mcp.json`:

```json
{
  "mcpServers": {
    "thinkube-kanban": {
      "command": "node",
      "args": ["${extensionPath}/dist/kanban-mcp-stdio.js"],
      "env": {}
    }
  }
}
```

(The `${extensionPath}` placeholder is resolved at install time by `BundleInstaller`. The stdio fallback per §7.1 ensures this works whether or not `vscode.lm.registerMCPServer` is available in the host.)

## Appendix F: Sources informing rev 5

The methodology-bundle composition (§3.1) is anchored to:

- **Anthropic — Claude Code documentation** (May 2026):
  - [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — when to reach for each primitive.
  - [Custom subagents](https://code.claude.com/docs/en/sub-agents) — subagent purpose: preserve context, enforce constraints, specialize, control costs.
  - [Skills](https://code.claude.com/docs/en/skills) — "create a skill when you keep pasting the same procedure into chat"; slash commands have been merged into skills.
  - [Hooks](https://code.claude.com/docs/en/hooks) — "use when actions must happen every time with zero exceptions"; deterministic enforcement.
  - [MCP](https://code.claude.com/docs/en/mcp) — when to add a server; explicit preference for `gh` CLI over an MCP for GitHub when no live shared state is needed.
- **Competitive landscape** (May 2026 sources):
  - [cc-sdd repo + 17-skill bundle](https://github.com/gotalab/cc-sdd) — skills-only, no agents, no hooks, no GitHub coupling.
  - [BMAD-METHOD v6.6 plugin marketplace](https://github.com/bmad-code-org/BMAD-METHOD) — ~32 skills via plugin marketplace, persona-driven, no GitHub coupling, no kanban.
  - [Cursor 2.5 Plugins](https://forum.cursor.com/t/cursor-2-5-plugins/152124) and [Marketplace](https://cursor.com/marketplace) — domain-of-work plugins, not methodology-of-work.
  - [Windsurf Cascade + Rules + Workflows](https://docs.windsurf.com/windsurf/cascade/cascade), [Rules, Memories & Workflows tutorial](https://windsurf.com/university/general-education/intro-rules-memories).
  - [GitHub Copilot Workspace](https://githubnext.com/projects/copilot-workspace/) and [Planning a project with Copilot](https://docs.github.com/en/copilot/tutorials/plan-a-project) — closest GitHub-anchored competitor; closed.
  - [JetBrains Junie](https://www.jetbrains.com/junie/) — Ask/Brave plan modes, no preset workflows.
  - [Cline rules](https://docs.cline.bot/customization/cline-rules) — rules-only, no preset bundles.
  - [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) and [claude-code-kanban](https://github.com/NikiforovAll/claude-code-kanban) — kanban-for-Claude prior art (UI-only; no methodology bundle).
