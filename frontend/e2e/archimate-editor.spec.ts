/**
 * The ArchiMate sandbox and editor (diagram-js): with the module enabled through the API, an admin
 * creates a diagram on /admin/architectureStudio, opens it, drops a Business Actor from the palette with the
 * keyboard, names it, sees the autosave land, reloads and finds the element again, then deletes the
 * diagram through the UI. The module flag is put back and the diagram removed by `afterAll`, even
 * when the spec fails half way.
 */
import { expect, gotoApp, test, BASE_URL, STORAGE_STATE } from "./fixtures";
import { t } from "./i18n";

test.describe.configure({ mode: "serial" });

test.describe("ArchiMate editor", () => {
  let wasEnabled = false;
  let diagramId: string | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
    const current = await api.get("/api/v1/settings/archimate-enabled");
    expect(current.ok(), `GET /settings/archimate-enabled answered ${current.status()}`).toBeTruthy();
    wasEnabled = ((await current.json()) as { enabled: boolean }).enabled;
    const enabled = await api.patch("/api/v1/settings/archimate-enabled", { data: { enabled: true } });
    expect(enabled.ok(), `PATCH /settings/archimate-enabled answered ${enabled.status()}`).toBeTruthy();
    await api.dispose();
  });

  test.beforeEach(({ page }) => {
    // The editor's beforeunload guard fires while a change is pending.
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  });

  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
    // Already gone when the spec reached its last step; a 404 here is fine.
    if (diagramId) await api.delete(`/api/v1/diagrams/${diagramId}`);
    await api.patch("/api/v1/settings/archimate-enabled", { data: { enabled: wasEnabled } });
    await api.dispose();
  });

  test("creates a diagram, drops a Business Actor, saves, reloads and deletes it", async ({ page }) => {
    const name = `E2E ArchiMate ${Date.now().toString(36)}`;
    const actorName = `Customer ${Date.now().toString(36)}`;

    await gotoApp(page, "/admin/architectureStudio");
    await expect(page.getByRole("heading", { name: t("archimate:sandbox.title") })).toBeVisible();
    await expect(page.getByText(t("archimate:trademark"))).toBeVisible();

    // Create: name the diagram, pick a Viewpoint that allows a Business Actor
    // ("Organization"), then start from its blank card.
    await page.getByRole("button", { name: t("archimate:sandbox.newDiagram") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("archimate:sandbox.name")).fill(name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Organization", exact: true }).click();
    await dialog.getByText(t("diagrams:archimatePicker.blank")).click();
    await page.waitForURL(/\/admin\/architectureStudio\/[^/]+$/);
    diagramId = page.url().split("/").pop() ?? null;
    expect(diagramId, "the id in the editor URL").toBeTruthy();

    // Drop a Business Actor from the palette with the keyboard (Enter on the focused entry), name it
    // in the label box that opens, and confirm with Enter.
    await expect(page.locator(".djs-container")).toBeVisible();
    await expect(page.locator(".djs-palette")).toBeVisible();
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/diagrams/${diagramId}`) &&
        r.request().method() === "PATCH" &&
        (r.request().postData() ?? "").includes(actorName),
      { timeout: 30_000 },
    );
    await page.locator('.archimate-palette-entry[data-archimate-type="BusinessActor"]').press("Enter");
    const labelBox = page.locator(".djs-direct-editing-content");
    await expect(labelBox).toBeVisible();
    await page.keyboard.type(actorName);
    await page.keyboard.press("Enter");
    await expect(page.locator(".archimate-name", { hasText: actorName })).toBeVisible();

    // The autosave PATCHes the Exchange XML, then the toolbar reads Saved.
    const response = await saved;
    expect(response.ok(), `PATCH /diagrams answered ${response.status()}`).toBeTruthy();
    await expect(page.getByRole("status").filter({ hasText: t("archimate:status.saved") })).toBeVisible();

    // The element survives a reload (it was read back from the server).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".archimate-name", { hasText: actorName })).toBeVisible();

    // Back to the list, then delete through the confirm dialog.
    await page.getByRole("button", { name: t("archimate:toolbar.back") }).click();
    await page.waitForURL(/\/admin\/architectureStudio$/);
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: t("archimate:sandbox.delete") }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t("archimate:sandbox.delete") })
      .click();
    await expect(page.getByText(t("archimate:sandbox.deleted"))).toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
