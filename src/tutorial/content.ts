export interface TutorialStep {
  title: string;
  instruction: string;
  target: string;
  axure: string;
}

export const TUTORIAL_UI_STRINGS = {
  brand: "Interactive tutorial",
  regionLabel: "Interactive ProtoFlow tutorial",
  close: "Close tutorial",
  closeConfirmation: "Close the tutorial and return to your project?",
  restartConfirmation: "Restart the tutorial? Changes in the tutorial copy will be discarded.",
  preserveProjectConfirmation: "The tutorial opens in a separate copy. Your current project will be restored when you finish. Continue?",
  stepCount: "STEP {current} OF {total}",
  progressLabel: "Step {current} of {total}",
  axureDisclosure: "If you’re coming from Axure…",
  exportComplete: "Responsive HTML export complete.",
  back: "Back",
  next: "Next",
  finish: "Finish",
} as const;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    title: "Select a shape",
    instruction: "Click the blue rectangle on the Home screen to select it.",
    target: "canvas",
    axure: "In Axure, you select widgets on the page canvas in much the same way.",
  },
  {
    title: "Move it on the canvas",
    instruction: "Drag the blue rectangle. Watch its position update in the inspector.",
    target: "canvas",
    axure: "This is the same direct-manipulation workflow as moving a widget on an Axure page.",
  },
  {
    title: "Change its style",
    instruction: "With the rectangle selected, change its Fill in the Style inspector.",
    target: "inspector",
    axure: "Axure's Style panel has the same role: adjust the selected widget's visual properties.",
  },
  {
    title: "Add a button",
    instruction: "Choose Button from the element library, then place it on the canvas.",
    target: "sidebar",
    axure: "ProtoFlow's element library is similar to Axure's widget libraries.",
  },
  {
    title: "Create a navigation rule",
    instruction: "Select the new button and add a rule: On click → Navigate to Details.",
    target: "inspector",
    axure: "This is like an Axure interaction case: choose an event, then add an action.",
  },
  {
    title: "Open the preview",
    instruction: "Open Preview from the top bar, or press Ctrl+P (Cmd+P on Mac).",
    target: "topbar",
    axure: "Axure's Preview command also opens a working version of the prototype.",
  },
  {
    title: "Try the interaction",
    instruction: "In the preview, click your button and confirm it navigates to Details. Then choose Next.",
    target: "canvas",
    axure: "Test a prototype in Axure Preview the same way: perform the action and check the result.",
  },
  {
    title: "Check the device frame",
    instruction: "Open the Home screen menu, choose Change device, and select iPhone 15. Then choose the Mobile breakpoint to see the frame at phone size.",
    target: "screens",
    axure: "Axure uses adaptive views; ProtoFlow attaches a named device frame to each screen.",
  },
  {
    title: "Try a mobile override",
    instruction: "Open Breakpoints → Manage and add the Mobile preset if it is missing. Select the header and define a Mobile override in Responsive.",
    target: "breakpoints",
    axure: "This is similar to Axure adaptive views, with explicit breakpoints and per-widget overrides.",
  },
  {
    title: "Switch panel states",
    instruction: "Select the Tabs panel and click its Overview, Activity, and Notes states.",
    target: "inspector",
    axure: "Axure calls these Dynamic Panels. ProtoFlow panels can nest up to five levels deep.",
  },
  {
    title: "Edit repeater data",
    instruction: "Select Starter repeater, open its dataset in the inspector, and add a row.",
    target: "inspector",
    axure: "Axure repeaters use a similar dataset-and-template model for repeating content.",
  },
  {
    title: "Use an expression",
    instruction: "Edit the Count expression text and enter [[count + 1]].",
    target: "inspector",
    axure: "Axure expressions use a similar inline idea; ProtoFlow evaluates its own safe expression syntax.",
  },
  {
    title: "Try the AI generator",
    instruction: "Optional: open Quick actions and try the AI interaction generator. You can choose Next without using cloud credits.",
    target: "topbar",
    axure: "Axure's interaction editor is manual; ProtoFlow can also draft a rule from a plain-language description.",
  },
  {
    title: "View the flow",
    instruction: "Choose Flow in the canvas toolbar to see how the screens connect.",
    target: "flow",
    axure: "This is a visual map of page links, similar to the Sitemap view in Axure.",
  },
  {
    title: "Export and start creating",
    instruction: "Export the project as responsive HTML (free and local), then finish the tour and start a real project.",
    target: "topbar",
    axure: "Like generating a shareable Axure prototype, ProtoFlow's HTML export runs locally and includes responsive styles.",
  },
];
