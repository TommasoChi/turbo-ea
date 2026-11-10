import { useMemo, useState } from "react";

export function useDiagramDotGrid(diagramKey: string) {
  const key = `turboea.diagram.dot-grid.${diagramKey}`;
  const stored = useMemo(() => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  }, [key]);
  const [choice, setChoice] = useState<{ key: string; enabled: boolean }>();
  const enabled = choice?.key === key ? choice.enabled : stored;

  const toggle = () => {
    const next = !enabled;
    setChoice({ key, enabled: next });
    try {
      localStorage.setItem(key, next ? "on" : "off");
    } catch { /* The current diagram can still toggle its grid. */ }
  };

  return [enabled, toggle] as const;
}
