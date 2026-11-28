/**
 * Helpers shared by the three Initiative-pages specs (`initiative-card-page`,
 * `ppm-overview`, `ppm-plan-budget`): API seeding of a throwaway Initiative,
 * a throwaway reader account, and a probe for the text an ECharts canvas draws
 * (the donut's centre total lives in a canvas, so the DOM cannot be read).
 *
 * Every write goes through the admin session and is undone by `Scratch.dispose`.
 */
import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

import { isDisposableTarget } from "../scripts/disposable-target";
import { BASE_URL, STORAGE_STATE } from "./fixtures";

export async function json<T>(response: APIResponse): Promise<T> {
  expect(
    response.ok(),
    `API ${response.url()} answered ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as T;
}

/** The suite writes data: only an isolated stack may run it. */
export function requireDisposableStack(): void {
  const { ok, reason } = isDisposableTarget(process.env);
  expect(ok, reason).toBe(true);
}

export const apiBase = (initiativeId: string) => `/api/v1/ppm/initiatives/${initiativeId}`;

export interface RiskSeed {
  title: string;
  probability: number;
  impact: number;
  status?: "open" | "mitigating" | "mitigated" | "closed" | "accepted";
}

export interface ReportSeed {
  report_date: string;
  summary?: string;
  accomplishments?: string;
  next_steps?: string;
  schedule_health?: "onTrack" | "atRisk" | "offTrack";
  cost_health?: "onTrack" | "atRisk" | "offTrack";
  scope_health?: "onTrack" | "atRisk" | "offTrack";
}

/** What a throwaway Initiative is created with. */
export interface InitiativeSeed {
  attributes?: Record<string, string>;
  description?: string;
  budgets?: {
    fiscal_year: number;
    category: "capex" | "opex";
    description: string;
    amount: number;
  }[];
  /** `budget` is the index into `budgets`. */
  costs?: { budget?: number; description: string; category: "capex" | "opex"; actual: number }[];
  reports?: ReportSeed[];
  risks?: RiskSeed[];
}

export const SEED_DATES = {
  startDate: "2026-04-01",
  endDate: "2026-09-30",
  actualStart: "2026-05-15",
};

export interface SeededInitiative {
  id: string;
  name: string;
  budgetIds: string[];
  costIds: string[];
}

/** Throwaway cards and users of one test, removed (newest first) by `dispose`. */
export class Scratch {
  private cardIds: string[] = [];
  private userIds: string[] = [];

  constructor(private readonly request: APIRequestContext) {}

  async initiative(label: string, seed: InitiativeSeed = {}): Promise<SeededInitiative> {
    const name = `E2E ${label} ${randomUUID().slice(0, 8)}`;
    const card = await json<{ id: string }>(
      await this.request.post("/api/v1/cards", {
        data: {
          type: "Initiative",
          name,
          description: seed.description,
          attributes: seed.attributes ?? SEED_DATES,
        },
      }),
    );
    this.cardIds.unshift(card.id);
    const base = apiBase(card.id);
    const budgetIds: string[] = [];
    for (const budget of seed.budgets ?? []) {
      budgetIds.push(
        (await json<{ id: string }>(await this.request.post(`${base}/budgets`, { data: budget })))
          .id,
      );
    }
    const costIds: string[] = [];
    for (const cost of seed.costs ?? []) {
      const { budget, ...rest } = cost;
      const data = budget === undefined ? rest : { ...rest, budget_line_id: budgetIds[budget] };
      costIds.push(
        (await json<{ id: string }>(await this.request.post(`${base}/costs`, { data }))).id,
      );
    }
    for (const report of seed.reports ?? []) {
      await json(await this.request.post(`${base}/reports`, { data: report }));
    }
    for (const risk of seed.risks ?? []) {
      await json(await this.request.post(`${base}/risks`, { data: risk }));
    }
    return { id: card.id, name, budgetIds, costIds };
  }

  /** A card the test created itself (a Provider, ...), removed with the rest. */
  async card(type: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const card = await json<{ id: string }>(
      await this.request.post("/api/v1/cards", { data: { type, name, ...extra } }),
    );
    this.cardIds.unshift(card.id);
    return card.id;
  }

  /** A local account with the given role; its password is returned with it. */
  async user(role: string): Promise<{ email: string; password: string; id: string }> {
    const email = `e2e-${role}-${randomUUID().slice(0, 8)}@turboea.demo`;
    const password = `E2e-${randomUUID().slice(0, 12)}!aA1`;
    const created = await json<{ id: string }>(
      await this.request.post("/api/v1/users", {
        data: { email, display_name: `E2E ${role}`, password, role, auth_provider: "local" },
      }),
    );
    this.userIds.unshift(created.id);
    return { email, password, id: created.id };
  }

  async dispose(): Promise<void> {
    const failures: string[] = [];
    const remove = async (path: string) => {
      try {
        const response = await this.request.delete(path);
        if (!response.ok()) failures.push(`${path}: ${response.status()} ${await response.text()}`);
      } catch (error) {
        failures.push(`${path}: ${String(error)}`);
      }
    };
    for (const id of this.cardIds) await remove(`/api/v1/cards/${id}`);
    for (const id of this.userIds) await remove(`/api/v1/users/${id}`);
    this.cardIds = [];
    this.userIds = [];
    expect(failures, "clean up the throwaway data").toEqual([]);
  }
}

/** A browser context signed in as `account`, through the API (no form, no rate-limit retries). */
export async function contextAs(
  browser: Browser,
  account: { email: string; password: string },
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const res = await context.request.post("/api/v1/auth/login", {
    data: { email: account.email, password: account.password },
  });
  expect(
    res.ok(),
    `login of ${account.email} answered ${res.status()}: ${await res.text()}`,
  ).toBeTruthy();
  return context;
}

export interface ChartTextHit {
  text: string;
  /** CSS pixels inside the chart's canvas: the middle of the drawn text. */
  x: number;
  y: number;
}

/**
 * Records every string an ECharts canvas draws, keyed by the chart's visible
 * title (the element its `aria-labelledby` names), most recent last. Call it
 * before the first navigation: `addInitScript` only reaches pages loaded after.
 */
export async function installChartTextProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Hit = { text: string; x: number; y: number };
    const log: Record<string, Hit[]> = {};
    (window as unknown as { __chartText: Record<string, Hit[]> }).__chartText = log;
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text: string,
      x: number,
      y: number,
      max?: number,
    ) {
      const host = this.canvas.closest(".echart-container");
      const titleId = host?.getAttribute("aria-labelledby");
      const title = titleId ? document.getElementById(titleId)?.textContent : null;
      if (title) {
        const m = this.getTransform();
        const scale = this.canvas.width / this.canvas.getBoundingClientRect().width || 1;
        const width = (this.measureText(text).width * m.a) / scale;
        const point = m.transformPoint(new DOMPoint(x, y));
        const align = this.textAlign;
        const shift =
          align === "center" ? 0 : align === "right" || align === "end" ? -width / 2 : width / 2;
        const entries = (log[title] ??= []);
        entries.push({ text, x: point.x / scale + shift, y: point.y / scale });
        if (entries.length > 600) entries.splice(0, entries.length - 600);
      }
      return original.call(this, text, x, y, max);
    };
  });
}

/** The strings the chart titled `title` has drawn, oldest first. */
export function chartTexts(page: Page, title: string): Promise<ChartTextHit[]> {
  return page.evaluate(
    (key) =>
      (window as unknown as { __chartText?: Record<string, ChartTextHit[]> }).__chartText?.[key] ??
      [],
    title,
  );
}

/** The most recent whole-number string the chart drew: the donut's centre total. */
export async function lastNumberDrawn(page: Page, title: string): Promise<string | undefined> {
  const hits = await chartTexts(page, title);
  return [...hits].reverse().find((hit) => /^\d+$/.test(hit.text))?.text;
}

/** Click the legend entry (or any drawn text) `label` of the chart titled `title`. */
export async function clickChartText(
  page: Page,
  chart: Locator,
  title: string,
  label: string,
) {
  const hit = [...(await chartTexts(page, title))].reverse().find((entry) => entry.text === label);
  expect(hit, `"${label}" was never drawn in the chart "${title}"`).toBeDefined();
  await chart.click({ position: { x: hit!.x, y: hit!.y } });
}

/** `first` comes before `second` in document order. */
export async function precedes(first: Locator, second: Locator): Promise<boolean> {
  const other = await second.elementHandle();
  return first.evaluate((el, node) => Boolean(el.compareDocumentPosition(node as Node) & Node.DOCUMENT_POSITION_FOLLOWING), other);
}

/**
 * Open `path` once before the first test so the lazy chunks and the first
 * queries are warm: a cold first page took 25 s, the rest 5 to 10 s.
 */
export async function warmUp(browser: Browser, path: string, readyText: string): Promise<void> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  try {
    const page = await context.newPage();
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(readyText, { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  } finally {
    await context.close();
  }
}
