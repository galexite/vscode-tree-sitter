import * as vscode from "vscode";
import * as wts from "web-tree-sitter";
import * as jsonc from "jsonc-parser";
import * as fs from "fs";
import * as path from "path";
import { GRAMMARS_DIR, PARSERS_DIR } from "./util";

export type Term = { term: string; range: vscode.Range };

interface GrammarJSON {
  simpleTerms: { [sym: string]: string };
  complexTerms: string[];
  complexScopes: { [sym: string]: string };
}

const INSTANCES = new Map<string, Grammar>();

export class Grammar {
  readonly complexDepth: number = 0;
  readonly complexOrder: boolean = false;

  // Constructor
  constructor(
    private readonly parser: wts.Parser,
    readonly simpleTerms: GrammarJSON["simpleTerms"],
    readonly complexTerms: GrammarJSON["complexTerms"],
    readonly complexScopes: GrammarJSON["complexScopes"],
  ) {
    for (const s in this.complexScopes) {
      const depth = s.split(">").length;

      if (depth > this.complexDepth) {
        this.complexDepth = depth;
      }

      if (s.indexOf("[") >= 0) {
        this.complexOrder = true;
      }
    }

    this.complexDepth--;
  }

  private static async create(languageName: string): Promise<Grammar> {
    const parser = new wts.Parser();
    const languageFile = path.join(PARSERS_DIR, `${languageName}.wasm`);
    const language = await wts.Language.load(languageFile);
    parser.setLanguage(language);

    const grammarFile = path.join(GRAMMARS_DIR, `${languageName}.json`);

    const grammarJson = jsonc.parse(
      fs.readFileSync(grammarFile, { encoding: "utf-8" }),
    ) as GrammarJSON;

    return new Grammar(
      parser,
      grammarJson.simpleTerms,
      grammarJson.complexTerms,
      grammarJson.complexScopes,
    );
  }

  static async getOrCreate(languageName: string): Promise<Grammar> {
    let instance = INSTANCES.get(languageName);
    if (!instance) {
      instance = await Grammar.create(languageName);
      INSTANCES.set(languageName, instance);
    }
    return instance;
  }

  // Build syntax tree
  tree(doc: string): wts.Tree | null {
    return this.parser.parse(doc);
  }

  // Parse syntax tree
  parse(tree: wts.Tree): Term[] {
    // Travel tree and peek terms
    const terms: Term[] = [];
    const stack: wts.Node[] = [];
    let node = tree.rootNode.firstChild;

    while (stack.length > 0 || node) {
      // Go deeper
      if (node) {
        stack.push(node);
        node = node.firstChild;
      }
      // Go back
      else {
        node = stack.pop()!;

        const type = getNodeType(node);

        // Simple one-level terms
        let term: string | undefined = undefined;
        if (!this.complexTerms.includes(type)) {
          term = this.simpleTerms[type];
        }
        // Complex terms require multi-level analyzes
        else {
          // Build complex scopes
          let desc = type;
          let scopes = [desc];
          let parent = node.parent;
          for (let i = 0; i < this.complexDepth && parent; i++) {
            const parentType = getNodeType(parent);

            desc = `${parentType} > ${desc}`;
            scopes.push(desc);
            parent = parent.parent;
          }

          // If there is also order complexity
          if (this.complexOrder) {
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

          // Use most complex scope
          for (const d of scopes) {
            if (d in this.complexScopes) {
              term = this.complexScopes[d];
            }
          }
        }

        // If term is found add it
        if (term) {
          terms.push({
            term: term,
            range: new vscode.Range(
              new vscode.Position(
                node.startPosition.row,
                node.startPosition.column,
              ),
              new vscode.Position(
                node.endPosition.row,
                node.endPosition.column,
              ),
            ),
          });
        }
        // Go right
        node = node.nextSibling;
      }
    }

    return terms;
  }
}

export function getNodeType(node: wts.Node): string {
  let type = node.type;

  if (!node.isNamed) {
    type = `"${type}"`;
  }

  return type;
}
