import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import {
  installPluginArchive,
  listInstalledPlugins,
  readPluginArchive,
  setPluginEnabled,
  uninstallPlugin,
} from "./storage";

const manifest = {
  id: "example.sample-plugin",
  name: "Sample plugin",
  version: "1.0.0",
  author: "ProtoFlow tests",
  main: "plugin.js",
  permissions: ["commands:run"],
};

class TestStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function makePluginFile(
  source = "ProtoFlow.registerCommand({ id: 'hello', label: 'Hello' }, () => {});",
  extraFiles: Record<string, string> = {},
): Promise<File> {
  const zip = new JSZip();
  zip.file("plugin.json", JSON.stringify(manifest));
  zip.file("plugin.js", source);
  for (const [path, content] of Object.entries(extraFiles)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const fileBytes = new Uint8Array(bytes.byteLength);
  fileBytes.set(bytes);
  return new File([fileBytes], "sample.pflow-plugin", { type: "application/zip" });
}

describe("plugin archive installation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new TestStorage(),
    });
  });

  it("installs disabled plugins and persists enable and uninstall actions", async () => {
    const installed = await installPluginArchive(await makePluginFile());
    expect(installed.enabled).toBe(false);
    expect(listInstalledPlugins()).toHaveLength(1);

    setPluginEnabled(manifest.id, true);
    expect(listInstalledPlugins()[0].enabled).toBe(true);

    uninstallPlugin(manifest.id);
    expect(listInstalledPlugins()).toEqual([]);
  });

  it("rejects archives with unexpected files and duplicate plugin IDs", async () => {
    const first = await makePluginFile();
    await installPluginArchive(first);
    await expect(installPluginArchive(await makePluginFile())).rejects.toThrow("already installed");
    await expect(readPluginArchive(await makePluginFile("console.log('ok')", {
      "extra.js": "console.log('unexpected')",
    }))).rejects.toThrow("must contain only plugin.json and plugin.js");
  });

  it("rejects oversized JavaScript after decompression", async () => {
    await expect(readPluginArchive(await makePluginFile("x".repeat(512 * 1024 + 1))))
      .rejects.toThrow("512 KiB");
  });

  it("rejects corrupt plugin source encoding", async () => {
    const zip = new JSZip();
    zip.file("plugin.json", JSON.stringify(manifest));
    zip.file("plugin.js", new Uint8Array([0xff, 0xfe]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const fileBytes = new Uint8Array(bytes.byteLength);
    fileBytes.set(bytes);
    await expect(readPluginArchive(new File([fileBytes], "invalid.pflow-plugin")))
      .rejects.toThrow();
  });
});
