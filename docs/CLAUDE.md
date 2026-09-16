# The Tandem docs

These pages are read by a person using Tandem in Thinkube IDE. They are
built into the Thinkube documentation site as the `tandem` module, and
follow that site's rules: `contributing/style-guide.adoc` and
`contributing/page-types.adoc` on the site.

## What a page is for

A page teaches the reader what they will see on the screen, what it
means, and what to do. It is written from the reader's chair, not from
inside the tool.

- Start from the problem the reader has, then show the screen that
  answers it. Every step in a tutorial: one sentence on why the step
  exists, the capture, what the reader sees, what they press.
- Use the words the page shows and only those. Engine names (asks,
  units, slices, probes, oracle, supervisor, footprint, TEP, HMAC) do
  not appear in a user page. If a mechanism matters to the reader, say
  what it does for them in the page's words.
- A list of labels is a table with a column for what each means and
  what to do, never a sentence that strings the labels together.
- A flow that has more than three steps is a diagram, drawn from what
  the reader sees. Diagrams are `[d2,alt="…"]` literal blocks in the page;
  `docs/lib/d2-block.js` renders them with the local `d2` binary during the
  build, with the ELK layout. The build needs `d2` on PATH and nothing on
  the network. The site repository carries the same extension in
  `lib/d2-block.js`; a change to one is made to both.
- Captures come from a walk of the real product; `thinkube-release/walks/`
  holds the walks and their observations.
- No time figures. No internals page "for developers" beside the user
  pages; that account lives in the code and the commit messages.

## Build

```bash
npm run docs        # docs/build/site, exit 0 with no warnings
```
