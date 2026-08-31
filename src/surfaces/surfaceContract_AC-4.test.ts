/**
 * TRANSITION — noteRefusal/lastRefusal are a new pair: the surface can hold
 * one refusal sentence across a render so a message line can show it, and
 * the very next noteAllowed call (the next push arriving) clears it, so a
 * refusal from an earlier press never lingers past its own push.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {noteAllowed} from "./surfaceContract";

