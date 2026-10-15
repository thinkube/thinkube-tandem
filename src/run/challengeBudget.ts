/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How many times a coder may challenge one check, and what the coder's
 * `challenge` tool says about it. Both read the one constant, so what the
 * coder is told is what the run counts: per check, never per slice — a
 * coder that questioned two other checks can still question the one that
 * is actually wrong.
 */
export const CHALLENGE_BUDGET = 2;

/** The coder's `challenge` tool, as the coder reads it. */
export const CHALLENGE_TOOL_TEXT =
  "Challenge ONE check you believe misreads its criterion or cannot be satisfied by any correct implementation. " +
  "Argue in intent terms with your verify evidence — you will never see the check's source. An independent judge " +
  "rules, reading what the check printed in your last verify; granted, the check is re-authored from its criterion " +
  "and the ruling is recorded on the delivery; denied, meet it. Do not grind a red check when you believe it is " +
  `wrong — file this instead. Budget: ${CHALLENGE_BUDGET} per check.`;
