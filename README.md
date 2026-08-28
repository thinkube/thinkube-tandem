# Thinkube Tandem

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

## Documentation

- **Using Tandem:** the Antora site under [docs/](docs/) — start at
  `docs/modules/ROOT/pages/index.adoc`.
- **Changing Tandem:** [docs/README.md](docs/README.md) maps the internal
  set. `PROCESS.md` is the operating design, `RULES.md` the eight rules
  and what each one deletes, `TERMINOLOGY.md` the canonical vocabulary.
- **The specification:** `SPEC.md` in the tandem store — always that file,
  evolved by edits, never replaced by a successor document.

## Status

v2, in use. Runs go end to end: sign, dispatch, closing gate, delivery,
accept, merge. Two vetoes hold a delivery back — an unkept promise and a
product that does not build; everything else the machine cannot settle
rides the delivery as a finding for the person to weigh.

Known and not yet built: the surface work, carried as asks in the store's
`surface-asks.txt` — fourteen changes to what a person sees, none started.
