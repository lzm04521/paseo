import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { getVisibleWorkspaceAgentTabIds } from "../support/helpers/workspace-tabs";

// Model B sidebar shape: every project — git or non-git, single- or
// multi-workspace — renders as the same expandable parent, the deepest sidebar
// level is the workspace row, and tabs/agents/terminals NEVER appear in the
// sidebar. These specs prove all three invariants end to end.

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function projectRow(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectEquivalenceViewKey(projectKey)}`);
}

function projectNewWorktreeIcon(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-new-worktree-${projectEquivalenceViewKey(projectKey)}`);
}

async function paintedSvgRight(locator: Locator): Promise<number> {
  return locator.evaluate((svg) => {
    let right = Number.NEGATIVE_INFINITY;
    for (const child of svg.querySelectorAll<SVGGraphicsElement>(
      "path, circle, ellipse, line, polyline, polygon, rect",
    )) {
      const box = child.getBBox();
      const matrix = child.getScreenCTM();
      if (!matrix) continue;
      const geometryRight = new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x;
      const strokeWidth = Number.parseFloat(getComputedStyle(child).strokeWidth) || 0;
      const scaleX = Math.hypot(matrix.a, matrix.b);
      right = Math.max(right, geometryRight + (strokeWidth * scaleX) / 2);
    }
    if (!Number.isFinite(right)) throw new Error("SVG has no measurable painted children");
    return right;
  });
}

async function paintedTextRight(locator: Locator): Promise<number> {
  return locator.evaluate((label) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Canvas text measurement is unavailable");
    context.font = getComputedStyle(label).font;
    const metrics = context.measureText(label.textContent ?? "");
    return label.getBoundingClientRect().left + metrics.actualBoundingBoxRight;
  });
}

async function seedSecondWorkspace(seeded: SeededWorkspace, title: string): Promise<string> {
  const created = await seeded.client.createWorkspace({
    source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create second workspace for ${seeded.projectId}`);
  }
  return created.workspace.id;
}

test.describe("Model B sidebar shape", () => {
  test.describe.configure({ timeout: 180_000 });

  test("git and non-git projects both render as expandable parents, both show a per-row New workspace icon, and the global button covers both", async ({
    page,
  }) => {
    const gitProject = await seedWorkspace({ repoPrefix: "model-b-git-" });
    const nonGitProject = await seedWorkspace({ repoPrefix: "model-b-nongit-", git: false });

    try {
      const gitSecondId = await seedSecondWorkspace(gitProject, "Git second");
      const nonGitSecondId = await seedSecondWorkspace(nonGitProject, "Non-git second");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Both projects are expandable parents — the non-git one is NOT flattened
      // into a bare workspace link.
      await expect(projectRow(page, gitProject.projectKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, nonGitProject.projectKey)).toBeVisible({ timeout: 30_000 });

      // Each parent shows both of its workspace rows underneath.
      await expect(workspaceRow(page, gitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, gitSecondId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitSecondId)).toBeVisible({ timeout: 30_000 });

      // Both projects show a per-row New workspace icon (revealed on hover): the
      // git project can branch off a worktree, and the non-git project can add
      // another workspace because the host supports workspaceMultiplicity.
      await projectRow(page, gitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, gitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await projectRow(page, nonGitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, nonGitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      // The global new-workspace button is the universal entry — present for both
      // kinds regardless of their per-row affordance.
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await gitProject.cleanup();
      await nonGitProject.cleanup();
    }
  });

  test("sidebar trailing glyphs share the workspace content rail", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "model-b-trailing-rail-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-display-show").click();
      await page.getByTestId("sidebar-workspace-trailing-timestamp").click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const project = projectRow(page, seeded.projectKey);
      const workspace = workspaceRow(page, seeded.workspaceId);
      const displayPreferencesGlyph = page
        .getByTestId("sidebar-display-preferences-menu")
        .locator("svg");

      await project.hover();
      const projectKebabGlyph = page
        .getByTestId(`sidebar-project-kebab-${projectEquivalenceViewKey(seeded.projectKey)}`)
        .locator("svg");
      await expect(projectKebabGlyph).toBeVisible();
      const projectKebabRight = await paintedSvgRight(projectKebabGlyph);

      await workspace.hover();
      const workspaceKebabGlyph = page
        .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${seeded.workspaceId}`)
        .locator("svg");
      const timestamp = workspace.getByTestId("sidebar-workspace-timestamp");
      await expect(workspaceKebabGlyph).toBeVisible();
      await expect(timestamp).toBeVisible();

      const rail = await paintedTextRight(timestamp);
      for (const glyphRight of await Promise.all([
        paintedSvgRight(displayPreferencesGlyph),
        Promise.resolve(projectKebabRight),
        paintedSvgRight(workspaceKebabGlyph),
      ])) {
        expect(glyphRight).toBeCloseTo(rail, 0);
      }
    } finally {
      await seeded.cleanup();
    }
  });

  test("no tab, agent, or terminal ever renders as a sidebar row", async ({ page }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-leaf-",
      title: "Leaf workspace",
    });

    try {
      // Open the workspace and materialize both an agent tab and a terminal tab.
      await gotoWorkspace(page, mock.workspaceId);
      const agentTabs = await getVisibleWorkspaceAgentTabIds(page);
      expect(agentTabs).toContain(`workspace-tab-agent_${mock.agentId}`);

      await clickNewTerminal(page);
      await expect(
        page.locator('[data-testid^="workspace-tab-terminal_"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // The deepest level inside the sidebar is the workspace row: no tab,
      // agent, or terminal element appears as a sidebar descendant.
      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();
      await expect(workspaceRow(page, mock.workspaceId).first()).toBeVisible({ timeout: 30_000 });
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-agent-row-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-terminal-row-"]')).toHaveCount(0);
    } finally {
      await mock.cleanup();
    }
  });

  test("status grouping shows only workspace rows and moves a single row when its status changes", async ({
    page,
  }) => {
    const idleProject = await seedWorkspace({ repoPrefix: "model-b-status-idle-" });
    const activeMock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-status-active-",
      title: "Working workspace",
      initialPrompt: "stay busy",
      model: "one-minute-stream",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(workspaceRow(page, idleProject.workspaceId)).toBeVisible({ timeout: 30_000 });

      // Switch to status grouping.
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-grouping-status").click();

      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();

      // The idle workspace lands in the Done bucket; the busy mock-agent workspace
      // lands in the Working bucket. Each workspace is bucketed independently.
      await expect(page.getByTestId("sidebar-status-group-done")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-status-group-running")).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toHaveAccessibleName(
        `${idleProject.projectDisplayName}, ${idleProject.workspaceName}`,
      );
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toHaveAccessibleName(
        /Working$/,
      );

      // Only workspace rows are shown — no tab/agent/terminal leaves leak into
      // the status view.
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);

      // Status mode drops the project grouping, so each row leads its subtitle
      // with the project's icon to keep projects distinguishable.
      for (const workspaceId of [idleProject.workspaceId, activeMock.workspaceId]) {
        await expect(
          page.getByTestId(`sidebar-row-project-icon-${getServerId()}:${workspaceId}`).first(),
        ).toBeVisible({ timeout: 60_000 });
      }

      // The busy workspace is grouped under Working, the idle one under Done:
      // changing one workspace's status moved only that row.
      const workingRows = page.getByTestId("sidebar-status-group-rows-running");
      const doneRows = page.getByTestId("sidebar-status-group-rows-done");
      await expect(
        workingRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${idleProject.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });
      // The busy workspace is NOT also sitting in the Done bucket — only its own
      // row moved.
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toHaveCount(0);
    } finally {
      await idleProject.cleanup();
      await activeMock.cleanup();
    }
  });
});
