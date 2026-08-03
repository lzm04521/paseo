import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function paintedSvgRight(locator: Locator): Promise<number> {
  return locator.evaluateAll((svgs) => {
    let right = Number.NEGATIVE_INFINITY;
    for (const element of svgs) {
      const svg = element as SVGSVGElement;
      const svgRect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      if (svgRect.right <= 0 || svgRect.left >= window.innerWidth || viewBox.width === 0) continue;
      const scaleX = svgRect.width / viewBox.width;
      for (const child of svg.querySelectorAll<SVGGraphicsElement>(
        "path, circle, ellipse, line, polyline, polygon, rect",
      )) {
        const box = child.getBBox();
        const strokeWidth = Number.parseFloat(getComputedStyle(child).strokeWidth) || 0;
        const localRight = box.x + box.width + strokeWidth / 2;
        right = Math.max(right, svgRect.left + (localRight - viewBox.x) * scaleX);
      }
    }
    if (!Number.isFinite(right)) throw new Error("SVG has no measurable painted children");
    return right;
  });
}

async function closeMenuSheet(page: Page): Promise<void> {
  const backdrop = page.getByRole("button", { name: "Bottom sheet backdrop" }).first();
  await backdrop.click({ position: { x: 12, y: 12 } });
  await expect(backdrop).not.toBeVisible({ timeout: 10_000 });
}

test("project and workspace kebabs open action sheets on compact layouts", async ({ page }) => {
  const seeded = await seedWorkspace({ repoPrefix: "sidebar-mobile-menu-sheet-" });

  try {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await waitForSidebarHydration(page);

    const closeGlyphRight = await paintedSvgRight(page.getByTestId("sidebar-close").locator("svg"));
    const trailingRail = await paintedSvgRight(
      page.getByTestId("sidebar-display-preferences-menu").locator("svg"),
    );
    expect(closeGlyphRight).toBeCloseTo(trailingRail, 0);

    await page
      .getByTestId(`sidebar-project-kebab-${projectEquivalenceViewKey(seeded.projectKey)}`)
      .click();

    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Project actions", { exact: true })).toBeVisible();
    await closeMenuSheet(page);

    const workspaceRow = page.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`,
    );
    await workspaceRow.hover();
    await workspaceRow
      .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${seeded.workspaceId}`)
      .click();

    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Workspace actions", { exact: true })).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});
