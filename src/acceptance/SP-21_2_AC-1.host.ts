/**
 * SP-21/2 AC-1 — One entry point, replacing New TEP.
 *
 * WHY (TRANSITION): proves thinkube.teps.new was removed from package.json's
 * commands array AND from the live command registry, and that thinkube.scratchpad.open
 * now occupies the TEPs view title bar at group navigation@0 — work that is done once
 * the command swap ships.
 *
 * WHY (INVARIANT): executing the Scratchpad open path always produces a live session
 * whose getScratchpadSession() handle is reachable via the extension API — this must
 * hold on every future activation.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ── 1. thinkube.teps.new must be absent from the registered command list ──
  // TRANSITION: the command was removed as part of this spec; its absence is
  // the proof the removal landed.
  const cmds = await vscode.commands.getCommands(true);
  assert.ok(
    !cmds.includes("thinkube.teps.new"),
    "thinkube.teps.new must NOT appear in vscode.commands.getCommands(true) — " +
      "it was removed when the Scratchpad replaced the New-TEP quick-create",
  );

  // ── 2. package.json: thinkube.teps.new must be absent from commands + menus ──
  // TRANSITION: the command declaration and its menu binding were deleted.
  const pkgPath = path.join(ext.extensionPath, "package.json");
  const pkgRaw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw) as {
    contributes: {
      commands: Array<{
        command: string;
        title: string;
        category?: string;
        icon?: string;
      }>;
      menus: {
        "view/title"?: Array<{ command: string; when: string; group: string }>;
      };
    };
  };

  const tepNewInCommands = pkg.contributes.commands.some(
    (c) => c.command === "thinkube.teps.new",
  );
  assert.ok(
    !tepNewInCommands,
    "thinkube.teps.new must NOT appear in package.json contributes.commands — " +
      "the command declaration must be removed alongside its registration",
  );

  const viewTitleMenus = pkg.contributes.menus?.["view/title"] ?? [];
  const tepNewInMenus = viewTitleMenus.some(
    (m) => m.command === "thinkube.teps.new",
  );
  assert.ok(
    !tepNewInMenus,
    "thinkube.teps.new must NOT appear in package.json contributes.menus[view/title] — " +
      "the navigation@0 slot in the TEPs view belongs to thinkube.scratchpad.open",
  );

  // ── 3. thinkube.scratchpad.open must occupy navigation@0 in the TEPs view title ──
  // TRANSITION: the scratchpad command takes the slot vacated by thinkube.teps.new.
  const scratchpadMenu = viewTitleMenus.find(
    (m) =>
      m.command === "thinkube.scratchpad.open" &&
      m.when.includes("thinkubeTeps") &&
      m.group === "navigation@0",
  );
  assert.ok(
    scratchpadMenu,
    "thinkube.scratchpad.open must appear in package.json contributes.menus[view/title] " +
      "with when containing 'thinkubeTeps' and group 'navigation@0'",
  );

  // ── 4. the command entry must carry the contractual title and category ──
  // TRANSITION: title and category changed when the command purpose changed.
  const scratchpadCmd = pkg.contributes.commands.find(
    (c) => c.command === "thinkube.scratchpad.open",
  );
  assert.ok(
    scratchpadCmd,
    "thinkube.scratchpad.open must appear in package.json contributes.commands",
  );
  assert.equal(
    scratchpadCmd.title,
    "Author TEP (Scratchpad)",
    "thinkube.scratchpad.open title must be 'Author TEP (Scratchpad)'",
  );
  assert.equal(
    scratchpadCmd.category,
    "Tandem Scratchpad",
    "thinkube.scratchpad.open category must be 'Tandem Scratchpad'",
  );

  // ── 5. executing openScratchpad opens a tab titled 'Thinkube Scratchpad' ──
  // INVARIANT: the panel must always open with the right title when the session starts.
  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac1");
  fs.mkdirSync(tmpDir, { recursive: true });
  const session = await api.scratchpad.openScratchpad({ sidecarRoot: tmpDir });

  assert.ok(session, "openScratchpad must return a live session");
  assert.ok(session.model, "session must expose a live working model");

  const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
  const scratchpadTab = allTabs.find((t) => t.label === "Thinkube Scratchpad");
  assert.ok(
    scratchpadTab,
    "a tab labelled 'Thinkube Scratchpad' must be open after openScratchpad — " +
      "the panel must be shown immediately on the first call",
  );

  // ── 6. getScratchpadSession() returns the live session openScratchpad created ──
  // INVARIANT: the extension API surface always exposes the current session handle.
  const gotten = api.scratchpad.getScratchpadSession();
  assert.ok(
    gotten,
    "getScratchpadSession() must return a live session after openScratchpad has been called",
  );
  assert.equal(
    gotten,
    session,
    "getScratchpadSession() must return the SAME session object openScratchpad returned",
  );
}
