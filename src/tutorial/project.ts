import tutorialProjectSource from "../../demos/interactive-tutorial.pflow?raw";
import { parseProject, type Project } from "../project/schema";

export function createTutorialProjectCopy(): Project {
  const project = parseProject(tutorialProjectSource);
  const timestamp = new Date().toISOString();
  return parseProject({
    ...project,
    id: crypto.randomUUID(),
    name: "Interactive Tutorial",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
