import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "./manifest";

const validManifest = {
  id: "example.sample-plugin",
  name: "Sample plugin",
  version: "1.0.0",
  author: "ProtoFlow tests",
  main: "plugin.js",
  permissions: ["commands:run"],
};

describe("plugin manifest", () => {
  it("accepts a valid, explicitly-permissioned plugin", () => {
    expect(parsePluginManifest(validManifest)).toEqual(validManifest);
  });

  it("rejects unknown fields and permissions", () => {
    expect(() => parsePluginManifest({ ...validManifest, wallet: true })).toThrow("Invalid plugin manifest");
    expect(() => parsePluginManifest({
      ...validManifest,
      permissions: ["wallet:read"],
    })).toThrow("Invalid plugin manifest");
  });

  it("rejects invalid identifiers, versions, and duplicate permissions", () => {
    expect(() => parsePluginManifest({ ...validManifest, id: "../plugin" })).toThrow("Invalid plugin manifest");
    expect(() => parsePluginManifest({ ...validManifest, version: "latest" })).toThrow("Invalid plugin manifest");
    expect(() => parsePluginManifest({
      ...validManifest,
      permissions: ["commands:run", "commands:run"],
    })).toThrow("Invalid plugin manifest");
  });
});
