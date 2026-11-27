import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import LinkifiedText from "@/components/LinkifiedText";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { PmlInitiativeSchedule, PpmStatusReport } from "@/types";
import { HealthDot } from "./ppmVisuals";

export type HealthReport = Pick<PmlInitiativeSchedule, "schedule_health" | "scope_health"> &
  Partial<Pick<PpmStatusReport, "report_date" | "summary" | "accomplishments" | "next_steps">>;

interface Props {
  report: HealthReport | null | undefined;
  costHealth?: string | null;
  onManage?: () => void;
}

export default function PpmHealthSummary({ report, costHealth, onManage }: Props) {
  const { t } = useTranslation("ppm");
  const { formatDate } = useDateFormat();
  const texts = [
    ["summary", report?.summary],
    ["accomplishments", report?.accomplishments],
    ["nextSteps", report?.next_steps],
  ] as const;
  return (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        sx={{ borderBottom: 1, borderColor: "divider", pb: 0.5, mb: 1 }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          {t("healthSummary")}
        </Typography>
        {onManage && (
          <Button
            size="small"
            aria-label={t("manageSection", { section: t("healthSummary") })}
            onClick={onManage}
          >
            {t("manage")}
          </Button>
        )}
      </Box>
      {!report ? (
        <Typography variant="body2" color="text.secondary">
          {t("noReportsYet")}
        </Typography>
      ) : (
        <>
          <Box display="flex" gap={{ xs: 1.5, sm: 4 }} flexWrap="wrap">
            {report.schedule_health && <HealthDot value={report.schedule_health} label={t("health_schedule")} />}
            {costHealth && <HealthDot value={costHealth} label={t("health_cost")} />}
            {report.scope_health && <HealthDot value={report.scope_health} label={t("health_scope")} />}
          </Box>
          {report.report_date && (
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              {formatDate(report.report_date)}
            </Typography>
          )}
          {texts.map(([key, text]) => (
            <Box key={key} mt={1}>
              <Typography variant="caption" color="text.secondary">
                {t(key)}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {text ? <LinkifiedText text={text} /> : "—"}
              </Typography>
            </Box>
          ))}
        </>
      )}
    </>
  );
}
