/**
 * ComingSoonPage — generic placeholder for a nav entry whose feature does not
 * exist yet (SWOT Analysis / What-if Analysis / Data Flow under Application &
 * Data Architecture — explicitly scoped out of the ArchiMate Viewpoint
 * Catalog feature, see the spec). No fake functionality: a title (reusing the
 * same `nav` label the menu item itself shows) and a single "not available
 * yet" line.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

interface Props {
  /** A `nav` namespace key — the same label the menu entry shows. */
  titleKey: string;
}

export default function ComingSoonPage({ titleKey }: Props) {
  const { t } = useTranslation("nav");

  return (
    <Box sx={{ maxWidth: 600, mx: "auto", textAlign: "center", py: 8 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        {t(titleKey)}
      </Typography>
      <Chip label={t("comingSoon.badge")} color="default" size="small" sx={{ mb: 2 }} />
      <Typography color="text.secondary">{t("comingSoon.body")}</Typography>
    </Box>
  );
}
