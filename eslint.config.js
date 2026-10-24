import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
    },
  },
  {
    // INT-07: adapters are typed by runIntegrationOperation/IntegrationResolverService; casting one hides a provider mismatch.
    files: ["src/temporal/activities/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "TSAsExpression[typeAnnotation.typeName.name=/Adapter(For)?$/], TSTypeAssertion[typeAnnotation.typeName.name=/Adapter(For)?$/]",
          message: "Do not cast integration adapters in Activities; pass providerKey/operation to runIntegrationOperation and use the typed adapter it provides.",
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  }
);

