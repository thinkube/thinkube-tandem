# The internal documentation, and what each file is for

These are the maintainer's documents: how the machine is designed, why it
is designed that way, and what it currently is. They are written for
whoever changes Tandem, not for whoever uses it. The user's documentation
is the Antora site under `modules/ROOT/pages/` — see the bottom of this
page for how the two relate.

## Start here

| Read | When you want |
|---|---|
| [TERMINOLOGY.md](TERMINOLOGY.md) | the canonical word for a thing. One meaning per word. A term not on this list is either plain English or does not belong in the product. |
| [PROCESS.md](PROCESS.md) | who decides what, and what happens at each control point when the answer is no. The actors, the states, the eight gates G0–G8, the artifacts, and why the loop ends. |
| [RULES.md](RULES.md) | the eight rules, each naming the failure it prevents **and what it removes**. A rule that only adds machinery is the disease, not the cure. |

Those three carry the design. Everything else is evidence, history, or
work in flight.

## The design and its evidence

| File | What it holds |
|---|---|
| [TARGET.md](TARGET.md) | what v2.5 is aiming at, judged by two numbers: attention events about the machine per run (zero), and whether the delivered thing did what was asked. Most of it is deletion. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | how each claim is *driven* — what test turns red if the mechanism is removed. Nothing is "done" because it was written, reviewed or committed. |
| [THE-LADDER.md](THE-LADDER.md) | who settles a failure, and who is behind them when they cannot. Every failure routes to the actor best placed to settle it, and there is always one more actor behind. |
| [WORDS.md](WORDS.md) | the vocabulary failures that cost real runs — where two different facts wore the same word and the machine acted on the wrong one. |

## Working records

These change often and are not the design. Read them for what happened,
not for what is true.

| File | What it holds |
|---|---|
| [TODO.md](TODO.md) | the work, in order, each item traced to a gate in PROCESS, a rule in RULES, a drive in ACCEPTANCE, or a field defect. If something is missing here it is missing from the design. |
| [SURFACE.md](SURFACE.md) | the line-by-line audit of the webview — 51 findings, each naming a file and line, and an ordered plan. Findings, not fixes. |
| [../DECISIONS.md](../DECISIONS.md) | decisions taken during the unattended core build. |
| [../ENGINE-WIRING.md](../ENGINE-WIRING.md), [../ENGINE-CHANGE.md](../ENGINE-CHANGE.md) | the ledger of what the inherited engine subtree still carries and what has moved off it. |

## The two bodies of documentation

The Antora site (`docs/antora.yml`, pages in `modules/ROOT/pages/`) is for
the person **using** Tandem: what to press, what a gate refuses, what a
delivery means. It describes behaviour and never internals.

These files are for the person **changing** Tandem: why a gate exists,
what a rule deletes, where a failure routes.

When behaviour changes, both move. The rule that decides which: if a
person using Tandem would notice, the Antora page is wrong until it says
so; if only a maintainer would notice, it belongs here alone. A change to
what a gate *refuses* is always both.
