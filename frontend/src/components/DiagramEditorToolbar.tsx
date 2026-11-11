import { useState, type ReactNode } from "react";
import { Badge, Box, Button, IconButton, Menu, Stack, Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CheckRow, ChoiceRow } from "@/components/cardDisplay/menuRows";

export function DiagramEditorHeader({ title, onBack, children }: {
  title: string; onBack?: () => void; children?: ReactNode;
}) {
  const { t: tArchimate } = useTranslation("archimate");
  return (
    <Stack component="header" direction="row" alignItems="center" gap={1} useFlexGap flexWrap="wrap"
      sx={{ px: 1, py: 0.5, minHeight: 48, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      {onBack && <DiagramTool label={tArchimate("toolbar.back")} icon="arrow_back" onClick={onBack} />}
      <Typography component="h1" variant="subtitle1" fontWeight={600} noWrap sx={{ flex: "1 1 8rem" }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

export function DiagramCanvasToolbar({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Stack role="toolbar" aria-label={label} direction="row" alignItems="center" gap={0.5} useFlexGap
      flexWrap="wrap" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      {children}
    </Stack>
  );
}

export function DiagramTool({ label, icon, onClick, disabled, expanded, controls, pressed }: {
  label: string; icon: string; onClick: () => void; disabled?: boolean; expanded?: boolean; controls?: string; pressed?: boolean;
}) {
  return (
    <Tooltip title={label} disableInteractive>
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} aria-expanded={expanded}
          aria-pressed={pressed} color={pressed ? "primary" : "default"}
          aria-controls={controls} onClick={onClick}>
          <MaterialSymbol icon={icon} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

export function DiagramGridTool({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const { t } = useTranslation("diagrams");
  return <DiagramTool label={t("editor.toolbar.dotGrid")} icon="grid_on" pressed={enabled} onClick={onToggle} />;
}

export function DiagramDisplayMenu({ label, icon, options, single }: {
  label: string; icon: string; single?: boolean;
  options: { label: string; checked: boolean; onSelect: () => void }[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<MaterialSymbol icon={icon} size={18} />}
        endIcon={<MaterialSymbol icon="expand_more" size={16} />} aria-label={label} aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={(event) => setAnchor(event.currentTarget)} sx={{ textTransform: "none", fontSize: "0.8rem" }}>
        {label}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { "aria-label": label } }}>
        {options.map((option) => single ? (
          <ChoiceRow key={option.label} label={option.label} checked={option.checked} onSelect={() => {
            option.onSelect();
            setAnchor(null);
          }} />
        ) : <CheckRow key={option.label} label={option.label} checked={option.checked} onToggle={option.onSelect} />)}
      </Menu>
    </>
  );
}

export function DiagramSyncButton({ onClick, pending, disabled }: {
  onClick: () => void; pending?: number; disabled?: boolean;
}) {
  const { t } = useTranslation("diagrams");
  return (
    <Tooltip title={t("editor.toolbar.syncTooltip")} disableInteractive>
      <Box component="span">
        <Badge badgeContent={pending} color="info" overlap="rectangular">
          <Button size="small" variant="outlined" color="inherit" aria-label={t("editor.toolbar.sync")}
            disabled={disabled} onClick={onClick}
            startIcon={<MaterialSymbol icon="sync" size={18} />}
            sx={{ textTransform: "none", minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.8rem" }}>
            {t("editor.toolbar.sync")}
          </Button>
        </Badge>
      </Box>
    </Tooltip>
  );
}
