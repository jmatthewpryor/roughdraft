import { ChevronRight, FolderOpen, FolderPlus, MoveUp, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DirectoryListing, StorageBackend } from "./storage";

interface ProjectPickerProps {
  backend: StorageBackend;
  open: boolean;
  onClose: () => void;
  onProjectChanged: () => Promise<void>;
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes("\\") ? "\\" : "/";
  const normalizedParent = parent.endsWith(separator)
    ? parent.slice(0, -1)
    : parent;
  return `${normalizedParent}${separator}${child}`;
}

function isValidFolderName(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value);
}

export function ProjectPicker({
  backend,
  open,
  onClose,
  onProjectChanged,
}: ProjectPickerProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<"open" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(
    async (nextPath?: string) => {
      setLoading(true);
      setError(null);
      try {
        const nextListing = await backend.listDirectories(nextPath);
        setListing(nextListing);
      } catch (loadError) {
        console.error(loadError);
        setError("Could not load folders.");
      } finally {
        setLoading(false);
      }
    },
    [backend]
  );

  useEffect(() => {
    if (!open || !backend.canManageProjects) return;
    setNewProjectName("");
    void loadDirectory(backend.info.projectPath);
  }, [backend, loadDirectory, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !backend.canManageProjects) {
    return null;
  }

  const handleOpenProject = async () => {
    if (!listing) return;
    setSubmitting("open");
    setError(null);
    try {
      await backend.openProject(listing.path);
      await onProjectChanged();
      onClose();
    } catch (openError) {
      console.error(openError);
      setError("Could not open that folder.");
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateProject = async () => {
    if (!listing) return;

    const trimmedName = newProjectName.trim();
    if (!isValidFolderName(trimmedName)) {
      setError("Enter a folder name without path separators.");
      return;
    }

    setSubmitting("create");
    setError(null);

    try {
      await backend.createProject(joinPath(listing.path, trimmedName));
      await onProjectChanged();
      onClose();
    } catch (createError) {
      console.error(createError);
      setError("Could not create that project folder.");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="project-picker-overlay" onClick={onClose}>
      <div
        className="project-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose project folder"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-picker-header">
          <div>
            <h2 className="project-picker-title">Project folder</h2>
            <p className="project-picker-subtitle">
              Open an existing folder or create a new project here.
            </p>
          </div>
          <button className="project-picker-close" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="project-picker-path">{listing?.path ?? backend.info.projectPath}</div>

        <div className="project-picker-actions">
          <button
            className="project-picker-nav"
            type="button"
            disabled={!listing?.parentPath || loading || submitting !== null}
            onClick={() => void loadDirectory(listing?.parentPath ?? undefined)}
          >
            <MoveUp size={16} />
            Up
          </button>
          <button
            className="project-picker-primary"
            type="button"
            disabled={!listing || loading || submitting !== null}
            onClick={() => void handleOpenProject()}
          >
            <FolderOpen size={16} />
            {submitting === "open" ? "Opening..." : "Open this folder"}
          </button>
        </div>

        <div className="project-picker-browser">
          {loading ? (
            <div className="project-picker-empty">Loading folders...</div>
          ) : listing && listing.directories.length > 0 ? (
            listing.directories.map((directory) => (
              <button
                key={directory.path}
                className="project-picker-directory"
                type="button"
                onClick={() => void loadDirectory(directory.path)}
                disabled={submitting !== null}
              >
                <span className="project-picker-directory-name">{directory.name}</span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <div className="project-picker-empty">No subfolders here.</div>
          )}
        </div>

        <div className="project-picker-create">
          <input
            className="project-picker-input"
            type="text"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New folder name"
            disabled={loading || submitting !== null}
          />
          <button
            className="project-picker-primary"
            type="button"
            disabled={!listing || loading || submitting !== null}
            onClick={() => void handleCreateProject()}
          >
            <FolderPlus size={16} />
            {submitting === "create" ? "Creating..." : "Create project"}
          </button>
        </div>

        {error ? <div className="project-picker-error">{error}</div> : null}
      </div>
    </div>
  );
}
