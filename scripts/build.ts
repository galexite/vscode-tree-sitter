#!/usr/bin/env npx tsx

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const isWindows = process.platform === "win32";
const whichEmcc =
  (isWindows && spawnSync("where", ["emcc"])) ||
  spawnSync("command -v emcc", { shell: true });

if (whichEmcc.status !== 0) {
  console.error(
    "emcc not found on PATH. The Emscripten SDK is required to build tree-sitter modules.",
  );
  process.exit(1);
}

function execWrapper(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = executable;
    if (args.length > 0) {
      cmd += " " + args.join(" ");
    }
    console.log("+ %s", cmd);
    const ts = execFile(executable, args);
    ts.stdout?.pipe(process.stdout);
    ts.stderr?.pipe(process.stderr);
    ts.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`\`${cmd}\` exited with code ${code}`));
      }

      resolve();
    });
  });
}

// Language-package map
const langMap = {
  typescript: {
    module: ["typescript", "typescript"],
    output: "typescript",
  },
  typescriptreact: {
    module: ["typescript", "tsx"],
    output: "tsx",
  },
  ocaml: {
    module: ["ocaml", "grammars", "ocaml"],
    output: "ocaml",
  },
  shellscript: {
    module: ["bash"],
    output: "bash",
  },
  csharp: {
    module: ["c-sharp"],
    output: "c_sharp",
  },
  php: {
    module: ["php", "php"],
    output: "php",
  },
};

type Language = keyof typeof langMap;

// Build wasm parsers for supported languages
const parsersDir = path.relative(
  process.cwd(),
  path.join(__dirname, "..", "parsers"),
);
fs.mkdirSync(parsersDir, { recursive: true });

function buildLanguage(lang: Language, next: () => void): void {
  const mapping = langMap[lang];
  const module = path.relative(
    process.cwd(),
    path.join(
      __dirname,
      "..",
      "node_modules",
      `tree-sitter-${mapping?.module[0] ?? lang}`,
      ...(mapping?.module.slice(1) ?? []),
    ),
  );
  const output = path.join(
    parsersDir,
    `tree-sitter-${mapping?.output ?? lang}.wasm`,
  );

  console.log(`Building ${lang} parser with ${module} to ${output}`);

  if (!(fs.existsSync(module) && fs.statSync(module).isDirectory())) {
    console.error(`No module found for ${lang}`);
    next();
    return;
  }

  let treeSitterExe = path.relative(
    process.cwd(),
    path.join(__dirname, "..", "node_modules", ".bin", "tree-sitter"),
  );

  if (isWindows) {
    treeSitterExe += ".cmd";
  }

  // if (lang === "d") {
  //   execFileSync(treeSitterExe, ["generate"], {
  //     cwd: module,
  //   });
  // }

  execWrapper(treeSitterExe, ["build", "--wasm", "--output", output, module])
    .then(() => next())
    .catch((reason) => {
      console.error("Building %s parser failed: %s", lang, reason);
    });
}

const languages = Object.keys(langMap) as Language[];

function buildNextLanguage() {
  const lang = languages.pop();
  if (lang === undefined) {
    return;
  }
  buildLanguage(lang, buildNextLanguage);
}

buildNextLanguage();
