/**
 * A unit's brief reads back into its parts: the promise, where it lands,
 * what must be true — and a tester's into criteria under their promise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardWords, parseBrief } from "./briefText";

const CODER =
  "The task list comes back already sorted — soonest due date first — instead of whatever order the database happens to return. — lands at backend/app/api/tasks.py › list_tasks(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)) -> List[Task], backend/app/models/task.py › TaskPriority — done when: Tasks with a due date come back before tasks with no due date at all.; Among tasks that have due dates, the one due soonest comes back first.\n" +
  'The documentation says what "I can see" does. — lands at docs/i-can-see.md (new file) — done when: A page at docs/i-can-see.md says, in plain words, what it does.';

test("a coder's brief: one promise per line, its files with their names, its criteria", () => {
  const built = parseBrief(CODER);
  assert.equal(built.length, 2);
  assert.match(built[0].promise, /^The task list comes back already sorted/);
  assert.deepEqual(
    built[0].lands.map((l) => [l.path, l.name, l.isNew ?? false]),
    [
      ["backend/app/api/tasks.py", "list_tasks", false],
      ["backend/app/models/task.py", "TaskPriority", false],
    ],
  );
  assert.match(built[0].lands[0].signature ?? "", /^list_tasks\(db: Session/);
  assert.deepEqual(built[0].criteria, [
    "Tasks with a due date come back before tasks with no due date at all.",
    "Among tasks that have due dates, the one due soonest comes back first.",
  ]);
  assert.deepEqual(built[1].lands, [{ path: "docs/i-can-see.md", isNew: true }]);
});

test("a tester's brief: criteria grouped under the promise each proves", () => {
  const built = parseBrief("[The list is sorted.] Tasks with a due date come first.; [The list is sorted.] Soonest first.; [The mark is visible.] A late task shows a mark.");
  assert.deepEqual(
    built.map((b) => [b.promise, b.criteria]),
    [
      ["The list is sorted.", ["Tasks with a due date come first.", "Soonest first."]],
      ["The mark is visible.", ["A late task shows a mark."]],
    ],
  );
});

test("nothing said is nothing built", () => {
  assert.deepEqual(parseBrief(undefined), []);
  assert.deepEqual(parseBrief("  "), []);
});

test("a name stops where code begins — a type, a body, a comment stay in the signature", () => {
  const built = parseBrief(
    "A task past its due date is marked. — lands at frontend/src/views/Home.vue › isOverdue: ComputedRef<boolean>, frontend/src/locales/en.json › task: { dueDate: string /*existing*/, dueOn: string }, frontend/src/views/Home.vue › template: task card due-date block — done when: A late task shows a mark.",
  );
  assert.deepEqual(
    built[0].lands.map((l) => [l.path, l.name]),
    [
      ["frontend/src/views/Home.vue", "isOverdue"],
      ["frontend/src/locales/en.json", "task"],
      ["frontend/src/views/Home.vue", "template"],
    ],
  );
  assert.deepEqual(built[0].criteria, ["A late task shows a mark."]);
});

test("a card's words: the first promise with a count, and files with names — never a paragraph", () => {
  const coder = cardWords(CODER);
  assert.equal(coder.title, "The task list comes back already sorted — soonest due date first — instead of whatever order the database happens to return. (+1 more)");
  assert.equal(coder.lands, "lands at backend/app/api/tasks.py › list_tasks, backend/app/models/task.py › TaskPriority, docs/i-can-see.md");
  const tester = cardWords("[The list is sorted.] Tasks with a due date come first.; [The list is sorted.] Soonest first.; [The mark is visible.] A late task shows a mark.");
  assert.equal(tester.title, "The list is sorted. (+1 more)");
  assert.equal(tester.lands, undefined);
  assert.deepEqual(cardWords(undefined), {});
});
