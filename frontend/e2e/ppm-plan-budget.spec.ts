/**
 * The Plan Budget table of the Budget & Costs tab (`/ppm/<id>?tab=cost`,
 * `PpmFinanceTree`): Item, FY, Category, Provider, Planned Budget, Cost Items,
 * Remaining Budget, Invoiced and Remaining to invoice; create, edit and delete
 * only (no move, no assign); no "Initiative total invoiced" line.
 *
 * Read-only tests share one throwaway Initiative made in `beforeAll`; a test
 * that writes makes its own (the Provider test also restores the PML
 * financial-field settings). Needs an isolated demo stack
 * (`scripts/e2e/docker-e2e.sh`).
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { BASE_URL, STORAGE_STATE, expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";
import { Scratch, contextAs, json, requireDisposableStack, warmUp, type SeededInitiative } from "./ppm-support";

let shared: SeededInitiative;
let sharedScratch: Scratch;
let api: APIRequestContext;

test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  requireDisposableStack();
  api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  sharedScratch = new Scratch(api);
  shared = await sharedScratch.initiative("Plan budget", {
    budgets: [
      { fiscal_year: 2026, category: "capex", description: "Platform", amount: 12000 },
      { fiscal_year: 2026, category: "opex", description: "Licences", amount: 3000 },
      { fiscal_year: 2025, category: "capex", description: "Old build", amount: 5000 },
    ],
    costs: [
      { budget: 0, description: "Renewal", category: "capex", actual: 8000 },
      { budget: 0, description: "Support", category: "opex", actual: 2000 },
      { budget: 1, description: "Licence fee", category: "opex", actual: 1000 },
    ],
  });
  await warmUp(browser, `/ppm/${shared.id}?tab=cost`, t("ppm:plannedBudget"));
});

test.afterAll(async () => {
  await sharedScratch.dispose();
  await api.dispose();
});

const tree = (page: Page) => page.getByRole("region", { name: t("ppm:financeTree.item") });
const budgetRow = (page: Page, name: string) =>
  tree(page)
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: t("ppm:financeTree.editBudget", { name }) }) });
const costRow = (page: Page, name: string) =>
  tree(page)
    .getByRole("table", { name: t("ppm:costItems") })
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: t("ppm:financeTree.editCost", { name }) }) });
const expandBudget = (page: Page, name: string) =>
  tree(page).getByRole("button", { name: t("ppm:financeTree.expand", { name }) }).click();
// Not glued to another digit or separator: 2000 must not match "12,000".
const amountOf = (n: number) =>
  new RegExp("(?<![\\d.,])" + String(n).replace(/(\d)(?=(\d{3})+$)/, "$1[,. \\u00a0]?") + "(?!\\d)");

async function openPlan(page: Page, id: string) {
  await gotoApp(page, `/ppm/${id}?tab=cost`);
  await expect(tree(page)).toBeVisible();
}

const cells = (row: Locator) => row.getByRole("cell");

test("lists the nine columns in order and one blank column for actions", async ({ page }) => {
  await openPlan(page, shared.id);
  await expect(tree(page).locator("thead").first().getByRole("columnheader")).toHaveText([
    t("ppm:financeTree.item"),
    t("ppm:financeTree.colFiscalYear"),
    t("ppm:financeTree.colCategory"),
    t("ppm:financeTree.colProvider"),
    t("ppm:plannedBudget"),
    t("ppm:costItems"),
    t("ppm:financeTree.remainingBudget"),
    t("ppm:financeTree.invoiced"),
    t("ppm:financeTree.remaining"),
    "",
  ]);
});

test("shows fiscal year and category in their own cells of a budget row", async ({ page }) => {
  await openPlan(page, shared.id);
  const row = budgetRow(page, "Platform");
  await expect(cells(row).nth(0)).toContainText("Platform");
  await expect(cells(row).nth(1)).toContainText("2026");
  await expect(cells(row).nth(2)).toHaveText("CAPEX");
  await expect(cells(budgetRow(page, "Licences")).nth(2)).toHaveText("OPEX");
  await expect(cells(budgetRow(page, "Old build")).nth(1)).toContainText("2025");
});

test("shows planned budget, cost items and remaining budget per row", async ({ page }) => {
  await openPlan(page, shared.id);
  const row = budgetRow(page, "Platform");
  await expect(cells(row).nth(4)).toContainText(amountOf(12000));
  await expect(cells(row).nth(5)).toContainText(amountOf(10000));
  await expect(cells(row).nth(6)).toContainText(amountOf(2000));
  const licences = budgetRow(page, "Licences");
  await expect(cells(licences).nth(4)).toContainText(amountOf(3000));
  await expect(cells(licences).nth(6)).toContainText(amountOf(2000));
});

test("adds a subtotal per fiscal year and category and a grand total", async ({ page }) => {
  await openPlan(page, shared.id);
  const subtotal = tree(page).getByRole("row").filter({ hasText: /2026\s*·\s*CAPEX/ });
  await expect(subtotal).toHaveCount(1);
  await expect(subtotal).toContainText(amountOf(12000));
  const total = tree(page).getByRole("row").filter({ has: page.getByText(t("ppm:financeTree.total"), { exact: true }) });
  await expect(total).toHaveCount(1);
  await expect(total).toContainText(amountOf(20000));
});

test("leaves the Provider cell empty when no Provider is configured", async ({ page }) => {
  await openPlan(page, shared.id);
  await expect(cells(budgetRow(page, "Platform")).nth(3)).toHaveText("");
});

test("shows the Provider's name in the Provider cell once a Provider is configured", async ({ page, request }) => {
  const scratch = new Scratch(request);
  const settings = "/api/v1/settings/pml/financial-fields";
  const configs = await json<Record<"budget" | "cost_item", { fields: Record<string, unknown>[] }>>(await request.get(settings));
  let budgetChanged = false;
  let costChanged = false;
  try {
    const provider = await scratch.card("Provider", "E2E Plan Provider");
    const originKey = "e2eOrigin" + provider.replaceAll("-", "");
    budgetChanged = true;
    await json(
      await request.put(`${settings}/budget`, {
        data: {
          ...configs.budget,
          fields: [...configs.budget.fields, { key: originKey, label: "E2E Provider", kind: "card_reference", card_type: "Provider" }],
        },
      }),
    );
    costChanged = true;
    await json(
      await request.put(`${settings}/cost_item`, {
        data: { ...configs.cost_item, provider_source: { budget_field_key: originKey, allow_child_selection: false } },
      }),
    );
    const own = await scratch.initiative("Plan provider", {});
    await json(
      await request.post(`/api/v1/ppm/initiatives/${own.id}/budgets`, {
        data: { fiscal_year: 2026, category: "capex", description: "Hosted", amount: 900, field_values: { [originKey]: provider } },
      }),
    );
    await openPlan(page, own.id);
    await expect(cells(budgetRow(page, "Hosted")).nth(3)).toHaveText("E2E Plan Provider");
    await expect(tree(page).getByText("E2E Provider", { exact: true })).toHaveCount(0);
  } finally {
    try {
      if (costChanged) await json(await request.put(`${settings}/cost_item`, { data: configs.cost_item }));
    } finally {
      try {
        // the budget field is populated until the scratch cards are gone, and the API refuses to drop a populated field
        await scratch.dispose();
      } finally {
        if (budgetChanged) await json(await request.put(`${settings}/budget`, { data: configs.budget }));
      }
    }
  }
});

test("has no Initiative total invoiced line", async ({ page }) => {
  await openPlan(page, shared.id);
  await expect(page.getByText(/initiative total invoiced/i)).toHaveCount(0);
});

test("offers only add cost, edit and delete on a budget row, never a move", async ({ page }) => {
  await openPlan(page, shared.id);
  const row = budgetRow(page, "Platform");
  const actions = cells(row).last().getByRole("button");
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0)).toHaveAccessibleName(t("ppm:financeTree.addCost", { name: "Platform" }));
  await expect(actions.nth(1)).toHaveAccessibleName(t("ppm:financeTree.editBudget", { name: "Platform" }));
  await expect(actions.nth(2)).toHaveAccessibleName(t("ppm:financeTree.deleteBudget", { name: "Platform" }));
  await expect(page.getByRole("button", { name: /move|assign/i })).toHaveCount(0);
  await expect(tree(page).getByText("drive_file_move")).toHaveCount(0);
});

test("lists a budget's Cost Items with edit, invoice and delete but no move or assign", async ({ page }) => {
  await openPlan(page, shared.id);
  await expandBudget(page, "Platform");
  const renewal = costRow(page, "Renewal");
  await expect(renewal).toBeVisible();
  await expect(costRow(page, "Support")).toBeVisible();
  await expect(renewal.getByRole("button", { name: t("ppm:financeTree.recordInvoice", { name: "Renewal" }) })).toBeVisible();
  await expect(renewal.getByRole("button", { name: t("ppm:financeTree.deleteCost", { name: "Renewal" }) })).toBeVisible();
  await expect(renewal.getByRole("button", { name: /move|assign/i })).toHaveCount(0);
  await expect(renewal.getByText("drive_file_move")).toHaveCount(0);
});

test("creates a budget line from Add Budget Line", async ({ page, request }) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Plan create", {});
    await openPlan(page, own.id);
    await page.getByRole("button", { name: t("ppm:addBudgetLine") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("common:labels.description")).fill("Created in the table");
    await dialog.getByLabel(t("ppm:financialForm.amount")).fill("7000");
    await dialog.getByRole("button", { name: t("common:actions.save") }).click();
    await expect(dialog).toBeHidden();
    const row = budgetRow(page, "Created in the table");
    await expect(row).toBeVisible();
    await expect(cells(row).nth(4)).toContainText(amountOf(7000));
  } finally {
    await scratch.dispose();
  }
});

test("edits a budget line's amount and refreshes its remaining budget", async ({ page, request }) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Plan edit", {
      budgets: [{ fiscal_year: 2026, category: "capex", description: "Editable", amount: 1000 }],
      costs: [{ budget: 0, description: "Spend", category: "capex", actual: 400 }],
    });
    await openPlan(page, own.id);
    await expect(cells(budgetRow(page, "Editable")).nth(6)).toContainText(amountOf(600));
    await budgetRow(page, "Editable").getByRole("button", { name: t("ppm:financeTree.editBudget", { name: "Editable" }) }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("ppm:financialForm.amount")).fill("2500");
    await dialog.getByRole("button", { name: t("common:actions.save") }).click();
    await expect(dialog).toBeHidden();
    await expect(cells(budgetRow(page, "Editable")).nth(4)).toContainText(amountOf(2500));
    await expect(cells(budgetRow(page, "Editable")).nth(6)).toContainText(amountOf(2100));
  } finally {
    await scratch.dispose();
  }
});

test("deletes a budget line after confirming", async ({ page, request }) => {
  const scratch = new Scratch(request);
  try {
    const own = await scratch.initiative("Plan delete", {
      budgets: [{ fiscal_year: 2026, category: "opex", description: "Doomed", amount: 100 }],
    });
    await openPlan(page, own.id);
    await budgetRow(page, "Doomed").getByRole("button", { name: t("ppm:financeTree.deleteBudget", { name: "Doomed" }) }).click();
    const confirm = page.getByRole("dialog", { name: t("ppm:financeTree.deleteTitle") });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: t("common:actions.delete") }).click();
    await expect(confirm).toBeHidden();
    await expect(budgetRow(page, "Doomed")).toHaveCount(0);
    await expect(page.getByText(t("ppm:financeTree.noBudgets"))).toBeVisible();
  } finally {
    await scratch.dispose();
  }
});

test("offers a reader no Add Budget Line and no row actions", async ({ browser, request }) => {
  const scratch = new Scratch(request);
  try {
    const reader = await scratch.user("viewer");
    const context = await contextAs(browser, reader);
    try {
      const page = await context.newPage();
      await gotoApp(page, `/ppm/${shared.id}?tab=cost`);
      await expect(page.getByRole("tab").first()).toBeVisible();
      const perms = await context.request.get(`/api/v1/cards/${shared.id}/my-permissions`);
      const { effective } = (await perms.json()) as { effective: { can_view_costs: boolean } };
      // Only admins hold costs.view among the built-in roles: the viewer must not see the tab.
      expect(effective.can_view_costs, "the viewer has no cost visibility").toBe(false);
      await expect(tree(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: t("ppm:addBudgetLine") })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Edit|Delete) budget /i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await scratch.dispose();
  }
});

test("prints the same columns without any action in the project report", async ({ page }) => {
  await gotoApp(page, `/ppm/${shared.id}/report`);
  const heading = page.getByText(t("ppm:plannedBudget"), { exact: true }).first();
  await expect(heading).toBeVisible();
  const region = page.getByRole("region", { name: t("ppm:financeTree.item") });
  await expect(region.locator("thead").first().getByRole("columnheader")).toHaveText([
    t("ppm:financeTree.item"),
    t("ppm:financeTree.colFiscalYear"),
    t("ppm:financeTree.colCategory"),
    t("ppm:financeTree.colProvider"),
    t("ppm:plannedBudget"),
    t("ppm:costItems"),
    t("ppm:financeTree.remainingBudget"),
    t("ppm:financeTree.invoiced"),
    t("ppm:financeTree.remaining"),
  ]);
  await expect(region.getByRole("button")).toHaveCount(0);
});
