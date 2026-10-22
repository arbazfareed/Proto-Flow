import JSZip from "jszip";
import type { InstalledPlugin } from "./manifest";
import { parsePluginManifest } from "./manifest";

export const PLUGINS_STORAGE_KEY = "proto-flow:plugins:v1";
export const MAX_PLUGIN_ARCHIVE_BYTES = 1024 * 1024;
export const MAX_PLUGIN_SOURCE_BYTES = 512 * 1024;
export const MAX_INSTALLED_PLUGINS = 20;
const MAX_TOTAL_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES = 16 * 1024;

function readInstalledPlugins(): InstalledPlugin[] {
  let serialized: string | null;
  try {
    serialized = localStorage.getItem(PLUGINS_STORAGE_KEY);
  } catch (error) {
    throw new Error("Cannot access plugin storage.", { cause: error });
  }
  if (!serialized) return [];
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Saved plugin data is invalid JSON.", { cause: error });
  }
  if (!Array.isArray(value)) throw new Error("Saved plugin data has an invalid format.");
  const plugins = value.map((entry) => {
    if (
      typeof entry !== "object" || entry === null ||
      !("manifest" in entry) || !("source" in entry) ||
      !("enabled" in entry) || !("installedAt" in entry)
    ) throw new Error("Saved plugin data has an invalid entry.");
    const plugin = entry as Record<string, unknown>;
    if (
      typeof plugin.source !== "string" ||
      new TextEncoder().encode(plugin.source).byteLength > MAX_PLUGIN_SOURCE_BYTES ||
      typeof plugin.enabled !== "boolean" ||
      typeof plugin.installedAt !== "string"
    ) throw new Error("Saved plugin data has an invalid entry.");
    return {
      manifest: parsePluginManifest(plugin.manifest),
      source: plugin.source,
      enabled: plugin.enabled,
      installedAt: plugin.installedAt,
    };
  });
  if (
    plugins.length > MAX_INSTALLED_PLUGINS ||
    plugins.reduce((total, plugin) => total + new TextEncoder().encode(plugin.source).byteLength, 0) >
      MAX_TOTAL_PLUGIN_SOURCE_BYTES ||
    new Set(plugins.map((plugin) => plugin.manifest.id)).size !== plugins.length
  ) throw new Error("Saved plugin data exceeds its limits or contains duplicate plugin IDs.");
  return plugins;
}

function saveInstalledPlugins(plugins: InstalledPlugin[]): void {
  try {
    localStorage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify(plugins));
  } catch (error) {
    throw new Error("Could not save installed plugins. Check available browser storage.", { cause: error });
  }
}

export function listInstalledPlugins(): InstalledPlugin[] {
  return readInstalledPlugins();
}

function validateZipDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const getUint16 = (offset: number) => view.getUint16(offset, true);
  const getUint32 = (offset: number) => view.getUint32(offset, true);
  const endStart = Math.max(0, bytes.byteLength - 22 - 65_535);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= endStart; offset -= 1) {
    if (getUint32(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0 || endOffset + 22 + getUint16(endOffset + 20) !== bytes.byteLength) {
    throw new Error("Plugin archive has an invalid ZIP directory.");
  }
  if (
    getUint16(endOffset + 4) !== 0 ||
    getUint16(endOffset + 6) !== 0 ||
    getUint16(endOffset + 8) !== getUint16(endOffset + 10)
  ) throw new Error("Multi-disk ZIP archives are not supported.");
  if (getUint16(endOffset + 10) !== 2) {
    throw new Error("A .pflow-plugin archive must contain only plugin.json and plugin.js.");
  }

  const centralDirectorySize = getUint32(endOffset + 12);
  const centralDirectoryOffset = getUint32(endOffset + 16);
  if (
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) throw new Error("ZIP64 or malformed plugin archives are not supported.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;
  for (let index = 0; index < 2; index += 1) {
    if (offset + 46 > endOffset || getUint32(offset) !== 0x02014b50) {
      throw new Error("Plugin archive has an invalid ZIP entry.");
    }
    const uncompressedSize = getUint32(offset + 24);
    const nameLength = getUint16(offset + 28);
    const extraLength = getUint16(offset + 30);
    const commentLength = getUint16(offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > endOffset || uncompressedSize === 0xffffffff) {
      throw new Error("Plugin archive contains an oversized or unsupported ZIP entry.");
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name !== "plugin.json" && name !== "plugin.js") {
      throw new Error("A .pflow-plugin archive must contain only plugin.json and plugin.js.");
    }
    if (name === "plugin.json" && uncompressedSize > MAX_PLUGIN_MANIFEST_BYTES) {
      throw new Error("plugin.json must be 16 KiB or smaller.");
    }
    if (name === "plugin.js" && uncompressedSize > MAX_PLUGIN_SOURCE_BYTES) {
      throw new Error("Plugin JavaScript must be between 1 byte and 512 KiB.");
    }
    names.add(name);
    totalUncompressedBytes += uncompressedSize;
    offset = entryEnd;
  }
  if (
    offset !== endOffset ||
    names.size !== 2 ||
    totalUncompressedBytes > MAX_PLUGIN_SOURCE_BYTES + MAX_PLUGIN_MANIFEST_BYTES
  ) throw new Error("Plugin archive has duplicate entries or exceeds its uncompressed size limit.");
}

export async function readPluginArchive(file: File): Promise<Omit<InstalledPlugin, "enabled" | "installedAt">> {
  if (file.size === 0 || file.size > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error("Plugin archives must be between 1 byte and 1 MiB.");
  }
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  validateZipDirectory(archiveBytes);
  const zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  if (
    paths.length !== 2 ||
    !paths.includes("plugin.json") ||
    !paths.includes("plugin.js")
  ) {
    throw new Error("A .pflow-plugin archive must contain only plugin.json and plugin.js.");
  }
  const manifestFile = zip.file("plugin.json");
  const sourceFile = zip.file("plugin.js");
  if (!manifestFile || !sourceFile) throw new Error("The plugin archive is missing required files.");
  const [manifestText, sourceBytes] = await Promise.all([
    manifestFile.async("string"),
    sourceFile.async("uint8array"),
  ]);
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_PLUGIN_SOURCE_BYTES) {
    throw new Error("Plugin JavaScript must be between 1 byte and 512 KiB.");
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(manifestText);
  } catch (error) {
    throw new Error("plugin.json is not valid JSON.", { cause: error });
  }
  const manifest = parsePluginManifest(manifestRaw);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  if (source.includes("\u0000")) throw new Error("Plugin JavaScript contains a null byte.");
  return { manifest, source };
}

export async function installPluginArchive(file: File): Promise<InstalledPlugin> {
  if (!import.meta.env.DEV) {
    throw new Error("Plugin installation is disabled in production until signing keys and revocation checks are configured.");
  }
  const { manifest, source } = await readPluginArchive(file);
  const plugins = readInstalledPlugins();
  if (plugins.some((plugin) => plugin.manifest.id === manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" is already installed.`);
  }
  if (
    plugins.length >= MAX_INSTALLED_PLUGINS ||
    plugins.reduce((total, plugin) => total + new TextEncoder().encode(plugin.source).byteLength, 0) +
      new TextEncoder().encode(source).byteLength > MAX_TOTAL_PLUGIN_SOURCE_BYTES
  ) throw new Error("Installing this plugin would exceed the local plugin storage limit.");
  const installed: InstalledPlugin = {
    manifest,
    source,
    enabled: false,
    installedAt: new Date().toISOString(),
  };
  saveInstalledPlugins([...plugins, installed]);
  return installed;
}

export function setPluginEnabled(pluginId: string, enabled: boolean): void {
  if (enabled && !import.meta.env.DEV) {
    throw new Error("Unsigned plugins cannot be enabled in production.");
  }
  const plugins = readInstalledPlugins();
  if (!plugins.some((plugin) => plugin.manifest.id === pluginId)) {
    throw new Error(`Plugin "${pluginId}" is not installed.`);
  }
  saveInstalledPlugins(plugins.map((plugin) =>
    plugin.manifest.id === pluginId ? { ...plugin, enabled } : plugin,
  ));
}

export function uninstallPlugin(pluginId: string): void {
  const plugins = readInstalledPlugins();
  if (!plugins.some((plugin) => plugin.manifest.id === pluginId)) {
    throw new Error(`Plugin "${pluginId}" is not installed.`);
  }
  saveInstalledPlugins(plugins.filter((plugin) => plugin.manifest.id !== pluginId));
}
