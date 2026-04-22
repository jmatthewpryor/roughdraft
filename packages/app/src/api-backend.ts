import type {
  BackendInfo,
  DirectoryListing,
  Page,
  ProjectLayout,
  StorageBackend,
  StoredAsset,
} from "./storage";

export class ApiBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = true;

  constructor(info: BackendInfo) {
    this.info = info;
  }

  async listPages(): Promise<Page[]> {
    const res = await fetch("/api/pages");
    if (!res.ok) throw new Error(`Failed to list pages: ${res.status}`);
    return res.json();
  }

  async getPage(id: string): Promise<Page> {
    const res = await fetch(`/api/pages/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Failed to get page ${id}: ${res.status}`);
    return res.json();
  }

  async savePage(id: string, content: string): Promise<void> {
    const res = await fetch(`/api/pages/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Failed to save page ${id}: ${res.status}`);
  }

  async createPage(title?: string, content?: string): Promise<Page> {
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error(`Failed to create page: ${res.status}`);
    return res.json();
  }

  async deletePage(id: string): Promise<void> {
    const res = await fetch(`/api/pages/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete page ${id}: ${res.status}`);
  }

  async getProject(): Promise<ProjectLayout> {
    const res = await fetch("/api/project");
    if (!res.ok) throw new Error(`Failed to get project: ${res.status}`);
    return res.json();
  }

  async saveProject(project: ProjectLayout): Promise<void> {
    const res = await fetch("/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    if (!res.ok) throw new Error(`Failed to save project: ${res.status}`);
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]!);
    }

    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: btoa(binary),
      }),
    });

    if (!res.ok) throw new Error(`Failed to save asset: ${res.status}`);
    return res.json();
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.replace(/^\.?\//, "");
    return `/api/files?path=${encodeURIComponent(normalized)}`;
  }

  async listDirectories(path?: string): Promise<DirectoryListing> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/api/directories${query}`);
    if (!res.ok) throw new Error(`Failed to list directories: ${res.status}`);
    return res.json();
  }

  async openProject(path: string): Promise<void> {
    const res = await fetch("/api/project/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Failed to open project: ${res.status}`);
  }

  async createProject(path: string): Promise<void> {
    const res = await fetch("/api/project/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  }
}
