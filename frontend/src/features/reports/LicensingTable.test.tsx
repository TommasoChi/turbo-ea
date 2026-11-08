/**
 * The Licensing report's Table view: one header row (the XLSX export reads no colspan/rowspan),
 * a total row without a percentage, sorting, the cost report's click gestures and group headers.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import type { LicenseReportRow, LicenseType } from "@/types";
import LicensingTable, { type LicensingTableRow } from "./LicensingTable";

const TYPES: LicenseType[] = [
  { id: "1", key: "admin", label: "Admin", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "dev", label: "Dev", sort_order: 2, archived: false, translations: {} },
];

const raw = (id: string, by_type: LicenseReportRow["by_type"]): LicenseReportRow => ({
  id,
  name: id,
  type: "Application",
  attributes: {},
  status: "compliant",
  worst_pct: null,
  worst_no_licence: false,
  licensed_total: 0,
  actual_total: null,
  by_type,
});
const cell = (licensed: number, actual: number | null, pct: number | null, no_licence = false) => ({
  licensed,
  actual,
  pct,
  no_licence,
  status: "compliant" as const,
});
const ROWS: LicensingTableRow[] = [
  {
    id: "A",
    name: "Alpha",
    type: "Application",
    status: "over",
    group: "g1",
    raw: raw("A", { admin: cell(10, 12, 120), dev: cell(0, 3, null, true) }),
  },
  {
    id: "B",
    name: "Beta",
    type: "Application",
    status: "compliant",
    group: "g2",
    raw: raw("B", { admin: cell(20, 5, 25) }),
  },
  {
    id: "C",
    name: "Gamma",
    type: "Application",
    status: "no_actual_data",
    group: "g1",
    raw: raw("C", { dev: cell(4, null, null) }),
  },
];

function setup(over: Partial<React.ComponentProps<typeof LicensingTable>> = {}) {
  const props: React.ComponentProps<typeof LicensingTable> = {
    rows: ROWS,
    types: TYPES,
    labelOf: (k) => TYPES.find((x) => x.key === k)?.label ?? k,
    extraColumns: [],
    extraLabel: (k) => k,
    extraValue: () => "",
    typeOf: () => ({ icon: "apps", label: "Application" }),
    showStatus: true,
    sortK: "name",
    sortD: "asc",
    onSort: vi.fn(),
    onOpen: vi.fn(),
    onDrill: vi.fn(),
    ...over,
  };
  render(<LicensingTable {...props} />);
  return props;
}
const names = () =>
  screen.getAllByTestId("licensing-row-name").map((n) => n.textContent);

describe("LicensingTable", () => {
  it("one header row with lic./act./% per type and no total %", async () => {
    await i18n.changeLanguage("en");
    setup();
    const headRows = document.querySelectorAll("thead tr");
    expect(headRows).toHaveLength(1);
    const heads = [...headRows[0].querySelectorAll("th")].map((h) => h.textContent);
    expect(heads).toEqual([
      "Name",
      "Admin lic.",
      "Admin act.",
      "Admin %",
      "Dev lic.",
      "Dev act.",
      "Dev %",
      "Total lic.",
      "Total act.",
      "Status",
    ]);
    // No colspan/rowspan anywhere: extractSheetsFromDOM does not read them.
    expect(document.querySelectorAll("[colspan],[rowspan]")).toHaveLength(0);
    const total = screen.getByTestId("licensing-total-row");
    const cells = [...total.querySelectorAll("td")].map((c) => c.textContent);
    // Admin 30 / 17, Dev 4 / 3, totals 34 / 20; no percentage in the totals, none for the status.
    expect(cells).toEqual(["Total", "30", "17", "", "4", "3", "", "34", "20", ""]);
  });

  it("renders counts, percentages, no-license, missing actual and status pills", async () => {
    await i18n.changeLanguage("en");
    setup();
    const rowA = screen.getByText("Alpha").closest("tr") as HTMLElement;
    const cells = [...rowA.querySelectorAll("td")].map((c) => c.textContent);
    expect(cells.slice(1, 9)).toEqual(["10", "12", "120 %", "0", "3", "no license", "10", "15"]);
    expect(within(rowA).getByText("Over-licensed")).toBeInTheDocument();
    const rowC = screen.getByText("Gamma").closest("tr") as HTMLElement;
    expect([...rowC.querySelectorAll("td")].map((c) => c.textContent).slice(1, 9)).toEqual([
      "—", "—", "—", "4", "—", "—", "4", "—",
    ]);
  });

  it("sorts by a type column", async () => {
    await i18n.changeLanguage("en");
    setup({ sortK: "lic:admin", sortD: "desc" });
    // Beta 20, Alpha 10, Gamma has no Admin cell (counts as 0).
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("clicking a header asks to sort by that column", async () => {
    await i18n.changeLanguage("en");
    const p = setup();
    await userEvent.click(screen.getByText("Dev act."));
    expect(p.onSort).toHaveBeenCalledWith("act:dev");
  });

  it("sorts by status, worst first", async () => {
    await i18n.changeLanguage("en");
    setup({ sortK: "status", sortD: "asc" });
    expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("right click drills, click opens", async () => {
    await i18n.changeLanguage("en");
    const p = setup();
    const row = screen.getByText("Beta").closest("tr") as HTMLElement;
    await userEvent.click(row);
    expect(p.onOpen).toHaveBeenCalledWith("B");
    await userEvent.pointer({ keys: "[MouseRight]", target: row });
    expect(p.onDrill).toHaveBeenCalledWith({ id: "B" });
  });

  it("group header rows when grouped, summing the members, right click drills the group", async () => {
    await i18n.changeLanguage("en");
    const p = setup({
      groups: [
        { key: "g1", label: "Group one" },
        { key: "g2", label: "Group two" },
      ],
    });
    const head = screen.getByText("Group one").closest("tr") as HTMLElement;
    expect([...head.querySelectorAll("td")].map((c) => c.textContent).slice(1, 3)).toEqual(["10", "12"]);
    expect(within(head).getByText("(2)")).toBeInTheDocument();
    // Members follow their header.
    const order = [...document.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
    expect(order[0]).toContain("Group one");
    expect(order[1]).toContain("Alpha");
    expect(order[2]).toContain("Gamma");
    expect(order[3]).toContain("Group two");
    await userEvent.pointer({ keys: "[MouseRight]", target: head });
    expect(p.onDrill).toHaveBeenCalledWith({ group: "g1" });
  });

  it("hides the status column and pills when showStatus is off (a Platform)", async () => {
    await i18n.changeLanguage("en");
    setup({ showStatus: false });
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Over-licensed")).toBeNull();
  });

  it("appends the extra columns", async () => {
    await i18n.changeLanguage("en");
    setup({ extraColumns: ["owner"], extraLabel: () => "Owner", extraValue: (r) => `o-${r.id}` });
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("o-A")).toBeInTheDocument();
  });
});
