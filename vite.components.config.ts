import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.component.test.tsx"],
    setupFiles: ["./src/test/componentSetup.ts"],
    pool: "threads",
    maxWorkers: 8,
    isolate: true,
    coverage: {
      provider: "v8",
      include: [
        "src/devices/DevicePicker.tsx",
        "src/layout/CommandPalette.tsx",
        "src/layout/ExpressionField.tsx",
        "src/layout/RestoreModal.tsx",
        "src/layout/UpdateToast.tsx",
        "src/layout/VersionHistoryDialog.tsx",
        "src/layout/WidgetNotes.tsx",
        "src/onboarding/OnboardingWizard.tsx",
      ],
      reporter: ["text", "html"],
      thresholds: {
        lines: 70,
      },
    },
  },
});
