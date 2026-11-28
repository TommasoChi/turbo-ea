/**
 * The Initiative card page (`/cards/<id>`): the Cost & Timeline section with
 * Timeline before Cost, the Completion ring beside the dates and one Total
 * bar, then the Health Summary and Risk Management sections.
 *
 * Read-only tests share one throwaway Initiative made in `beforeAll`; a test
 * that writes makes its own and deletes it. Needs an isolated demo stack
 * (`scripts/e2e/docker-e2e.sh`): it creates cards and a user.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { BASE_URL, STORAGE_STATE, expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";
import {
  Scratch,
  clickChartText,
  contextAs,
  installChartTextProbe,
  lastNumberDrawn,
  precedes,
  requireDisposableStack,
  warmUp,
  type SeededInitiative,
} from "./ppm-support";

const LATEST = {
  summary: "Latest summary E2E",
  accomplishments: "Latest accomplishment E2E",
  next_steps: "Latest next step E2E",
};
const OLDER_SUMMARY = "Older summary E2E";
const JULY_FIRST = /1 Jul 2026|2026-07-01|07\/01\/2026|01\/07\/2026|1\/7\/2026/;

let shared: SeededInitiative;
let sharedScratch: Scratch;
let api: APIRequestContext;

test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  requireDisposableStack();
  api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  sharedScratch = new Scratch(api);
  shared = await sharedScratch.initiative("Card page", {
    budgets: [{ fiscal_year: 2026, category: "capex", description: "Platform", amount: 10000 }],
    costs: [{ budget: 0, description: "Renewal", category: "capex", actual: 4000 }],
    reports: [
      { report_date: "2026-06-01", summary: OLDER_SUMMARY, cost_health: "onTrack" },
      { report_date: "2026-07-01", ...LATEST, schedule_health: "atRisk", cost_health: "offTrack", scope_health: "onTrack" },
    ],
    risks: [
      { title: "E2E high risk", probability: 5, impact: 4, status: "open" },
      { title: "E2E medium risk", probability: 3, impact: 3, status: "mitigating" },
      { title: "E2E low risk", probability: 1, impact: 2, status: "open" },
      { title: "E2E closed risk", probability: 5, impact: 5, status: "closed" },
    ],
  });
  await warmUp(browser, `/cards/${shared.id}`, t("ppm:healthSummary"));
});

test.afterAll(async () => {
  await sharedScratch.dispose();
  await api.dispose();
});

const costTimeline = (page: Page) =>
  page.locator(".MuiAccordion-root").filter({ has: page.getByText("Cost & Timeline", { exact: true }) });
const groupHeading = (section: Locator, name: string) =>
  section.locator(".MuiTypography-subtitle2", { hasText: new RegExp(`^${name}$`) });
const sectionOf = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator("xpath=../..");

async function openCard(page: Page, id: string): Promise<Locator> {
  await gotoApp(page, `/cards/${id}`);
  const section = costTimeline(page);
  const summary = section.getByRole("button", { name: /Cost & Timeline/ }).first();
  await expect(summary).toBeVisible();
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(groupHeading(section, t("ppm:summaryTimeline"))).toBeVisible();
  return section;
}

test("puts the Timeline group before the Cost group", async ({ page }) => {
  const section = await openCard(page, shared.id);
  const timeline = groupHeading(section, t("ppm:summaryTimeline"));
  const cost = groupHeading(section, t("ppm:summaryCost"));
  await expect(cost).toBeVisible();
  expect(await precedes(timeline, cost)).toBe(true);
});

test("lays the sections out as Cost & Timeline, Health Summary, then Risk Management", async ({ page }) => {
  const section = await openCard(page, shared.id);
  const health = page.getByText(t("ppm:healthSummary"), { exact: true });
  const risks = page.getByText(t("ppm:riskManagement"), { exact: true });
  await expect(health).toBeVisible();
  await expect(risks).toBeVisible();
  expect(await precedes(section, health)).toBe(true);
  expect(await precedes(health, risks)).toBe(true);
});

test("shows the Completion ring beside the dates of an Initiative with work packages", async ({ page, demo, request }) => {
  const completion = (await (await request.get(`/api/v1/ppm/initiatives/${demo.migrationId}/completion`)).json()) as {
    completion: number;
    wbs_count: number;
  };
  expect(completion.wbs_count).toBeGreaterThan(0);
  const section = await openCard(page, demo.migrationId);
  const aside = section.locator("[data-group-aside]");
  await expect(aside.getByText(t("ppm:completion"), { exact: true })).toBeVisible();
  const ring = aside.getByRole("progressbar");
  await expect(ring).toHaveAttribute("aria-valuenow", String(Math.round(completion.completion)));
  await expect(aside).toContainText(`${Math.round(completion.completion)}%`);
  // The aside shares a row with the date fields, not a row of its own.
  const timeline = groupHeading(section, t("ppm:summaryTimeline"));
  const asideBox = (await aside.boundingBox())!;
  const headingBox = (await timeline.boundingBox())!;
  const startLabel = section.getByText(/^Start Date/).first();
  const startBox = (await startLabel.boundingBox())!;
  expect(asideBox.y).toBeGreaterThan(headingBox.y);
  expect(asideBox.x).toBeGreaterThan(startBox.x);
  expect(asideBox.y).toBeLessThan(startBox.y + 200);
});

test("says there are no work packages instead of drawing a ring", async ({ page }) => {
  const section = await openCard(page, shared.id);
  const aside = section.locator("[data-group-aside]");
  await expect(aside.getByText(t("ppm:noWbsItems"))).toBeVisible();
  await expect(aside.getByRole("progressbar")).toHaveCount(0);
});

test("shows Budget and Actual Cost side by side", async ({ page }) => {
  const section = await openCard(page, shared.id);
  const budget = section.getByText(/^Budget/).first();
  const actual = section.getByText(/^Actual Cost/).first();
  await expect(budget).toBeVisible();
  await expect(actual).toBeVisible();
  const [a, b] = [(await budget.boundingBox())!, (await actual.boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThan(4);
  expect(b.x).toBeGreaterThan(a.x + 50);
});

test("draws one Total budget bar for the Cost group", async ({ page }) => {
  const section = await openCard(page, shared.id);
  const cost = section.locator(".MuiTypography-subtitle2", { hasText: new RegExp(`^${t("ppm:summaryCost")}$`) }).locator("xpath=../..");
  const bars = cost.getByRole("progressbar");
  await expect(bars).toHaveCount(1);
  await expect(cost.getByText(t("ppm:budgetBarTotal"), { exact: true })).toBeVisible();
  await expect(bars).toHaveAttribute("aria-valuenow", "40");
  await expect(cost.getByText("(40%)")).toBeVisible();
  await expect(cost.getByText(t("ppm:capex"), { exact: true })).toHaveCount(0);
  await expect(cost.getByText(t("ppm:opex"), { exact: true })).toHaveCount(0);
});

test("offers Manage on Timeline, Budget & Costs, Health Summary and Risk Management to an admin", async ({ page }) => {
  await openCard(page, shared.id);
  for (const name of [
    t("ppm:manageSection", { section: t("ppm:summaryTimeline") }),
    t("ppm:manageSection", { section: t("ppm:budgetAndCosts") }),
    t("ppm:manageSection", { section: t("ppm:healthSummary") }),
    t("ppm:riskSummaryManage"),
  ]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
});

test("shows the latest report in the Health Summary: date, dots and three texts", async ({ page }) => {
  await openCard(page, shared.id);
  const health = sectionOf(page, t("ppm:healthSummary"));
  await expect(health.getByText(JULY_FIRST)).toBeVisible();
  for (const text of Object.values(LATEST)) await expect(health.getByText(text)).toBeVisible();
  await expect(health.getByText(OLDER_SUMMARY)).toHaveCount(0);
  await expect(health.getByTestId("health-dot")).toHaveCount(3);
  for (const label of ["health_schedule", "health_cost", "health_scope"]) {
    await expect(health.getByText(t(`ppm:${label}`), { exact: true })).toBeVisible();
  }
});

test("opens the status report editor from Health Summary Manage with a counter on each text", async ({ page }) => {
  await openCard(page, shared.id);
  await page.getByRole("button", { name: t("ppm:manageSection", { section: t("ppm:healthSummary") }) }).click();
  const dialog = page.getByRole("dialog", { name: t("ppm:addReport") });
  await expect(dialog).toBeVisible();
  for (const key of ["summary", "accomplishments", "nextSteps"]) {
    const counted = t("ppm:statusReportCounter", { label: t(`ppm:${key}`), count: 0, limit: 250 });
    await expect(dialog.getByRole("textbox", { name: counted })).toBeVisible();
  }
});

test("refuses a status text past 250 characters and accepts exactly 250", async ({ page }) => {
  await openCard(page, shared.id);
  await page.getByRole("button", { name: t("ppm:manageSection", { section: t("ppm:healthSummary") }) }).click();
  const dialog = page.getByRole("dialog", { name: t("ppm:addReport") });
  const save = dialog.getByRole("button", { name: t("ppm:addReport") });
  await dialog.getByRole("textbox", { name: /^Summary/ }).fill("x".repeat(250));
  await expect(dialog.getByRole("textbox", { name: t("ppm:statusReportCounter", { label: t("ppm:summary"), count: 250, limit: 250 }) })).toBeVisible();
  await expect(dialog.getByText(t("ppm:statusReportTooLong", { limit: 250 }))).toHaveCount(0);
  await expect(save).toBeEnabled();
  await dialog.getByRole("textbox", { name: /^Summary/ }).fill("x".repeat(251));
  await expect(dialog.getByRole("textbox", { name: t("ppm:statusReportCounter", { label: t("ppm:summary"), count: 251, limit: 250 }) })).toBeVisible();
  await expect(dialog.getByText(t("ppm:statusReportTooLong", { limit: 250 }))).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: t("common:actions.cancel") }).click();
  await expect(dialog).toBeHidden();
});

test("saves a status report from the card page and shows it as the latest", async ({ page, request }) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Report save", {
      reports: [{ report_date: "2026-01-01", summary: "Seed report E2E" }],
    });
    await openCard(page, own.id);
    const health = sectionOf(page, t("ppm:healthSummary"));
    await expect(health.getByText("Seed report E2E")).toBeVisible();
    await page.getByRole("button", { name: t("ppm:manageSection", { section: t("ppm:healthSummary") }) }).click();
    const dialog = page.getByRole("dialog", { name: t("ppm:addReport") });
    await dialog.getByRole("textbox", { name: /^Summary/ }).fill("Fresh summary E2E");
    await dialog.getByRole("button", { name: t("ppm:addReport") }).click();
    await expect(dialog).toBeHidden();
    await expect(health.getByText("Fresh summary E2E")).toBeVisible();
    await expect(health.getByText("Seed report E2E")).toHaveCount(0);
  } finally {
    await scratch.dispose();
  }
});

test("summarises the risks in three tiles", async ({ page }) => {
  await openCard(page, shared.id);
  const risks = sectionOf(page, t("ppm:riskManagement"));
  for (const [label, value] of [
    [t("ppm:riskSummaryTotal"), "4"],
    [t("ppm:riskSummaryOpen"), "3"],
    [t("ppm:riskSummaryHighOpen"), "1"],
  ]) {
    const tile = risks.locator(".MuiPaper-root").filter({ has: page.getByText(label, { exact: true }) });
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText(value);
  }
});

test("changes the donut's centre total when a legend entry is toggled", async ({ page }) => {
  await installChartTextProbe(page);
  await openCard(page, shared.id);
  const title = t("ppm:riskSummaryExposure");
  const donut = page.getByRole("img", { name: title });
  await expect(donut).toBeVisible();
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("3");
  await clickChartText(page, donut, title, t("ppm:riskGridBandHigh"));
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("2");
  await clickChartText(page, donut, title, t("ppm:riskGridBandMedium"));
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("1");
  await clickChartText(page, donut, title, t("ppm:riskGridBandHigh"));
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("2");
});

test("marks each active risk on the heat map and leaves the closed one off", async ({ page }) => {
  await openCard(page, shared.id);
  const map = page.getByRole("group", { name: t("ppm:riskSummaryHeatMap") });
  await expect(map).toBeVisible();
  for (const [p, i] of [["5", "4"], ["3", "3"], ["1", "2"]]) {
    await expect(map.locator(`[data-row="${p}"][data-col="${i}"]`)).toHaveText("1");
  }
  await expect(map.locator('[data-row="5"][data-col="5"]')).not.toHaveText("1");
});

test("opens the Manage popup on the Risks tab with the initiative's risks", async ({ page }) => {
  await openCard(page, shared.id);
  await page.getByRole("button", { name: t("ppm:riskSummaryManage") }).click();
  const dialog = page.getByRole("dialog", { name: t("ppm:riskManagement") });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("E2E high risk")).toBeVisible();
  await dialog.getByRole("button", { name: t("common:actions.close"), exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("hides every Manage button from a reader without ppm.manage", async ({ browser, request }) => {
  const scratch = new Scratch(request);
  try {
    const reader = await scratch.user("viewer");
    const context = await contextAs(browser, reader);
    try {
      const page = await context.newPage();
      await gotoApp(page, `/cards/${shared.id}`);
      await expect(page.getByText(t("ppm:healthSummary"), { exact: true })).toBeVisible();
      await expect(page.getByText(t("ppm:riskManagement"), { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: t("ppm:riskSummaryManage") })).toHaveCount(0);
      await expect(page.getByRole("button", { name: new RegExp(`^${t("ppm:manageSection", { section: "" }).trim()}`) })).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await scratch.dispose();
  }
});
