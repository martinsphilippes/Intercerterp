import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // o tsconfig do Next deixa o JSX intacto ("preserve"); nos testes, componentes .tsx viram chamadas do React
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30000, env: { DATA_BACKEND: "memory", TZ: "UTC" } },
});
