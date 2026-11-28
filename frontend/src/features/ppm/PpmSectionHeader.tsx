import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/** The heading row of an Overview/card-page section: title left, optional action right. */
export default function PpmSectionHeader({ title, action, titleId }: { title: string; action?: ReactNode; titleId?: string }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
      <Typography variant="subtitle1" fontWeight={600} id={titleId}>
        {title}
      </Typography>
      {action}
    </Stack>
  );
}
