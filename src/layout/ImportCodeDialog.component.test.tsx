import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { ImportCodeDialog, compileSandboxDocument } from "./ImportCodeDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImportCodeDialog", () => {
  it("debounces live updates into a script-only sandbox with a restrictive CSP", async () => {
    renderWithProviders(<ImportCodeDialog screens={[]} sourceScreenId="source" onClose={vi.fn()} onRenderOnCanvas={vi.fn()} />);
    const preview = screen.getByTitle("Sandboxed code preview");

    expect(preview.getAttribute("sandbox")).toBe("allow-scripts");
    await waitFor(() => {
      expect(screen.getByTitle("Sandboxed code preview").getAttribute("srcdoc"))
        .toContain("connect-src 'none'");
    });

    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: { value: "<h1>Updated live preview</h1>" },
    });
    await waitFor(() => {
      expect(screen.getByTitle("Sandboxed code preview").getAttribute("srcdoc"))
        .toContain("Updated live preview");
    });
    expect(preview.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("switches between HTML, CSS, and JavaScript editors and invokes canvas import", () => {
    const onClose = vi.fn();
    const onRenderOnCanvas = vi.fn();
    renderWithProviders(<ImportCodeDialog screens={[]} sourceScreenId="source" onClose={onClose} onRenderOnCanvas={onRenderOnCanvas} />);

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
    }, {
      colors: [],
      textStyles: [],
    }, null, [], expect.objectContaining({
      html: "<h1>Canvas import</h1>",
      css: "h1 { color: red; }",
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("extracts embedded document CSS and JavaScript for the sandbox preview", async () => {
    renderWithProviders(<ImportCodeDialog screens={[]} sourceScreenId="source" onClose={vi.fn()} onRenderOnCanvas={vi.fn()} />);
    const html = `<!doctype html><html><head><style>.hero { color: #123456; }</style></head>
      <body><main class="hero"><h1>Full document</h1></main>
      <script>document.querySelector("h1").dataset.ready = "true";</script></body></html>`;
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: { value: html },
    });

    await waitFor(() => {
      const preview = screen.getByTitle("Sandboxed code preview");
      expect(preview.getAttribute("srcdoc")).toContain(".hero { color: #123456; }");
      expect(preview.getAttribute("srcdoc")).toContain('document.querySelector("h1").dataset.ready');
    });
    const preview = screen.getByTitle("Sandboxed code preview");
    expect(preview.getAttribute("srcdoc")).not.toContain("#f3f0fa");
    expect(preview.getAttribute("srcdoc")).not.toContain("<html lang=\"en\"><head");
  });

  it("offers a ProtoFlow rule for supported JavaScript text listeners", () => {
    const onRenderOnCanvas = vi.fn();
    renderWithProviders(
      <ImportCodeDialog
        screens={[]}
        sourceScreenId="source"
        onClose={vi.fn()}
        onRenderOnCanvas={onRenderOnCanvas}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: { value: '<button id="save">Save</button>' },
    });

    fireEvent.click(screen.getByRole("tab", { name: "JS" }));
    fireEvent.change(screen.getByRole("textbox", { name: "JS code" }), {
      target: {
        value: `document.querySelector("#save").addEventListener("click", (event) => {
          event.currentTarget.textContent = "Saved";
        });`,
      },
    });

    const convert = screen.getByRole("button", {
      name: "Convert click listener on #save to ProtoFlow rule",
    });
    expect(convert).toBeEnabled();
    fireEvent.click(convert);
    fireEvent.click(screen.getByRole("button", { name: "Render on Canvas" }));

    expect(onRenderOnCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<button id="save">Save</button>' }),
      expect.any(Object),
      null,
      [expect.objectContaining({
        nodeId: "node-1",
        protoFlowEvent: "onClick",
        textValue: "Saved",
      })],
      expect.objectContaining({
        javascript: `document.querySelector("#save").addEventListener("click", (event) => {
          event.currentTarget.textContent = "Saved";
        });`,
      }),
    );
  });

  it("detects listeners embedded in a full HTML document", () => {
    renderWithProviders(
      <ImportCodeDialog
        screens={[]}
        sourceScreenId="source"
        onClose={vi.fn()}
        onRenderOnCanvas={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: {
        value: `<!doctype html><html><body><button id="save">Save</button>
          <script>document.querySelector("#save").addEventListener("click", (event) => {
            event.currentTarget.textContent = "Saved";
          });</script></body></html>`,
      },
    });

    expect(screen.getByRole("button", {
      name: "Convert click listener on #save to ProtoFlow rule",
    })).toBeEnabled();
  });

  it("resolves external styles, scripts, and images into the editable sources", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/theme.css")) {
        return new Response("h1 { color: #123456; }", {
          headers: { "content-type": "text/css" },
        });
      }
      if (url.endsWith("/app.js")) {
        return new Response(
          `document.querySelector("#save").addEventListener("click", (event) => {
            event.currentTarget.textContent = "Saved";
          });`,
          { headers: { "content-type": "text/javascript" } },
        );
      }
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    renderWithProviders(
      <ImportCodeDialog
        screens={[]}
        sourceScreenId="source"
        onClose={vi.fn()}
        onRenderOnCanvas={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: {
        value: '<link rel="stylesheet" href="/theme.css"><button id="save">Save</button>' +
          '<script src="/app.js"></script><img src="/photo.png" alt="Photo">',
      },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Asset base URL" }), {
      target: { value: "https://assets.example.test/pages/demo.html" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve external assets" }));

    await screen.findByText("Resolved 3 external assets.");
    const resolvedHtml = screen.getByRole("textbox", {
      name: "HTML code",
    }) as HTMLTextAreaElement;
    expect(resolvedHtml.value).toContain('src="data:image/png;base64,AQID"');
    expect(resolvedHtml.value).toContain('currentTarget.textContent = "Saved"');
    fireEvent.click(screen.getByRole("tab", { name: "CSS" }));
    expect((screen.getByRole("textbox", {
      name: "CSS code",
    }) as HTMLTextAreaElement).value).toContain("color: #123456");
    expect(screen.getByRole("button", {
      name: "Convert click listener on #save to ProtoFlow rule",
    })).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shows a clear warning when external assets are blocked by CORS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    renderWithProviders(
      <ImportCodeDialog
        screens={[]}
        sourceScreenId="source"
        onClose={vi.fn()}
        onRenderOnCanvas={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), {
      target: {
        value: '<img src="https://assets.example.test/photo.png">',
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve external assets" }));

    expect(await screen.findByRole("status", { name: "External asset warnings" }))
      .toHaveTextContent("CORS or network policy");
  });

  it("restores the latest HTML, CSS, and JavaScript after closing and reopening", () => {
    let draft: { html: string; css: string; javascript: string } | null = null;
    const onDraftChange = vi.fn((updated) => {
      draft = updated;
    });
    const html = "<!doctype html><html><head><style>h1 { color: green; }</style></head><body><h1>My draft</h1></body></html>";
    const javascript = "document.body.dataset.edited = 'yes';";
    const first = renderWithProviders(
      <ImportCodeDialog
        onClose={vi.fn()}
        screens={[]}
        sourceScreenId="source"
        onDraftChange={onDraftChange}
        onRenderOnCanvas={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "HTML code" }), { target: { value: html } });
    fireEvent.click(screen.getByRole("tab", { name: "JS" }));
    fireEvent.change(screen.getByRole("textbox", { name: "JS code" }), {
      target: { value: javascript },
    });
    first.unmount();

    renderWithProviders(
      <ImportCodeDialog
        initialCode={draft}
        screens={[]}
        sourceScreenId="source"
        onClose={vi.fn()}
        onDraftChange={onDraftChange}
        onRenderOnCanvas={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "HTML code" })).toHaveValue(html);
    fireEvent.click(screen.getByRole("tab", { name: "JS" }));
    expect(screen.getByRole("textbox", { name: "JS code" })).toHaveValue(javascript);
  });

  it("shows relevant code icons for semantic markup", () => {
    renderWithProviders(<ImportCodeDialog screens={[]} sourceScreenId="source" onClose={vi.fn()} onRenderOnCanvas={vi.fn()} />);
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
    renderWithProviders(<ImportCodeDialog screens={[]} sourceScreenId="source" onClose={vi.fn()} onRenderOnCanvas={onRenderOnCanvas} />);

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
    expect(srcdoc).toContain('type: "protoflow-design-tokens"');
    expect(srcdoc).toContain('nonce: "preview"');
  });
});
