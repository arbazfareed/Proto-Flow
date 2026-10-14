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
    });
    expect(result?.project.screens[0].widgets[0].props).not.toHaveProperty("src");
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

  it("copies linked image assets when saving a project to a new path", async () => {
    const project = createEmptyProject("Portable images");
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
      props: { mime: "image/png", fileName: "portrait.png", assetPath: "assets/portrait.png" },
    };
    const projectWithAsset = {
      ...project,
      screens: [{ ...project.screens[0], widgets: [image] }],
    };
    invokeMock
      .mockResolvedValueOnce("copied.pflow")
      .mockResolvedValueOnce({ mime: "image/png", base64: "aW1hZ2U=" })
      .mockResolvedValueOnce("assets/copied-portrait.png")
      .mockResolvedValueOnce("copied.pflow");

    const result = await saveProjectFile(projectWithAsset, "original.pflow", true);

    expect(result?.project.screens[0].widgets[0].props.assetPath)
      .toBe("assets/copied-portrait.png");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "read_image_asset", {
      projectPath: "original.pflow",
      assetPath: "assets/portrait.png",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "save_image_asset", {
      projectPath: "copied.pflow",
      mime: "image/png",
      base64: "aW1hZ2U=",
    });
  });

  it("externalizes the image that would exceed the cumulative inline-payload budget", async () => {
    const project = createEmptyProject("Image budget");
    const src = `data:image/png;base64,${"A".repeat(600_000)}`;
    const images = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      type: "image",
      x: index * 10,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: index,
      style: {},
      props: { src, mime: "image/png", fileName: `image-${index}.png` },
    }));
    const projectWithImages = {
      ...project,
      screens: [{ ...project.screens[0], widgets: images }],
    };
    invokeMock
      .mockResolvedValueOnce("assets/budget.png")
      .mockResolvedValueOnce("budget.pflow");

    const saved = await saveProjectFile(projectWithImages, "budget.pflow");
    const savedImages = saved?.project.screens[0].widgets ?? [];

    expect(savedImages.slice(0, 4).every((widget) => widget.props.src === src)).toBe(true);
    expect(savedImages[4].props).not.toHaveProperty("src");
    expect(savedImages[4].props.assetPath).toBe("assets/budget.png");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("rejects project file operations outside the desktop runtime", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openProjectFile()).rejects.toThrow("desktop app");
    await expect(saveProjectFile(createEmptyProject(), null)).rejects.toThrow("desktop app");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
