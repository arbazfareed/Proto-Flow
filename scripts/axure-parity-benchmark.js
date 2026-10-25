import Konva from "konva";
import { autoLayoutScreens } from "../src/project/flow.ts";
import {
  getFlowViewportBounds,
  isFlowEdgeInViewport,
  getVisibleFlowScreens,
} from "../src/project/flow.ts";
import {
  flattenActivePanelWidgets,
  withPanelStates,
} from "../src/project/dynamicPanels.ts";
import { evaluateExpression } from "../src/project/expressions.ts";
import { getVirtualRowRange } from "../src/preview/virtualization.ts";
import { getCanvasViewportBounds, intersectsCanvasViewport } from "../src/canvas/navigation.ts";

Konva.autoDrawEnabled = false;

const widget = (id, index, extra = {}) => ({
  id,
  x: (index * 137) % 5_000,
  y: (index * 251) % 5_000,
  width: 72 + (index % 4) * 12,
  height: 42 + (index % 3) * 10,
  rotation: (index % 7) * 5,
  ...extra,
});

function createPanel(id, stateCount, widgetsPerState, startIndex) {
  const states = Array.from({ length: stateCount }, (_, stateIndex) => ({
    id: `${id}-state-${stateIndex}`,
    name: `State ${stateIndex + 1}`,
    widgets: Array.from({ length: widgetsPerState }, (_, widgetIndex) =>
      widget(`${id}-state-${stateIndex}-widget-${widgetIndex}`, startIndex + stateIndex * widgetsPerState + widgetIndex),
    ),
  }));
  return withPanelStates({
    ...widget(id, startIndex),
    type: "dynamic-panel",
    props: {},
  }, states, states[0]?.id);
}

function createExpressionWorkload() {
  const expressions = Array.from({ length: 200 }, (_, index) => `value${index % 20} * 2 + shared`);
  const variables = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`value${index}`, index]),
  );
  variables.shared = 1;
  for (const expression of expressions) evaluateExpression(expression, { variables });
  let totalMs = 0;
  let maximumAverageMs = 0;
  const repetitions = 100;
  for (const expression of expressions) {
    const start = performance.now();
    for (let iteration = 0; iteration < repetitions; iteration += 1) {
      variables.shared = iteration;
      evaluateExpression(expression, { variables });
    }
    const averageMs = (performance.now() - start) / repetitions;
    totalMs += averageMs;
    maximumAverageMs = Math.max(maximumAverageMs, averageMs);
  }
  return {
    expressionCount: expressions.length,
    evaluationMs: totalMs,
    maxExpressionMs: maximumAverageMs,
  };
}

function createFlowWorkload() {
  const screens = Array.from({ length: 100 }, (_, index) => ({
    id: `screen-${index}`,
    name: `Screen ${index + 1}`,
    widgets: [],
    interactionRules: [],
  }));
  const edges = screens.flatMap((screen, index) =>
    [1, 7, 13].flatMap((offset) => {
      const target = screens[(index + offset) % screens.length];
      return target ? [{
        id: `${screen.id}-${target.id}`,
        ruleId: `${screen.id}-rule`,
        actionIndex: offset,
        sourceScreenId: screen.id,
        targetScreenId: target.id,
        label: "onClick",
        event: "onClick",
      }] : [];
    }),
  );
  const start = performance.now();
  const positions = autoLayoutScreens(screens, edges, screens[0].id);
  return {
    screens,
    edges,
    positions,
    layoutMs: performance.now() - start,
  };
}

function createRepeaterWidgets(rowCount, templateWidgetCount, startIndex) {
  const rowHeight = 52;
  const range = getVirtualRowRange(rowCount, rowHeight, 5_200, 520);
  const visibleWidgets = [];
  const start = performance.now();
  for (let rowIndex = range.startIndex; rowIndex < range.endIndex; rowIndex += 1) {
    for (let templateIndex = 0; templateIndex < templateWidgetCount; templateIndex += 1) {
      visibleWidgets.push(widget(
        `repeater-${startIndex}-row-${rowIndex}-widget-${templateIndex}`,
        startIndex + rowIndex * templateWidgetCount + templateIndex,
      ));
    }
  }
  return {
    widgets: visibleWidgets,
    rowCount,
    renderedRowCount: range.endIndex - range.startIndex,
    renderMs: performance.now() - start,
  };
}

function createScenes() {
  const panelRoots = Array.from({ length: 20 }, (_, index) =>
    createPanel(`panel-${index}`, 5, 10, index * 50),
  );
  const panelSwitchStart = performance.now();
  let activePanels = [];
  for (let stateIndex = 0; stateIndex < 20; stateIndex += 1) {
    const activeStates = Object.fromEntries(panelRoots.map((panel, panelIndex) => [
      panel.id,
      `${panel.id}-state-${(stateIndex + panelIndex) % 5}`,
    ]));
    activePanels = flattenActivePanelWidgets(panelRoots, activeStates);
  }
  const panelSwitchMs = (performance.now() - panelSwitchStart) / 20;

  const nestedRoots = Array.from({ length: 10 }, (_, rootIndex) => {
    let nested = widget(`nested-${rootIndex}-content`, rootIndex * 100);
    nested.type = "text";
    for (let depth = 2; depth >= 0; depth -= 1) {
      nested = withPanelStates({
        ...widget(`nested-${rootIndex}-panel-${depth}`, rootIndex * 100 + depth),
        type: "dynamic-panel",
        props: {},
      }, [{
        id: `nested-${rootIndex}-state-${depth}`,
        name: `Nested ${depth + 1}`,
        widgets: [
          ...Array.from({ length: 9 }, (_, index) => widget(
            `nested-${rootIndex}-${depth}-widget-${index}`,
            rootIndex * 100 + depth * 9 + index,
          )),
          nested,
        ],
      }]);
    }
    return nested;
  });
  const nestedWidgets = flattenActivePanelWidgets(nestedRoots);

  const repeater = createRepeaterWidgets(500, 5, 25_000);
  const expressions = createExpressionWorkload();
  const flow = createFlowWorkload();
  const mixedRepeaters = Array.from({ length: 5 }, (_, index) =>
    createRepeaterWidgets(500, 5, 30_000 + index * 2_500),
  );
  const mixedPanels = Array.from({ length: 10 }, (_, index) =>
    createPanel(`mixed-panel-${index}`, 2, 5, 50_000 + index * 10),
  );
  const mixedPanelWidgets = flattenActivePanelWidgets(mixedPanels);
  const mixedExpressionWidgets = Array.from({ length: 100 }, (_, index) =>
    widget(`expression-widget-${index}`, 60_000 + index, {
      note: { description: `Requirement ${index}`, priority: "medium" },
    }),
  );

  return [
    {
      name: "A - Dynamic panels",
      widgets: activePanels,
      panelCount: 20,
      totalFeatureWidgets: 1_020,
      panelSwitchMs,
    },
    {
      name: "B - Repeater virtualization",
      widgets: repeater.widgets,
      repeaterRowCount: repeater.rowCount,
      renderedRepeaterRows: repeater.renderedRowCount,
      repeaterRenderMs: repeater.renderMs,
      totalFeatureWidgets: 2_500,
    },
    {
      name: "C - Nested panels",
      widgets: nestedWidgets,
      panelCount: 30,
      totalFeatureWidgets: nestedWidgets.length,
    },
    {
      name: "D - Expressions",
      widgets: Array.from({ length: 200 }, (_, index) =>
        widget(`expression-${index}`, index),
      ),
      expressionCount: expressions.expressionCount,
      expressionEvaluationMs: expressions.evaluationMs,
      maxExpressionMs: expressions.maxExpressionMs,
      totalFeatureWidgets: 200,
    },
    {
      name: "E - Full Axure-parity mix",
      widgets: [
        ...mixedPanelWidgets,
        ...mixedRepeaters.flatMap((result) => result.widgets),
        ...mixedExpressionWidgets,
      ],
      panelCount: 10,
      repeaterRowCount: 2_500,
      renderedRepeaterRows: mixedRepeaters.reduce((sum, result) => sum + result.renderedRowCount, 0),
      repeaterRenderMs: Math.max(...mixedRepeaters.map((result) => result.renderMs)),
      expressionCount: 100,
      expressionEvaluationMs: expressions.evaluationMs,
      maxExpressionMs: expressions.maxExpressionMs,
      totalFeatureWidgets: 10 + 10 * 2 * 5 + 2_500 * 5 + 100,
      annotationCount: 100,
    },
    {
      name: "F - Flow diagram",
      widgets: flow.screens.map((screen, index) => {
        const position = flow.positions[screen.id];
        return {
          id: screen.id,
          x: position.x,
          y: position.y,
          width: 224,
          height: 190,
          rotation: 0,
        };
      }),
      transitions: flow.edges.map((edge) => {
        const source = flow.positions[edge.sourceScreenId];
        const target = flow.positions[edge.targetScreenId];
        return {
          edge,
          points: [source.x + 224, source.y + 74, target.x, target.y + 74],
        };
      }),
      screens: flow.screens,
      flowPositions: flow.positions,
      screenCount: flow.screens.length,
      transitionCount: flow.edges.length,
      flowLayoutMs: flow.layoutMs,
      totalFeatureWidgets: flow.screens.length,
    },
  ];
}

function percentile(samples, fraction) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function measureMode(stage, layer, nodes, scenario, mode, durationMs) {
  const frameTimes = [];
  let lastTimestamp;
  let startTimestamp;
  return new Promise((resolve, reject) => {
    const tick = (timestamp) => {
      if (startTimestamp === undefined) {
        startTimestamp = timestamp;
        lastTimestamp = timestamp;
      }
      const elapsed = timestamp - startTimestamp;
      const progress = elapsed / durationMs;
      if (mode === "pan") {
        stage.position({
          x: -1_500 + Math.sin(progress * Math.PI * 2) * 1_200,
          y: -1_500 + Math.cos(progress * Math.PI * 2) * 1_200,
        });
      } else if (mode === "zoom") {
        const scale = 0.8 + Math.sin(progress * Math.PI * 2) * 0.2;
        stage.scale({ x: scale, y: scale });
      } else if (mode === "drag" && nodes.length > 0) {
        const node = nodes[Math.floor((progress * 20) % nodes.length)];
        node.position({
          x: (progress * 500) % 2_000,
          y: (progress * 300) % 1_000,
        });
      }
      if (mode === "pan" || mode === "zoom") {
        const view = {
          zoom: stage.scaleX(),
          pan: stage.position(),
        };
        const bounds = getCanvasViewportBounds({ width: 1024, height: 768 }, view);
        for (let index = 0; index < scenario.widgets.length; index += 1) {
          const item = scenario.widgets[index];
          const node = nodes[index];
          if (!node) continue;
          const visible = intersectsCanvasViewport(item, bounds);
          if (visible && node.getLayer() !== layer) layer.add(node);
          else if (!visible && node.getLayer() === layer) node.remove();
        }
      }
      stage.draw();
      if (elapsed >= durationMs) {
        resolve({
          fps: frameTimes.length / (durationMs / 1_000),
          p95Ms: percentile(frameTimes, 0.95),
          p99Ms: percentile(frameTimes, 0.99),
          frameTimes,
        });
        return;
      }
      frameTimes.push(timestamp - lastTimestamp);
      lastTimestamp = timestamp;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function measureFlowMode(
  world,
  screenElements,
  edgeElements,
  scenario,
  mode,
  durationMs,
) {
  const frameTimes = [];
  let lastTimestamp;
  let startTimestamp;
  return new Promise((resolve, reject) => {
    const tick = (timestamp) => {
      try {
        if (startTimestamp === undefined) {
          startTimestamp = timestamp;
          lastTimestamp = timestamp;
        }
        const elapsed = timestamp - startTimestamp;
        const progress = elapsed / durationMs;
        let pan = { x: 24, y: 24 };
        let zoom = 1;
        if (mode === "pan") {
          pan = {
            x: -1_500 + Math.sin(progress * Math.PI * 2) * 1_200,
            y: -1_500 + Math.cos(progress * Math.PI * 2) * 1_200,
          };
        } else if (mode === "zoom") {
          zoom = 0.8 + Math.sin(progress * Math.PI * 2) * 0.2;
        } else if (mode === "drag" && screenElements.length > 0) {
          const nodeIndex = Math.floor((progress * 20) % screenElements.length);
          const screen = scenario.screens[nodeIndex];
          const element = screenElements[nodeIndex]?.element;
          const position = scenario.flowPositions[screen.id];
          if (!element || !position) throw new Error(`Flow node "${screen.id}" is not measurable.`);
          element.style.left = `${position.x + (progress * 100) % 500}px`;
          element.style.top = `${position.y + (progress * 80) % 300}px`;
        }
        if (mode !== "drag") {
          world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
          const bounds = getFlowViewportBounds(1024, 768, pan, zoom);
          for (const { screen, element } of screenElements) {
            const visible = getVisibleFlowScreens(
              [screen],
              scenario.flowPositions,
              bounds,
            ).length > 0;
            element.style.display = visible ? "" : "none";
          }
          for (const { edge, element } of edgeElements) {
            element.style.display = isFlowEdgeInViewport(
              edge,
              scenario.flowPositions,
              bounds,
            ) ? "" : "none";
          }
        }
        if (elapsed >= durationMs) {
          resolve({
            fps: frameTimes.length / (durationMs / 1_000),
            frameTimes,
          });
          return;
        }
        frameTimes.push(timestamp - lastTimestamp);
        lastTimestamp = timestamp;
        requestAnimationFrame(tick);
      } catch (error) {
        reject(error);
      }
    };
    requestAnimationFrame(tick);
  });
}

async function runFlowScene(scenario, modeDurationMs) {
  console.log(`Starting ${scenario.name}`);
  const container = document.querySelector("#benchmark");
  container.replaceChildren();
  container.style.position = "relative";
  container.style.overflow = "hidden";
  const world = document.createElement("div");
  const worldWidth = Math.max(
    1_024,
    ...scenario.screens.map((screen) =>
      scenario.flowPositions[screen.id].x + 224 + 112,
    ),
  );
  const worldHeight = Math.max(
    768,
    ...scenario.screens.map((screen) =>
      scenario.flowPositions[screen.id].y + 190 + 36,
    ),
  );
  console.log(`Flow diagram extent: ${worldWidth}x${worldHeight}`);
  world.style.position = "absolute";
  world.style.left = "0";
  world.style.top = "0";
  world.style.transformOrigin = "0 0";
  world.style.width = `${worldWidth}px`;
  world.style.height = `${worldHeight}px`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(worldWidth));
  svg.setAttribute("height", String(worldHeight));
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.overflow = "visible";
  world.append(svg);
  const edgeElements = scenario.transitions.map((transition) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const [startX, startY, endX, endY] = transition.points;
    const middleX = (startX + endX) / 2;
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#9a7cf2");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    return { edge: transition.edge, element: path };
  });
  const screenElements = scenario.screens.map((screen) => {
    const position = scenario.flowPositions[screen.id];
    const element = document.createElement("div");
    Object.assign(element.style, {
      position: "absolute",
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: "224px",
      height: "190px",
      boxSizing: "border-box",
      border: "1px solid #494650",
      borderRadius: "8px",
      background: "#202127",
    });
    element.textContent = screen.name;
    world.append(element);
    return { screen, element };
  });
  container.append(world);
  const modes = {};
  try {
    for (const mode of ["idle", "pan", "zoom", "drag"]) {
      console.log(`Measuring ${scenario.name} (${mode})`);
      modes[mode] = await measureFlowMode(
        world,
        screenElements,
        edgeElements,
        scenario,
        mode,
        modeDurationMs,
      );
    }
  } finally {
    container.replaceChildren();
  }
  const allFrames = Object.values(modes).flatMap((result) => result.frameTimes);
  return {
    ...Object.fromEntries(Object.entries(scenario).filter(([key]) =>
      !["widgets", "transitions", "flowPositions", "screens"].includes(key),
    )),
    name: scenario.name,
    widgetCount: scenario.widgets.length,
    modes: Object.fromEntries(Object.entries(modes).map(([name, result]) => [
      name,
      { fps: result.fps, p95Ms: percentile(result.frameTimes, 0.95), p99Ms: percentile(result.frameTimes, 0.99) },
    ])),
    fps: Math.min(...Object.values(modes).map((result) => result.fps)),
    frameTimeP95Ms: percentile(allFrames, 0.95),
    frameTimeP99Ms: percentile(allFrames, 0.99),
  };
}

async function runScene(scenario, modeDurationMs) {
  if (scenario.flowPositions) return runFlowScene(scenario, modeDurationMs);
  console.log(`Starting ${scenario.name}`);
  const container = document.querySelector("#benchmark");
  const stage = new Konva.Stage({ container, width: 1024, height: 768 });
  const layer = new Konva.Layer({ listening: true, perfectDrawEnabled: false });
  stage.add(layer);
  const nodes = scenario.widgets.map((item, index) => {
    const node = new Konva.Rect({
      ...item,
      fill: index % 2 ? "#896fce" : "#55a890",
      cornerRadius: 4,
      perfectDrawEnabled: false,
      shadowForStrokeEnabled: false,
    });
    const initialBounds = getCanvasViewportBounds(
      { width: 1024, height: 768 },
      { zoom: 1, pan: { x: 0, y: 0 } },
    );
    if (intersectsCanvasViewport(item, initialBounds)) layer.add(node);
    return node;
  });
  const modes = {};
  try {
    for (const mode of ["idle", "pan", "zoom", "drag"]) {
      console.log(`Measuring ${scenario.name} (${mode})`);
      modes[mode] = await measureMode(stage, layer, nodes, scenario, mode, modeDurationMs);
      stage.position({ x: 0, y: 0 });
      stage.scale({ x: 1, y: 1 });
    }
  } finally {
    stage.destroy();
    container.replaceChildren();
  }
  const allFrames = Object.values(modes).flatMap((mode) => mode.frameTimes);
  return {
    ...Object.fromEntries(Object.entries(scenario).filter(([key]) => key !== "widgets")),
    name: scenario.name,
    widgetCount: scenario.widgets.length,
    modes: Object.fromEntries(Object.entries(modes).map(([name, result]) => [
      name,
      { fps: result.fps, p95Ms: percentile(result.frameTimes, 0.95), p99Ms: percentile(result.frameTimes, 0.99) },
    ])),
    fps: Math.min(...Object.values(modes).map((mode) => mode.fps)),
    frameTimeP95Ms: percentile(allFrames, 0.95),
    frameTimeP99Ms: percentile(allFrames, 0.99),
  };
}

function getHeapSize() {
  if (typeof globalThis.gc === "function") globalThis.gc();
  const memory = performance.memory;
  if (!memory || typeof memory.usedJSHeapSize !== "number") {
    throw new Error("Chromium did not expose performance.memory; heap metrics are required.");
  }
  return memory.usedJSHeapSize;
}

async function runSoak(durationMs, widgetCount, frameCallback) {
  const stage = new Konva.Stage({
    container: document.querySelector("#benchmark"),
    width: 1024,
    height: 768,
  });
  const layer = new Konva.Layer({ listening: false, perfectDrawEnabled: false });
  stage.add(layer);
  for (let index = 0; index < widgetCount; index += 1) {
    layer.add(new Konva.Rect({
      ...widget(`soak-${index}`, index),
      fill: index % 2 ? "#896fce" : "#55a890",
      perfectDrawEnabled: false,
    }));
  }
  const samples = {
    start: getHeapSize(),
    midpoint: null,
    end: null,
  };
  const midpoint = durationMs / 2;
  const start = performance.now();
  let midpointCaptured = false;
  return new Promise((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - start;
      stage.draw();
      if (!midpointCaptured && elapsed >= midpoint) {
        samples.midpoint = getHeapSize();
        midpointCaptured = true;
        frameCallback(samples);
      }
      if (elapsed >= durationMs) {
        samples.end = getHeapSize();
        stage.destroy();
        document.querySelector("#benchmark").replaceChildren();
        resolve({
          durationMs,
          startBytes: samples.start,
          midpointBytes: samples.midpoint ?? samples.start,
          endBytes: samples.end,
          growthBytes: samples.end - samples.start,
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

window.runAxureParityBenchmarks = async (options = {}) => {
  const modeDurationMs = options.modeDurationMs ?? 1_000;
  const soakDurationMs = options.soakDurationMs ?? 300_000;
  const scenarios = createScenes();
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScene(scenario, modeDurationMs));
    console.log(`Completed ${scenario.name}`);
  }
  const fullMix = scenarios.find((scenario) => scenario.name === "E - Full Axure-parity mix");
  if (!fullMix) throw new Error("Full mix scene is missing from the benchmark suite.");
  console.log(`Starting ${soakDurationMs}ms heap soak`);
  const soak = await runSoak(soakDurationMs, fullMix.widgets.length, () => {});
  console.log("Completed heap soak");
  return { scenes: results, soak };
};
