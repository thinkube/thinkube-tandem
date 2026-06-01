# The Thinkube methodology

This is the methodology the extension is built around. It's opinionated, but the opinions are recoverable: every artefact lives in your repo, every transition is just a GitHub Projects v2 mutation, every skill is a markdown file you can edit. The extension is a UI on top of a workflow you could (and arguably should) be able to run from the shell with `gh` if you wanted to.

---

## 1. Pair programming, human + AI

The unit of work in Thinkube is a **pair-programming session**, not a queued task or an autonomous agent run. One human + one Claude session work together on one Task at a time, with clear roles.

Two roles, three modes:

| Mode             | Who can write                      | When to use                                                                                                      |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `navigator`      | Human drives; AI reads + proposes. | When the human wants close control over the diff — architectural decisions, sensitive code, learning a new area. |
| `driver`         | AI drives; the human reviews.      | When the work is well-specified and the human wants to focus on review rather than typing.                       |
| `both` (default) | Either party writes at will.       | The natural pair-programming mode.                                                                               |

The mode is **observable** in the kanban panel header (badge: `NAVIGATOR` / `DRIVER` / `BOTH`) and **enforced** by the MCP server (in `navigator`, write tools refuse). Switch the mode mid-session via the `thinkube.kanban.mode` setting; the kanban and the MCP server both react.

This is **not autonomous-agent dispatch.** No queues, no background runners, no "give Claude this Story and come back in 4 hours." If you want that, several other projects exist; Thinkube isn't one of them. The reason is taste: we believe the unit of intellectual progress in software is the conversation that happens during decisions, not the typing that happens after them — and that conversation only happens when a human is in the loop.

---

## 2. Hierarchy

Work has four tiers. Each tier is a GitHub issue type (`Epic`/`Story`/`Spec`/`Task`) plus a markdown sidecar in `.thinkube/`.

```
Epic    EP-12   .thinkube/epics/EP-12.md       weeks-of-work outcome
  └─ Story    ST-34   .thinkube/stories/ST-34.md    one user-observable deliverable
       └─ Spec     SP-50   .thinkube/specs/SP-50.md      one technical slice
            └─ Task    #142    (no sidecar)                  1–3 hours of focused work
```

Reading the column from the top: **Epic** is "the thing we're building this quarter"; **Story** is "the thing a user can do after this lands"; **Spec** is "how, technically"; **Task** is "the next 1–3 hours of my keyboard".

GitHub Issue Types are the source of truth for the typing. If your repo has Issue Types configured (the preferred path), the extension reads + writes them directly. If not, it falls back to labels (`epic` / `story` / `spec` / `task`) — the `IssueClassifier` handles both transparently.

### Why a sidecar plus an issue?

The issue is the **source of truth** for state — what column it's in, who's working on it, what was discussed. The sidecar (`.thinkube/<kind>/<prefix>-<n>.md`) is the **long-form** — acceptance criteria checklist, design notes, links, anything that doesn't fit naturally in an issue body. Both are committed to your repo. You can edit either side; the methodology bundle's skills tend to write the sidecar and mirror the body when the issue is empty.

---

## 3. The six-column workflow

The kanban has six columns, in this order:

| Column      | What it means                                                                                      | Gate to enter                                                |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Spec        | Spec issue exists but the body isn't fully written.                                                | (no gate)                                                    |
| Ready       | Spec body has acceptance criteria; tasks have been materialised; available to pull.                | **Spec has a non-empty `## Acceptance Criteria` checklist.** |
| In Progress | A pair is actively working on this Task right now.                                                 | (no gate)                                                    |
| Review      | Code written; awaiting `reviewer` subagent or human review. A summary comment exists on the issue. | **At least one comment on the issue.**                       |
| Verify      | Reviewed; awaiting `verifier` subagent (tests + lint + typecheck).                                 | **All acceptance criteria in the parent Spec are checked.**  |
| Done        | Shipped or merged.                                                                                 | (no gate)                                                    |

Gates are enforced by the kanban panel — drag a card across a gate boundary without meeting the condition and the move snaps back with a toast naming the missing condition. Gates are _also_ checked by the MCP `move_task` tool, so AI-driven moves get the same treatment.

The gate names + their reasons live in `src/methodology/qualityGates.ts`. They're pure functions — easy to call from a skill (`/pair-next`'s verifier delegation walks the same code path).

---

## 4. Day-in-the-life

### Tuesday morning — starting a new Story

Alex has a fresh thought: "users should be able to sign in with a magic link." Run `/story-new <epic-number>` on the active "Auth" Epic. Claude proposes a Story title + user-observable acceptance criteria; Alex tweaks the AC; Claude creates the Story issue and the `.thinkube/stories/ST-34.md` sidecar.

Two Specs are needed: backend endpoint, frontend form. Alex creates them by hand via the **New Spec** button in the Roadmap (or asks Claude to via the MCP).

Now `/spec-prepare 50` for the backend spec. Claude reads SP-50's body (empty), walks up to ST-34 to ground itself in the user outcomes, and asks Alex about the design: how to store the magic-link token, TTL, rate limit. Each section gets confirmed; Claude writes `.thinkube/specs/SP-50.md` with all four canonical sections.

`/tasks-decompose 50`. Claude reads the spec, proposes 6 tasks (1–3h each), marks 2 as `(P)` parallel-eligible, identifies one dependency. The toast pops: "Materialise 6 tasks for SP-50?" Alex hits Materialise. Six Task issues appear in the kanban Ready column.

`/pair-start 34`. Claude loads the Story + both Specs + the 6 Ready Tasks and proposes a starting Task. Alex confirms; Claude moves it to In Progress; pairing begins.

### Tuesday afternoon — `/pair-next`

The first Task is done. Run `/pair-next`. Claude delegates to the `verifier` subagent: `npm test` (green, 247 passed), `npm run lint` (clean), `npm run typecheck` (clean). Pass.

Claude posts a one-paragraph comment summarising what changed (key files, the rate-limit choice, what reviewers should look at). The In-Progress→Review gate now passes (comment exists). The Task moves to Review.

Claude picks the next Ready Task — the parallel-eligible one sibling. Moves it to In Progress. Loads its context. Asks Alex what to do first.

### Wednesday — `/retro`

Friday afternoon. Alex runs `/retro "Pair-programming on the auth-callback handler — Claude caught two off-by-one cases in the state validation."` Claude classifies it as `### kept`, appends to today's `.thinkube/retros/2026-05-22.md`. Done.

---

## 5. The `--quick` escape hatch

The four-tier hierarchy is right for medium-and-larger work and **overkill for solo bugfix-shape work**. `/pair-start-quick "fix the login redirect bug when token has just expired"` exists for that case:

- Drafts a one-paragraph spec inline (one AC line, one design paragraph, no Constraints/File-Plan sections).
- Creates the Spec issue + sidecar under a host Story you point at (a "Day-to-day" Story is the typical pattern).
- Writes a one-row tasks file.
- Materialises one Task in Ready.
- Moves it to In Progress.
- Drops you into pair-programming on the Task.

Same artefacts as the full flow — the work stays first-class on the kanban — just without the Epic / Story / multi-task scaffolding. This is the escape hatch for "I just need to fix this." If you keep coming back with multi-task bugfixes against the same thing, that's a real Story trying to emerge; promote it.

---

## 6. Skill catalogue

The methodology bundle (installed via **Thinkube Kanban: Install Methodology Bundle**) ships:

**Workflow skills**

- `/epic-new` — create an Epic.
- `/story-new <epic-number>` — create a Story under an Epic.
- `/spec-prepare <spec-number>` — fill in a Spec body to the canonical four-section shape.
- `/tasks-decompose <spec-number>` — generate `SP-{n}-tasks.md` from a prepared Spec.
- `/tasks-materialize <spec-number>` — turn unchecked rows into GitHub Task issues + project items in Ready.

**Pair-programming orchestration**

- `/pair-start <story-number>` — load context, surface next Task pick.
- `/pair-next` — verify previous Task, comment, move forward, pick next.
- `/board` — text snapshot of the kanban.
- `/retro <freeform note>` — append to today's retro file under a classified lens.
- `/pair-start-quick <description>` — ceremony defuser.

**Reference (loaded by other skills; not user-invocable)**

- `methodology-context` — vocabulary, hierarchy, workflow descriptions.
- `repo-conventions` — branch / PR / commit / test-command conventions for _this_ project. **Hand-edit after install** to set your project's actual test commands.

**Subagents** (delegate via the `Task` tool to keep main context lean)

- `explorer` — read-only codebase research. Refuses any write.
- `reviewer` — adversarial diff review against the Spec's acceptance criteria.
- `verifier` — runs tests + lint + typecheck. Gates Review → Verify.

---

## 7. Where things live

```
your-project/
├── .claude/                          ← Claude Code config
│   ├── settings.json                 (permissions + hooks)
│   ├── skills/                       (the 11 bundle skills + your own)
│   ├── agents/                       (the 3 bundle subagents + your own)
│   └── …
├── .mcp.json                         ← MCP server entries (incl. thinkube-kanban)
├── .thinkube/                        ← methodology artefacts, committed to the repo
│   ├── .bundle-version.json          (install metadata for drift detection)
│   ├── epics/EP-{n}.md
│   ├── stories/ST-{n}.md
│   ├── specs/SP-{n}.md
│   ├── specs/SP-{n}-tasks.md         (the task decomposition)
│   ├── decisions/ADR-{n}.md
│   └── retros/{YYYY-MM-DD}.md
├── CLAUDE.md                         ← project instructions, with the methodology block
└── src/, etc.                        ← your code
```

The whole methodology is git-tracked. If the extension breaks tomorrow, the artefacts are still your repo.

---

## 8. Further reading

These are referenced for inspiration only — the methodology stands on its own:

- **BMAD-METHOD** ([bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) — an Agile-AI methodology with persona-based agents (PM / Architect / Developer / UX / …). The phasing (analysis → planning → architecture → implementation) maps loosely onto our Epic → Story → Spec → Task hierarchy. The persona system is interesting but explicitly out of scope for v0.1.0 — a possible future "Ask the Architect persona" mode on top of the existing roles.
- **Anthropic's Claude Code documentation** — best-practices, custom subagents, skills, hooks, MCP. The methodology bundle is built around the patterns documented there (skills as the unit, subagents to preserve main context, hooks reserved for "every-time" enforcement).

---

## 9. What this is not

- Not autonomous-agent dispatch — see §1.
- Not a Claude Code replacement — Claude Code runs the show; the extension provides the MCP tools and the board.
- Not a custom backend — no SQLite, no Postgres, no separate server. GitHub + repo files.
- Not a straitjacket — the hierarchy is opinionated, but the conversations at each level are free-form pair programming. The methodology makes the _artefacts_ first-class; what you say to Claude during a pair session is on you.
- Not finished — this is v0.1.0. The skill prompts have been used on real work but they'll keep evolving. Feedback and PRs are welcome.
