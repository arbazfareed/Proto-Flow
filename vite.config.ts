import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "**/*.component.test.tsx", "e2e/**", "cloud/**"],
    pool: "threads",
    maxWorkers: 8,
    isolate: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/canvas/navigation.ts",
        "src/canvas/selection.ts",
        "src/canvas/snapping.ts",
        "src/devices/catalog.ts",
        "src/devices/frame.ts",
        "src/devices/schema.ts",
        "src/project/dynamicPanels.ts",
        "src/project/expressions.ts",
        "src/project/inputModes.ts",
        "src/project/interactions.ts",
        "src/project/interactionSchema.ts",
        "src/project/repeaters.ts",
        "src/project/responsive.ts",
        "src/project/schema.ts",
        "src/project/variables.ts",
        "src/store/canvasSlice.ts",
        "src/store/documentSlice.ts",
        "src/store/historySlice.ts",
        "src/store/uiSlice.ts",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
      },
    },
  },
});
