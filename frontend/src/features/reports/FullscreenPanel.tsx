import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function FullscreenPanel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const { t } = useTranslation("reports");
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (isFullscreen) document.exitFullscreen();
    else ref.current?.requestFullscreen();
  };

  return (
    <Box ref={ref} data-testid="fullscreen-panel" sx={{ position: "relative" }}>
      <Tooltip title={isFullscreen ? t("shell.exitFullscreen") : label}>
        <IconButton
          size="small"
          onClick={toggle}
          aria-label={isFullscreen ? t("shell.exitFullscreen") : label}
          sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}
        >
          <MaterialSymbol icon={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={18} />
        </IconButton>
      </Tooltip>
      {children}
    </Box>
  );
}
