import { test } from "vitest";
import { flattenActivePanelWidgets, withPanelStates } from "./dynamicPanels";
import { autoLayoutScreens } from "./flow";
import { evaluateExpression } from "./expressions";
import { getVirtualRowRange } from "../preview/virtualization";
import { createEmptyProject, type Widget } from "./schema";

const measurePanelSwitch = flattenActivePanelWidgets;
const measureVisibleRows = getVirtualRowRange;
const measureExpression = evaluateExpression;
const measureFlowLayout = autoLayoutScreens;

function createWidget(id: string, type = "text", props: Record<string, unknown> = {}): Widget {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 120,
    height: 48,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props,
  };
}

const panels = Array.from({ length: 20 }, (_, panelIndex) => {
  const states = Array.from({ length: 5 }, (_, stateIndex) => ({
    id: `panel-${panelIndex}-state-${stateIndex}`,
    name: `State ${stateIndex}`,
    widgets: Array.from({ length: 10 }, (_, widgetIndex) =>
      createWidget(`panel-${panelIndex}-${stateIndex}-${widgetIndex}`),
    ),
  }));
  return withPanelStates(createWidget(`panel-${panelIndex}`, "dynamic-panel"), states);
});
const activeStates = Object.fromEntries(panels.map((panel, index) => [
  panel.id,
  `panel-${index}-state-${index % 5}`,
]));
const variables = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
  `value${index}`,
  index,
]));
const project = createEmptyProject("Flow benchmark");
const screens = Array.from({ length: 100 }, (_, index) => ({
  ...project.screens[0],
  id: `screen-${index}`,
  name: `Screen ${index}`,
  interactionRules: [],
}));
const edges = screens.flatMap((screen, index) =>
  [1, 7, 13].map((offset) => ({
    id: `${screen.id}-${offset}`,
    ruleId: `${screen.id}-rule`,
    actionIndex: offset,
    sourceScreenId: screen.id,
    targetScreenId: screens[(index + offset) % screens.length].id,
    label: "onClick",
    event: "onClick",
  })),
);

test("PF-T705 feature benchmarks", async ({ bench }) => {
  const registrations = [
    bench("select active content in 20 panels × 5 states × 10 widgets", () => {
      measurePanelSwitch(panels, activeStates);
    }),
    bench("calculate visible rows for a 500-row repeater", () => {
      measureVisibleRows(500, 52, 5_200, 520, 5);
    }),
    bench("evaluate one cached expression", () => {
      measureExpression("value7 * 2 + shared", {
        variables: { ...variables, shared: 1 },
      });
    }),
    bench("layout 100 screens and 300 transitions", () => {
      measureFlowLayout(screens, edges, screens[0].id);
    }),
  ];
  for (const registration of registrations) {
    const result = await registration.run();
    if (result.state !== "completed") {
      throw "error" in result ? result.error : new Error(`${registration.name} did not complete.`);
    }
    console.info(
      `${registration.name}: ${result.latency.mean.toFixed(4)} ms/op ` +
      `(${result.throughput.mean.toFixed(0)} ops/s)`,
    );
  }
});
