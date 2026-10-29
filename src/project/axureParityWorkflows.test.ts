import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewRuntime } from "../preview/runtime";
import {
  exportWidgetNotesCsv,
  exportWidgetNotesMarkdown,
  getWidgetNoteRecords,
} from "./widgetNotes";
import { evaluateExpression } from "./expressions";
import { autoLayoutScreens, buildFlowSvg, getNavigationEdges } from "./flow";
import {
  clearVersionHistoryCache,
  compareProjects,
  createProjectCheckpoint,
  listProjectCheckpoints,
  reconstructCheckpoint,
} from "./versionHistory";
import { parseRichTextMarkdown, richTextRunsToHtml } from "./richText";
import { createEmptyProject, type Project, type Widget } from "./schema";

function makeWidget(type: string, props: Record<string, unknown> = {}): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    x: 20,
    y: 30,
    width: 180,
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

function addScreen(project: Project, name: string) {
  const screen = {
    ...project.screens[0],
    id: crypto.randomUUID(),
    name,
    widgets: [] as Widget[],
    interactionRules: [] as Project["screens"][number]["interactionRules"],
    flowPosition: undefined,
  };
  project.screens.push(screen);
  return screen;
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

afterEach(() => {
  clearVersionHistoryCache();
  vi.unstubAllGlobals();
});

describe("PF-T513 Axure-style workflow regressions", () => {
  it("runs a three-screen dashboard with panel, repeater, expression, and note data", () => {
    const project = createEmptyProject("Dashboard workflow");
    const screen = project.screens[0];
    screen.name = "Overview";
    addScreen(project, "Activity");
    addScreen(project, "Settings");

    const trigger = makeWidget("button", { label: "Refresh dashboard" });
    const panel = makeWidget("dynamic-panel", {
      states: [
        { id: "summary", name: "Summary", widgets: [makeWidget("text", { text: "Summary" })] },
        { id: "details", name: "Details", widgets: [makeWidget("text", { text: "Details" })] },
      ],
      activeStateId: "summary",
    });
    const repeater = makeWidget("repeater", {
      dataset: [{ name: "Beta", amount: 4, quantity: 2 }, { name: "Alpha", amount: 3, quantity: 3 }],
      rowTemplate: { widgets: [makeWidget("text", { text: "{{item.name}}" })] },
      layout: "vertical",
      gap: 8,
      itemBinding: {},
    });
    const total = makeWidget("text", { text: "[[ item.amount * item.quantity ]]" });
    total.notes = {
      description: "Verify the computed dashboard amount.",
      requirementId: "DASH-1",
      priority: "high",
      status: "draft",
      tags: ["dashboard"],
      custom: {},
    };
    screen.widgets.push(trigger, panel, repeater, total);
    screen.interactionRules.push({
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditionMode: "all",
      conditions: [],
      actions: [
        { type: "setPanelState", target: panel.id, value: "details", transition: "fade", duration: 180 },
        { type: "sortRepeater", target: repeater.id, value: '{"field":"name","direction":"asc"}' },
        { type: "addRepeaterRow", target: repeater.id, value: '{"name":"{{item.name}}","quantity":1}' },
      ],
    });

    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onClick", { name: "Gamma", amount: 5 })).toEqual([]);
    expect(runtime.snapshot().panelStates[panel.id]).toBe("details");
    expect(runtime.snapshot().panelTransitions[panel.id]).toEqual({ transition: "fade", duration: 180 });
    expect(runtime.snapshot().repeaterData[repeater.id]).toEqual([
      { name: "Alpha", amount: 3, quantity: 3 },
      { name: "Beta", amount: 4, quantity: 2 },
      { name: "Gamma", quantity: 1 },
    ]);
    expect(runtime.interpolate("{{item.name}}", screen.id, { name: "Gamma" })).toBe("Gamma");
    expect(evaluateExpression("item.amount * item.quantity", { item: { amount: 5, quantity: 3 } })).toBe(15);

    const notes = getWidgetNoteRecords(project);
    expect(exportWidgetNotesCsv(notes)).toContain("DASH-1");
    expect(exportWidgetNotesMarkdown(notes)).toContain("Verify the computed dashboard amount.");
  });

  it("advances five onboarding states and validates rich text and flow navigation", () => {
    const project = createEmptyProject("Onboarding workflow");
    const screen = project.screens[0];
    screen.name = "Welcome";
    const nextScreens = Array.from({ length: 4 }, (_, index) => addScreen(project, `Step ${index + 2}`));
    const onboardingScreens = [screen, ...nextScreens];
    const trigger = makeWidget("button", { label: "Continue" });
    const stepTriggers = [trigger, ...Array.from({ length: 4 }, () => makeWidget("button", { label: "Continue" }))];
    const panel = makeWidget("dynamic-panel", {
      states: Array.from({ length: 5 }, (_, index) => ({
        id: `step-${index + 1}`,
        name: `Step ${index + 1}`,
        widgets: [makeWidget("text", { richText: true, text: `**Step ${index + 1}**` })],
      })),
      activeStateId: "step-1",
    });
    screen.widgets.push(...stepTriggers, panel);
    project.variables.push({
      id: crypto.randomUUID(),
      name: "stepIndex",
      type: "number",
      initial: 0,
      scope: "project",
    });

    project.variables.push({
      id: crypto.randomUUID(),
      name: "scratch",
      type: "number",
      initial: 100,
      scope: "project",
    }, {
      id: crypto.randomUUID(),
      name: "progressEcho",
      type: "number",
      initial: 0,
      scope: "project",
    });

    for (let index = 0; index < 5; index += 1) {
      const currentScreen = onboardingScreens[0];
      currentScreen.interactionRules.push({
        id: crypto.randomUUID(),
        widgetId: stepTriggers[index].id,
        event: "onClick",
        conditionMode: "all",
        conditions: [{ variable: "stepIndex", operator: "equals", value: index }],
        localVariables: [{ name: "scratch", type: "number", initial: index + 1 }],
        actions: [
          { type: "setPanelState", target: panel.id, value: `step-${index + 1}`, transition: "slide-left", duration: 160 },
          { type: "setVariable", target: "stepIndex", value: "[[ stepIndex + 1 ]]" },
          { type: "setVariable", target: "progressEcho", value: "[[ scratch ]]" },
        ],
      });
    }

    for (let index = 0; index < onboardingScreens.length - 1; index += 1) {
      const currentScreen = onboardingScreens[index];
      const currentTrigger = stepTriggers[index];
      if (index > 0) currentScreen.widgets.push(currentTrigger);
      currentScreen.interactionRules.push({
        id: crypto.randomUUID(),
        widgetId: currentTrigger.id,
        event: "onDoubleClick",
        conditionMode: "all",
        conditions: [],
        actions: [{ type: "navigate", target: onboardingScreens[index + 1].id }],
      });
    }

    const firstRuntime = new PreviewRuntime(project);
    for (let index = 0; index < 5; index += 1) {
      expect(firstRuntime.runEvent(stepTriggers[index], "onClick")).toEqual([]);
      expect(firstRuntime.getVariable("stepIndex")).toBe(index + 1);
      expect(firstRuntime.getVariable("progressEcho")).toBe(index + 1);
      expect(firstRuntime.getVariable("scratch")).toBe(100);
    }
    expect(firstRuntime.snapshot().panelStates[panel.id]).toBe("step-5");
    expect(firstRuntime.snapshot().panelTransitions[panel.id]).toEqual({ transition: "slide-left", duration: 160 });

    const runs = parseRichTextMarkdown("**Welcome** *to ProtoFlow*\n- Review settings");
    expect(richTextRunsToHtml(runs)).toContain("<strong>Welcome</strong>");
    expect(richTextRunsToHtml(runs)).toContain("<ul><li>Review settings</li></ul>");

    const edges = getNavigationEdges(project);
    expect(edges).toHaveLength(4);
    const positions = autoLayoutScreens(project.screens, edges, project.startScreenId);
    expect(positions[onboardingScreens[0].id].x).toBeLessThan(positions[onboardingScreens[4].id].x);
    expect(buildFlowSvg(project, positions)).toContain("onDoubleClick");
  });

  it("keeps settings repeater edits across three local history checkpoints", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const project = createEmptyProject("Settings workflow");
    const repeater = makeWidget("repeater", {
      dataset: [{ name: "Email alerts", enabled: true }, { name: "Product updates", enabled: false }],
      rowTemplate: { widgets: [makeWidget("toggle", { label: "{{item.name}}" })] },
      layout: "vertical",
      gap: 8,
      itemBinding: {},
    });
    project.screens[0].widgets.push(repeater);

    await createProjectCheckpoint(project, null, "Settings v1", "manual");
    const v1 = structuredClone(project);
    repeater.props.dataset = [
      { name: "Email alerts", enabled: false },
      { name: "Product updates", enabled: false },
    ];
    await createProjectCheckpoint(project, null, "Settings v2", "manual");
    const v2 = structuredClone(project);
    repeater.props.dataset = [
      { name: "Email alerts", enabled: false },
      { name: "Product updates", enabled: true },
    ];
    repeater.props.visibleWhen = { field: "enabled", operator: "equals", value: true };
    await createProjectCheckpoint(project, null, "Settings v3", "manual");

    const checkpoints = await listProjectCheckpoints(project.id, null);
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(["Settings v1", "Settings v2", "Settings v3"]);
    expect(reconstructCheckpoint(checkpoints, 1).screens[0].widgets[0].props.dataset)
      .toEqual(v2.screens[0].widgets[0].props.dataset);
    expect(reconstructCheckpoint(checkpoints, 0).screens[0].widgets[0].props.dataset)
      .toEqual(v1.screens[0].widgets[0].props.dataset);
    expect(compareProjects(v2, reconstructCheckpoint(checkpoints, 2))).toEqual(expect.arrayContaining([
      expect.objectContaining({ widget: "repeater", change: "changed" }),
    ]));
    expect(reconstructCheckpoint(checkpoints, 1).screens[0].widgets[0].props.dataset)
      .toEqual([{ name: "Email alerts", enabled: false }, { name: "Product updates", enabled: false }]);
  });
});
