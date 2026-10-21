/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a declared build that passed can be said to prove.
 *
 * A template ships as an image built from its own Dockerfile, test stage
 * included, and only the platform's deploy builds that image. The command
 * the repository declares as its build (a compile, a syntax pass) runs
 * here and says nothing about the image, so for a template the words name
 * the command that passed and say who judges the image: the deploy the
 * live phase runs, whose refusal is the veto. For any other repository the
 * declared build is how its product is built.
 */

/** Who judges a template's image, for a person reading the gate or readiness. */
export const IMAGE_JUDGED_BY_DEPLOY =
  "the image is built, and its tests run, only by the platform's deploy — the live phase runs that deploy, and its refusal is the veto";

/** A declared build that passed, in words that claim no more than it ran. */
export function declaredBuildPassed(command: string, template: boolean): string {
  return template
    ? `the declared build (${command}) passes; that is not the image: ${IMAGE_JUDGED_BY_DEPLOY}`
    : `the product build (${command}) builds as shipped`;
}
