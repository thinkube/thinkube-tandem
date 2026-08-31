/**
 * INVARIANT — every action the phase table governs must have a
 * person-facing control name, checked by importing the real gatedActions()
 * set rather than by matching action strings as text. A governed action
 * with no name would let a refusal fall back to a bare "not now" with
 * nothing for the person to recognise on screen.
 */
import {test} from "node:test";
import assert from "node:assert/strict";

import {CONTROL_NAMES} from "./surfaceContract";

