// The mint-side approval hasher (SP-6/19, TEP-6 mechanism 6 hardening).
//
// SP-17 arming the human-approval gate exposed that the mint (`ReviewPanel`) hashed the whole
// on-disk file (frontmatter + body) while the `create_slice` gate hashed only the parsed body —
// the two could never match, deadlocking all slicing. The hotfix (0.1.144) made the panel parse
// the frontmatter out inline, but with no named helper and no regression guard. This module names
// the mint's hash into a single pure helper: `specApprovalHash(rawFileText)` takes the RAW file and
// does the body extraction itself (a well-formed leading `---`…`---` frontmatter fence parsed out;
// a fence-less raw is all-body), so the mint cannot hand it a pre-stripped or full-file string by
// mistake. Frontmatter (`implements`, `repo`, the `ac_verifications` map + signature) is machinery
// and must never invalidate an approval — a frontmatter-only edit leaves the hash (and any stored
// approval) intact, while any body edit moves it and re-arms the gate.
//
// It lives in its OWN small module — not on the widely-imported `approvalToken.ts` — so the mint's
// wiring drags no existing importer into a slice's footprint (SP-6/18's test-impact gate). It only
// COMPOSES the two stable primitives (`approvalContentHash` + `parseFrontmatter`); the gate keeps
// computing `approvalContentHash(specDoc.body)` on its own already-correct path (it was never the
// bug), and SP-19 AC2's cross-check proves the two agree — the mint helper equals the gate's
// `approvalContentHash(parseFrontmatter(body))`, frontmatter-invariant and body-sensitive.
import { approvalContentHash } from "./approvalToken";
import { parseFrontmatter } from "./store/frontmatter";

/**
 * THE approval content hash the review-panel mint uses, computed from the **raw on-disk file
 * text**. It parses the leading `---` … `---` frontmatter fence out and hashes ONLY the document
 * body — `approvalContentHash(parseFrontmatter(rawFileText).body)`; a fence-less raw is treated as
 * all-body. Because the helper takes the raw file and does the body extraction itself, the mint
 * cannot pass "the wrong body": it converges on the exact bytes the gate hashes (`store.getFile`
 * uses the same `parseFrontmatter` to make `specDoc.body`), so a mint always matches what the gate
 * verifies. Pure and synchronous — no fs, no vscode.
 */
export function specApprovalHash(rawFileText: string): string {
  return approvalContentHash(parseFrontmatter(rawFileText).body);
}
