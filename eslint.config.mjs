// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import parser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["eslint.config.mjs", "examples/**/*.[jt]s", "dist/**/*.js"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        programs: [
          parser.createProgram("tsconfig.json"),
          parser.createProgram("tsconfig.scripts.json"),
        ],
      },
    },
  },
  eslintConfigPrettier,
);
