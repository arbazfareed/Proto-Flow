import Konva from "konva";
import { getCanvasViewportBounds, intersectsCanvasViewport } from "../src/canvas/navigation.ts";

Konva.autoDrawEnabled = false;

function createWidgets(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    x: (index * 137) % 5_000,
    y: (index * 251) % 5_000,
    width: 72 + (index % 4) * 12,
    height: 42 + (index % 3) * 10,
    rotation: (index % 7) * 5,
  }));
}

function createScenario(name, count, panelCount = 0, repeaterRows = 0) {
  return { name, widgets: createWidgets(count), panelCount, repeaterRows };
}

function measureScenario(scenario, durationMs) {
  const container = document.querySelector("#benchmark");
  const stage = new Konva.Stage({ container, width: 1024, height: 768 });
  const layer = new Konva.Layer({ listening: true, perfectDrawEnabled: false });
  stage.add(layer);
  const nodes = scenario.widgets.map((widget, index) => {
    const node = new Konva.Rect({
      ...widget,
      fill: index % 2 ? "#896fce" : "#55a890",
      cornerRadius: 4,
      perfectDrawEnabled: false,
      shadowForStrokeEnabled: false,
    });
    return { widget, node };
  });
  const samples = [];
  let lastFrame = performance.now();
  let startTime = 0;
  const warmupMs = Math.min(1_000, durationMs * 0.1);

  return new Promise((resolve) => {
    const draw = (timestamp) => {
      const elapsed = timestamp - startTime;
      if (elapsed >= durationMs) {
        stage.destroy();
        resolve({
          name: scenario.name,
          fps: samples.length / ((durationMs - warmupMs) / 1000),
          frameTimeMs: samples.length
            ? samples.reduce((sum, frameTime) => sum + frameTime, 0) / samples.length
            : 0,
          nodeCount: nodes.length,
          activePanelCount: scenario.panelCount,
          repeaterRowCount: scenario.repeaterRows,
        });
        return;
      }

      const view = {
        zoom: 0.8 + Math.sin(elapsed / 2_300) * 0.2,
        pan: {
          x: -2_000 + Math.sin(elapsed / 1_700) * 1_800,
          y: -2_000 + Math.cos(elapsed / 2_100) * 1_800,
        },
      };
      const bounds = getCanvasViewportBounds({ width: 1024, height: 768 }, view);
      stage.position(view.pan);
      stage.scale({ x: view.zoom, y: view.zoom });
      for (const { widget, node } of nodes) {
        const visible = intersectsCanvasViewport(widget, bounds);
        if (visible && node.getLayer() !== layer) {
          layer.add(node);
        } else if (!visible && node.getLayer() === layer) {
          node.remove();
        }
      }
      stage.draw();

      if (elapsed > warmupMs) samples.push(timestamp - lastFrame);
      lastFrame = timestamp;
      requestAnimationFrame(draw);
    };
    requestAnimationFrame((timestamp) => {
      startTime = timestamp;
      lastFrame = timestamp;
      draw(timestamp);
    });
  });
}

window.runCanvasBenchmarks = async (durationMs = 30_000) => {
  const scenarios = [
    createScenario("100 nodes", 100),
    createScenario("500 nodes", 500),
    createScenario("1000 nodes", 1_000),
    createScenario("50 panels + 500 repeater rows", 550, 50, 500),
  ];
  const results = [];
  for (const scenario of scenarios) {
    results.push(await measureScenario(scenario, durationMs));
  }
  return results;
};
