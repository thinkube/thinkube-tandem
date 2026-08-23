# The surface: what it is today, and what has to change

Read from the code on 23 August, not from memory. Every finding names the
file and line that shows it. Nothing here is a fix; the plan at the end is
ordered work, each item with the thing that would prove it.

## What exists

Four tabs, one row, drawn once in `App.tsx:263`:

| Tab | Screen | What it holds |
|---|---|---|
| 0 · Write | `App.tsx` | the draft, the reading of it |
| 1 · Intent | `IntentGraph.tsx` | asks, subjects, claims |
| 2 · Work | `WorkGraph.tsx` + `Rail.tsx` | promises, their checks, the cut review, Sign and build |
| 3 · Orchestration | `Run.tsx` + `Delivery.tsx` | the workers, the delivery |

Twenty-eight actions reach the host. Twelve are in the gesture registry
(`affordances.ts`); sixteen are not.

## Findings

### 1. A worker's card says nothing

`Run.tsx:151` titles a card `u.sliceTitle ?? u.slice`, so it falls back to
`SL-7`. The title is resolved in `push.ts:124`:

```
session.units.find((x) => x.id === u.slice)?.abstract?.title
```

`u.slice` is a run handle — `SL-7`. `session.units` are the space's own
unit records, whose ids are nothing of the kind. The lookup never matches,
so **every** card in every run has fallen back to its handle. The person
sees `SL-7` and `SL-7#eu-0`, which name a place in the machine and nothing
about the work.

### 2. The activity tag is raw worker text

`Run.tsx:33` builds a chip from `u.activity.text` with no length rule, and
the strings it renders are sentences: *"supervisor pre-flight — reading the
brief against the checks"*. The chip is inside a fixed-width card, so the
text overflows its node.

### 3. Zoomed out, state disappears

Zoom is one CSS transform over the whole canvas (`Run.tsx:298`). Nothing
switches to a coarser drawing as it shrinks. A card's **role** is a colour
band (`Run.tsx:149`), so roles stay legible; a card's **state** —
running, passed, failed, waiting — exists only as small text inside the
chip. Zoom out and the one thing a person is watching for is the first
thing to go.

### 4. One action, several labels

| Action | Labels in the product | Where |
|---|---|---|
| `retry-model` | "Read it again" / "Read what I wrote" | `IntentGraph.tsx` twice |
| `think-again` | "Think …" / "Think it through again" | `Run.tsx`, `WorkGraph.tsx` |
| `think` | "Work it out now" / unlabelled | `WorkGraph.tsx`, `App.tsx` |
| `rerun` | "Run … again" | `Run.tsx`, `Delivery.tsx` |
| `switch-repo` | "Choose project…" / unlabelled | `App.tsx` twice |

Two of these are duplicates of the same gesture on two screens, with
different words. `switch-repo` says *project* where the tab bar, the
commands and the docs say *repository*.

### 5. Three vocabularies for one thing

An action has an internal name (`think`), a button label ("Work it out
now"), and a registry entry that names a surface and a gesture — and the
registry covers twelve of twenty-eight. Instructions written from the code
name the first, the person sees the second. Every instruction has to be
translated by hand, and it has been, wrongly, several times today.

### 6. Orchestration is three screens sharing a tab

`App.tsx:434-460` chooses between a live run, the remains of a dead run,
and a delivery, by state. The three have different layouts, different
controls, and different silences: when nothing is running, the tab shows
what the last run left, with no line saying that nothing is running now —
which is how a dead run and a working one came to look the same.

### 7. The tab row moves

The row is drawn once, but what sits above it is conditional: a legacy
banner (`App.tsx:250`), the draft box, the reading strip. The row's
vertical position therefore depends on the screen and its state, which is
what makes the tabs feel like they move.

### 8. Feedback lands where the gesture is not

Derivation shows its progress on the intent screen; the gesture that
starts it sits on the work screen. A fixed pill at the top of every screen
(`App.tsx:106`) does say *"the machine is …"*, so the fact is not hidden —
but a person who pressed a button on one screen has no confirmation on the
screen they are looking at.

## The plan

Ordered. Each item names the rule it serves and what would prove it.

**1. A card is named for the work, not for the machine.**
Carry the promise's own sentence into the run view where the slice is
built (the dispatcher knows both), and title the card with it; the handle
stays underneath as the address. *Proven when:* a run's cards read as
sentences a person wrote, and no card in any state falls back to `SL-…`.

**2. State survives zoom.**
State becomes a shape, not a sentence: the card's own fill or border says
running, passed, failed, waiting, and stays legible at any scale. The chip
keeps the detail for when it can be read. *Proven when:* at the smallest
zoom the four states are distinguishable with the text unreadable.

**3. An activity tag is one short line.**
The worker's text is clipped to the card's width at the source, with the
full sentence on hover and in the log. *Proven when:* no node's tag
overflows its card, at any zoom, for any of the sentences the workers
actually emit.

**4. One action, one name, everywhere.**
The registry becomes the single source: label, screen, gesture. Buttons
read their label from it; duplicates are removed or made explicit;
`switch-repo` says repository. *Proven when:* every action reaching the
host has exactly one registry entry, one label, and the drive that says so
fails when a second label appears.

**5. The orchestration tab states what it is showing.**
One frame, three contents, and a line at the top that says which: a run in
flight, what a finished run left, or a delivery waiting for you. *Proven
when:* with nothing running, the tab says nothing is running.

**6. The frame does not move.**
The tab row is fixed; banners live below it. *Proven when:* the row's
position is the same on every screen in every state.

**7. A gesture answers where it was pressed.**
Every action that starts work leaves a line where the button is, until the
work is visible elsewhere. *Proven when:* pressing a button on any screen
changes something on that screen.

## What this does not cover

The three graphs (intent, work, run) share no layout code and differ in
their gestures. That is a fourth screen-level question — one drawing, one
set of interactions — and it should be answered after 1 to 3, which are
about a person being able to read a run at all.
