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

    await expect(saveProjectFile(project, "checkout.pflow")).resolves.toEqual({
      path: "checkout.pflow",
      project,
    });
    expect(invokeMock).toHaveBeenCalledWith("save_project", {
      path: "checkout.pflow",
      content: serializeProject(project),
    });
  });

  it("uses the native save-as dialog and preserves cancellation", async () => {
    const project = createEmptyProject("Checkout flow");
    invokeMock.mockResolvedValue(null);

    await expect(saveProjectFile(project, "existing.pflow", true)).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("pick_project_save_path", {
      defaultFilename: "Checkout flow",
    });
  });

  it("moves images of at least 500 KB into the project assets folder on save", async () => {
    const project = createEmptyProject("Images");
    const screen = project.screens[0];
    const bytes = new Uint8Array(500 * 1024);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const src = `data:image/png;base64,${btoa(binary)}`;
    const image = {
      id: crypto.randomUUID(),
      type: "image",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { src, mime: "image/png", fileName: "large.png" },
    };
    const projectWithImage = {
      ...project,
      screens: [{ ...screen, widgets: [image] }],
    };
    invokeMock
      .mockResolvedValueOnce("assets/generated.png")
      .mockResolvedValueOnce("images.pflow");

    const result = await saveProjectFile(projectWithImage, "images.pflow");

    expect(result?.path).toBe("images.pflow");
    expect(result?.project.screens[0].widgets[0].props).toMatchObject({
      assetPath: "assets/generated.png",
      src,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "save_image_asset",
      expect.objectContaining({
        projectPath: "images.pflow",
        mime: "image/png",
      }),
    );
    const savedContent = invokeMock.mock.calls[1][1] as { content: string };
    expect(JSON.parse(savedContent.content).screens[0].widgets[0].props).toEqual({
      mime: "image/png",
      fileName: "large.png",
      assetPath: "assets/generated.png",
    });
  });

  it("rejects project file operations outside the desktop runtime", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openProjectFile()).rejects.toThrow("desktop app");
    await expect(saveProjectFile(createEmptyProject(), null)).rejects.toThrow("desktop app");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
