---
description: Append a structured retro note to today's .thinkube/retros/{YYYY-MM-DD}.md. Light-touch journaling for what we learned today.
allowed-tools:
  ["Read", "Write", "Edit", "mcp__thinkube-kanban__write_retro_note"]
argument-hint: "<freeform note>"
thinkube-bundle: 0.0.1
---

# /retro

Append a structured retro note to today's retros file. Quick, low-ceremony — the goal is that retros accumulate naturally as a journal rather than requiring a formal end-of-cycle meeting.

## Mission

Add a timestamped section to `.thinkube/retros/{YYYY-MM-DD}.md` capturing one of the standard retro lenses: _kept_, _changed_, _learned_, _blocked_. The user passes a note; the skill asks one clarifying question about which lens (or infers from the note), then writes.

## Procedure

1. **Classify the note.** From the user's freeform text, infer the lens:
   - **kept**: a practice that worked, worth keeping.
   - **changed**: a decision to do something differently going forward.
   - **learned**: a fact or insight surfaced during the work.
   - **blocked**: a recurring blocker worth naming for the next cycle.

   If the inference isn't confident, ask the user once. If still ambiguous, write under `## misc`.

2. **Write.** Call `mcp__thinkube-kanban__write_retro_note` with the note text framed under the chosen lens. The MCP tool appends to today's file with a timestamp.

   The file shape ends up looking like:

```
---
kind: retro
repo: <owner>/<name>
status: active
created: <YYYY-MM-DD>
---

# Retro — <YYYY-MM-DD>

## 2026-05-19 14:32

### learned

PostgreSQL JSONB columns can't be indexed via GIN without an opclass. Spent 40 min on this.

## 2026-05-19 16:08

### kept

Pair-programming on the auth-callback slice — Claude caught two off-by-one cases in the state validation.
```

3. **Acknowledge.** One line: "✏ Logged to .thinkube/retros/2026-05-19.md".

## Constraints

- **One note per call.** Don't batch — the granularity is the point.
- **Don't paraphrase the user's note.** Lens classification + light formatting only.
- **Don't read existing retros** unless the user asks for context. The skill is write-mostly.

## Output

A short confirmation:

```
✏ Logged under #learned to .thinkube/retros/2026-05-19.md
```

## Safety / fallback

- **No `.thinkube/retros/` directory.** The MCP tool creates it on demand; no special handling needed here.
- **Multi-day backlog.** If the user has a note about something that happened on a different day ("yesterday I learned…"), still log it to _today's_ file but note the original date in the body. The retro file is a journal of _when you reflected_, not _when it happened_.
