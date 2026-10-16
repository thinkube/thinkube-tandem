---
name: tandem
description: How the Tandem Workshop works and how an agent works in it — asks, cuts, deliveries, the two gates that are the person's alone, and which thinkube-tandem tool does what. Use whenever the person speaks of a thinking space, an ask, a cut, a run, a delivery, or asks to build a change with Tandem.
---
# The Tandem Workshop

Tandem builds a change to an application with the person, from what they
ask for to a delivery they accept. The person writes what they want in
their own words; the machine grounds every sentence in the code, builds
from exact work orders, proves the work and deploys it; the person decides.

Three artifacts, kept in a thinking space of the repository:

- **Asks** — the person's sentences, verbatim.
- **Cuts** — what the person signed to build now.
- **Deliveries** — what was built, with its proofs and findings.

## The two gates are the person's

Signing a cut (`build`) and accepting a delivery (`accept_delivery`) are
the person's acts, and so are keeping a draft as asks (`keep_draft`),
choosing the set to build (`choose_set`), deciding an open question
(`answer_question`), saying a promise does not hold (`does_not_hold`) and
rejecting a delivery (`reject_delivery`). Call none of them until the
person has said so in words. When you call one, the server asks the
person to confirm it in their own session; their no does nothing. Never
work around a refusal.

## The flows

The server offers each flow as a prompt, which Claude Code lists as a
slash command. Each takes the space to work in:

- `/mcp__thinkube-tandem__capture-asks` — turn what the person said into
  drafted asks, one sentence each, kept only when they say so.
- `/mcp__thinkube-tandem__build` — readiness, reading, grouping, and the
  build on the person's word; then watching the run.
- `/mcp__thinkube-tandem__review-delivery` — read the latest delivery with
  the person, look at the running product, record what they decide.

## Reading before acting

`list_spaces` says what projects and spaces exist; `read_space` says a
space's asks, promises, phase and open questions; `read_run` and
`read_log` say what a run is doing; `read_delivery` says what was
delivered and proved. Read first, say it in the person's words, then act
only where the flow allows an agent to.
