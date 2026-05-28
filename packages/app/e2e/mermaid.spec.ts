import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("mermaid diagram rendering", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("mermaid");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("paints a mermaid fence as an inline SVG diagram", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "diagram.md",
      [
        "# Mermaid",
        "",
        "```mermaid",
        "graph TD",
        "  A[Start] --> B[End]",
        "```",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.getByTestId("rich-text-editor");

    // The mermaid fence renders to an inline SVG (not a code block). Mermaid
    // loads lazily and renders asynchronously, so allow extra time.
    const diagram = editor.locator(".mermaid-block svg");
    await expect(diagram).toBeVisible({ timeout: 15_000 });

    // The rendered diagram reflects the source node labels.
    await expect(diagram).toContainText("Start");
    await expect(diagram).toContainText("End");

    // A non-mermaid fence stays a code block, not a diagram.
    await expect(editor.locator("pre code")).toContainText("const value = 1;");

    logE2eEvent("mermaid.rendered", { projectDir, file: "diagram.md" });
  });
});
