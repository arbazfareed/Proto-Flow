import type { InteractionRule, Project } from "./schema";

const SCREEN_LINK_ACTIONS = new Set(["navigate", "navigateTo"]);

export type ScreenLink = {
  /** Screen whose interaction rule holds the link. */
  fromScreenId: string;
  ruleId: string;
  actionIndex: number;
};

function isLinkTo(action: InteractionRule["actions"][number], screenId: string): boolean {
  return SCREEN_LINK_ACTIONS.has(action.type) && action.target === screenId;
}

/** Interaction links on other screens that go to `screenId`. */
export function findLinksToScreen(project: Project, screenId: string): ScreenLink[] {
  return project.screens
    .filter((screen) => screen.id !== screenId)
    .flatMap((screen) => screen.interactionRules.flatMap((rule) =>
      rule.actions.flatMap((action, actionIndex) =>
        isLinkTo(action, screenId) ? [{ fromScreenId: screen.id, ruleId: rule.id, actionIndex }] : [])));
}

/**
 * Points every link to `fromScreenId` at `toScreenId` instead, or removes those links when
 * `toScreenId` is null (a rule left with no actions is removed too).
 */
export function repointScreenLinks(
  project: Project,
  fromScreenId: string,
  toScreenId: string | null,
): Project {
  return {
    ...project,
    screens: project.screens.map((screen) => {
      if (!screen.interactionRules.some((rule) => rule.actions.some((action) => isLinkTo(action, fromScreenId)))) {
        return screen;
      }
      const interactionRules = screen.interactionRules.flatMap((rule) => {
        if (!rule.actions.some((action) => isLinkTo(action, fromScreenId))) return [rule];
        const actions = toScreenId === null
          ? rule.actions.filter((action) => !isLinkTo(action, fromScreenId))
          : rule.actions.map((action) => isLinkTo(action, fromScreenId) ? { ...action, target: toScreenId } : action);
        return actions.length ? [{ ...rule, actions }] : [];
      });
      return { ...screen, interactionRules };
    }),
  };
}
