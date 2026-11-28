import { useId } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import LinkifiedText from "@/components/LinkifiedText";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { PmlInitiativeSchedule, PpmStatusReport } from "@/types";
import { HealthDot } from "./ppmVisuals";
import PpmSectionHeader from "./PpmSectionHeader";

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
  const titleId = useId();
  const texts = [
    ["summary", report?.summary],
    ["accomplishments", report?.accomplishments],
    ["nextSteps", report?.next_steps],
  ] as const;
  return (
    <Box component="section" aria-labelledby={titleId}>
      <PpmSectionHeader
        title={t("healthSummary")}
        titleId={titleId}
        action={
          onManage && (
            <Button
              size="small"
              aria-label={t("manageSection", { section: t("healthSummary") })}
              onClick={onManage}
            >
              {t("manage")}
            </Button>
          )
        }
      />
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
          <Box display="flex" flexWrap="wrap" columnGap={3}>
            {texts.map(([key, text]) => (
              <Box key={key} mt={1} sx={{ flex: "1 1 200px", minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {t(key)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {text ? <LinkifiedText text={text} /> : "—"}
                </Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
