import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

// Unit tests run with `isolate: false`, so another test file (versionHistory, for example)
// may already have loaded ./files with the real Tauri runtime. Reload the modules here so
// ./files always sees the mocked `invoke` and `isTauri`.
type Core = typeof import("@tauri-apps/api/core");
type Schema = typeof import("./schema");
type Files = typeof import("./files");
let invokeMock: ReturnType<typeof vi.mocked<Core["invoke"]>>;
let isTauriMock: ReturnType<typeof vi.mocked<Core["isTauri"]>>;
let createEmptyProject: Schema["createEmptyProject"];
let SchemaValidationError: Schema["SchemaValidationError"];
let serializeProject: Schema["serializeProject"];
let openProjectFile: Files["openProjectFile"];
let saveProjectFile: Files["saveProjectFile"];

beforeAll(async () => {
  vi.resetModules();
  const core = await import("@tauri-apps/api/core");
  invokeMock = vi.mocked(core.invoke);
  isTauriMock = vi.mocked(core.isTauri);
  ({ createEmptyProject, SchemaValidationError, serializeProject } = await import("./schema"));
  ({ openProjectFile, saveProjectFile } = await import("./files"));
});

describe("project file commands", () => {
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

  it("downloads a portable .pflow project in the browser without cloud calls", async () => {
    const project = createEmptyProject("Offline demo");
    const imageSource = "data:image/png;base64,iVBORw0KGgo=";
    project.screens[0].widgets.push({
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
      props: { src: imageSource, assetPath: "assets/logo.png", mime: "image/png" },
    });
    let downloadBlob: Blob | undefined;
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("Expected a project Blob download.");
      downloadBlob = blob;
      return "blob:offline-project";
    });
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: "", download: "", style: {}, click, remove: vi.fn() };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { append: vi.fn() },
    });
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        callback();
        return 1;
      }),
    });
    isTauriMock.mockReturnValue(false);

    const result = await saveProjectFile(project, null);

    expect(result).toEqual({ path: "Offline demo.pflow", project, method: "download" });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(link.download).toBe("Offline demo.pflow");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:offline-project");
    const downloadedProject = JSON.parse(await downloadBlob!.text()) as {
      screens: Array<{ widgets: Array<{ props: Record<string, unknown> }> }>;
    };
    expect(downloadedProject.screens[0].widgets[0].props).toMatchObject({ src: imageSource });
    expect(downloadedProject.screens[0].widgets[0].props).not.toHaveProperty("assetPath");

    vi.unstubAllGlobals();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("does not download an incomplete project when image assets are not embedded", async () => {
    const project = createEmptyProject("Images");
    project.screens[0].widgets = [{
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
      props: { assetPath: "assets/photo.png", mime: "image/png" },
    }];
    isTauriMock.mockReturnValue(false);

    await expect(saveProjectFile(project, null)).rejects.toThrow(
      "Open it in the desktop app to download a copy with those assets.",
    );
    expect(invokeMock).not.toHaveBeenCalled();
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
});

describe("opening a .pflow file in the browser (B45)", () => {
  type Listener = () => void;

  /** A fake file input: `choose` runs the `change` handlers, `cancel` runs the `cancel` handlers. */
  function stubFilePicker(action: "choose" | "cancel", file?: { name: string; size: number; text: () => Promise<string> }) {
    const listeners: Record<string, Listener[]> = {};
    const input = {
      type: "",
      accept: "",
      style: {} as Record<string, string>,
      files: file ? [file] : [],
      addEventListener: (name: string, listener: Listener) => {
        (listeners[name] ??= []).push(listener);
      },
      remove: vi.fn(),
      click: vi.fn(() => {
        for (const listener of listeners[action === "choose" ? "change" : "cancel"] ?? []) listener();
      }),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => input),
      body: { append: vi.fn() },
    });
    return input;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
  });

  it("shows a file picker for .pflow files and opens the chosen project", async () => {
    const project = createEmptyProject("Reopened in browser");
    const content = serializeProject(project);
    const input = stubFilePicker("choose", {
      name: "Reopened in browser.pflow",
      size: content.length,
      text: async () => content,
    });

    await expect(openProjectFile()).resolves.toEqual({
      project,
      path: "Reopened in browser.pflow",
    });
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".pflow");
    expect(input.click).toHaveBeenCalledOnce();
    expect(input.remove).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns null when the picker is closed without choosing a file", async () => {
    stubFilePicker("cancel");

    await expect(openProjectFile()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects a damaged file and a file that is too large without loading them", async () => {
    stubFilePicker("choose", { name: "broken.pflow", size: 20, text: async () => '{"schemaVersion":"1.0.0"' });
    await expect(openProjectFile()).rejects.toBeInstanceOf(SchemaValidationError);

    const text = vi.fn(async () => "{}");
    stubFilePicker("choose", { name: "huge.pflow", size: 101 * 1024 * 1024, text });
    await expect(openProjectFile()).rejects.toThrow("too large to open in the browser");
    expect(text).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("saving in the browser when it can write to a file (B62)", () => {
  type Writable = { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };

  function makeHandle(name: string, opts: { failWrite?: boolean; text?: string } = {}) {
    const writable: Writable = {
      write: vi.fn(async () => { if (opts.failWrite) throw new Error("Disk is full"); }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const text = opts.text ?? "";
    return {
      name,
      writable,
      createWritable: vi.fn(async () => writable),
      getFile: vi.fn(async () => ({ name, size: text.length, text: async () => text }) as unknown as File),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks where to save once, then overwrites the same file on every later save", async () => {
    const handle = makeHandle("Checkout flow.pflow");
    const showSaveFilePicker = vi.fn(async () => handle);
    vi.stubGlobal("window", { showSaveFilePicker });
    const project = createEmptyProject("Checkout flow");

    const first = await saveProjectFile(project, null);
    expect(first).toEqual({ path: "Checkout flow.pflow", project, method: "file" });
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "Checkout flow.pflow" }));

    const second = await saveProjectFile(project, "Checkout flow.pflow");
    const third = await saveProjectFile(project, "Checkout flow.pflow");

    expect(second?.method).toBe("file");
    expect(third?.method).toBe("file");
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(handle.createWritable).toHaveBeenCalledTimes(3);
    expect(handle.writable.write).toHaveBeenCalledTimes(3);
    expect(handle.writable.close).toHaveBeenCalledTimes(3);
    expect(JSON.parse(handle.writable.write.mock.calls[0][0] as string).name).toBe("Checkout flow");
  });

  it("asks again for Save As, for a new project, and when the file name no longer matches", async () => {
    const first = makeHandle("One.pflow");
    const second = makeHandle("Two.pflow");
    const showSaveFilePicker = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(first);
    vi.stubGlobal("window", { showSaveFilePicker });
    const project = createEmptyProject("One");

    await saveProjectFile(project, null);
    await saveProjectFile(project, "One.pflow", true); // Save As
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);

    await saveProjectFile(project, null); // a new project has no file name yet
    expect(showSaveFilePicker).toHaveBeenCalledTimes(3);

    await saveProjectFile(project, "Other.pflow"); // not the file we hold a handle for
    expect(showSaveFilePicker).toHaveBeenCalledTimes(4);
  });

  it("does nothing when the file picker is closed", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    vi.stubGlobal("window", { showSaveFilePicker });

    await expect(saveProjectFile(createEmptyProject("Cancelled"), null)).resolves.toBeNull();
  });

  it("reports a write failure, aborts the write, and asks again on the next save", async () => {
    const broken = makeHandle("Broken.pflow", { failWrite: true });
    const fresh = makeHandle("Broken.pflow");
    const showSaveFilePicker = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(fresh);
    vi.stubGlobal("window", { showSaveFilePicker });
    const project = createEmptyProject("Broken");

    await expect(saveProjectFile(project, null)).rejects.toThrow("Disk is full");
    expect(broken.writable.abort).toHaveBeenCalledOnce();

    await expect(saveProjectFile(project, "Broken.pflow")).resolves.toMatchObject({ method: "file" });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
  });

  it("saves back into the file that was opened with the file picker", async () => {
    const project = createEmptyProject("Opened in browser");
    const handle = makeHandle("Opened in browser.pflow", { text: serializeProject(project) });
    const showOpenFilePicker = vi.fn(async () => [handle]);
    const showSaveFilePicker = vi.fn();
    vi.stubGlobal("window", { showOpenFilePicker, showSaveFilePicker });

    await expect(openProjectFile()).resolves.toEqual({ project, path: "Opened in browser.pflow" });
    await expect(saveProjectFile(project, "Opened in browser.pflow")).resolves.toMatchObject({
      path: "Opened in browser.pflow",
      method: "file",
    });
    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(handle.writable.write).toHaveBeenCalledOnce();
  });

  it("returns null when the open picker is closed", async () => {
    vi.stubGlobal("window", {
      showOpenFilePicker: vi.fn(async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      }),
    });

    await expect(openProjectFile()).resolves.toBeNull();
  });

  it("still refuses to save a project whose images live beside a desktop project", async () => {
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn() });
    const project = createEmptyProject("Desktop images");
    project.screens[0].widgets = [{
      id: crypto.randomUUID(), type: "image", x: 0, y: 0, width: 50, height: 50, rotation: 0,
      opacity: 1, visible: true, locked: false, zIndex: 0, style: {},
      props: { assetPath: "assets/a.png", src: "asset://a.png" },
    }];

    await expect(saveProjectFile(project, null)).rejects.toThrow("stored beside its desktop project");
  });
});
