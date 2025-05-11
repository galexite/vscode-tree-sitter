import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

import { TokensProvider } from "./tokens-provider";
import { GRAMMARS_DIR, PARSERS_DIR } from "./util";

// Semantic token legend
const termMap = new Map<string, { type: string; modifiers?: string[] }>();

function buildLegend() {
  // Terms vocabulary
  termMap.set("type", { type: "type" });
  termMap.set("scope", { type: "namespace" });
  termMap.set("function", { type: "function" });
  termMap.set("variable", { type: "variable" });
  termMap.set("number", { type: "number" });
  termMap.set("string", { type: "string" });
  termMap.set("comment", { type: "comment" });
  termMap.set("constant", {
    type: "variable",
    modifiers: ["readonly", "defaultLibrary"],
  });
  termMap.set("directive", { type: "macro" });
  termMap.set("control", { type: "keyword" });
  termMap.set("operator", { type: "operator" });
  termMap.set("modifier", { type: "type", modifiers: ["modification"] });
  termMap.set("punctuation", { type: "punctuation" });
  termMap.set("async", { type: "keyword", modifiers: ["async"] });
  termMap.set("parameter", { type: "parameter", modifiers: ["declaration"] });
  termMap.set("parameter_type", { type: "support", modifiers: ["type"] });

  // Tokens and modifiers in use
  const tokens: string[] = [];
  const modifiers: string[] = [];
  termMap.forEach((t) => {
    if (!tokens.includes(t.type)) {
      tokens.push(t.type);
    }

    t.modifiers?.forEach((m) => {
      if (!modifiers.includes(m)) {
        modifiers.push(m);
      }
    });
  });
  // Construct semantic token legend

  return new vscode.SemanticTokensLegend(tokens, modifiers);
}

const legend = buildLegend();

// Extension activation
export async function activate(context: vscode.ExtensionContext) {
  // Languages
  const availableGrammars = (await fs.readdir(GRAMMARS_DIR)).map((name) =>
    path.basename(name, ".json"),
  );
  const availableParsers = (await fs.readdir(PARSERS_DIR)).map((name) =>
    path.basename(name, ".wasm"),
  );

  const enabledLangs: string[] = vscode.workspace
    .getConfiguration("syntax")
    .get("highlightLanguages")!;
  const selectors: vscode.DocumentFilter[] = availableGrammars
    .filter(
      (lang) => enabledLangs.includes(lang) && availableParsers.includes(lang),
    )
    .map((lang) => {
      return { language: lang };
    });

  const engine = new TokensProvider(legend, termMap);

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selectors,
      engine,
      legend,
    ),
  );

  // Register debug hover providers
  // Very useful tool for implementation and fixing of grammars
  if (vscode.workspace.getConfiguration("syntax").get("debugHover")) {
    for (const lang of selectors) {
      vscode.languages.registerHoverProvider(lang, engine);
    }
  }
}
