import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { readableTextColor } from "@/lib/color";
import CollapseToggle from "./CollapseToggle";

interface Props {
  color: string;
  name: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  /** Replaces the spacer that balances the toggle on the left. */
  extra?: ReactNode;
}

export default function GroupHeader({ color, name, collapsed, onToggle, onOpen, extra }: Props) {
  const text = readableTextColor(color);
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        bgcolor: color,
        color: text,
      }}
    >
      <CollapseToggle collapsed={collapsed} onToggle={onToggle} color={text} />
      <Typography
        variant="subtitle2"
        {...(onOpen && {
          role: "button",
          tabIndex: 0,
          onClick: onOpen,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          },
        })}
        sx={{ flex: 1, textAlign: "center", cursor: onOpen ? "pointer" : undefined }}
      >
        {name}
      </Typography>
      {extra ?? <Box sx={{ width: 24, flexShrink: 0 }} />}
    </Box>
  );
}
