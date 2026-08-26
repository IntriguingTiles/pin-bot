import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig(
    eslint.configs.recommended,
    tseslint.configs.strict,
    tseslint.configs.stylistic,
    {
        languageOptions: {
            globals: globals.node
        },
        rules: {
            "brace-style": "error",
            "no-var": "error",
            "prefer-const": "error",
            "no-console": "off",
            quotes: ["error", "double"],
            semi: ["error", "always"],
            yoda: "error",
            eqeqeq: ["error", "smart"],
            "@typescript-eslint/prefer-literal-enum-member": [
                "error",
                {
                    "allowBitwiseExpressions": true
                }
            ],
        }
    }
);