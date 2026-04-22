export interface Page {
  id: string;
  title: string;
  content: string; // markdown string
}

export interface StoredAsset {
  markdownPath: string;
  previewUrl: string;
  mimeType: string;
}

export interface ProjectLayout {
  pages: Record<string, { x: number; y: number; width: number; height: number }>;
}

export interface BackendInfo {
  kind: "local-files" | "local-storage";
  label: string;
  detail: string;
  projectPath?: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

export interface StorageBackend {
  info: BackendInfo;
  canManageProjects: boolean;
  listPages(): Promise<Page[]>;
  getPage(id: string): Promise<Page>;
  savePage(id: string, content: string): Promise<void>;
  createPage(title?: string, content?: string): Promise<Page>;
  deletePage(id: string): Promise<void>;
  getProject(): Promise<ProjectLayout>;
  saveProject(project: ProjectLayout): Promise<void>;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  listDirectories(path?: string): Promise<DirectoryListing>;
  openProject(path: string): Promise<void>;
  createProject(path: string): Promise<void>;
}
