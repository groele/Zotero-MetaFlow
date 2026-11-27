import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["test/unit-transport.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.ts",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/modules/**/*.ts",
        "src/domains/lint-engine/rules/_*.ts",
        "src/domains/lint-engine/rules/index.ts",
        "src/services/lint/rule-base.ts",
      ],
      reporter: ["json-summary", "text", "html"],
    },
  },
});
