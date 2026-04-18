import { useState, useCallback, useEffect } from "react";
import { TAB_DRAG_MIME, type TabDragData } from "./TabButton";
import { moveTabToNewPane, addTab } from "../../state/actions";
import { useStore } from "../../state/store";
import { createTab } from "../../models/pane-node";
import { PaneTabKind } from "../../../../shared/ipc-types";
import {
  FILE_TREE_DRAG_MIME,
  type FileTreeDragData,
} from "../sidebar/FileTreeNode";

interface PaneDropZoneProps {
  paneId: string;
  tabCount: number;
}

type DropSide = "left" | "right" | "center" | null;

export function PaneDropZone({ paneId, tabCount }: PaneDropZoneProps) {
  const isTabDragActive = useStore((s) => s.isTabDragActive);
  const isFileTreeDragActive = useStore((s) => s.isFileTreeDragActive);
  const dragActive = isTabDragActive || isFileTreeDragActive;
  const [activeSide, setActiveSide] = useState<DropSide>(null);

  // Safety net: reset drag state when drag ends abnormally (Escape, window
  // blur, Cmd+Tab, Mission Control, mouse released outside window, etc.).
  useEffect(() => {
    if (!dragActive) return;

    const resetDrag = () => {
      const store = useStore.getState();
      store.setTabDragActive(false);
      store.setFileTreeDragActive(false);
    };

    document.addEventListener("dragend", resetDrag, true);
    window.addEventListener("blur", resetDrag);
    document.addEventListener("visibilitychange", resetDrag);

    return () => {
      document.removeEventListener("dragend", resetDrag, true);
      window.removeEventListener("blur", resetDrag);
      document.removeEventListener("visibilitychange", resetDrag);
    };
  }, [dragActive]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const isTabDrag = types.includes(TAB_DRAG_MIME);
    const isFileDrag = types.includes(FILE_TREE_DRAG_MIME);
    if (!isTabDrag && !isFileDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isFileDrag ? "copy" : "move";

    // Tab drags split left/right. File drops default to dropping into the
    // current pane ("center"), with left/right as split intents too.
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (isTabDrag) {
      setActiveSide(e.clientX < midX ? "left" : "right");
    } else {
      // For file drags: split when near the edges, otherwise open in current.
      const edge = rect.width * 0.2;
      if (e.clientX - rect.left < edge) setActiveSide("left");
      else if (rect.right - e.clientX < edge) setActiveSide("right");
      else setActiveSide("center");
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setActiveSide(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setActiveSide(null);

      const tabRaw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (tabRaw) {
        useStore.getState().setTabDragActive(false);
        const data: TabDragData = JSON.parse(tabRaw);
        if (data.sourcePaneId === paneId && tabCount <= 1) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const direction = e.clientX < midX ? "left" : "right";
        moveTabToNewPane(data.tabId, data.sourcePaneId, paneId, direction);
        return;
      }

      const fileRaw = e.dataTransfer.getData(FILE_TREE_DRAG_MIME);
      if (fileRaw) {
        useStore.getState().setFileTreeDragActive(false);
        const data: FileTreeDragData = JSON.parse(fileRaw);
        const store = useStore.getState();
        const rect = e.currentTarget.getBoundingClientRect();
        const edge = rect.width * 0.2;
        const nearLeft = e.clientX - rect.left < edge;
        const nearRight = rect.right - e.clientX < edge;
        const shouldSplit = nearLeft || nearRight;

        // Switch focused workspace if the file lives in a different one so
        // the split / open lands in the right place.
        if (store.selectedWorkspacePath !== data.workspacePath) {
          store.selectWorkspace(data.workspacePath);
        }

        if (shouldSplit) {
          // Lazy-import to avoid circular deps with actions.
          import("../../state/actions").then(({ openFileInSplit }) => {
            openFileInSplit(data.workspacePath, data.filePath);
          });
        } else {
          // Open as a new tab in THIS pane.
          store.setFocusedPaneId(paneId);
          const isMarkdown = /\.(?:md|markdown)$/i.test(data.filePath);
          const kind = isMarkdown ? PaneTabKind.MarkdownViewer : PaneTabKind.Editor;
          const label = data.filePath.split("/").pop() ?? "File";
          const overrides = isMarkdown
            ? { markdownFilePath: data.filePath }
            : { editorFilePath: data.filePath };
          const isMonacoDefault = store.config?.editor === "monaco";
          const needsTerminalId = kind === PaneTabKind.Editor && !isMonacoDefault;
          const tab = createTab(kind, label, {
            ...(needsTerminalId ? { terminalId: crypto.randomUUID() } : {}),
            ...overrides,
          });
          addTab(paneId, tab);
        }
        return;
      }
    },
    [paneId, tabCount],
  );

  if (!dragActive) return null;

  return (
    <div
      className="absolute inset-0 z-20"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeSide === "left" && (
        <div className="absolute inset-y-0 left-0 w-1/2 bg-[var(--ctp-blue)]/10 border-2 border-[var(--ctp-blue)]/30 rounded-l-md pointer-events-none" />
      )}
      {activeSide === "right" && (
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[var(--ctp-blue)]/10 border-2 border-[var(--ctp-blue)]/30 rounded-r-md pointer-events-none" />
      )}
      {activeSide === "center" && (
        <div className="absolute inset-0 bg-[var(--ctp-blue)]/10 border-2 border-[var(--ctp-blue)]/30 rounded-md pointer-events-none" />
      )}
    </div>
  );
}
