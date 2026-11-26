/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A request between modules: the owner of one module needs something from
 * another module, and the owner session of that module builds it.
 *
 * The request belongs to the record, not to the two conversations. It is
 * written before any message is sent, so it stands when the other module
 * has no owner session, and both modules show the same state of it.
 *
 * The message between the two sessions is only the transport. Its first
 * line names the request, which is how the record knows, at the receiving
 * session, that the request arrived.
 *
 * On disk: `requests/<request-id>.json`, one file per request, holding its
 * state now.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

interface Request {
  id: string;
  askedAt: string;
  /** The module that asks, and the session that owned it then. */
  from: { module: string; label: string; session: string };
  /** The module that is asked. */
  to: { module: string; label: string };
  text: string;
  /** Each try to hand the message to the owner session of the module asked. */
  sent: { at: string; session: string; delivered: boolean; reason?: string }[];
  /** When the owner session of the module asked was seen to receive it. */
  arrivedAt?: string;
  /** What that owner session answered when it was done. */
  answered?: { at: string; session: string; text: string };
}

function requestFile(storeRoot: string, id: string): string {
  return path.join(storeRoot, "requests", `${id}.json`);
}

function save(storeRoot: string, request: Request): Request {
  const file = requestFile(storeRoot, request.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

export function openRequest(
  storeRoot: string,
  asked: Pick<Request, "from" | "to" | "text">,
  now: () => string,
): Request {
  return save(storeRoot, {
    id: `r-${randomBytes(3).toString("hex")}`,
    askedAt: now(),
    ...asked,
    sent: [],
  });
}

export function readRequest(storeRoot: string, id: string): Request | undefined {
  // An id is read from a message's text: only the shape the record mints
  // names a file.
  if (!/^r-[0-9a-f]{6}$/.test(id)) return undefined;
  const file = requestFile(storeRoot, id);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Request;
}

/** Change a request that exists, and write it back. */
export function updateRequest(
  storeRoot: string,
  id: string,
  change: (request: Request) => Request,
): Request | undefined {
  const request = readRequest(storeRoot, id);
  return request ? save(storeRoot, change(request)) : undefined;
}

/** Every request a module asked or was asked, oldest first. */
export function requestsOf(storeRoot: string, moduleId: string): Request[] {
  const dir = path.join(storeRoot, "requests");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Request)
    .filter((r) => r.from.module === moduleId || r.to.module === moduleId)
    .sort((a, b) => (a.askedAt < b.askedAt ? -1 : a.askedAt > b.askedAt ? 1 : 0));
}

/** The message that carries a request to the owner of the module asked. */
export function requestMessage(request: Request): string {
  return [
    `Tandem request ${request.id} from the module "${request.from.label}" to the module "${request.to.label}", which this session owns.`,
    "",
    request.text,
    "",
    `Tandem keeps this request in the record of both modules. When it is built and pushed, call the tool mcp__tandem__answer_request with request "${request.id}" and say what you did. If you cannot do it, call the same tool and say why.`,
  ].join("\n");
}

/** The message that carries the answer back to the owner of the asking module. */
export function answerMessage(request: Request): string {
  return [
    `Tandem answer to request ${request.id}, from the module "${request.to.label}" to the module "${request.from.label}", which this session owns.`,
    "",
    `You asked: ${request.text}`,
    "",
    `The answer: ${request.answered?.text ?? ""}`,
  ].join("\n");
}

/** The request a message carries, read from its first line. */
export function requestCarriedBy(text: string): string | undefined {
  return /^Tandem request (r-[0-9a-f]{6}) from the module /.exec(text)?.[1];
}

/** Where a request stands, in words for the person. */
export function stateOf(request: Request): string {
  if (request.answered) return "answered";
  if (request.arrivedAt) return "with the owner session";
  const last = request.sent.at(-1);
  if (!last) return "waiting: the module has no owner session";
  if (last.delivered) return "sent to the owner session";
  return last.reason ? `not delivered: ${last.reason}` : "not delivered";
}
