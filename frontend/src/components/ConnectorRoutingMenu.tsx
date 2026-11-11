import { ListItemIcon, Menu, MenuItem, SvgIcon } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ConnectorRouting } from "@/lib/connectorRouting";

// Draw.io Format.straightImage and Format.orthogonalImage, with theme color.
const paths = {
  straight: "M 0 26 L 4 26 L 4 30 L 0 30 Z M 4 26 L 26 4 M 26 0 L 30 0 L 30 4 L 26 4 Z",
  orthogonal: "M 0 26 L 4 26 L 4 30 L 0 30 Z M 2 26 L 2 14 L 28 14 L 28 4 M 26 0 L 30 0 L 30 4 L 26 4 Z",
} as const;

export default function ConnectorRoutingMenu({ anchor, routing, onSelect, onClose }: {
  anchor: { left: number; top: number } | null;
  routing?: ConnectorRouting;
  onSelect: (routing: ConnectorRouting) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("diagrams");
  return (
    <Menu open={anchor !== null} anchorReference="anchorPosition" anchorPosition={anchor ?? undefined}
      onClose={onClose} slotProps={{ list: { "aria-label": t("routing.label") } }}>
      {(["straight", "orthogonal"] as const).map((value) => (
        <MenuItem key={value} role="menuitemradio" aria-checked={routing === value}
          selected={routing === value} onClick={() => { onSelect(value); onClose(); }}>
          <ListItemIcon>
            <SvgIcon viewBox="0 0 36 36" sx={{ width: 16, height: 18 }}>
              <path transform="translate(3,4)" stroke="currentColor" strokeWidth={2.5} fill="none" d={paths[value]} />
            </SvgIcon>
          </ListItemIcon>
          {t(`routing.${value}`)}
        </MenuItem>
      ))}
    </Menu>
  );
}
