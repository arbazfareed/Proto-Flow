import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { ImportCodeDialog, compileSandboxDocument } from "./ImportCodeDialog";

describe("ImportCodeDialog", () => {
  it("debounces live updates into a script-only sandbox with a restrictive CSP", async () => {
    renderWithProviders(<ImportCodeDialog onClose={vi.fn()} onRenderOnCanvas={vi.fn()} />);
    const preview = screen.getByTitle("Sandboxed code preview");

    expect(preview.getAttribute("sandbox")).toBe("allow-scripts");
    await waitFor(() => {
      expect(preview.getAttribute("srcdoc")).toContain("connect-src 'none'");
    });

    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: { value: "<h1>Updated live preview</h1>" },
    });
    await waitFor(() => {
      expect(preview.getAttribute("srcdoc")).toContain("Updated live preview");
    });
    expect(preview.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("switches between HTML, CSS, and JavaScript editors and invokes canvas import", () => {
    const onClose = vi.fn();
    const onRenderOnCanvas = vi.fn();
    renderWithProviders(<ImportCodeDialog onClose={onClose} onRenderOnCanvas={onRenderOnCanvas} />);

    fireEvent.click(screen.getByRole("tab", { name: "CSS" }));
    fireEvent.change(screen.getByRole("textbox", { name: "CSS code" }), {
      target: { value: "h1 { color: red; }" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "JS" }));
    expect(screen.getByRole("textbox", { name: "JS code" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "HTML" }));
    const html = screen.getByRole("textbox", { name: "HTML code" });
    fireEvent.change(html, { target: { value: "<h1>Canvas import</h1>" } });

    fireEvent.click(screen.getByRole("button", { name: "Render on Canvas" }));
    expect(onRenderOnCanvas).toHaveBeenCalledWith({
      html: "<h1>Canvas import</h1>",
      css: "h1 { color: red; }",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows relevant code icons for semantic markup", () => {
    renderWithProviders(<ImportCodeDialog onClose={vi.fn()} onRenderOnCanvas={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: {
        value: `<video aria-label="Intro"></video><table><tr><td>Report</td></tr></table><input type="date" aria-label="Start date">`,
      },
    });

    expect(screen.getByLabelText("Required icons")).toHaveTextContent("Video");
    expect(screen.getByLabelText("Required icons")).toHaveTextContent("Table");
    expect(screen.getByLabelText("Required icons")).toHaveTextContent("Calendar");
  });

  it("keeps the dialog open and announces import errors", () => {
    const onRenderOnCanvas = vi.fn(() => {
      throw new Error("Nothing importable.");
    });
    renderWithProviders(<ImportCodeDialog onClose={vi.fn()} onRenderOnCanvas={onRenderOnCanvas} />);

    fireEvent.click(screen.getByRole("button", { name: "Render on Canvas" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing importable.");
    expect(screen.getByRole("dialog", { name: "Import code" })).toBeVisible();
  });
});

describe("compileSandboxDocument", () => {
  it("prevents user code from closing the generated style and script elements", () => {
    const srcdoc = compileSandboxDocument(
      "<p>Example</p>",
      "/* </style><img src=x> */",
      "/* </script><img src=x> */",
    );

    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).toContain("<\\/style");
    expect(srcdoc).toContain("<\\/script");
  });
});
