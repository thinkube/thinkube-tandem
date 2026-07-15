/**
 * SP-21/3 AC-13 — Easy to open, several per project.
 *
 * WHY: Thinking spaces must be discoverable directly from the sidebar tree —
 * no command-palette knowledge required. The navigator lists each namespace's
 * named thinking documents (one ThinkingDocNode per *.json file in
 * <namespace>/thinking/) followed by a New-thinking-space sentinel
 * (NewThinkingDocNode). Clicking a ThinkingDocNode opens the panel for exactly
 * that document. Both the listing and the open behaviour must hold across every
 * namespace and every document — the tree is the authoring entry point.
 *
 * Tests in this file:
 *
 * 1. package.json declares both commands and view/item/context menu entries.
 *    TRANSITION — proves the manifest metadata landed; its job is done once
 *    the spec ships and the entries remain.
 *
 * 2. Both commands are registered in the VS Code runtime command registry.
 *    INVARIANT — must always hold; a dropped registration makes tree clicks
 *    silently do nothing.
 *
 * 3. getChildren on a repo node lists ThinkingDocNodes + NewThinkingDocNode.
 *    INVARIANT — must always hold; this is the discoverable surface that
 *    lets the author reach a named space without knowing its path.
 *
 * 4. ThinkingDocNode's tree item default command is openDoc.
 *    INVARIANT — the click handler must always be openDoc; any other
 *    command breaks discoverability.
 *
 * 5. Executing openDoc renders exactly that document's content.
 *    INVARIANT — the content of the named document must be visible
 *    after opening; the wrong document is as bad as no document.
 *
 * 6. Opening a different document replaces the singleton session.
 *    INVARIANT — the previous document's content must not bleed into
 *    the new panel; spaces are distinct, not stacked.
 *
 * Setup: a temp board root seeded with two namespaces:
 *   ns-alpha  → thinking/alpha1.json (contains ALPHA1_ITEM)
 *               thinking/alpha2.json (contains ALPHA2_ITEM)
 *   ns-beta   → thinking/beta1.json  (fresh, no marker)
 * Documents are created via openScratchpad so they are in the correct
 * SP-3 serialisation format.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";
import type { ScratchpadSession } from "../scratchpad/session";
import { ThinkingSpaceNavigatorProvider } from "../views/thinkingSpaces/ThinkingSpaceNavigatorProvider";
import type { RepoEntry } from "../views/thinkingSpaces/ThinkingSpaceNavigatorProvider";

// ── SP-3 new navigator node types (not in codebase yet; defined locally) ─────
// The SP-3 implementer MUST export types with exactly these shapes from
// ThinkingSpaceNavigatorProvider.ts. These local definitions let the test
// compile and name the expected contract precisely before the implementation.
interface ThinkingDocNode {
  kind: "thinkingDoc";
  /** The namespace directory under the board root (e.g. "ns-alpha"). */
  namespace: string;
  /** Document name — basename of the *.json file without the extension. */
  name: string;
}
interface NewThinkingDocNode {
  kind: "newThinkingDoc";
  /** The namespace directory in which a new document will be created. */
  namespace: string;
}
/** Loose union for casting getChildren results. */
type AnyNavNode = ThinkingDocNode | NewThinkingDocNode | { kind: string };

// ── SP-3 extended session types (not yet exported; defined locally) ───────────
interface SP3Section {
  id: string;
  kind: string;
  items: unknown[];
}
interface SP3Model {
  sections: SP3Section[];
}
type SP3Session = ScratchpadSession & {
  postFromWebview(msg: Record<string, unknown>): Promise<void>;
};

// ── Marker strings — all-caps alphanumeric only, HTML-escape safe ─────────────
/** Unique item text seeded into alpha1; must appear in alpha1's renderedHtml()
 *  and MUST NOT appear in alpha2's or any other document's render. */
const ALPHA1_ITEM = "ALPHA1ITEMMARKERAC13";
/** Unique item text seeded into alpha2; must appear in alpha2's renderedHtml(). */
const ALPHA2_ITEM = "ALPHA2ITEMMARKERAC13";

// ── Fixed paths — deterministic; no Date.now() / Math.random() ───────────────
const SIDECAR_ROOT = path.join(os.tmpdir(), "tandem-probe-sp21-3-ac13");
const NS_ALPHA = "ns-alpha";
const NS_BETA = "ns-beta";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  const api = (await ext.activate()) as TandemExtensionApi;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. package.json declares both commands and view/item/context menu entries
  //    TRANSITION: these commands are NEW in SP-3; their presence proves the
  //    manifest metadata landed and the tree is navigable without the palette.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const pkgPath = path.join(ext.extensionPath, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      contributes: {
        commands: Array<{ command: string; category?: string }>;
        menus?: {
          "view/item/context"?: Array<{ command: string; when?: string }>;
        };
      };
    };

    const pkgCmds = pkg.contributes.commands;

    const openDocEntry = pkgCmds.find(
      (c) => c.command === "thinkube.thinkingSpace.openDoc",
    );
    assert.ok(
      openDocEntry,
      '"thinkube.thinkingSpace.openDoc" must appear in package.json contributes.commands — ' +
        "AC-13: the author must be able to open an existing thinking space document by " +
        "clicking it in the tree; no command-palette knowledge required",
    );

    const newDocEntry = pkgCmds.find(
      (c) => c.command === "thinkube.thinkingSpace.newDoc",
    );
    assert.ok(
      newDocEntry,
      '"thinkube.thinkingSpace.newDoc" must appear in package.json contributes.commands — ' +
        "AC-13: the author must be able to create a new thinking space document from the " +
        "New-thinking-space node in the tree",
    );

    // The view/item/context entries must wire openDoc to ThinkingDocNode items
    // and newDoc to NewThinkingDocNode items so both are reachable from the tree
    // without the command palette.
    const itemMenus = pkg.contributes.menus?.["view/item/context"] ?? [];

    const openDocMenu = itemMenus.find(
      (m) => m.command === "thinkube.thinkingSpace.openDoc",
    );
    assert.ok(
      openDocMenu,
      '"thinkube.thinkingSpace.openDoc" must appear in ' +
        'package.json contributes.menus["view/item/context"] — ' +
        "clicking a ThinkingDocNode must offer the open action without requiring the palette",
    );
    // The when clause must scope the entry to the thinkingDoc context value so
    // the menu entry does not appear on unrelated tree items.
    assert.ok(
      openDocMenu.when?.includes("thinkingDoc"),
      `openDoc view/item/context when clause must reference "thinkingDoc" — ` +
        `got: "${openDocMenu.when ?? "(absent)"}"; ` +
        "the menu must be scoped to ThinkingDocNode items (viewItem == thinkingDoc or similar)",
    );

    const newDocMenu = itemMenus.find(
      (m) => m.command === "thinkube.thinkingSpace.newDoc",
    );
    assert.ok(
      newDocMenu,
      '"thinkube.thinkingSpace.newDoc" must appear in ' +
        'package.json contributes.menus["view/item/context"] — ' +
        "clicking the New-thinking-space node must offer the create action",
    );
    assert.ok(
      newDocMenu.when?.includes("newThinkingDoc"),
      `newDoc view/item/context when clause must reference "newThinkingDoc" — ` +
        `got: "${newDocMenu.when ?? "(absent)"}"; ` +
        "the menu must be scoped to NewThinkingDocNode items",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Both commands registered in the VS Code runtime command registry
  //    INVARIANT: losing a registration makes tree clicks silently do nothing.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const cmds = await vscode.commands.getCommands(true);

    assert.ok(
      cmds.includes("thinkube.thinkingSpace.openDoc"),
      '"thinkube.thinkingSpace.openDoc" must be registered in the VS Code command registry — ' +
        "ThinkingDocNode tree clicks and context menu entries both invoke it via executeCommand; " +
        "a missing registration means clicks do nothing",
    );

    assert.ok(
      cmds.includes("thinkube.thinkingSpace.newDoc"),
      '"thinkube.thinkingSpace.newDoc" must be registered in the VS Code command registry — ' +
        "the NewThinkingDocNode click invokes it to prompt for a name and create the document",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Setup: seed both namespaces with named thinking documents.
  // Documents are created via openScratchpad (not raw file writes) so they use
  // the correct SP-3 serialisation format. Alpha1 and alpha2 receive a
  // distinguishing item marker; beta1 is left empty (needed only for the
  // navigator listing count test).
  // ═══════════════════════════════════════════════════════════════════════════
  fs.rmSync(SIDECAR_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SIDECAR_ROOT, { recursive: true });

  /**
   * Open a named thinking space, optionally add a marker item to its
   * constraints section, then flush the session to disk.
   *
   * The cast is the pattern used across every SP-3 probe: the pre-SP-3
   * ScratchpadSessionDeps type does not yet carry `namespace` and `space`;
   * the implementer merges them in. Casting to Record<string,unknown> lets
   * the probe compile today and route correctly once the implementation exists.
   */
  async function seedDoc(
    namespace: string,
    space: string,
    marker: string | null,
  ): Promise<void> {
    const raw = await (
      api.scratchpad.openScratchpad as (
        d: Record<string, unknown>,
      ) => Promise<ScratchpadSession>
    )({ sidecarRoot: SIDECAR_ROOT, namespace, space });

    assert.ok(
      raw,
      `openScratchpad must return a live session for ${namespace}/${space} — ` +
        "the named document must be openable from deps alone",
    );

    if (marker !== null) {
      const session = raw as unknown as SP3Session;
      const m = session.model as unknown as SP3Model;
      const constraintsSec = m.sections.find((s) => s.kind === "constraints");
      assert.ok(
        constraintsSec,
        `fresh thinking space ${namespace}/${space} must have a constraints section ` +
          "to receive the marker item — the six section kinds are seeded on open",
      );
      await session.postFromWebview({
        type: "addItem",
        sectionId: constraintsSec.id,
        text: marker,
      });
    }

    await raw.flush();

    // Verify the document was written to the expected path before proceeding.
    const expectedPath = path.join(
      SIDECAR_ROOT,
      namespace,
      "thinking",
      `${space}.json`,
    );
    assert.ok(
      fs.existsSync(expectedPath),
      `${expectedPath} must exist after flush() — ` +
        "document path is <sidecarRoot>/<namespace>/thinking/<space>.json",
    );
  }

  await seedDoc(NS_ALPHA, "alpha1", ALPHA1_ITEM);
  await seedDoc(NS_ALPHA, "alpha2", ALPHA2_ITEM);
  await seedDoc(NS_BETA, "beta1", null);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Navigator getChildren lists ThinkingDocNodes + NewThinkingDocNode
  //    INVARIANT: every *.json file under <namespace>/thinking/ must appear as
  //    a ThinkingDocNode (name = basename without .json, namespace set), and
  //    there must be exactly one NewThinkingDocNode at the end of the list.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // A minimal output-channel stub — ThinkingSpaceNavigatorProvider only calls
    // appendLine(); the other channel methods are not exercised by getChildren.
    const fakeOutput = {
      appendLine: (_line: string) => {},
    } as unknown as vscode.OutputChannel;

    const provider = new ThinkingSpaceNavigatorProvider(fakeOutput);

    // ── ns-alpha: two docs → two ThinkingDocNodes + one NewThinkingDocNode ──
    // INVARIANT: both alpha1.json and alpha2.json must appear; the list must
    // not be truncated, filtered, or limited to one.
    const repoAlpha: RepoEntry = {
      kind: "repo",
      path: "/probe/fake/repo-ns-alpha",
      name: "ns-alpha",
      rel: "ns-alpha",
      enabled: true,
      thinkingSpaceDir: path.join(SIDECAR_ROOT, NS_ALPHA),
    };

    const rawAlpha = await provider.getChildren(repoAlpha);
    const childrenAlpha = rawAlpha as unknown as AnyNavNode[];

    const docNodesAlpha = childrenAlpha.filter(
      (c): c is ThinkingDocNode => c.kind === "thinkingDoc",
    );
    const newDocNodesAlpha = childrenAlpha.filter(
      (c): c is NewThinkingDocNode => c.kind === "newThinkingDoc",
    );

    assert.equal(
      docNodesAlpha.length,
      2,
      `ns-alpha must produce exactly 2 ThinkingDocNodes — one per *.json file ` +
        `(alpha1.json and alpha2.json) under ns-alpha/thinking/; got ${docNodesAlpha.length}`,
    );

    const docNamesAlpha = docNodesAlpha.map((n) => n.name).sort();
    assert.deepEqual(
      docNamesAlpha,
      ["alpha1", "alpha2"],
      "ThinkingDocNode.name must be the basename without .json — " +
        "alpha1.json → alpha1, alpha2.json → alpha2",
    );

    for (const node of docNodesAlpha) {
      assert.equal(
        node.namespace,
        NS_ALPHA,
        `ThinkingDocNode.namespace must be "${NS_ALPHA}" — ` +
          "the namespace travels from the parent repo/project node to each child doc node",
      );
    }

    assert.equal(
      newDocNodesAlpha.length,
      1,
      "ns-alpha getChildren must include exactly ONE NewThinkingDocNode — " +
        "the New-thinking-space sentinel is always present; there must not be 0 or 2+",
    );
    assert.equal(
      newDocNodesAlpha[0].namespace,
      NS_ALPHA,
      `NewThinkingDocNode.namespace must be "${NS_ALPHA}" — ` +
        "the sentinel carries the namespace so the newDoc command knows where to create",
    );

    // The NewThinkingDocNode must be the LAST child (named docs come first).
    const lastAlpha = childrenAlpha[childrenAlpha.length - 1];
    assert.equal(
      lastAlpha.kind,
      "newThinkingDoc",
      "the NewThinkingDocNode must be the LAST child returned by getChildren — " +
        "the contract orders named documents before the create-new sentinel",
    );

    // ── ns-beta: one doc → one ThinkingDocNode + one NewThinkingDocNode ─────
    // INVARIANT: a namespace with a single doc must still list it plus the
    // sentinel — neither a zero-doc nor a sentinel-only result is acceptable.
    const repoBeta: RepoEntry = {
      kind: "repo",
      path: "/probe/fake/repo-ns-beta",
      name: "ns-beta",
      rel: "ns-beta",
      enabled: true,
      thinkingSpaceDir: path.join(SIDECAR_ROOT, NS_BETA),
    };

    const rawBeta = await provider.getChildren(repoBeta);
    const childrenBeta = rawBeta as unknown as AnyNavNode[];

    const docNodesBeta = childrenBeta.filter(
      (c): c is ThinkingDocNode => c.kind === "thinkingDoc",
    );

    assert.equal(
      docNodesBeta.length,
      1,
      "ns-beta must produce exactly 1 ThinkingDocNode (beta1.json)",
    );
    assert.equal(
      docNodesBeta[0].name,
      "beta1",
      "ThinkingDocNode.name must be 'beta1' — basename of beta1.json without .json",
    );
    assert.equal(
      docNodesBeta[0].namespace,
      NS_BETA,
      `ThinkingDocNode.namespace must be "${NS_BETA}" for the beta1 document`,
    );

    const newDocNodeBeta = childrenBeta.find(
      (c): c is NewThinkingDocNode => c.kind === "newThinkingDoc",
    );
    assert.ok(
      newDocNodeBeta,
      "ns-beta getChildren must include a NewThinkingDocNode — " +
        "the create-new sentinel must be present regardless of how many docs the namespace has",
    );
    assert.equal(
      newDocNodeBeta!.namespace,
      NS_BETA,
      `ns-beta's NewThinkingDocNode.namespace must be "${NS_BETA}"`,
    );

    // ── ThinkingDocNode default (click) command is openDoc ───────────────────
    // INVARIANT: the tree item's command property must be set to openDoc so that
    // a single click on a doc node opens it — the ThinkingDocNode is the primary
    // discoverability surface and must not require a right-click or palette use.
    const alpha1DocNode = docNodesAlpha.find((n) => n.name === "alpha1")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const treeItem = provider.getTreeItem(alpha1DocNode as unknown as any);

    assert.equal(
      treeItem.command?.command,
      "thinkube.thinkingSpace.openDoc",
      "ThinkingDocNode's tree item must have command 'thinkube.thinkingSpace.openDoc' as " +
        "its default click command — a single click on a named doc node must open it, " +
        "with no palette knowledge or right-click required",
    );

    // The command arguments must include the namespace and the doc name so the
    // handler receives exactly (namespace, name) and can route to the right file.
    const cmdArgs = treeItem.command?.arguments ?? [];
    assert.ok(
      cmdArgs.includes(NS_ALPHA),
      `getTreeItem command arguments must include the namespace "${NS_ALPHA}" — ` +
        "the openDoc command receives (namespace, name) as positional args",
    );
    assert.ok(
      cmdArgs.includes("alpha1"),
      'getTreeItem command arguments must include the document name "alpha1" — ' +
        "the openDoc command must receive the exact name to open the right file",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4-5. Executing openDoc renders exactly that document's content.
  //      INVARIANT: the panel is rooted in the named document; opening alpha1
  //      shows alpha1's content and NOT alpha2's content; opening alpha2
  //      replaces the session and shows alpha2's content and NOT alpha1's.
  //
  // The command reads thinkube.thinkingSpace.root to derive sidecarRoot, so
  // we update the setting before executing it. The update is synchronous in
  // the test host's user-settings file and takes effect on the next read.
  // ═══════════════════════════════════════════════════════════════════════════
  await vscode.workspace
    .getConfiguration("thinkube.thinkingSpace")
    .update("root", SIDECAR_ROOT, vscode.ConfigurationTarget.Global);

  // ── Open alpha1 → session must render alpha1's content ───────────────────
  // INVARIANT: the named document's content (ALPHA1_ITEM in constraints) must
  // appear in renderedHtml() after openDoc; the wrong document is as bad as
  // no document.
  await vscode.commands.executeCommand(
    "thinkube.thinkingSpace.openDoc",
    NS_ALPHA,
    "alpha1",
  );

  {
    const sessionAlpha1 = api.scratchpad.getScratchpadSession();
    assert.ok(
      sessionAlpha1,
      "getScratchpadSession() must return a live session after openDoc — " +
        "the command must open a panel-backed session for the named document",
    );

    const htmlAlpha1 = sessionAlpha1!.renderedHtml();

    assert.ok(
      htmlAlpha1.includes(ALPHA1_ITEM),
      `renderedHtml() after openDoc("${NS_ALPHA}", "alpha1") must contain '${ALPHA1_ITEM}' — ` +
        "the panel must render the NAMED document's persisted content, not a fresh empty space",
    );

    assert.ok(
      !htmlAlpha1.includes(ALPHA2_ITEM),
      `renderedHtml() after openDoc("${NS_ALPHA}", "alpha1") must NOT contain '${ALPHA2_ITEM}' — ` +
        "opening alpha1 must not show alpha2's content; each thinking space document is distinct",
    );
  }

  // ── Open alpha2 → session is REPLACED; must render alpha2's content ──────
  // INVARIANT: the singleton session is flushed and disposed; the panel is
  // re-rooted in the new document. The old document's content must not bleed
  // into the new panel — spaces are distinct, not stacked or merged.
  await vscode.commands.executeCommand(
    "thinkube.thinkingSpace.openDoc",
    NS_ALPHA,
    "alpha2",
  );

  {
    const sessionAlpha2 = api.scratchpad.getScratchpadSession();
    assert.ok(
      sessionAlpha2,
      "getScratchpadSession() must return a live session after the second openDoc call",
    );

    const htmlAlpha2 = sessionAlpha2!.renderedHtml();

    assert.ok(
      htmlAlpha2.includes(ALPHA2_ITEM),
      `renderedHtml() after openDoc("${NS_ALPHA}", "alpha2") must contain '${ALPHA2_ITEM}' — ` +
        "the new document's content must be rendered after the session replacement",
    );

    assert.ok(
      !htmlAlpha2.includes(ALPHA1_ITEM),
      `renderedHtml() after openDoc("${NS_ALPHA}", "alpha2") must NOT contain '${ALPHA1_ITEM}' — ` +
        "opening a different document must replace the singleton session; " +
        "alpha1's content must not persist into the alpha2 panel",
    );
  }
}
