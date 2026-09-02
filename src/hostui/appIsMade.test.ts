/**
 * Making an application waits on the platform's own words. A name the
 * platform already knows is refused with its message, not polled for
 * fifteen minutes on an empty id; and "success" is the word the platform
 * says when it is done.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createAppFromTemplate } from "./templateCore";

function platform(answers: { post: unknown; status?: string[] }) {
  const calls: string[] = [];
  const statuses = [...(answers.status ?? [])];
  const http = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? "GET"} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
    if (init?.method === "POST") return new Response(JSON.stringify(answers.post), { status: 200 });
    const status = statuses.length > 1 ? statuses.shift()! : statuses[0];
    return new Response(JSON.stringify({ status }), { status: 200 });
  };
  return { http, calls };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tandem-app-"));

test("a name the platform already knows is refused with the platform's words, at once", async () => {
  const p = platform({ post: { deployment_id: "", status: "conflict", message: "Service name 'todo' is already in use", requires_confirmation: true } });
  const made = await createAppFromTemplate({
    auth: { base: "https://control", token: "t" },
    product: "Apps", appName: "todo", templateUrl: "https://github.com/x/t",
    appsRoot: tmp(), storeRoot: tmp(), http: p.http, sleep: async () => {},
  });
  assert.equal(made.ok, false);
  assert.match((made as { reason: string }).reason, /already has "todo": Service name 'todo' is already in use/);
  assert.match((made as { reason: string }).reason, /say replace/);
  assert.equal(p.calls.filter((c) => c.startsWith("GET")).length, 0, "nothing is polled on an empty id");
});

test("replace says so to the platform", async () => {
  let body = "";
  const http = async (_url: string, init?: RequestInit): Promise<Response> => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ deployment_id: "", status: "conflict", message: "x" }), { status: 200 });
  };
  await createAppFromTemplate({
    auth: { base: "https://control", token: "t" }, product: "Apps", appName: "todo", templateUrl: "https://github.com/x/t",
    appsRoot: tmp(), storeRoot: tmp(), http, sleep: async () => {}, replace: true,
  });
  assert.match(body, /"_overwrite_confirmed":true/);
});

test("the platform's success ends the wait", async () => {
  const p = platform({ post: { deployment_id: "d-1", status: "queued" }, status: ["running", "success"] });
  const appsRoot = tmp();
  const made = await createAppFromTemplate({
    auth: { base: "https://control", token: "t" }, product: "Apps", appName: "todo", templateUrl: "https://github.com/x/t",
    appsRoot, storeRoot: tmp(), http: p.http, sleep: async () => {},
    clone: async (_url, dest) => {
      fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
    },
    patience: 5,
  });
  assert.equal(p.calls.filter((c) => c.startsWith("GET")).length, 2, "two polls: running, then success");
  assert.equal(made.ok, true, JSON.stringify(made));
});
