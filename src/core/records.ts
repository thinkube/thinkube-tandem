/**
 * The append-only store (SPEC §multi-user, the four commitments):
 *
 * 1. A record is one immutable file — appending = creating a file; no file
 *    is ever edited. Conflict-free in git even against your own second
 *    session.
 * 2. Filenames are readable (date + author + kind); content hashes are
 *    plumbing and never surface.
 * 3. The fold is deterministic and total: order by (timestamp,
 *    author-identity); identical record sets produce identical state on
 *    every machine. Contradictory decisions never resolve by merge order —
 *    they surface as a question.
 * 4. Data merges; execution locks (the dispatcher's branch claim + lock
 *    files — not this module's concern).
 *
 * Each user appends snapshot records ONLY inside their own subtree
 * (`spaces/<project-id>/<user>/records/`); the space's current state is a
 * FOLD over the latest record of every user. Cross-author id collisions
 * (legacy unscoped ids) are qualified deterministically with the author,
 * references rewritten — never silently merged.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { docsObligation, emptySpace, Space } from "./schema";

export interface SnapshotRecord {
  at: string;
  author: string;
  kind: "snapshot" | "space-imported";
  space: Space;
  /** The author's own cut selection (working state, not consensus). */
  cut: string[];
}

const RECORDS_DIR = "records";

/** Readable, unique, append-only: date + author + kind (+ a tiebreaker). */
function recordFileName(r: SnapshotRecord, seq: number): string {
  const ts = r.at.replace(/[:.]/g, "-");
  // The sequence is ALWAYS present and zero-padded so lexicographic
  // filename order IS append order — even under a constant clock.
  return `${ts}--${r.author}--${r.kind}--${String(seq).padStart(3, "0")}.json`;
}

/** Append one record into `userDir/records/` — a NEW file, never an edit. */
export function appendRecord(userDir: string, r: SnapshotRecord): string {
  const dir = path.join(userDir, RECORDS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  let seq = 0;
  let name = recordFileName(r, seq);
  while (fs.existsSync(path.join(dir, name))) name = recordFileName(r, ++seq);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(r, null, 2));
  return path.join(dir, name);
}

/** Read one user's records (their own subtree). */
function readUserRecords(userDir: string): SnapshotRecord[] {
  const out: SnapshotRecord[] = [];
  const dir = path.join(userDir, RECORDS_DIR);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files.sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SnapshotRecord;
      if (raw && raw.space && typeof raw.author === "string") out.push(raw);
    } catch {
      /* an unreadable record is skipped, never fatal */
    }
  }
  return out;
}

/** Read every user's records under the project dir (`spaces/<id>/`). */
function readAllRecords(projectDir: string): SnapshotRecord[] {
  const out: SnapshotRecord[] = [];
  let users: string[] = [];
  try {
    users = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const user of users) out.push(...readUserRecords(path.join(projectDir, user)));
  return out;
}

/** Latest record per author, ordered by (at, author, read-order) — the
 *  read order (sorted filenames) is the tiebreaker, so a constant clock
 *  still yields a deterministic "latest". */
export function latestPerAuthor(records: SnapshotRecord[]): SnapshotRecord[] {
  const cmp = (a: [SnapshotRecord, number], b: [SnapshotRecord, number]): number =>
    a[0].at !== b[0].at
      ? a[0].at < b[0].at
        ? -1
        : 1
      : a[0].author !== b[0].author
        ? a[0].author < b[0].author
          ? -1
          : 1
        : a[1] - b[1];
  const indexed: [SnapshotRecord, number][] = records.map((r, i) => [r, i]);
  const by = new Map<string, SnapshotRecord>();
  for (const [r] of [...indexed].sort(cmp)) by.set(r.author, r);
  const pos = new Map([...indexed].map(([r, i]) => [r, i]));
  return [...by.values()].sort((a, b) => cmp([a, pos.get(a) ?? 0], [b, pos.get(b) ?? 0]));
}

/** Qualify an id with its author — the deterministic collision escape. */
const qual = (id: string, author: string): string => `${id}~${author}`;

/** Rewrite every reference inside one author's space after qualification. */
function rewriteIds(space: Space, ren: Map<string, string>): Space {
  const r = (id: string): string => ren.get(id) ?? id;
  return {
    asks: space.asks.map((a) => ({ ...a, id: r(a.id) })),
    nodes: space.nodes.map((n) => ({
      ...n,
      id: r(n.id),
      serves: n.serves.map(r),
      needs: n.needs.map(r),
    })),
    units: space.units.map((u) => ({ ...u, id: r(u.id), changeIds: u.changeIds.map(r) })),
    questions: space.questions.map((q) => ({ ...q, id: r(q.id), askId: r(q.askId) })),
    proposals: space.proposals?.map((p) => ({ ...p, a: r(p.a), b: r(p.b) })),
    vetoes: space.vetoes,
    impacts: space.impacts?.map((im) => ({ ...im, askId: r(im.askId), questionId: r(im.questionId) })),
    cuts: space.cuts.map((c) => ({ ...c, id: r(c.id), changeIds: c.changeIds.map(r) })),
    deliveries: space.deliveries.map((d) => ({ ...d, id: r(d.id), cutId: r(d.cutId) })),
  };
}

/**
 * Fold the latest snapshot of every author into ONE space. Deterministic
 * and total; contradictory decisions surface as a question.
 */
export function foldSpaces(latest: SnapshotRecord[]): Space {
  if (latest.length === 0) return emptySpace();
  if (latest.length === 1) return latest[0].space;

  const merged = emptySpace();
  // An id collides only when the CONTENT differs: another author holding
  // the same entity (deciding my question, accepting my delivery) is a
  // shared reference, never a rename.
  const seen = {
    asks: new Map<string, string>(),
    nodes: new Map<string, string>(),
    questions: new Map<string, string>(),
    cuts: new Map<string, string>(),
    deliveries: new Map<string, string>(),
  };

  const spaces = latest.map((rec) => {
    const ren = new Map<string, string>();
    const claim = (map: Map<string, string>, id: string, contentKey: string): void => {
      const owner = map.get(id);
      if (owner === undefined) map.set(id, contentKey);
      else if (owner !== contentKey) ren.set(id, qual(id, rec.author));
    };
    for (const a of rec.space.asks) claim(seen.asks, a.id, a.text);
    for (const n of rec.space.nodes) claim(seen.nodes, n.id, n.sentence);
    for (const q of rec.space.questions) claim(seen.questions, q.id, `${q.askId}\u0000${q.text}`);
    for (const c of rec.space.cuts) claim(seen.cuts, c.id, JSON.stringify([c.tepId, ...c.changeIds]));
    for (const d of rec.space.deliveries) claim(seen.deliveries, d.id, `${d.cutId}\u0000${d.branch}`);
    return { author: rec.author, space: ren.size ? rewriteIds(rec.space, ren) : rec.space };
  });

  // Second pass: union by id in fold order; the first writer of an id owns
  // the base; later authors may only ADD decision/acceptance facts.
  const put = <T extends { id: string }>(list: T[], item: T): void => {
    if (!list.some((x) => x.id === item.id)) list.push(item);
  };
  const decides = new Map<string, Set<string>>();
  // Every author's documentation decision on every cut id, in fold order —
  // a waiver another author recorded must survive a first-writer-wins put
  // on the base cut object, and two DIFFERENT waiver reasons for the same
  // cut are a collision, never picked by merge order.
  const cutDocs = new Map<string, { waived: boolean; reason: string }[]>();
  for (const { space } of spaces) {
    for (const a of space.asks) put(merged.asks, a);
    for (const n of space.nodes) put(merged.nodes, n);
    for (const q of space.questions) {
      put(merged.questions, { ...q });
      if (q.decided) {
        if (!decides.has(q.id)) decides.set(q.id, new Set());
        decides.get(q.id)!.add(q.decided.text);
      }
    }
    for (const c of space.cuts) {
      put(merged.cuts, c);
      if (c.docs) {
        if (!cutDocs.has(c.id)) cutDocs.set(c.id, []);
        cutDocs.get(c.id)!.push(c.docs);
      }
    }
    for (const u of space.units) put(merged.units, u);
    for (const p of space.proposals ?? []) {
      if (!merged.proposals) merged.proposals = [];
      if (!merged.proposals.some((x) => x.id === p.id)) merged.proposals.push(p);
    }
    for (const v of space.vetoes ?? []) {
      if (!merged.vetoes) merged.vetoes = [];
      if (!merged.vetoes.includes(v)) merged.vetoes.push(v);
    }
    for (const im of space.impacts ?? []) {
      if (!merged.impacts) merged.impacts = [];
      if (!merged.impacts.some((x) => x.id === im.id)) merged.impacts.push(im);
    }
    for (const d of space.deliveries) {
      const existing = merged.deliveries.find((x) => x.id === d.id);
      if (!existing) merged.deliveries.push(d);
      else if (!existing.acceptedAt && d.acceptedAt) existing.acceptedAt = d.acceptedAt;
    }
  }

  // Decisions: one distinct answer stands; two or more distinct answers
  // NEVER resolve by merge order — the question re-opens with the conflict
  // named, and a synthetic question carries the choice back to the humans.
  merged.questions = merged.questions.map((q) => {
    const answers = [...(decides.get(q.id) ?? [])].sort();
    if (answers.length <= 1)
      return answers.length === 1 && !q.decided
        ? {
            ...q,
            decided: latest
              .flatMap((r) => r.space.questions)
              .find((x) => x.id === q.id && x.decided)?.decided,
          }
        : q;
    return { ...q, decided: undefined };
  });
  for (const [qid, answers] of decides)
    if (answers.size > 1)
      merged.questions.push({
        id: `conflict-${qid}`,
        askId: merged.questions.find((q) => q.id === qid)?.askId ?? "",
        text: `Conflicting decisions on "${merged.questions.find((q) => q.id === qid)?.text ?? qid}": ${[...answers].sort().join(" — versus — ")}`,
        recommendation: [...answers].sort()[0],
      });

  // Documentation decisions carry across authors: a waiver another author
  // recorded is neither dropped by the base cut's first-writer-wins put nor
  // silently unified with a differing one — reasons for the SAME cut that
  // disagree surface exactly as a contradictory decision does.
  merged.cuts = merged.cuts.map((c) => {
    const all = cutDocs.get(c.id);
    if (!all || all.length === 0) return c;
    const valid = all.filter((d) => docsObligation({ ...c, docs: d }).required === false);
    const reasons = new Set(valid.map((d) => d.reason));
    if (reasons.size > 1) {
      // Ambiguous, never resolved by merge order: the conflict surfaces as
      // its own question and the cut's own waiver stays whatever the base
      // writer already held — never one of the colliding reasons picked
      // silently.
      merged.questions.push({
        id: `conflict-docs-${c.id}`,
        askId: "",
        text: `Conflicting documentation waivers on "${c.id}": ${[...reasons].sort().join(" — versus — ")}`,
        recommendation: [...reasons].sort()[0],
      });
      return c;
    }
    if (reasons.size === 1 && !c.docs) return { ...c, docs: valid[0] };
    return c;
  });

  return merged;
}

/**
 * Load a project's space: fold every author's latest record. Legacy
 * migration: a pre-records `space.json` in the user's dir is imported once
 * as a `space-imported` record (a new file — nothing is edited).
 */
export function loadFolded(
  projectDir: string,
  userDir: string,
  author: string,
  now: () => string,
): { space: Space; cut: string[] } {
  const legacy = path.join(userDir, "space.json");
  const hasRecords = fs.existsSync(path.join(userDir, RECORDS_DIR));
  if (!hasRecords && fs.existsSync(legacy)) {
    try {
      const raw = JSON.parse(fs.readFileSync(legacy, "utf8")) as { space: Space; cut: string[] };
      appendRecord(userDir, {
        at: now(),
        author,
        kind: "space-imported",
        space: raw.space,
        cut: raw.cut ?? [],
      });
    } catch {
      /* unreadable legacy state starts empty */
    }
  }
  // projectDir === userDir → single-user: read only this user's records
  // (the project layer reads every user's subtree).
  const all =
    path.resolve(projectDir) === path.resolve(userDir)
      ? readUserRecords(userDir)
      : readAllRecords(projectDir);
  const latest = latestPerAuthor(all);
  const mine = latest.find((r) => r.author === author);
  return { space: foldSpaces(latest), cut: mine?.cut ?? [] };
}
