/**
 * Tests for the @thinky chat core (Phase C, 2026-07-17): the chat surface is
 * a thin mouth over the session's one inbound seam — routing, slash-command
 * mapping, status rendering. No vscode; fakes only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import {
  handleThinkyRequest,
  renderThinkyStatus,
  THINKY_SLASH_COMMANDS,
  type ThinkySessionLike,
} from "./chatCore";

function fakeStream(): {
  markdowns: string[];
  buttons: { command: string; title: string; arguments?: unknown[] }[];
  markdown(v: string): void;
  button(b: { command: string; title: string; arguments?: unknown[] }): void;
} {
  const markdowns: string[] = [];
  const buttons: { command: string; title: string; arguments?: unknown[] }[] =
    [];
  return {
    markdowns,
    buttons,
    markdown(v: string) {
      markdowns.push(v);
    },
    button(b) {
      buttons.push(b);
    },
  };
}

function fakeSession(model: WorkingModel, outcome?: string) {
  const posted: ScratchpadInboundMessage[] = [];
  const session: ThinkySessionLike & { posted: ScratchpadInboundMessage[] } = {
    model,
    posted,
    lastCommandMessage: outcome,
    async postFromWebview(message: ScratchpadInboundMessage) {
      posted.push(message);
    },
  };
  return session;
}

test("no open session: thinky explains how to open one, posts nothing", async () => {
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "hello" }, undefined, stream);
  assert.equal(stream.markdowns.length, 1);
  assert.ok(stream.markdowns[0].includes("No thinking space is open"));
});

test("free text routes through the command seam verbatim", async () => {
  const session = fakeSession(
    emptyModel("tep"),
    "Recorded as standing assumption #1.",
  );
  const stream = fakeStream();
  await handleThinkyRequest(
    { prompt: "the environment is a single-user development platform" },
    session,
    stream,
  );
  assert.equal(session.posted.length, 1);
  assert.deepEqual(session.posted[0], {
    type: "command",
    utterance: "the environment is a single-user development platform",
  });
  assert.ok(stream.markdowns[0].includes("standing assumption"));
});

test("slash commands map to the exact command-field utterances", async () => {
  assert.equal(THINKY_SLASH_COMMANDS.readiness, "check readiness");
  assert.equal(THINKY_SLASH_COMMANDS.reframe, "reframe");
  assert.equal(THINKY_SLASH_COMMANDS.contextualize, "contextualize");
  assert.equal(THINKY_SLASH_COMMANDS.panic, "panic");
  const session = fakeSession(emptyModel("tep"));
  const stream = fakeStream();
  await handleThinkyRequest(
    { prompt: "", command: "readiness" },
    session,
    stream,
  );
  assert.deepEqual(session.posted[0], {
    type: "command",
    utterance: "check readiness",
  });
});

test("empty prompt returns the status summary without posting", async () => {
  const session = fakeSession(emptyModel("tep"));
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "   " }, session, stream);
  assert.equal(session.posted.length, 0);
  assert.ok(stream.markdowns[0].includes("journal 1"));
});

test("status counts settled/active per section and shows the curated title", () => {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "an element", modality: "optional", evals: {} },
  }).model;
  const itemId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  model = reduce(model, { type: "checkItem", actor: "human", itemId }).model;
  model = reduce(model, {
    type: "curateIntent",
    text: "- a commitment",
    title: "A short title",
  }).model;
  const status = renderThinkyStatus(model);
  assert.ok(status.includes("elements 1/1"));
  assert.ok(status.includes("A short title"));
});

test("reply always carries the outcome then the status, plus follow-up buttons", async () => {
  const session = fakeSession(emptyModel("tep"), "Link round done — 3 edges.");
  const stream = fakeStream();
  await handleThinkyRequest({ prompt: "link the space" }, session, stream);
  assert.equal(stream.markdowns[0], "Link round done — 3 edges.");
  assert.ok(stream.markdowns[1].includes("journal 1"));
  assert.equal(stream.buttons.length, 2);
  assert.equal(stream.buttons[0].command, "thinkube.thinky.say");
  assert.deepEqual(stream.buttons[0].arguments, ["check readiness"]);
});
