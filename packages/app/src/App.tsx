import { useEffect, useState, useCallback, useRef } from "react";
import type { StorageBackend, Page, ProjectLayout } from "./storage";
import { detectBackend } from "./detect-backend";
import { Canvas } from "./Canvas";
import { PageCard } from "./PageCard";
import { ProjectPicker } from "./ProjectPicker";

function getWorkspacePath(path?: string) {
  return path?.trim() || null;
}

function getWorkspaceName(path?: string) {
  const workspacePath = getWorkspacePath(path);
  if (!workspacePath) return "Browser drafts";

  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || workspacePath;
}

function getWorkspaceMeta(backend: StorageBackend | null) {
  if (!backend) return { text: "", title: undefined as string | undefined };

  const workspacePath = getWorkspacePath(backend.info.projectPath);
  if (workspacePath) {
    return {
      text: `Local folder · ${workspacePath}`,
      title: workspacePath,
    };
  }

  return {
    text: backend.info.detail,
    title: backend.info.detail,
  };
}

export function App() {
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [layout, setLayout] = useState<ProjectLayout>({ pages: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const backendRef = useRef<StorageBackend | null>(null);
  const layoutRef = useRef<ProjectLayout>({ pages: {} });
  const saveLayoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  backendRef.current = backend;
  layoutRef.current = layout;

  const loadProject = useCallback(async (nextBackend: StorageBackend) => {
    if (saveLayoutTimer.current) {
      clearTimeout(saveLayoutTimer.current);
      saveLayoutTimer.current = null;
    }

    const [pageList, project] = await Promise.all([
      nextBackend.listPages(),
      nextBackend.getProject(),
    ]);

    let pg: Page[];
    let proj = project;

    if (pageList.length === 0) {
      const page = await nextBackend.createPage(
        "Untitled",
        "# Welcome to Roughdraft\n\nStart writing. Your work is saved automatically.\n"
      );
      pg = [page];
      proj = await nextBackend.getProject();
    } else {
      pg = pageList;
    }

    let layoutChanged = false;
    for (const p of pg) {
      if (!proj.pages[p.id]) {
        const idx = Object.keys(proj.pages).length;
        proj.pages[p.id] = {
          x: idx * 720,
          y: 0,
          width: 680,
          height: 500,
        };
        layoutChanged = true;
      }
    }
    if (layoutChanged) {
      await nextBackend.saveProject(proj);
    }

    setSelectedId(null);
    setPages(pg);
    setLayout(proj);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const detectedBackend = await detectBackend();
      if (cancelled) return;
      setBackend(detectedBackend);

      await loadProject(detectedBackend);
      if (cancelled) return;
      setLoading(false);
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [loadProject]);

  const handleSavePage = useCallback(async (id: string, content: string) => {
    await backendRef.current?.savePage(id, content);
    // Update page title in local state
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const firstLine = content.split("\n")[0] || "";
        const title = firstLine.replace(/^#*\s*/, "") || p.id;
        return { ...p, content, title };
      })
    );
  }, []);

  const handleReposition = useCallback((id: string, x: number, y: number) => {
    setLayout((prev) => {
      const entry = prev.pages[id] || { x: 0, y: 0, width: 680, height: 500 };
      const next = {
        ...prev,
        pages: { ...prev.pages, [id]: { ...entry, x, y } },
      };
      // Debounce save
      if (saveLayoutTimer.current) clearTimeout(saveLayoutTimer.current);
      saveLayoutTimer.current = setTimeout(() => {
        backendRef.current?.saveProject(layoutRef.current).catch((err) => {
          console.error("Failed to save layout:", err);
        });
      }, 300);
      return next;
    });
  }, []);

  const handleCreatePage = useCallback(async () => {
    if (!backendRef.current) return;
    const page = await backendRef.current.createPage("Untitled", "# Untitled\n");
    const proj = await backendRef.current.getProject();
    setPages((prev) => [...prev, page]);
    setLayout(proj);
    setSelectedId(page.id);
  }, []);

  const handleDeletePage = useCallback(
    async (id: string) => {
      if (!backendRef.current) return;
      await backendRef.current.deletePage(id);
      setPages((prev) => prev.filter((p) => p.id !== id));
      setLayout((prev) => {
        const next = { ...prev, pages: { ...prev.pages } };
        delete next.pages[id];
        return next;
      });
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId]
  );

  const handleCanvasPointerDown = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleProjectChanged = useCallback(async () => {
    setLoading(true);
    const nextBackend = await detectBackend();
    setBackend(nextBackend);
    await loadProject(nextBackend);
    setLoading(false);
  }, [loadProject]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
        }}
      >
        <p>Loading...</p>
      </div>
    );
  }

  const workspaceName = getWorkspaceName(backend?.info.projectPath);
  const workspaceMeta = getWorkspaceMeta(backend);

  return (
    <>
      <div className="app-chrome">
        <div className="workspace-header">
          <div className="workspace-copy">
            <h1 className="workspace-title">{workspaceName}</h1>
            <p className="workspace-meta" title={workspaceMeta.title}>
              {workspaceMeta.text}
            </p>
          </div>
          {backend?.canManageProjects ? (
            <button
              className="workspace-action"
              type="button"
              onClick={() => setIsProjectPickerOpen(true)}
            >
              Switch project
            </button>
          ) : null}
        </div>
      </div>
      <Canvas onPointerDownOnCanvas={handleCanvasPointerDown}>
        {pages.map((page) => {
          const pos = layout.pages[page.id] || { x: 0, y: 0 };
          return (
            <PageCard
              key={page.id}
              page={page}
              x={pos.x}
              y={pos.y}
              selected={selectedId === page.id}
              onSelect={setSelectedId}
              onSave={handleSavePage}
              onReposition={handleReposition}
              onDelete={handleDeletePage}
              backend={backend!}
            />
          );
        })}
      </Canvas>
      <button className="create-page-btn" onClick={handleCreatePage} title="New page">
        +
      </button>
      {backend ? (
        <ProjectPicker
          backend={backend}
          open={isProjectPickerOpen}
          onClose={() => setIsProjectPickerOpen(false)}
          onProjectChanged={handleProjectChanged}
        />
      ) : null}
    </>
  );
}
