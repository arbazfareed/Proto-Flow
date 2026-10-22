# @protoflow/plugin-sdk

The SDK provides the typed API used by bundled ProtoFlow plugins. Bundle plugin
code into a single JavaScript file and place it beside `plugin.json` in a
`.pflow-plugin` ZIP archive.

```ts
import {
  on,
  registerAIProvider,
  registerCommand,
  registerExporter,
  registerShape,
} from "@protoflow/plugin-sdk";

registerShape({
  id: "rounded-card",
  label: "Rounded card",
  kind: "rectangle",
  width: 240,
  height: 140,
  fill: "#282431",
  stroke: "#a78bfa",
});

registerExporter({ id: "project-json", label: "Export project JSON" }, (project) => ({
  filename: `${project.name}.json`,
  content: JSON.stringify(project, null, 2),
  mimeType: "application/json",
}));

registerAIProvider({ id: "sample-provider", label: "Sample provider" }, ({ prompt }) => ({
  text: `Prompt received: ${prompt}`,
}));

registerCommand({ id: "hello", label: "Say hello" }, () => {
  console.log("Hello from ProtoFlow");
});

on("app:ready", () => console.log("Plugin sandbox started"));
```

Example `plugin.json`:

```json
{
  "id": "example.hello",
  "name": "Example plugin",
  "version": "1.0.0",
  "author": "Example author",
  "main": "plugin.js",
  "permissions": ["commands:run"]
}
```

Permission identifiers are `canvas:write`, `export:write`, `ai:generate`,
`commands:run`, and `project:read`. ProtoFlow asks for consent at installation
and only sends a project snapshot to an exporter that declares `project:read`
or `export:write`. Plugin code runs in a sandboxed iframe with a restrictive
Content Security Policy; it has no bridge to Tauri, the wallet, JWTs, or native
filesystem APIs.

The SDK source is ready for package builds. Publishing and signing are not
configured by this repository. Production installation remains fail-closed
until a trusted signing-key and revocation-list service are configured.
