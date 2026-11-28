/**
 * The PPM project Overview (`/ppm/<id>`): Description, Timeline with its
 * Completion ring, Health Summary, Risk Management and Financials, and the
 * back arrow to the portfolio.
 *
 * Read-only tests share one throwaway Initiative made in `beforeAll`; a test
 * that writes makes its own. Needs an isolated demo stack
 * (`scripts/e2e/docker-e2e.sh`): it creates cards and a user.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import { BASE_URL, expect, gotoApp, STORAGE_STATE, test } from "./fixtures";
import { t } from "./i18n";
import {
  clickChartText,
  contextAs,
  installChartTextProbe,
  lastNumberDrawn,
  precedes,
  requireDisposableStack,
  Scratch,
  type SeededInitiative,
  warmUp,
} from "./ppm-support";

const DESCRIPTION = "Overview description E2E";
const LATEST = {
  summary: "Overview latest summary E2E",
  accomplishments: "Overview latest accomplishment E2E",
  next_steps: "Overview latest next step E2E",
};
const JULY_FIRST = /1 Jul 2026|2026-07-01|07\/01\/2026|01\/07\/2026|1\/7\/2026/;

let shared: SeededInitiative;
let sharedScratch: Scratch;
let api: APIRequestContext;

test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  requireDisposableStack();
  api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  sharedScratch = new Scratch(api);
  shared = await sharedScratch.initiative("Overview", {
    description: DESCRIPTION,
    budgets: [{ fiscal_year: 2026, category: "capex", description: "Platform", amount: 10000 }],
    costs: [{ budget: 0, description: "Renewal", category: "capex", actual: 4000 }],
    reports: [
      { report_date: "2026-06-01", summary: "Overview older summary E2E" },
      { report_date: "2026-07-01", ...LATEST },
    ],
    risks: [
      { title: "Overview high risk", probability: 5, impact: 4, status: "open" },
      { title: "Overview medium risk", probability: 3, impact: 3, status: "mitigating" },
      { title: "Overview low risk", probability: 1, impact: 2, status: "open" },
      { title: "Overview closed risk", probability: 5, impact: 5, status: "closed" },
    ],
  });
  await warmUp(browser, `/ppm/${shared.id}`, t("ppm:healthSummary"));
});

test.afterAll(async () => {
  await sharedScratch.dispose();
  await api.dispose();
});

/** A section's heading: the Typography, never the tab of the same name. */
const heading = (page: Page, title: string) =>
  page.locator(".MuiTypography-subtitle1").filter({ hasText: new RegExp(`^${title}$`) });

/** The Paper that holds the heading `title`. */
const panel = (page: Page, title: string) =>
  heading(page, title).locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' MuiPaper-root ')][1]",
  );

async function openOverview(page: Page, id: string) {
  await gotoApp(page, `/ppm/${id}`);
  await expect(heading(page, t("ppm:healthSummary"))).toBeVisible();
}

const headings = (page: Page) =>
  [
    t("common:labels.description"),
    t("ppm:timeline"),
    t("ppm:healthSummary"),
    t("ppm:riskManagement"),
    t("ppm:financials"),
  ].map((title) => heading(page, title));

test("stacks Description, Timeline, Health Summary, Risk Management and Financials in that order", async ({
  page,
}) => {
  await openOverview(page, shared.id);
  const all = headings(page);
  for (const heading of all) await expect(heading).toBeVisible();
  for (let i = 0; i < all.length - 1; i++) expect(await precedes(all[i], all[i + 1])).toBe(true);
});

test("renders the five headings in one style", async ({ page }) => {
  await openOverview(page, shared.id);
  const styles = await Promise.all(
    headings(page).map((heading) =>
      heading.evaluate((el) => {
        const css = getComputedStyle(el);
        return `${css.fontSize}/${css.fontWeight}`;
      }),
    ),
  );
  expect(new Set(styles).size).toBe(1);
  expect(styles[0].endsWith("/600")).toBe(true);
});

test("shows the description", async ({ page }) => {
  await openOverview(page, shared.id);
  await expect(panel(page, t("common:labels.description"))).toContainText(DESCRIPTION);
});

test("draws the Completion ring inside the Timeline panel for an Initiative with work packages", async ({
  page,
  demo,
  request,
}) => {
  const completion = (await (
    await request.get(`/api/v1/ppm/initiatives/${demo.migrationId}/completion`)
  ).json()) as {
    completion: number;
  };
  await openOverview(page, demo.migrationId);
  const timeline = panel(page, t("ppm:timeline"));
  await expect(timeline.getByText(t("ppm:completion"), { exact: true })).toBeVisible();
  await expect(timeline.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(completion.completion)),
  );
  await expect(timeline).toContainText(t("ppm:completionDesc"));
});

test("says there are no work packages when the Initiative has none", async ({ page }) => {
  await openOverview(page, shared.id);
  const timeline = panel(page, t("ppm:timeline"));
  await expect(timeline.getByText(t("ppm:noWbsItems"))).toBeVisible();
  await expect(timeline.getByRole("progressbar")).toHaveCount(0);
});

test("shows the latest status report in the Health Summary", async ({ page }) => {
  await openOverview(page, shared.id);
  const health = panel(page, t("ppm:healthSummary"));
  await expect(health.getByText(JULY_FIRST)).toBeVisible();
  for (const text of Object.values(LATEST)) await expect(health.getByText(text)).toBeVisible();
  await expect(health.getByText("Overview older summary E2E")).toHaveCount(0);
  await expect(health.getByTestId("health-dot")).toHaveCount(3);
});

test("opens the status report editor from Health Summary Manage and refuses 251 characters", async ({
  page,
}) => {
  await openOverview(page, shared.id);
  await panel(page, t("ppm:healthSummary"))
    .getByRole("button", { name: t("ppm:manageSection", { section: t("ppm:healthSummary") }) })
    .click();
  const dialog = page.getByRole("dialog", { name: t("ppm:addReport") });
  const summary = dialog.getByRole("textbox", { name: /^Summary/ });
  await expect(
    dialog.getByRole("textbox", {
      name: t("ppm:statusReportCounter", { label: t("ppm:summary"), count: 0, limit: 250 }),
    }),
  ).toBeVisible();
  await summary.fill("y".repeat(251));
  await expect(
    dialog.getByRole("textbox", {
      name: t("ppm:statusReportCounter", { label: t("ppm:summary"), count: 251, limit: 250 }),
    }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: t("ppm:addReport") })).toBeDisabled();
  await summary.fill("y".repeat(250));
  await expect(dialog.getByRole("button", { name: t("ppm:addReport") })).toBeEnabled();
  await dialog.getByRole("button", { name: t("common:actions.cancel") }).click();
  await expect(dialog).toBeHidden();
});

test("saves a status report from the Overview and shows it as the latest", async ({
  page,
  request,
}) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Overview save", {
      reports: [{ report_date: "2026-01-01", summary: "Overview seed report E2E" }],
    });
    await openOverview(page, own.id);
    const health = panel(page, t("ppm:healthSummary"));
    await expect(health.getByText("Overview seed report E2E")).toBeVisible();
    await health
      .getByRole("button", { name: t("ppm:manageSection", { section: t("ppm:healthSummary") }) })
      .click();
    const dialog = page.getByRole("dialog", { name: t("ppm:addReport") });
    await dialog.getByRole("textbox", { name: /^Summary/ }).fill("Overview fresh summary E2E");
    await dialog.getByRole("button", { name: t("ppm:addReport") }).click();
    await expect(dialog).toBeHidden();
    await expect(health.getByText("Overview fresh summary E2E")).toBeVisible();
  } finally {
    await scratch.dispose();
  }
});

test("shows the risk tiles and the three charts", async ({ page }) => {
  await openOverview(page, shared.id);
  const risks = panel(page, t("ppm:riskManagement"));
  for (const [label, value] of [
    [t("ppm:riskSummaryTotal"), "4"],
    [t("ppm:riskSummaryOpen"), "3"],
    [t("ppm:riskSummaryHighOpen"), "1"],
  ]) {
    await expect(
      risks.locator(".MuiPaper-root").filter({ has: page.getByText(label, { exact: true }) }),
    ).toContainText(value);
  }
  await expect(risks.getByRole("img", { name: t("ppm:riskSummaryExposure") })).toBeVisible();
  await expect(risks.getByRole("img", { name: t("ppm:riskSummaryStatus") })).toBeVisible();
  await expect(risks.getByRole("group", { name: t("ppm:riskSummaryHeatMap") })).toBeVisible();
});

test("changes the donut's centre total when a legend entry is toggled", async ({ page }) => {
  await installChartTextProbe(page);
  await openOverview(page, shared.id);
  const title = t("ppm:riskSummaryExposure");
  const donut = page.getByRole("img", { name: title });
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("3");
  await clickChartText(page, donut, title, t("ppm:riskGridBandMedium"));
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("2");
  await clickChartText(page, donut, title, t("ppm:riskGridBandMedium"));
  await expect.poll(() => lastNumberDrawn(page, title)).toBe("3");
});

test("opens the Manage popup on the Risks tab from Risk Management", async ({ page }) => {
  await openOverview(page, shared.id);
  await panel(page, t("ppm:riskManagement"))
    .getByRole("button", { name: t("ppm:riskSummaryManage") })
    .click();
  const dialog = page.getByRole("dialog", { name: t("ppm:riskManagement") });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Overview high risk")).toBeVisible();
  await dialog.getByRole("button", { name: t("common:actions.close"), exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("lists a risk added since the page loaded when the Manage popup opens", async ({
  page,
  request,
}) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Overview risk", {
      risks: [{ title: "Overview only risk", probability: 2, impact: 2, status: "open" }],
    });
    await openOverview(page, own.id);
    const risks = panel(page, t("ppm:riskManagement"));
    const total = risks
      .locator(".MuiPaper-root")
      .filter({ has: page.getByText(t("ppm:riskSummaryTotal"), { exact: true }) });
    await expect(total).toContainText("1");
    const created = await request.post(`/api/v1/ppm/initiatives/${own.id}/risks`, {
      data: { title: "Overview added risk", probability: 4, impact: 4, status: "open" },
    });
    expect(created.ok()).toBeTruthy();
    await risks.getByRole("button", { name: t("ppm:riskSummaryManage") }).click();
    const dialog = page.getByRole("dialog", { name: t("ppm:riskManagement") });
    await expect(dialog.getByText("Overview added risk")).toBeVisible();
    await dialog.getByRole("button", { name: t("common:actions.close"), exact: true }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await scratch.dispose();
  }
});

test("shows Financials: three KPIs and the Total, CapEx and OpEx bars", async ({ page }) => {
  await openOverview(page, shared.id);
  const financials = panel(page, t("ppm:financials"));
  await expect(financials.getByText(t("ppm:totalBudget"), { exact: true })).toBeVisible();
  await expect(financials.getByText(t("ppm:totalActual"), { exact: true })).toBeVisible();
  await expect(financials.getByText(t("ppm:variance"), { exact: true })).toBeVisible();
  await expect(financials).toContainText(/10\s?k|10[,.]000/);
  const bars = financials.getByRole("progressbar");
  await expect(bars).toHaveCount(3);
  await expect(bars.first()).toHaveAttribute("aria-valuenow", "40");
  await expect(financials.getByText(t("ppm:budgetBarTotal"), { exact: true })).toBeVisible();
});

test("goes back to the portfolio tab with the back arrow", async ({ page }) => {
  await openOverview(page, shared.id);
  await page.getByRole("button").filter({ hasText: "arrow_back" }).first().click();
  await expect(page).toHaveURL(/\/ppm\?tab=portfolio$/);
});

test("shows a reader the sections but no Manage buttons", async ({ browser, request }) => {
  const scratch = new Scratch(request);
  try {
    const reader = await scratch.user("viewer");
    const context = await contextAs(browser, reader);
    try {
      const page = await context.newPage();
      await openOverview(page, shared.id);
      await expect(heading(page, t("ppm:riskManagement"))).toBeVisible();
      await expect(page.getByRole("button", { name: t("ppm:riskSummaryManage") })).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: t("ppm:manageSection", { section: t("ppm:healthSummary") }),
        }),
      ).toHaveCount(0);
      const perms = await context.request.get(`/api/v1/cards/${shared.id}/my-permissions`);
      const { can_view_costs } = (await perms.json()) as { can_view_costs: boolean };
      // The Financials panel follows the card's cost visibility: absent, never zeroed.
      await expect(heading(page, t("ppm:financials"))).toHaveCount(can_view_costs ? 1 : 0);
    } finally {
      await context.close();
    }
  } finally {
    await scratch.dispose();
  }
});
