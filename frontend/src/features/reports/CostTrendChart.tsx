import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useCurrency } from "@/hooks/useCurrency";
import { costFiscalYearName } from "@/lib/fiscalYear";
import { buildCostTrendOption, type CostTrendRow } from "./costTrendOption";

/** Stacked history of the cost field's components (the keys of its calculation), one bar per year. */
export default function CostTrendChart({
  typeParam,
  costField,
  components,
  labelOf,
  years,
  currentFiscalYear,
}: {
  typeParam: string;
  costField: string;
  components: string[];
  /** A component's display label; the key itself when omitted. */
  labelOf?: (component: string) => string;
  years: number[];
  currentFiscalYear: number;
}) {
  const [rows, setRows] = useState<CostTrendRow[]>([]);
  const chrome = useEChartsTheme();
  const { fmt } = useCurrency();

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const results = await Promise.all(
        years.map((year) =>
          Promise.all(
            components.map((component) =>
              api.get<{ total: number }>(
                `/reports/cost-treemap?type=${typeParam}&cost_field=${component}&fiscal_year=${year}`,
                { signal },
              ),
            ),
          ).then((responses) => {
            const row: CostTrendRow = { fiscalYear: year };
            components.forEach((component, i) => {
              row[component] = responses[i].total;
            });
            return row;
          }),
        ),
      );
      if (isCurrent()) setRows(results);
    },
    // costField: a new field can keep the same components yet must not show the old rows.
    [typeParam, costField, components.join(","), years],
  );

  const option = useMemo(
    () =>
      buildCostTrendOption(rows, components, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
        yearLabel: (year) => costFiscalYearName(year, currentFiscalYear),
        componentLabel: labelOf,
      }),
    [rows, components, chrome, fmt, currentFiscalYear, labelOf],
  );

  return (
    <Box data-testid="cost-trend-chart">
      <EChart option={option} style={{ height: 300 }} ariaLabel={components.map((c) => labelOf?.(c) ?? c).join(", ")} />
    </Box>
  );
}
