/**
 * Three commands that choose or read a place rather than change one:
 * switching project, opening the documentation, and reading the defect
 * ledger. They are self-contained registrations, kept out of activation so
 * that function stays a wiring diagram rather than a program.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import * as nodeFs from "node:fs";
import { chooseProject } from "./projectOps";
import { parseDefectLog } from "../engine/defectStats";
import type { EnabledProject } from "../core/identity";

export function placeCommands(a: {
  context: vscode.ExtensionContext;
  openProjects: () => EnabledProject[];
  openSpaceFor: (id?: string) => Promise<void> | void;
  /** The project this window is on, and who is asking — the ledger is
   *  read per project and per author. */
  rememberedProject: (context: vscode.ExtensionContext) => EnabledProject | undefined;
  currentAuthor: () => string | undefined;
}): vscode.Disposable[] {
  const { context, openProjects, openSpaceFor, rememberedProject, currentAuthor } = a;
  return [
    vscode.commands.registerCommand("thinkube-tandem.switchProject", async () => {
      const picked = await chooseProject(context, openProjects);
      if (!picked) return;
      await openSpaceFor(picked.card.id);
    }),
    vscode.commands.registerCommand("thinkube-tandem.openDocs", async () => {
      const pagesDir = vscode.Uri.joinPath(
        context.extensionUri,
        "docs",
        "modules",
        "ROOT",
        "pages",
      );
      const pages: { label: string; file: string }[] = [
        { label: "What Tandem is", file: "index.adoc" },
        { label: "Getting started", file: "getting-started.adoc" },
        { label: "The space — asks, changes, units", file: "the-space.adoc" },
        { label: "The two gates", file: "gates.adoc" },
        { label: "The run and the orchestration graph", file: "the-run.adoc" },
        { label: "Configuration and settings", file: "configuration.adoc" },
        { label: "The store", file: "store.adoc" },
        { label: "The defect ledger", file: "defects.adoc" },
        { label: "When something goes wrong", file: "troubleshooting.adoc" },
      ];
      const pick = await vscode.window.showQuickPick(pages, {
        title: "Tandem documentation",
      });
      if (!pick) return;
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(pagesDir, pick.file),
      );
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("thinkube-tandem.showDefects", async () => {
      const config = vscode.workspace.getConfiguration("thinkubeTandem");
      const storeRoot =
        config.get<string>("storeRoot", "") ||
        path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
      const project = rememberedProject(context);
      const author = currentAuthor() ?? "";
      const dirs = project
        ? [path.join(storeRoot, "spaces", project.card.id, author, "defects")]
        : [];
      const lines: string[] = ["# Tandem defects — find-time ledger", ""];
      let total = 0;
      for (const dir of dirs) {
        let files: string[] = [];
        try {
          files = nodeFs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }
        for (const f of files.sort().reverse()) {
          const { rows } = parseDefectLog(nodeFs.readFileSync(path.join(dir, f), "utf8"));
          if (!rows.length) continue;
          lines.push(`## ${f.replace(".jsonl", "")}`, "", "| when | TEP | slice | trigger | impact | detail |", "|---|---|---|---|---|---|");
          for (const r of rows) {
            total++;
            lines.push(
              `| ${(r.ts ?? "").slice(0, 16)} | ${r.spec ?? ""} | ${r.slice ?? ""} | ${r.trigger ?? ""} | ${r.impact ?? ""} | ${(r.detail ?? "").replace(/\|/g, "/").slice(0, 120)} |`,
            );
          }
          lines.push("");
        }
      }
      if (total === 0) lines.push("No defect rows recorded for this space yet.");
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: lines.join("\n"),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  ];
}
