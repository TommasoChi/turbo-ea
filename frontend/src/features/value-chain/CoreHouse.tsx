import { Fragment } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useIsRtl } from "@/hooks/useIsRtl";
import { readableTextColor } from "@/lib/color";
import type { ValueChainCoreHouse } from "@/types";
import ProcessCategoryBox from "./ProcessCategoryBox";
import { chevronClipPath, pentagonClipPath } from "./shapes";
import { CHEVRON_H } from "./valueStreamLayout";

interface Props {
  house: ValueChainCoreHouse;
  color: string;
  onOpenCard: (id: string) => void;
  onDrill: (id: string) => void;
}

/** Core band as a three-tier house: level-one chevrons, level-two boxes, level-three categories. */
export default function CoreHouse({ house, color, onOpenCard, onDrill }: Props) {
  const { t } = useTranslation("valuechain");
  const rtl = useIsRtl();
  const text = readableTextColor(color);

  if (house.level_one.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("house.empty")}
      </Typography>
    );
  }

  const bookend = (label: string) => (
    <Box
      sx={{
        flexShrink: 0,
        width: 56,
        bgcolor: color,
        clipPath: pentagonClipPath(rtl),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pr: 2.25,
        py: 2,
      }}
    >
      <Typography
        variant="subtitle2"
        fontWeight={700}
        sx={{
          color: text,
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          whiteSpace: "nowrap",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "stretch", gap: 1.5 }}>
      {bookend(t("house.customerRequest"))}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${house.level_one.length}, minmax(220px, 1fr))`,
          columnGap: 1.5,
          alignItems: "start",
          overflowX: "auto",
        }}
      >
        {house.level_one.map((l1, i) => {
          const column = i + 1;
          const levelTwo = house.level_two[l1.id] ?? [];
          const levelThree = house.level_three[l1.id] ?? [];
          return (
            <Fragment key={l1.id}>
              <Box
                onClick={() => onOpenCard(l1.id)}
                sx={{
                  gridColumn: column,
                  gridRow: 1,
                  clipPath: chevronClipPath(rtl),
                  bgcolor: color,
                  color: text,
                  minHeight: CHEVRON_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  px: 2.5,
                  cursor: "pointer",
                  "&:hover": { opacity: 0.9 },
                }}
              >
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{
                    textAlign: "center",
                    color: "inherit",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {l1.name}
                </Typography>
              </Box>
              {levelTwo.length > 0 && (
                <Box
                  data-level="2"
                  sx={{ gridColumn: column, gridRow: 2, display: "flex", flexDirection: "column", gap: 0.75, mt: 1 }}
                >
                  {levelTwo.map((l2) => (
                    <Box
                      key={l2.id}
                      onClick={() => onOpenCard(l2.id)}
                      sx={{
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 1,
                        px: 1.5,
                        py: 1,
                        cursor: "pointer",
                        "&:hover": { boxShadow: 1 },
                      }}
                    >
                      <Typography variant="caption" sx={{ display: "block", textAlign: "center" }}>
                        {l2.name}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
              {levelThree.length > 0 && (
                <Box
                  data-level="3"
                  sx={{
                    gridColumn: column,
                    gridRow: 3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.75,
                    mt: 1.5,
                    pt: 1,
                    borderTop: 1,
                    borderStyle: "dashed",
                    borderColor: "divider",
                  }}
                >
                  {levelThree.map((box) => (
                    <ProcessCategoryBox
                      key={box.id}
                      box={box}
                      headerColor={color}
                      onOpenCard={onOpenCard}
                      onDrill={onDrill}
                    />
                  ))}
                </Box>
              )}
            </Fragment>
          );
        })}
      </Box>
      {bookend(t("house.customerSatisfaction"))}
    </Box>
  );
}
