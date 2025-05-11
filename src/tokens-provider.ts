import * as vscode from "vscode";
import * as parser from "web-tree-sitter";

import { Grammar, getNodeType } from "./grammar";

const AVAILABLE_TERMS = [
  "type",
  "scope",
  "function",
  "variable",
  "number",
  "string",
  "comment",
  "constant",
  "directive",
  "control",
  "operator",
  "modifier",
  "punctuation",
  "async",
  "parameter",
];

// Semantic token provider
export class TokensProvider
  implements vscode.DocumentSemanticTokensProvider, vscode.HoverProvider
{
  readonly supportedTerms: Set<string>;
  readonly debugDepth: number;
  readonly trees = new Map<string, parser.Tree>();

  constructor(
    private legend: vscode.SemanticTokensLegend,
    private termMap: Map<string, { type: string; modifiers?: string[] }>,
  ) {
    // Terms
    const enabledTerms: string[] = vscode.workspace
      .getConfiguration("syntax")
      .get("highlightTerms")!;

    const enabledTermsSet = new Set(enabledTerms);

    this.supportedTerms = new Set(
      AVAILABLE_TERMS.filter((term) => enabledTermsSet.has(term)),
    );

    if (!vscode.workspace.getConfiguration("syntax").get("highlightComment")) {
      this.supportedTerms.delete("comment");
    }

    this.debugDepth = vscode.workspace
      .getConfiguration("syntax")
      .get("debugDepth")!;
  }

  // Provide document tokens
  async provideDocumentSemanticTokens(
    doc: vscode.TextDocument,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: vscode.CancellationToken,
  ): Promise<vscode.SemanticTokens> {
    const builder = new vscode.SemanticTokensBuilder(this.legend);

    // Parse document
    const grammar = await Grammar.getOrCreate(doc.languageId);
    const tree = grammar.tree(doc.getText())!;
    const terms = grammar.parse(tree);
    this.trees.set(doc.uri.toString(), tree);

    // Build tokens
    terms.forEach((t) => {
      if (!this.supportedTerms.has(t.term)) {
        return;
      }

      const type = this.termMap.get(t.term)!.type;
      const modifiers = this.termMap.get(t.term)!.modifiers;

      if (t.range.start.line === t.range.end.line) {
        return builder.push(t.range, type, modifiers);
      }

      let line = t.range.start.line;
      builder.push(
        new vscode.Range(t.range.start, doc.lineAt(line).range.end),
        type,
        modifiers,
      );

      for (line = line + 1; line < t.range.end.line; line++) {
        builder.push(doc.lineAt(line).range, type, modifiers);
      }

      builder.push(
        new vscode.Range(doc.lineAt(line).range.start, t.range.end),
        type,
        modifiers,
      );
    });

    return builder.build();
  }

  // Provide hover tooltips
  async provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    const uri = doc.uri.toString();
    const tree = this.trees.get(uri);
    if (!tree) {
      return null;
    }

    const grammar = await Grammar.getOrCreate(doc.languageId);
    const node = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    if (!node) {
      return null;
    }
    let type = getNodeType(node);

    const depth = Math.max(grammar.complexDepth, this.debugDepth);

    // TODO(fallenwood): merge similar codes
    let term: string | null = null;
    const isComplex = grammar.complexTerms.includes(type);

    if (!isComplex) {
      term = grammar.simpleTerms[type];
    }

    let parent = node.parent;
    let scopes = [type];

    for (let i = 0; i < depth && parent; i++) {
      const parentType = getNodeType(parent);

      type = `${parentType} > ${type}`;
      scopes.push(type);
      parent = parent.parent;
    }

    // If there is also order complexity
    if (grammar.complexOrder) {
      let index = 0;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.type === node.type) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      let rindex = -1;
      sibling = node.nextSibling;
      while (sibling) {
        if (sibling.type === node.type) {
          rindex--;
        }

        sibling = sibling.nextSibling;
      }

      type = `${type}[${index}][${rindex}]`;

      const orderScopes: string[] = [];

      for (let i = 0; i < scopes.length; i++) {
        orderScopes.push(
          scopes[i],
          `${scopes[i]}[${index}]`,
          `${scopes[i]}[${rindex}]`,
        );
      }

      scopes = orderScopes;
    }

    if (isComplex) {
      // Use most complex scope
      for (const s of scopes) {
        if (s in grammar.complexScopes) {
          term = grammar.complexScopes[s];
        }
      }
    }

    return {
      contents: [type, `Term: ${term ?? "<unknown>"}`],
      range: new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column,
      ),
    };
  }
}
