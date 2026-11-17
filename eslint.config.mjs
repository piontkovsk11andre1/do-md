import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      ".types/**",
      "coverage/**",
      "tests/fixtures/**",
      "tests/conformance/**",
      "examples/**",
    ],
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
    rules: {
      curly: ["error", "all"],
      "constructor-super": "error",
      "for-direction": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "no-constant-binary-expression": "error",
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": "error",
      "no-import-assign": "error",
      "no-this-before-super": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-private-class-members": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-var": "error",
      "prefer-const": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
