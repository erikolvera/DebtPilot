import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: every test in this project targets a pure function in
    // lib/. Components are verified in the browser, not with a DOM shim.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
