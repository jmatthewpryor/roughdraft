import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCanvasScale } from "./Canvas";
import { EditorContextMenu } from "./EditorContextMenu";
import { createEditorExtensions } from "./editor-extensions";
import { EditorToolbar } from "./EditorToolbar";
import { toHtml, toMarkdown } from "./markdown";
import type { Page, StorageBackend } from "./storage";

interface PageCardProps {
  page: Page;
  x: number;
  y: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onSave: (id: string, content: string) => Promise<void>;
  onReposition: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  backend: StorageBackend;
}

export function PageCard({
  page,
  x,
  y,
  selected,
  onSelect,
  onSave,
  onReposition,
  onDelete,
  backend,
}: PageCardProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, pageX: 0, pageY: 0 });
  const recentMarkdownRef = useRef<Set<string>>(new Set());
  const editorRef = useRef<Editor | null>(null);
  const scale = useCanvasScale();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  const resolveFileUrl = useCallback(
    (path: string) => backend.resolveFileUrl(path),
    [backend]
  );

  const htmlContent = useMemo(
    () =>
      toHtml(page.content, {
        resolveFileUrl,
      }),
    [page.content, resolveFileUrl]
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || files.length === 0) return;

      const assets = await Promise.all(files.map((file) => backend.saveAsset(file)));
      const markdown = assets
        .map((asset, index) => {
          const file = files[index];
          if (asset.mimeType.startsWith("image/")) {
            return `![${file?.name || "Image"}](${asset.markdownPath})`;
          }
          return `[${file?.name || "Attachment"}](${asset.markdownPath})`;
        })
        .join("\n\n");

      currentEditor
        .chain()
        .focus()
        .insertContent(
          toHtml(markdown, {
            resolveFileUrl,
          })
        )
        .run();
    },
    [backend, resolveFileUrl]
  );

  const editor = useEditor(
    {
      extensions: createEditorExtensions("Start writing..."),
      content: htmlContent,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "tiptap",
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const markdown = toMarkdown(currentEditor.getHTML());
        recentMarkdownRef.current.add(markdown);
        if (recentMarkdownRef.current.size > 10) {
          const iterator = recentMarkdownRef.current.values();
          recentMarkdownRef.current.delete(iterator.next().value as string);
        }

        if (saveTimer.current) clearTimeout(saveTimer.current);
        setSaveState("saving");
        saveTimer.current = setTimeout(async () => {
          try {
            await onSave(page.id, markdown);
            setSaveState("idle");
          } catch (error) {
            console.error("Failed to save page:", error);
            setSaveState("error");
          }
        }, 500);
      },
    },
    [page.id]
  );

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    if (recentMarkdownRef.current.has(page.content)) {
      recentMarkdownRef.current.delete(page.content);
      return;
    }

    if (editor.getHTML() !== htmlContent) {
      editor.commands.setContent(htmlContent, { emitUpdate: false });
    }
  }, [editor, htmlContent, page.content]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const handleDragPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.stopPropagation();
      event.preventDefault();
      isDragging.current = true;
      dragStart.current = { x, y, pageX: event.clientX, pageY: event.clientY };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      onSelect(page.id);
    },
    [onSelect, page.id, x, y]
  );

  const handleDragPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!isDragging.current) return;
      const dx = (event.clientX - dragStart.current.pageX) / scale;
      const dy = (event.clientY - dragStart.current.pageY) / scale;
      onReposition(page.id, dragStart.current.x + dx, dragStart.current.y + dy);
    },
    [onReposition, page.id, scale]
  );

  const handleDragPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleBodyPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.stopPropagation();
      onSelect(page.id);
    },
    [onSelect, page.id]
  );

  return (
    <div
      className={`page-card ${selected ? "page-card-selected" : ""}`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 680,
      }}
    >
      <div
        className="page-card-handle"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
      >
        <span className="page-card-title">{page.title}</span>
        {saveState === "saving" ? <span className="page-card-status">Saving…</span> : null}
        {saveState === "error" ? (
          <span className="page-card-status page-card-status-error">Save failed</span>
        ) : null}
        <button
          className="page-card-delete"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(page.id);
          }}
          title="Delete page"
        >
          &times;
        </button>
      </div>
      <div className="page-card-body" onPointerDown={handleBodyPointerDown}>
        <EditorToolbar editor={editor} onPickFiles={insertFiles} />
        <EditorContextMenu editor={editor} backend={backend}>
          <EditorContent editor={editor} />
        </EditorContextMenu>
      </div>
    </div>
  );
}
