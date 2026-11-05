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
        "src/modules/rules/_*.ts",
        "src/modules/rules/index.ts",
        "src/modules/rules/rule-base.ts",
      ],
      reporter: ["json-summary", "text", "html"],
    },
  },
});
