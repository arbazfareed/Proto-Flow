import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDiagnosticLine,
  clearRecentDiagnosticLines,
  getRecentDiagnosticLines,
  MAX_DIAGNOSTIC_LOG_LINES,
  readPrivacySettings,
  sanitizeDiagnosticText,
  writePrivacySettings,
} from "./privacy";

const storedValues = new Map<string, string>();
const localStorageStub = {
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  removeItem: (key: string) => storedValues.delete(key),
  setItem: (key: string, value: string) => storedValues.set(key, value),
};

describe("diagnostic privacy helpers", () => {
  beforeEach(() => {
    clearRecentDiagnosticLines();
    vi.stubGlobal("localStorage", localStorageStub);
    storedValues.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("redacts common identifying and credential-like values", () => {
    const sanitized = sanitizeDiagnosticText(
      "User person@example.com at C:\\Users\\Alice\\project.pflow with ghp_123456789012345678901234567890",
    );

    expect(sanitized).not.toContain("person@example.com");
    expect(sanitized).not.toContain("C:\\Users\\Alice");
    expect(sanitized).not.toContain("ghp_123456789012345678901234567890");
    expect(sanitized.match(/\[redacted\]/g)).toHaveLength(3);
  });

  it("defaults to no stored consent and rejects malformed preferences", () => {
    expect(readPrivacySettings()).toBeNull();
    localStorage.setItem("protoflow.privacy.v1", "{");
    expect(() => readPrivacySettings()).toThrow("invalid JSON");
    localStorage.setItem(
      "protoflow.privacy.v1",
      JSON.stringify({ crashReports: true, anonymousTelemetry: "yes" }),
    );
    expect(() => readPrivacySettings()).toThrow("unsupported format");
  });

  it("persists crash and telemetry consent separately", () => {
    const settings = { crashReports: true, anonymousTelemetry: false };
    writePrivacySettings(settings);
    expect(readPrivacySettings()).toEqual(settings);
  });

  it("keeps only the most recent 20 sanitized log entries", () => {
    for (let index = 0; index < MAX_DIAGNOSTIC_LOG_LINES + 3; index += 1) {
      appendDiagnosticLine("info", `event-${index} user${index}@example.com`);
    }
    const lines = getRecentDiagnosticLines();
    expect(lines).toHaveLength(MAX_DIAGNOSTIC_LOG_LINES);
    expect(lines[0]).toContain("event-3");
    expect(lines.at(-1)).toContain("[redacted]");
    expect(lines.join("\n")).not.toContain("@example.com");
  });
});
