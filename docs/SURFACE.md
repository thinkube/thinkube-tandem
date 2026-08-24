# The surface, read line by line

Every component of the webview was read in full: `App`, `Compose`,
`Analysis`, `Asks`, `IntentGraph`, `WorkGraph`, `Run`, `Rail`,
`Delivery`, `Markdown`, `nodeCard`, `world`, `type`, plus the two files
that feed them — `push.ts` and `run/state.ts` — and the gesture registry.

Fifty-one findings. Each one names the file and line that shows it.
Nothing here is a fix. The plan at the end is ordered work, and each item
says what would prove it done.

The first audit of this surface looked at which actions reach the host.
That is a list of wires, not a reading of a screen, and it missed
everything below. This one starts from what a person sees.

---

## A. What is drawn

Four tabs, one row, `App.tsx:263`.

| Tab | Files | What it holds |
|---|---|---|
| 0 · Write | `App.tsx`, `Compose.tsx`, `Analysis.tsx` | the box, the reading of it |
| 1 · Intent | `Asks.tsx`, `IntentGraph.tsx` | asks, subjects, claims |
| 2 · Work | `WorkGraph.tsx` | promises, where they land, what proves them |
| 3 · Orchestration | `Run.tsx`, `Delivery.tsx` | the workers, the delivery |

A rail 320 pixels wide sits beside all four (`App.tsx:474`).

Thirty actions reach the host (`vscode.ts:207-236`). Eighteen have a
registry entry (`affordances.ts`). Five have no button anywhere.

---

## B. Things that show nothing

**B1 — every card in a run is titled with a machine handle.**
`push.ts:124` resolves a card's title with

```
session.units.find((x) => x.id === u.slice)?.abstract?.title
```

`u.slice` is a run handle, `SL-7`. `session.units` are the space's unit
records, whose ids are nothing of the kind. The lookup never matches, so
`sliceTitle` is always undefined and every card in every run has fallen
back to its handle — `Run.tsx:151`, `Run.tsx:159`, `Rail.tsx:50`. This is
the whole of "SL-7 and SL-7#eu-0 tell nothing".

**B2 — three cards in a run carry the same title.**
For one slice the surface draws a tester (`Run.tsx:151`), a coder (same
line, same expression) and an auditor (`Run.tsx:159`). All three read
`u.sliceTitle ?? u.slice`. Only the colour band differs. The comment at
`Run.tsx:142-146` says the old defect was "drawing the same slice title
on three different nodes, so no card said which one it was". The fix
changed the maintainer only; the other three still collide.

**B3 — an audit card carries one chip and no criteria.**
`Run.tsx:161-165`: the chip is `green` or `waiting`. Nothing says which
criteria were graded, how many, or what any of them said. The card the
person most wants to read is the emptiest one on the page.

**B4 — clicking an audit card or the gate card opens an empty panel.**
`Run.tsx:343` posts `read-log` with the card's id for every card. Audit
cards have id `audit:SL-7`; the gate card has id `gate`. No step in the
run writes a log under either name — the run logs under unit ids, under
`run`, and under `gate#closer`. `logTail` returns nothing, and the rail
draws a panel titled `audit:SL-7` whose body is `(nothing yet)`.

**B5 — the closing gate's real log cannot be opened.**
It is written under `gate#closer` (`gate.ts:293`, `unkept.ts:228`). No
card has that id. There is no gesture that reaches it.

**B6 — the log panel's title is a raw step id.**
`Rail.tsx:43` — `<strong>{log.step}</strong>`. That is `SL-7#eu-0`, or
`run`, or `gate#closer`. When the step is not a unit, `Rail.tsx:184`
finds no unit and the whole explanatory block is skipped, so the panel is
an untitled wall of text. Beside the title sits an empty `<div>` in a
`space-between` row (`Rail.tsx:44`), left over from something removed.

**B7 — the log body is one block of joined lines.**
`Rail.tsx:98` — `log.lines.join("\n")` inside a `<pre>`. Worker prose,
`[oracle]` blocks and `[suite]` blocks arrive as one stream with no
separation, no entry boundaries, and no distinction between what a
worker said and what a tool printed.

**B8 — the rail is an empty column on two tabs.**
`App.tsx:474` draws it always. On Write and Intent there is no run log,
no parked worker, and `canBuild` is false, so `Rail.tsx:179-252` renders
a 320-pixel bordered column containing nothing.

**B9 — the in-flight list never says which subject.**
`WorkGraph.tsx:120-124` draws one row per subject being thought about:
`{g.label} — {g.current} of {g.total}`. With four subjects in flight
that is four identical lines. The name is in the payload and is not used.

**B10 — selecting a promise does nothing visible.**
`WorkGraph.tsx:341` calls `onSelect`, which posts `select-unit`. The only
visible consequence is the card's border colour (`WorkGraph.tsx:353`).
Nothing anywhere shows the selected promise.

**B11 — a re-run says "passed · no log yet" on the same card.**
When a run resumes, every unit of a slice whose work already stands is
marked done and **nothing is written to its log**
(`dispatch.ts:217-222` — `st.set(u.id, "done")` with no `log` call). The
surface then draws two chips from two different facts:

- `chipFor` reads state `done` and says **passed** (`Run.tsx:42`)
- `logChip` reads a count of 0 and says **no log yet**, with the hover
  "This step has not written anything yet." (`Run.tsx:57-62`)

Read together they contradict each other: a worker that passed with no
log. Clicking the card then opens an empty panel titled with the unit id
(B4, B6). And neither chip says the one true thing — this unit passed
**in an earlier run**, and was not run again.

The evidence exists. It is simply out of reach. Two files are written
per run and they behave differently:

- `runs/<tep>.log` is named per TEP and **appends**. Every run of that
  TEP is in it, including the first run's log for each standing unit.
- `runs/<cutId>.json` is named per CUT and is **rewritten** each run
  (`record.ts:88`). A re-run replaces it, and it shrinks, because the
  standing units contribute nothing this time round.

The surface reads only the second. `logView()` goes through `runState`,
which is the live run or `RunState.from(loadLastRun(...))`, and
`loadLastRun` takes `.endsWith(".json")` (`record.ts:107`). Nothing in
the product ever reads a `.log` back — `runLog.ts` is write-only, and
says so.

So the log that justifies the word "passed" is on disk, in a file no
screen and no gesture can open. That makes this the cheapest finding
here to fix: the data does not need to be produced, only reached.

**B12 — the closing gate does its work off the graph.**
The gate runs two actors: the finisher (`gate#suite-1`) and then the
closer (`gate#closer`, `gate.ts:244`). The finisher is seeded as a unit
only when it starts, and the closer is never a unit at all — it writes
to a step the graph has no card for (B5). So for the whole stretch
between the last worker finishing and the finisher starting, and again
for the entire closer, the surface shows a finished run and the machine
is working.

---

## C. Things that are not true

**C1 — `Fit` does not fit.**
`world.tsx:119` — `fit: () => setT({ tx: 30, ty: 30, k: 1 })`. It reads
neither the graph nor the viewport. The button says "Fit" and its
tooltip says "Fit everything on screen" (`world.tsx:139-140`). On a run
of twenty cards it leaves most of them off screen.

**C2 — the audit chip claims a check ran.**
Its hover text is "Every check for this slice passed against the real
state" (`Run.tsx:163`). The condition behind it is `graded()`,
`Run.tsx:134-135`, which is true when every **code** unit of the slice
reached `done`. It never looks at a check, and it ignores the tester and
the maintainer — so a slice whose tester failed can show green.

**C3 — a worker that finished is chipped "passed".**
`Run.tsx:42` maps state `done` to the word `passed`. `done` means the
worker stopped without failing. It is not a verdict.

**C4 — the surface guesses at the person.**
"Its last run ended without a delivery — if the window reloaded, the run
ended with it" — `WorkGraph.tsx:219` and `App.tsx:438`. The surface does
not know whether the window reloaded. The run's end is now written to the
ledger on shutdown; the sentence was never updated to read it.

**C5 — `Compose` names a button it does not have.**
Its own header says "Nothing is recorded until you press Record"
(`Compose.tsx:15`). The button is `Read N asks` (`Compose.tsx:194`).
Recording happens on a different screen, under `Keep N asks`
(`Analysis.tsx:188`).

**C6 — "every 'see it' line above is a way in" points at inert text.**
`Delivery.tsx:108`. The report is drawn by `Markdown.tsx`, which
understands headings, list items, quotes, bold and code spans. It does
not understand links. Nothing in a delivery report is clickable.

**C7 — the rail sends the reader to a place that does not exist.**
`Rail.tsx:204` — unanswered questions "are above the graph, and answering
one first replaces its answer with yours". No component draws
`push.questions`. Only its length is read, in that sentence and in
`App.tsx:211`.

**C8 — the gate card says "green" without the gate having run.**
`Run.tsx:177-183`: the chip is `green` when `allDone`, which is
`run.units.every((u) => u.state === "done")` (`Run.tsx:138`) — every
WORKER finished. The gate's own verdict is never consulted. Its hover
text is "Every check ran green at the gate", a claim about a gate that
may not have started.

Seen live: at 23:02 the last worker finished, every unit read done, and
the card said green for twelve minutes. The gate then ran the
repository's suite, found it red, and its finisher failed. The card had
announced the opposite of what happened, before it happened.

**C9 — a delivery report carries no identity.**
`Delivery.tsx:44` renders `<Markdown text={d.page} />` and nothing else:
no run, no TEP, no date. A report from a withheld run twenty-six minutes
ago is drawn exactly like one from the run finishing now. With C8 above,
a person reads a graph claiming the gate is green beside a report from a
different run, and nothing on the screen distinguishes either from the
truth.

---

## D. Things that overflow, or vanish

**D1 — a chip cannot wrap, and is given a sentence.**
`nodeCard.tsx:60` sets `whiteSpace: "nowrap"` on every chip.
`Run.tsx:33` builds the chip's text from the worker's raw activity line
with no length rule — sentences such as "supervisor pre-flight — reading
the brief against the checks". The card is 230 pixels wide
(`nodeCard.tsx:9`). The chip runs straight out of it, over its
neighbours. This is the overflow that was reported.

**D2 — one notch of zoom-out erases every state.**
`world.tsx:29` sets `far` below scale 0.62. `nodeCard.tsx:127` and
`nodeCard.tsx:132` then drop the second line **and every chip**. What
survives is the role band and the title — and by B1 the title is `SL-7`
and by B2 three cards share it. Zoomed out, running, passed, failed and
never-ran are indistinguishable. This is exactly the loss that was
reported.

**D3 — the work page's header may take 45% of the page.**
`WorkGraph.tsx:161` — `maxHeight: "45%", overflowY: "auto"`. Two banners
can occupy it (out-of-date, `:163`; signed-and-idle, `:202`), and the
second may be scrolled out of sight.

**D4 — the asks panel may take 16rem above the tab row.**
`Asks.tsx:100` — `maxHeight: "16rem", overflowY: "auto"`, and it is drawn
above the tabs (`App.tsx:240` vs `App.tsx:263`). This is the largest
single cause of the tab row moving.

**D5 — every delivery ever made is drawn in full, in one scroll.**
`Delivery.tsx:32` reverses the list and renders each report's whole page.
Nothing collapses an old one.

**D6 — the observations list is laid out as a button.**
`Delivery.tsx:110-119` puts the "for you to certify" list inside the flex
row that holds Accept, Not this and Run again (`Delivery.tsx:45-53`,
`alignItems: "center"`). The things a person must check before accepting
are drawn after the Accept button, squashed beside it.

---

## E. The frame moves

**E1 — three conditional blocks sit above the tab row.**
The capture row (`App.tsx:155`, shown only on Write), the asks panel
(`App.tsx:240`, shown only on Intent) and the legacy banner
(`App.tsx:249`). The row's vertical position is therefore different on
every tab, and different again as state changes.

**E2 — the orchestration tab grows two buttons once a delivery exists.**
`App.tsx:296` — the Workers / Delivery report switch is drawn only when
`hasReport`. The control row is one shape before a delivery and another
after it.

**E3 — the tab changes under the person, twice.**
`App.tsx:50` jumps to Orchestration whenever a run starts.
`App.tsx:57-62` jumps to Work when the thinking finishes, and the flag
that does it (`goingToWork`) survives navigating away, so the jump can
arrive minutes later on a screen the person chose.

**E4 — the host's message is invisible on three tabs of four.**
`App.tsx:236` draws `push.message` inside the capture block, and
`App.tsx:158` hides that block unless the tab is Write. Every refusal
note the host returns through `note` is drawn where most people are not.

**E5 — the thinking pill covers the row beneath it.**
`App.tsx:106-131` is `position: fixed, top: 8, left: 50%`. On Write it
sits over the "Asking in" row.

---

## F. One thing, many names

**F1 — one action, several labels.**

| Action | Labels in the product | Where |
|---|---|---|
| `think` | "Work it out now" · "See what this will build →" · "Keep this reading and see what it will build →" · "Working out what to build…" | `WorkGraph.tsx:143`, `IntentGraph.tsx:317-321` |
| `think-again` | "Think it through again" · "Think TEP-… again" | `WorkGraph.tsx:228`, `Run.tsx:100` |
| `retry-model` | "Read it again" · "Read what I wrote" | `IntentGraph.tsx:227`, `IntentGraph.tsx:250` |
| `read-draft` | "Read N asks" · "Read it again" · "press Read" | `Compose.tsx:194`, `Analysis.tsx:178`, `App.tsx:376` |
| `build` | "Sign and build N subjects" · "press Build" | `Rail.tsx:242`, `App.tsx:461` |
| `rerun` | "Run TEP-… again" · "Run it again" | `Delivery.tsx:26`, `Run.tsx:89` |
| `switch-repo` | "Choose project…" · "switch" | `App.tsx:98`, `App.tsx:152` |

"Read it again" is the label of **two different actions** —
`retry-model` on Intent, `read-draft` on Write.

**F2 — the registry names eleven surfaces for four screens.**
`affordances.ts`: "the writing page", "the work page", "the reading
page", "the work graph", "the work graph's panel", "the intent graph",
"orchestration graph", "run view", "map toolbar", "units map", "delivery
page". None of these is a tab label.

**F3 — five registry entries describe a gesture the product does not
have.**

| Entry | Registry says | The product has |
|---|---|---|
| `dismiss-promise` | "press Dismiss on a promise", on the work graph's panel | a button "Remove", in the orphans box on Intent (`IntentGraph.tsx:350`) |
| `reground` | "press an out-of-date badge" | a button "Read the code again" in a banner; the badge (`WorkGraph.tsx:471`) is not clickable |
| `build` | "press Build" | "Sign and build N subjects" |
| `read-log` | "click a step … and page through it" | paging was removed; the panel scrolls |
| `panic` | "map toolbar" | the capture row on Write (`App.tsx:224`) |

**F4 — twelve of thirty actions have no registry entry, and five have no
button at all.**
Unregistered: `accept-check`, `accept-impact`, `accept-question`,
`apply-all-impacts`, `cancel-capture`, `dismiss-impact`, `load`,
`open-cut-review`, `pin`, `propose-check`, `rerun`, `switch-repo`.
Of these, `load` is an internal handshake. The other four unreachable
ones — `accept-impact`, `dismiss-impact`, `apply-all-impacts`,
`accept-question` — plus `pin` have no gesture anywhere in the webview.
The host handles the first three (`inbound.ts:110-119`), and `push.ts`
computes and sends `impacts` on every push (`push.ts:155-160`) to a
surface that never reads it.

**F5 — two words for one thing, throughout.**
*probes* (`Run.tsx:253`, `Rail.tsx:64`) against *checks* everywhere else.
*project* (`App.tsx:92`, `App.tsx:98`) against *repository*
(`App.tsx:148`). *forge* appears once, in a tooltip (`Delivery.tsx:92`),
and nowhere else on the surface.

**F6 — machine identifiers are used as words in sentences.**
`WorkGraph.tsx:218` opens a sentence with `TEP-cmxela-12`.
`Rail.tsx:201` says "mints a TEP number", unexplained.
`App.tsx:209` says "N TEP(s)". `Delivery.tsx:26` and `Run.tsx:89,100`
put one inside a button label. `Rail.tsx:63` prints a raw unit id
(`SL-7#eu-0`) as the thing a worker waits for.

---

## G. A refusal that is not said

**G1 — `post()` swallows a disallowed action silently.**
`vscode.ts:284` — `if (!can(msg.action)) return;`. No message, no log,
nothing on the screen. `can()` reads the `allowed` list from the last
push, so a button rendered from an older push can be enabled while the
post is dropped. Every report of "the button does nothing" is explained
by this line.

**G2 — `whyNot()` gives one sentence per phase, not per refusal.**
`vscode.ts:272-281`. Every disabled control in phase `read` says "The
reading is waiting for keep or edit", whatever it was actually refused
for — and it says it only on hover.

---

## H. The same thing, drawn twice

**H1 — a parked worker's question has two answer boxes.**
On its card (`Run.tsx:346-368`) and in the rail (`Rail.tsx:126-156`).
Two inputs, two Send buttons, no shared state: typing in one leaves the
other empty.

**H2 — the asks are drawn twice, in two shapes.**
The Write tab's list (`App.tsx:332-359`) has no assumptions and no edit
pencil. The Intent tab's panel (`Asks.tsx`) has both. Neither says the
other exists; the Write copy sends the reader to Intent to edit.

**H3 — the unplaced sentences are said twice, differently.**
"I could not place N of your sentences" (`IntentGraph.tsx:99`) and "I
could not say what N of your sentences are about" (`Analysis.tsx:170`).
Same field, `model.missing`.

**H4 — the signed-and-idle banner is said twice.**
`WorkGraph.tsx:202-234` and `App.tsx:436-440`, in slightly different
words, with different buttons attached.

**H5 — progress is shown in five places at once.**
The fixed pill (`App.tsx:106`), the capture bar (`App.tsx:182`), each
subject's own line (`IntentGraph.tsx:129`), the working box
(`IntentGraph.tsx:280`), and the work page's empty state
(`WorkGraph.tsx:112`).

---

## I. Sentences that point the wrong way

**I1** — `WorkGraph.tsx:148`: "write what you want on the intent page".
Writing happens on 0 · Write.

**I2** — `IntentGraph.tsx:255`: "write what you want above". On the
Intent tab the box is hidden (`App.tsx:158`). "Above" is nothing.

**I3** — `WorkGraph.tsx:231`: "use the run page". No tab has that name.

**I4** — `WorkGraph.tsx:398`: a drifted check says "re-anchor". There is
no gesture that re-anchors anything.

---

## J. Rules the surface breaks against its own `type.ts`

`type.ts:12-18` states three rules: the word carries the meaning, nothing
that carries meaning is italic, capitals are for captions only.

**J1** — the written-in subject is italic, and it carries meaning:
`Analysis.tsx:102-104`, and again in that page's own legend
(`Analysis.tsx:153`).

**J2** — in a delivery report a level-2 heading is drawn as a caption at
11 pixels (`Markdown.tsx:106`) while a level-3 heading is 14
(`Markdown.tsx:110`). The hierarchy inverts.

**J3** — "red" is used as a state word for a person to read:
`WorkGraph.tsx:400`. Colour is being asked to carry meaning as a name.

**J4** — parenthetical plurals sit beside correct ones in the same files:
`subject(s)` and `TEP(s)` (`App.tsx:209`) against `ask{s}` twelve lines
later; `thing(s)` (`IntentGraph.tsx:338`); `sentence(s)` (`Asks.tsx:72`).

**J5** — `Run.tsx:184` spreads `{ children: undefined }` or `{}` into the
gate card. It does nothing either way.

---

## K. What the surface cannot show yet

The request was for an audit card to show the criteria that were checked.
That cannot be drawn today, and the reason is not in the webview.

`RunUnitView` (`run/state.ts:20-44`) carries `what`, `id`, `slice`,
`role`, `state`, `requires`, `waits`, `startedAt`, `question`, `note`,
`activity`. `view()` (`run/state.ts:195-208`) adds `logs`, `parked` and
`logCounts`. **There is no per-criterion field anywhere in the run
view.** The oracle's verdicts exist only as text inside a step's log.

So B3 is not a drawing problem. Until the dispatcher records each
criterion's id, its sentence and its verdict on the run state, no card
can show an AC, and the audit card has nothing to say but green or
waiting. This is the first item of the plan for that reason.

---

## The plan

Ordered. Later items assume earlier ones. Each says what would prove it.

**1. Put the work's own words, and its verdicts, into the run view.**
Fix the title lookup at its source so a card can be named for the promise
rather than the handle, and add per-criterion results to `RunUnitView`:
the criterion's id, its sentence, and what the oracle said. *Proven
when:* no card in any run falls back to `SL-…`, and the run view of a
finished run contains every criterion the oracle graded.
Covers B1, B9, K.

**2. A card says which one it is, and what state it is in at any zoom.**
The tester, the coder and the auditor of one slice read differently.
State becomes the card's own shape — fill or border — so it survives
`far`, and the chip keeps the detail for when it can be read. An
activity chip is clipped to the card at the source, with the sentence on
hover. *Proven when:* at the smallest zoom the four states are
distinguishable with all text unreadable, and no chip crosses a card's
edge for any sentence a worker emits.
Covers B2, C3, D1, D2.

**3. The audit card shows what it graded.**
The criteria, how many passed, and which did not — from the data added in
item 1. `graded()` stops claiming a check ran when it only counted
finished workers, and stops ignoring the tester and the maintainer.
*Proven when:* an audit card lists its criteria, and a slice with a
failed tester cannot show green.
Covers B3, C2.

**4. Every log has a title in words, and a body with structure.**
The panel is titled for what the step is, not for its id. Steps with no
log of their own are not clickable; the closing gate's log gets a card
that reaches it. Machine output is separated from what a worker said.
*Proven when:* no panel opens empty, no panel is titled with an id, and
`gate#closer` is reachable by one gesture.
Covers B4, B5, B6, B7.

**4b. A reused unit says it was reused, and its log stays reachable.**
A unit carried over from an earlier run reads as carried over — one
chip, naming the run it passed in — instead of "passed" beside "no log
yet". Its log is already on disk in the TEP's own `.log`; the surface
reaches that file instead of showing an empty panel. Nothing new has to
be produced, only read.
*Proven when:* a resumed run shows no card claiming a pass with no
evidence, and opening a carried-over unit shows the log from the run it
passed in.
Covers B11.

**5. One action, one name.**
The registry becomes the source of the label, the screen and the gesture.
Buttons read their label from it. Its screen names become the four tab
names. Its gestures are corrected to what the product does. Every action
that reaches the host gets an entry or an explicit machine-only reason.
*Proven when:* the drive that walks the registry fails if an action has
two labels, no entry, or a screen name that is not a tab.
Covers F1, F2, F3, F4.

**6. A refusal is said, never swallowed.**
`post()` reports a dropped action on the screen. `whyNot()` answers for
the action asked about, not for the phase in general, and the reason is
visible without hovering. *Proven when:* pressing any disabled or
refused control produces a visible sentence naming that control.
Covers G1, G2.

**7. The frame stands still.**
The tab row is fixed and everything conditional lives below it. The
orchestration tab's own controls do not appear and disappear with the
delivery. A tab changes only when the person changes it. The host's
message is drawn where every screen can show it. *Proven when:* the tab
row is at the same y on every tab in every state, and no state change
moves the person to another tab.
Covers D4, E1, E2, E3, E4, E5.

**8. Nothing is drawn twice.**
One answer box per parked worker. One list of asks. One sentence for the
unplaced ones. One signed-and-idle banner. One place that shows progress.
*Proven when:* each of those five things has exactly one site.
Covers H1, H2, H3, H4, H5.

**9. Every sentence points at something that exists.**
Fit fits. The reload sentence reads the ledger instead of guessing. The
"see it" lines are links, or the sentence goes. `Compose`'s header names
the button it has. The rail stops pointing at questions nothing draws.
The four misdirections in section I are corrected.
*Proven when:* every instruction on the surface names a control that is
on that screen.
Covers C1, C4, C5, C6, C7, I1, I2, I3, I4.

**10. Decide the unreachable features.**
`impacts` and `questions` are computed and pushed on every change and
never drawn; `accept-impact`, `dismiss-impact`, `apply-all-impacts`,
`accept-question` and `pin` have no gesture. Each is either given a
screen or removed from the payload, the message type and the host. There
is no third option — a feature that only the machine can reach is a cost
paid on every push for nothing.
*Proven when:* every field in `SpacePush` is read by a component, and
every action in `WebToHost` has a caller.
Covers F4.

**11. The surface obeys its own type rules, and stops wasting the page.**
Nothing that carries meaning is italic. A report's headings do not invert.
No colour is used as a state's name. Plurals are written out. The rail is
not drawn when it holds nothing. The work header stops taking 45%. Old
deliveries collapse. The observations list leaves the button row. The
dead spread on the gate card goes, and so does the empty div beside the
log title.
*Proven when:* the type rules in `type.ts:12-18` hold everywhere, and no
screen draws an empty container.
Covers B8, B10, D3, D5, D6, J1, J2, J3, J4, J5.

---

## What this does not cover

The three graphs — intent, work, run — share no layout code and differ in
their gestures: one is a scrolling grid, one is a pannable world of framed
sections, one is a pannable world of laid-out cards. Making them one
drawing with one set of interactions is a larger question than any item
above, and it should be answered after items 1 to 4, which are about a
person being able to read a run at all.

---

## L. Found by the headless journey

The journey driver (`src/cli/journey.ts`) runs the whole thing without a
window. Two faults surfaced in its first two attempts, before any worker
was dispatched — both invisible from the editor, because the editor keeps
one session in memory and never exercises these paths.

**L1 — a forge is optional in the type and required by the gate.**
`SessionDeps.forge` is documented "absent means deliveries stay local
branches". `runGate.ts:50-55` refuses to start a run without one. The
first journey read the repository, derived eleven promises over ten
minutes, and stopped at the last step for a missing setting — the whole
cost of the journey paid for a note. The journey now resolves the forge
first and refuses before it spends; the contradiction in the type is
still there.

**L2 — a cut signed in one process fails its own signature in the next.**
`signCut` then `verifyCutSignature` agree in memory and across a JSON
round trip (driven directly, both green). But a cut signed by a session
and then loaded by `loadFolded` in a second process is refused: *"the
render changed since the signature"*. The grounding half of the pair
still matches, so the difference is in the render's other half —
sentences, checks, needs, unverified — and no recorded state of that
space reproduces the signed hash: every snapshot before and after the
signature renders to the same value, and it is not the one stored.

Not chased to the bottom. What is known: the machinery is sound in
isolation, `loadFolded` is given the same directory for both the store
and the fold in both headless entry points, and the editor never meets
this because it signs and runs in one session.

**L3 — the deferral scan reads its own implementation as confessions.**
The closing gate scans every delivered file for confessed deferrals —
`TODO`, `FIXME`, `UNDELIVERED:` and friends. A run that changed the
machinery implementing that scan was handed its own source back as four
confessions:

```
src/run/plan.ts:241 confesses a deferral:
  const OTHER_MARKERS = /\b(TODO|FIXME|XXX|HACK|…)\b/i;
src/run/gate.ts:458  confesses a deferral: `UNDELIVERED:\n${…}`
src/run/shapes.ts:176 confesses a deferral: "UNDELIVERED: none"
```

The first is the regular expression that DEFINES the vocabulary, the
second is the code that FORMATS the report, the third is a fixture. None
is a deferral. `isDeferralVocabulary` already exists to catch exactly
this and only looks at the matched text, which in every case is the
marker itself.

The impact is bounded but real: a run cannot deliver a change that
touches the deferral machinery, and it says so in words that read like
the delivery is dishonest.

Not fixed. Every rule that would separate "a marker word being defined"
from "a marker word being confessed" is a heuristic, and this one sits
in the gate that decides whether work is handed over. It is written down
rather than guessed at.
