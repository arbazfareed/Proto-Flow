export type TutorialAction =
  | "preview-opened"
  | "flow-opened"
  | "html-exported";

const TUTORIAL_ACTION_EVENT = "protoflow:tutorial-action";

export function emitTutorialAction(action: TutorialAction): void {
  window.dispatchEvent(new CustomEvent<TutorialAction>(TUTORIAL_ACTION_EVENT, {
    detail: action,
  }));
}

export function listenForTutorialActions(
  listener: (action: TutorialAction) => void,
): () => void {
  const onAction = (event: Event) => {
    if (event instanceof CustomEvent) listener(event.detail as TutorialAction);
  };
  window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
  return () => window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
}
