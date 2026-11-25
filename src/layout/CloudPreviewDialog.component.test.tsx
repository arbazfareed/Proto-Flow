import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { MeteredActionProvider } from "../wallet/meteredActions";
import { CloudPreviewDialog } from "./CloudPreviewDialog";

const base = { x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, style: {} };
const widget = (type: string, props: Record<string, unknown>): Widget =>
  ({ ...base, id: crypto.randomUUID(), type, props }) as Widget;

function openWith(...widgets: Widget[]) {
  const project = createEmptyProject("Shared");
  project.screens[0].name = "Home";
  project.screens[0].widgets = widgets;
  useStore.getState().setProject(project);
}

describe("CloudPreviewDialog with pictures from the web (B23)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("open")
        ? { ok: true, blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }) }
        : { ok: false, blob: async () => new Blob([]) },
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("copies a web picture into the preview and says so", async () => {
    openWith(widget("image", { src: "https://open.example/a.png", alt: "Logo" }));
    renderWithProviders(<MeteredActionProvider><CloudPreviewDialog onClose={() => {}} /></MeteredActionProvider>);

    expect(await screen.findByText(/1 picture from the web was copied into the preview/)).toBeInTheDocument();
    expect(screen.queryByText(/will show as missing/)).toBeNull();
  });

  it("names the pictures and videos a shared preview cannot show", async () => {
    openWith(
      widget("image", { src: "https://blocked.example/hero.png", alt: "Hero" }),
      widget("video", { src: "https://video.example/clip.mp4" }),
    );
    renderWithProviders(<MeteredActionProvider><CloudPreviewDialog onClose={() => {}} /></MeteredActionProvider>);

    expect(await screen.findByText(/2 pictures or videos use a web address that a shared preview cannot load/)).toBeInTheDocument();
    expect(screen.getByText("Hero on Home (image)")).toBeInTheDocument();
    expect(screen.getByText("video on Home (video)")).toBeInTheDocument();
  });

  it("shows no notice when the project has no web pictures", async () => {
    openWith(widget("text", { text: "Hello" }));
    renderWithProviders(<MeteredActionProvider><CloudPreviewDialog onClose={() => {}} /></MeteredActionProvider>);

    expect(await screen.findByRole("button", { name: /Publish \(2 credits\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/web address/)).toBeNull();
    expect(screen.queryByText(/from the web/)).toBeNull();
  });
});
