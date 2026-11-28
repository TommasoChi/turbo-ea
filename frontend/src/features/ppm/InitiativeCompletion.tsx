import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { CompletionRing } from "./ppmVisuals";
import { usePpmCompletion } from "./usePpmFinancials";

/** The Initiative card's Completion, drawn beside the Timeline dates. */
export default function InitiativeCompletion({ initiativeId, revision }: { initiativeId: string; revision: number }) {
  const { t } = useTranslation("ppm");
  const { data, error } = usePpmCompletion(initiativeId, revision);
  return (
    <Box sx={{ minWidth: 96 }}>
      <Typography variant="caption" color="text.secondary">{t("completion")}</Typography>
      {error ? (
        <Alert severity="error">{error.message || t("common:errors.generic")}</Alert>
      ) : !data ? (
        <LinearProgress />
      ) : data.wbs_count === 0 ? (
        <Typography variant="body2" color="text.secondary">{t("noWbsItems")}</Typography>
      ) : (
        <CompletionRing value={data.completion} />
      )}
    </Box>
  );
}
