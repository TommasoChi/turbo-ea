import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { backOf, type Crumb, type Drill } from "./costDrill";

/** Breadcrumb with Back above the cost report's views, plus the click hint. */
export default function CostDrillBar({
  crumbs,
  onSelect,
  hint,
}: {
  crumbs: Crumb[];
  onSelect: (d: Drill) => void;
  hint: string;
}) {
  const { t } = useTranslation("reports");
  const current = crumbs[crumbs.length - 1];
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
      {crumbs.length > 1 && (
        <Button size="small" onClick={() => onSelect(backOf(current.target))}>
          {`‹ ${t("cost.back")}`}
        </Button>
      )}
      {crumbs.map((c, i) => (
        <Box key={`${c.kind}-${i}`} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {i > 0 && <Typography color="text.secondary">›</Typography>}
          {c === current ? (
            <Typography fontWeight={600}>{c.label}</Typography>
          ) : (
            <Link component="button" type="button" underline="hover" onClick={() => onSelect(c.target)}>
              {c.label}
            </Link>
          )}
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
        {hint}
      </Typography>
    </Box>
  );
}
