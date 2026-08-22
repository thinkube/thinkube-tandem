# v2.5 — the design the findings add up to

Judged by two numbers, and nothing else:

- **attention events about the machine, per run: zero.** (About the *work* —
  an intent question, a promise that cannot be observed — is legitimate and
  designed in. About the *machine* — a stall, a dead end, a green unit
  failed for what it cannot reach — is a defect.)
- **did the delivered thing do what was asked**, proven by driving it.

Everything below follows from failures that actually happened, and most of
it is deletion.

## 1. One worktree per repository — and no others

v1 did all its work in one tree per spec, with the held-out checks inside it
and the coder blinded by **permission** — the engine's own `codeReadFence`:
a code worker cannot read an acceptance check. v2 kept a tree per repository and then split the work *again inside it* —
a shared code tree, a detached tester snapshot, and a composed runner per
slice — and called that split "structural blinding".

Five mechanisms exist only because of that split, and every one of them cost
a night this week:

| Mechanism | Exists because | Cost |
|---|---|---|
| the emit map (compiled-path mapping) | checks live in a tree without build output | the audit faulted correct checks |
| the probe store | the tester tree is detached and reset | complexity, restore bugs |
| re-homing | checks were never in the repository's test homes | the growth engine behind 796 tests |
| runner composition | grading needs a tree that does not exist | "the tree is not ready" reds, the cascade, both deadlocks |
| the closer's tree confusion | two trees, one footprint | its real fix for SL-6 was written where nothing commits |

**Decision: exactly one worktree per repository the cut touches, and none
beyond that.** A cut spanning three repositories has three worktrees, three
branches and three deliveries — as v1 had one per spec, and as v2 already
does per repository. What goes is every *additional* tree v2 created
*inside* a repository: the tester snapshot and the per-slice runners.

Within a repository's tree, everything happens: the tester writes checks
into the repository's own test homes, the coder writes production beside
them, and verification runs there. Blinding is by permission — the guard
already refuses a coder any test-shaped path, in both engines. The
scheduler keeps two units off one file, as v1 did.

*Deletes:* the tester snapshot, the probe store, the emit map, the runner
composition, re-homing, and the entire "incomplete tree" class of reds.

## 2. One judgement per level

- A **unit** is judged by the checks of its own criteria. Nothing else.
- The **repository's suite** is judged once, at the gate, on the whole tree,
  where the finisher and the closer can reach every file.
- **Cross-repository behaviour** is judged at a project-level gate after the
  repositories' deliveries land — or declared unprovable at signing.

*Deletes:* the per-slice suite, the owner classification (code / tree /
elsewhere / maintainer), the waits it drove, and with them both deadlocks.

## 3. Criteria that can be observed, and states that cannot be written wrong

- A criterion must be **drivable at the product's outer seam**. One that can
  only be proven by calling a class is at the wrong altitude and goes back
  at grounding — not at dispatch, when the cut is already frozen.
- A **promise belongs to one repository**, as a field on the promise, with
  touchpoint paths relative to it. The mixed state becomes unrepresentable,
  so the late refusal and the missing split mechanism both disappear.
- What cannot be driven is **declared at signing**, in the person's words,
  and they accept it knowingly or send it back.

*Deletes:* the "mixes scopes — split it" dead end, and the silent
substitution of a class-level check for an unobservable promise.

## 4. Wiring proven by execution

The drive must **execute** the lines the unit wrote. A stub satisfies
assertions; it cannot appear on the execution path of a drive it is not
connected to. This is the only new machinery in the design, and it is the
one that answers the original question — *did I ask for a car and get a
tricycle*.

## 5. Enforced by construction, never by prose

Every rule that has held was enforced structurally: a coder cannot write a
test (tool refusal), two units cannot write one file at once (scheduler).
Every rule that has failed was a sentence in a prompt with a validator
downstream and a person as the error handler.

So: illegal states unrepresentable, permissions enforced by the guard,
collisions prevented by the scheduler, and everything else measured rather
than asked.

## The build order — each step ends in a demonstration

No step is "done" because it was written. It is done when it is shown.

1. **Collapse to one worktree per repository.** Delete the extra trees
   inside each repository, and the five mechanisms of §1 with them.
   *Shown by:* the existing repository-shape runs still deliver.
2. **Checks born in the repository's test homes.** Delete re-homing, the
   store, the emit map.
   *Shown by:* a run delivers, and afterwards the checks are where the
   repository keeps its tests.
3. **Altitude and the promise's repository.** Grounding refuses what cannot
   be driven; signing shows where each promise lands.
   *Shown by:* a criterion that can only be proven by calling a class is
   refused before signing.
4. **Drives and the wiring trace.**
   *Shown by:* the SL-6 tricycle — a register built, disposed and connected
   to nothing — fails, where seven checks passed it.
5. **Measure.** Three runs, counting attention events about the machine.
   *Shown by:* the number, not an opinion.

If step 1 does not deliver, nothing after it matters, and the honest move is
back to v1's loop plus one attention-reducing mechanism at a time — each
proven to reduce the count before the next is allowed in.
