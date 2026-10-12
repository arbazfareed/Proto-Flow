import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createEmptyProject,
  SchemaValidationError,
  serializeProject,
} from "./schema";
import { openProjectFile, saveProjectFile } from "./files";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("native project file commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
  });

  it("opens and validates project content returned by the Rust command", async () => {
    const project = createEmptyProject("Checkout flow");
    invokeMock.mockResolvedValue({ path: "checkout.pflow", content: serializeProject(project) });

    await expect(openProjectFile()).resolves.toEqual({
      project,
      path: "checkout.pflow",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_project");
  });

  it("preserves a cancelled native open dialog", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(openProjectFile()).resolves.toBeNull();
  });

  it("rejects an incompatible project version without loading it", async () => {
    invokeMock.mockResolvedValue({
      path: "future-format.pflow",
      content: '{"schemaVersion":"2.5.0"}',
    });

    await expect(openProjectFile()).rejects.toMatchObject({
      name: "SchemaValidationError",
      message: "Project validation failed: schemaVersion: Incompatible schema version (2.5.0). Please update Proto Flow.",
    });
  });

  it("rejects malformed project JSON without crashing the file service", async () => {
    invokeMock.mockResolvedValue({
      path: "truncated.pflow",
      content: '{"schemaVersion":"1.0.0"',
    });

    await expect(openProjectFile()).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("saves to the current path using the atomic Rust save command", async () => {
    const project = createEmptyProject("Checkout flow");
    invokeMock.mockResolvedValue("checkout.pflow");

    await expect(saveProjectFile(project, "checkout.pflow")).resolves.toBe("checkout.pflow");
    expect(invokeMock).toHaveBeenCalledWith("save_project", {
      path: "checkout.pflow",
      content: serializeProject(project),
    });
  });

  it("uses the native save-as dialog and preserves cancellation", async () => {
    const project = createEmptyProject("Checkout flow");
    invokeMock.mockResolvedValue(null);

    await expect(saveProjectFile(project, "existing.pflow", true)).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("save_project_as", {
      defaultFilename: "Checkout flow",
      content: serializeProject(project),
    });
  });

  it("rejects project file operations outside the desktop runtime", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openProjectFile()).rejects.toThrow("desktop app");
    await expect(saveProjectFile(createEmptyProject(), null)).rejects.toThrow("desktop app");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
