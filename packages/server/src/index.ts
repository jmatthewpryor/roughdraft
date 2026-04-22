import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../../app/dist");

interface PageLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProjectData {
  pages: Record<string, PageLayout>;
}

interface AssetPayload {
  filename?: string;
  mimeType?: string;
  dataBase64?: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

function readProjectFile(projectDir: string): ProjectData {
  const filePath = path.join(projectDir, "roughdraft.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    fs.mkdirSync(projectDir, { recursive: true });
    const defaultProject: ProjectData = { pages: {} };
    fs.writeFileSync(filePath, JSON.stringify(defaultProject, null, 2));
    return defaultProject;
  }
}

function writeProjectFile(projectDir: string, data: ProjectData): void {
  const filePath = path.join(projectDir, "roughdraft.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function listMdFiles(projectDir: string): string[] {
  try {
    return fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function nextUntitledId(projectDir: string): string {
  const existing = listMdFiles(projectDir);
  let i = 1;
  while (existing.includes(`untitled-${i}`)) i++;
  return `untitled-${i}`;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function ensureProjectPath(projectDir: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/^\.?\//, "");
  const absolute = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}

function nextAssetPath(projectDir: string, filename: string): string {
  const assetsDir = path.join(projectDir, ".roughdraft-assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const extensionIndex = safeName.lastIndexOf(".");
  const basename =
    extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";

  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const relativePath = `.roughdraft-assets/${basename}${suffix}${extension}`;
    const absolutePath = path.join(projectDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return relativePath;
    }
    counter += 1;
  }
}

function ensureDirectoryExists(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isExistingDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(dir: string): DirectoryListing {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const parentPath = path.dirname(dir);

  return {
    path: dir,
    parentPath: parentPath === dir ? null : parentPath,
    directories: entries,
  };
}

export function createServer(port = 3000, projectDir?: string): void {
  let currentProjectDir = path.resolve(projectDir || process.cwd());
  const app = express();

  ensureDirectoryExists(currentProjectDir);

  app.use(express.json({ limit: "50mb" }));

  // --- API routes ---

  app.get("/api/pages", (_req, res) => {
    const ids = listMdFiles(currentProjectDir);
    const pages = ids.map((id) => {
      const content = fs.readFileSync(path.join(currentProjectDir, `${id}.md`), "utf-8");
      return { id, title: titleFromContent(content, id), content };
    });
    res.json(pages);
  });

  app.get("/api/pages/:id", (req, res) => {
    const id = req.params.id;
    const filePath = path.join(currentProjectDir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ id, title: titleFromContent(content, id), content });
  });

  app.put("/api/pages/:id", (req, res) => {
    const id = req.params.id;
    const filePath = path.join(currentProjectDir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const { content } = req.body as { content: string };
    fs.writeFileSync(filePath, content);
    res.json({ id, title: titleFromContent(content, id), content });
  });

  app.post("/api/pages", (req, res) => {
    const { title, content: bodyContent } = req.body as {
      title?: string;
      content?: string;
    };
    const id = nextUntitledId(currentProjectDir);
    const content = bodyContent || `# ${title || "Untitled"}\n`;
    const filePath = path.join(currentProjectDir, `${id}.md`);
    fs.writeFileSync(filePath, content);

    // Add to roughdraft.json
    const project = readProjectFile(currentProjectDir);
    const existing = Object.values(project.pages);
    const maxX =
      existing.length > 0
        ? Math.max(...existing.map((p) => p.x + p.width))
        : 0;
    project.pages[id] = { x: maxX + 20, y: 0, width: 400, height: 500 };
    writeProjectFile(currentProjectDir, project);

    res.status(201).json({ id, title: titleFromContent(content, id), content });
  });

  app.delete("/api/pages/:id", (req, res) => {
    const id = req.params.id;
    const filePath = path.join(currentProjectDir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    fs.unlinkSync(filePath);

    // Remove from roughdraft.json
    const project = readProjectFile(currentProjectDir);
    delete project.pages[id];
    writeProjectFile(currentProjectDir, project);

    res.json({ ok: true });
  });

  app.get("/api/project", (_req, res) => {
    const project = readProjectFile(currentProjectDir);
    res.json(project);
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      backend: "local-files",
      projectDir: currentProjectDir,
      port,
    });
  });

  app.get("/api/directories", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? path.resolve(req.query.path)
        : currentProjectDir;

    if (!isExistingDirectory(requestedPath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    res.json(listDirectories(requestedPath));
  });

  app.post("/api/project/open", (req, res) => {
    const requestedPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    if (!isExistingDirectory(absolutePath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    currentProjectDir = absolutePath;
    ensureDirectoryExists(currentProjectDir);
    readProjectFile(currentProjectDir);

    res.json({
      backend: "local-files",
      projectDir: currentProjectDir,
      port,
    });
  });

  app.post("/api/project/create", (req, res) => {
    const requestedPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    ensureDirectoryExists(absolutePath);
    currentProjectDir = absolutePath;
    readProjectFile(currentProjectDir);

    res.status(201).json({
      backend: "local-files",
      projectDir: currentProjectDir,
      port,
    });
  });

  app.put("/api/project", (req, res) => {
    const project = req.body as ProjectData;
    writeProjectFile(currentProjectDir, project);
    res.json(project);
  });

  app.get("/api/files", (req, res) => {
    const relativePath = typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(currentProjectDir, relativePath);

    if (!absolutePath || !fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.sendFile(absolutePath);
  });

  app.post("/api/assets", (req, res) => {
    const payload = req.body as AssetPayload;
    if (!payload.filename || !payload.dataBase64) {
      res.status(400).json({ error: "filename and dataBase64 are required" });
      return;
    }

    const relativePath = nextAssetPath(currentProjectDir, payload.filename);
    const absolutePath = ensureProjectPath(currentProjectDir, relativePath);
    if (!absolutePath) {
      res.status(400).json({ error: "Invalid asset path" });
      return;
    }

    const buffer = Buffer.from(payload.dataBase64, "base64");
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    res.status(201).json({
      markdownPath: `./${relativePath}`,
      previewUrl: `/api/files?path=${encodeURIComponent(relativePath)}`,
      mimeType: payload.mimeType || "application/octet-stream",
    });
  });

  // --- Static files & SPA fallback ---

  app.use(express.static(staticDir));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  app.listen(port, () => {
    console.log(`\n  Roughdraft running at http://localhost:${port}`);
    console.log(`  Project directory: ${currentProjectDir}\n`);
  });
}
