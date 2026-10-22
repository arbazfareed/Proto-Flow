import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "./manifest";
import { hasPluginPermission, parsePluginExtension, type PluginExtension } from "./runtime";

const plugin = (permissions: string[]) => ({
  manifest: parsePluginManifest({
    id: "example.permission-test",
    name: "Permission test",
    version: "1.0.0",
    author: "ProtoFlow tests",
    main: "plugin.js",
    permissions,
  }),
  source: "",
  enabled: true,
  installedAt: new Date(0).toISOString(),
});

describe("plugin extension permissions", () => {
  it.each([
    ["shape", "canvas:write"],
    ["exporter", "export:write"],
    ["aiProvider", "ai:generate"],
    ["command", "commands:run"],
  ] as const)("requires %s extensions to request %s", (kind, permission) => {
    const extension: PluginExtension = {
      kind,
      id: "test",
      label: "Test",
      definition: {},
    };
    expect(hasPluginPermission(plugin([permission]), extension)).toBe(true);
    expect(hasPluginPermission(plugin([]), extension)).toBe(false);
  });
});

describe("plugin extension definitions", () => {
  it("validates and limits built-in custom shape primitives", () => {
    expect(parsePluginExtension("shape", {
      id: "rounded-card",
      label: "Rounded card",
      kind: "rectangle",
      width: 240,
      height: 120,
      fill: "#123456",
    }).label).toBe("Rounded card");
    expect(() => parsePluginExtension("shape", {
      id: "invalid",
      label: "Invalid",
      kind: "rectangle",
      fill: "#12345",
    })).toThrow("hex color");
    expect(() => parsePluginExtension("shape", {
      id: "invalid",
      label: "Invalid",
      kind: "rectangle",
      component: "script",
    })).toThrow("unsupported fields");
  });

  it("rejects malformed definitions and unsupported extension kinds", () => {
    expect(() => parsePluginExtension("unknown", { id: "x", label: "X" }))
      .toThrow("unsupported extension type");
    expect(() => parsePluginExtension("command", { id: "../command", label: "Run" }))
      .toThrow("IDs and labels");
    expect(() => parsePluginExtension("shape", {
      id: "custom",
      label: "Custom",
      kind: "svg",
    })).toThrow("rectangle, ellipse, or text");
  });
});
