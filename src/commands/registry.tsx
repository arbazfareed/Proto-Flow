import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  Bell,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Redo2,
  Undo2,
} from "lucide-react";

export interface AppCommand {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, AppCommand>();
  private readonly listeners = new Set<() => void>();
  private snapshot: AppCommand[] = [];

  register(command: AppCommand): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`A command with id "${command.id}" is already registered.`);
    }

    this.commands.set(command.id, command);
    this.publish();

    return () => {
      if (this.commands.get(command.id) !== command) return;
      this.commands.delete(command.id);
      this.publish();
    };
  }

  getSnapshot = (): AppCommand[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    this.snapshot = [...this.commands.values()];
    this.listeners.forEach((listener) => listener());
  }
}

export const commandRegistry = new CommandRegistry();

export interface CoreCommandActions {
  newProject: () => void;
  openProject: () => void | Promise<void>;
  saveProject: (saveAs?: boolean) => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  checkForUpdates: () => void;
}

export function createCoreCommands(actions: CoreCommandActions): AppCommand[] {
  return [
    {
      id: "project.new",
      label: "New Project",
      keywords: ["create", "document"],
      shortcut: "Ctrl N",
      icon: <FilePlus2 />,
      run: actions.newProject,
    },
    {
      id: "project.open",
      label: "Open Project",
      keywords: ["load", "file"],
      shortcut: "Ctrl O",
      icon: <FolderOpen />,
      run: actions.openProject,
    },
    {
      id: "project.save",
      label: "Save Project",
      keywords: ["write", "file"],
      shortcut: "Ctrl S",
      icon: <ArrowDownToLine />,
      run: () => actions.saveProject(),
    },
    {
      id: "project.save-as",
      label: "Save Project As",
      keywords: ["duplicate", "file"],
      shortcut: "Ctrl Shift S",
      icon: <FileText />,
      run: () => actions.saveProject(true),
    },
    {
      id: "edit.undo",
      label: "Undo",
      keywords: ["history", "back"],
      shortcut: "Ctrl Z",
      icon: <Undo2 />,
      run: actions.undo,
    },
    {
      id: "edit.redo",
      label: "Redo",
      keywords: ["history", "forward"],
      shortcut: "Ctrl Shift Z",
      icon: <Redo2 />,
      run: actions.redo,
    },
    {
      id: "canvas.toggle-grid",
      label: "Toggle Grid",
      keywords: ["canvas", "view"],
      shortcut: "Ctrl '",
      icon: <Eye />,
      run: actions.toggleGrid,
    },
    {
      id: "canvas.toggle-snap",
      label: "Toggle Snap to Grid",
      keywords: ["canvas", "grid", "alignment", "guides"],
      shortcut: "Ctrl Shift '",
      icon: <Eye />,
      run: actions.toggleSnap,
    },
    {
      id: "app.check-updates",
      label: "Check for Updates",
      keywords: ["version", "upgrade"],
      icon: <Bell />,
      run: actions.checkForUpdates,
    },
  ];
}
