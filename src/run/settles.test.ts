/**
 * The tool answers, instead of a check being written about the tool.
 *
 * A playbook says a package is installed. A check asserting that the
 * playbook says so restates the file in a second language and passes for a
 * playbook that could never run — it tests the tool, not the work. So the
 * tool is asked directly, and the question no test asks is whether running
 * the work again still changes anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { askTheTool } from "./settles";

function tool(answers: Record<string, { code: number; out: string }>) {
  const asked: string[] = [];
  return {
    asked,
    invoke: async (command: string) => {
      asked.push(command);
      return answers[command] ?? { code: 0, out: "ok" };
    },
  };
}

const ANSIBLE = {
  still: ["ansible-lint site.yaml", "ansible-playbook --syntax-check site.yaml"],
  apply: "ansible-playbook site.yaml",
  ask: "ansible-playbook site.yaml",
  settled: "changed=0",
};

test("work that settles is green, and settling is what the second run says", async () => {
  const t = tool({ "ansible-playbook site.yaml": { code: 0, out: "ok=7 changed=0 failed=0" } });
  const r = await askTheTool({ repoRoot: "/repo", verify: ANSIBLE, invoke: t.invoke });
  assert.equal(r.verdict, "green");
  assert.deepEqual(t.asked, [
    "ansible-lint site.yaml",
    "ansible-playbook --syntax-check site.yaml",
    "ansible-playbook site.yaml",
    "ansible-playbook site.yaml",
  ], "still, then apply, then ask — and asking is running it a second time");
});

test("work that keeps changing things on a second run does not settle", async () => {
  let n = 0;
  const r = await askTheTool({
    repoRoot: "/repo",
    verify: ANSIBLE,
    invoke: async (c: string) =>
      c === "ansible-playbook site.yaml"
        ? { code: 0, out: ++n === 1 ? "ok=7 changed=3 failed=0" : "ok=7 changed=2 failed=0" }
        : { code: 0, out: "" },
  });
  assert.equal(r.verdict, "red", "the defect nobody writes a test for");
  assert.match(r.detail, /does not settle/);
  assert.match(r.detail, /no guard/, "and it says the likely cause in the person's terms");
});

test("nothing is applied when the tool will not even parse it", async () => {
  const t = tool({ "ansible-playbook --syntax-check site.yaml": { code: 4, out: "ERROR! conflicting action" } });
  const r = await askTheTool({ repoRoot: "/repo", verify: ANSIBLE, invoke: t.invoke });
  assert.equal(r.verdict, "red");
  assert.match(r.detail, /conflicting action/, "the tool's words");
  assert.ok(!t.asked.includes("ansible-playbook site.yaml"), "there is nothing worth applying");
});

test("a tool that is not here judges nothing", async () => {
  const t = tool({ "ansible-lint site.yaml": { code: 127, out: "bash: ansible-lint: command not found" } });
  const r = await askTheTool({ repoRoot: "/repo", verify: ANSIBLE, invoke: t.invoke });
  assert.equal(r.verdict, "unjudged", "the machine's limits must never be reported as the work's failure");
});

test("nothing here knows what any tool is", async () => {
  // Terraform asks a different question than it applies, and answers with an
  // exit code rather than a word in its output. Same code path, no branch.
  const terraform = {
    still: ["terraform fmt -check", "terraform validate"],
    apply: "terraform apply -auto-approve",
    ask: "terraform plan -detailed-exitcode",
  };
  const t = tool({ "terraform plan -detailed-exitcode": { code: 0, out: "No changes." } });
  const r = await askTheTool({ repoRoot: "/repo", verify: terraform, invoke: t.invoke });
  assert.equal(r.verdict, "green");
  assert.deepEqual(t.asked[t.asked.length - 1], "terraform plan -detailed-exitcode");

  const busy = tool({ "terraform plan -detailed-exitcode": { code: 2, out: "Plan: 1 to add" } });
  assert.equal(
    (await askTheTool({ repoRoot: "/repo", verify: terraform, invoke: busy.invoke })).verdict,
    "red",
    "exit 2 means terraform still has work to do — no rule about terraform anywhere in the code",
  );
});

test("a repository that only declares safe commands gets an honest, smaller answer", async () => {
  const r = await askTheTool({
    repoRoot: "/repo",
    verify: { still: ["yamllint ."] },
    invoke: (async () => ({ code: 0, out: "" })) as never,
  });
  assert.equal(r.verdict, "green");
  assert.match(r.detail, /nothing to correct/, "it claims only what it asked");
});
