import { useEffect, useState } from "react";
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

const COST_FIELDS = [
  "softwareLicensingCost",
  "applicationManagementServicesCost",
  "infrastruttureCost",
] as const;

interface TrendRow {
  fiscalYear: number;
  softwareLicensingCost: number;
  applicationManagementServicesCost: number;
  infrastruttureCost: number;
}

export default function CostTrendChart({
  cardTypeKey,
  years,
}: {
  cardTypeKey: string;
  years: number[];
}) {
  const [rows, setRows] = useState<TrendRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      years.map((year) =>
        Promise.all(
          COST_FIELDS.map((field) =>
            api.get(
              `/reports/cost-treemap?type=${cardTypeKey}&cost_field=${field}&fiscal_year=${year}`,
            ) as Promise<{ total: number }>,
          ),
        ).then(([sw, ams, infra]) => ({
          fiscalYear: year,
          softwareLicensingCost: sw.total,
          applicationManagementServicesCost: ams.total,
          infrastruttureCost: infra.total,
        })),
      ),
    ).then((results) => {
      if (!cancelled) setRows(results);
    });
    return () => {
      cancelled = true;
    };
  }, [cardTypeKey, years]);

  return (
    <Box data-testid="cost-trend-chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={rows}>
          <XAxis dataKey="fiscalYear" />
          <YAxis />
          <Bar dataKey="softwareLicensingCost" stackId="cost" fill="#1976d2" />
          <Bar dataKey="applicationManagementServicesCost" stackId="cost" fill="#42a5f5" />
          <Bar dataKey="infrastruttureCost" stackId="cost" fill="#90caf9" />
          <RTooltip />
          <Legend />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
