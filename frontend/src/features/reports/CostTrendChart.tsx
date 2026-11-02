import { useState } from "react";
import Box from "@mui/material/Box";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RTooltip,
  Legend,
} from "recharts";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { costFiscalYearName } from "@/lib/fiscalYear";
import { CATEGORICAL_COLORS } from "@/theme/tokens";

type TrendRow = { fiscalYear: number } & Record<string, number>;

/** Stacked history of the cost field's components (the keys of its calculation), one bar per year. */
export default function CostTrendChart({
  typeParam,
  costField,
  components,
  years,
  currentFiscalYear,
}: {
  typeParam: string;
  costField: string;
  components: string[];
  years: number[];
  currentFiscalYear: number;
}) {
  const [rows, setRows] = useState<TrendRow[]>([]);

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
            const row: TrendRow = { fiscalYear: year };
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

  return (
    <Box data-testid="cost-trend-chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={rows}>
          <XAxis
            dataKey="fiscalYear"
            tickFormatter={(year: number) => costFiscalYearName(year, currentFiscalYear)}
          />
          <YAxis />
          {components.map((component, i) => (
            <Bar
              key={component}
              dataKey={component}
              stackId="cost"
              fill={CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]}
            />
          ))}
          <RTooltip />
          <Legend />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
