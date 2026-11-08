import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { formatPct, STATUS_ORDER, statusColor } from "@/lib/licenses";
import type { LicenseReportRow, LicenseStatus, LicenseType } from "@/types";

export interface LicensingTableRow {
  id: string;
  name: string;
  type: string;
  group?: string;
  status: LicenseStatus;
  raw: LicenseReportRow;
}

export interface LicensingTableProps {
  rows: LicensingTableRow[];
  /** The license types shown as columns, in catalogue order. */
  types: LicenseType[];
  labelOf: (typeKey: string) => string;
  /** Group headers in display order; rows are matched on `row.group`. */
  groups?: { key: string; label: string }[];
  extraColumns: string[];
  extraLabel: (fieldKey: string) => string;
  extraValue: (row: LicensingTableRow, fieldKey: string) => string;
  typeOf: (typeKey: string) => { icon: string; label: string } | null;
  /** False for a Platform aggregate, which has no status. */
  showStatus: boolean;
  sortK: string;
  sortD: "asc" | "desc";
  onSort: (key: string) => void;
  onOpen: (cardId: string) => void;
  onDrill: (target: { id: string } | { group: string }) => void;
}

const STATUS_KEY: Record<LicenseStatus, string> = {
  over: "licensing.statusOver",
  approaching: "licensing.statusApproaching",
  no_actual_data: "licensing.statusNoActualData",
  compliant: "licensing.statusCompliant",
};

const DASH = "—";
const num = (v: number | null | undefined) => (v == null ? DASH : String(v));

/** Sum of the counts; `null` when none of them exists (no actual recorded at all). */
function sumOrNull(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export default function LicensingTable({
  rows,
  types,
  labelOf,
  groups,
  extraColumns,
  extraLabel,
  extraValue,
  typeOf,
  showStatus,
  sortK,
  sortD,
  onSort,
  onOpen,
  onDrill,
}: LicensingTableProps) {
  const { t } = useTranslation(["reports", "common"]);

  const licensedOf = (r: LicensingTableRow, key: string) => r.raw.by_type[key]?.licensed;
  const actualOf = (r: LicensingTableRow, key: string) => r.raw.by_type[key]?.actual;
  const totalLic = (r: LicensingTableRow) =>
    sumOrNull(types.map((x) => licensedOf(r, x.key))) ?? 0;
  const totalAct = (r: LicensingTableRow) => sumOrNull(types.map((x) => actualOf(r, x.key)));

  // The value a column sorts on; a missing figure sorts as the lowest one.
  const sortValue = (r: LicensingTableRow): string | number => {
    if (sortK === "name") return r.name;
    if (sortK === "status") return STATUS_ORDER.indexOf(r.status);
    if (sortK === "total_lic") return totalLic(r);
    if (sortK === "total_act") return totalAct(r) ?? -1;
    const [kind, key] = sortK.split(":");
    if (kind === "lic") return licensedOf(r, key) ?? 0;
    if (kind === "act") return actualOf(r, key) ?? -1;
    if (kind === "pct") {
      const c = r.raw.by_type[key];
      return c?.no_licence ? Number.POSITIVE_INFINITY : (c?.pct ?? -1);
    }
    return 0;
  };
  const byColumn = (a: LicensingTableRow, b: LicensingTableRow) => {
    const d = sortD === "asc" ? 1 : -1;
    const va = sortValue(a);
    const vb = sortValue(b);
    if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * d;
    return ((va as number) - (vb as number)) * d;
  };

  const sortHead = (key: string, label: string, align: "left" | "right" = "right") => (
    <TableCell key={key} align={align}>
      <TableSortLabel
        active={sortK === key}
        direction={sortK === key ? sortD : "asc"}
        onClick={() => onSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const typeBadge = (r: LicensingTableRow) => {
    const tp = typeOf(r.type);
    return tp ? (
      <Typography
        component="span"
        variant="caption"
        color="text.secondary"
        sx={{ ml: 1, display: "inline-flex", alignItems: "center", gap: 0.5, verticalAlign: "middle" }}
      >
        <MaterialSymbol icon={tp.icon} size={14} />
        {tp.label}
      </Typography>
    ) : null;
  };

  const countCells = (
    lic: (key: string) => number | null | undefined,
    act: (key: string) => number | null | undefined,
    pct: ((key: string) => string) | null,
    bold = false,
  ) =>
    types.map((x) => (
      <Fragment key={x.key}>
        <TableCell align="right" sx={bold ? { fontWeight: 700 } : undefined}>
          {num(lic(x.key))}
        </TableCell>
        <TableCell align="right" sx={bold ? { fontWeight: 700 } : undefined}>
          {num(act(x.key))}
        </TableCell>
        <TableCell align="right" sx={bold ? { fontWeight: 700 } : undefined}>
          {pct ? pct(x.key) : ""}
        </TableCell>
      </Fragment>
    ));

  const cardRow = (r: LicensingTableRow, indent: boolean) => (
    <TableRow
      key={r.id}
      hover
      sx={{ cursor: "pointer" }}
      onClick={() => onOpen(r.id)}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        onDrill({ id: r.id });
      }}
    >
      <TableCell sx={{ fontWeight: 500, ...(indent && { pl: 4 }) }}>
        <span data-testid="licensing-row-name">{r.name}</span>
        {typeBadge(r)}
      </TableCell>
      {countCells(
        (k) => licensedOf(r, k),
        (k) => actualOf(r, k),
        (k) => {
          const c = r.raw.by_type[k];
          return c ? formatPct(c.pct, c.no_licence, t) : DASH;
        },
      )}
      <TableCell align="right">{num(totalLic(r))}</TableCell>
      <TableCell align="right">{num(totalAct(r))}</TableCell>
      {showStatus && (
        <TableCell>
          <Chip
            size="small"
            variant="outlined"
            label={t(STATUS_KEY[r.status])}
            sx={{ borderColor: statusColor(r.status), color: statusColor(r.status) }}
          />
        </TableCell>
      )}
      {extraColumns.map((key) => (
        <TableCell key={key} align="right">
          {extraValue(r, key)}
        </TableCell>
      ))}
    </TableRow>
  );

  const sumType = (members: LicensingTableRow[], key: string, pick: (r: LicensingTableRow, key: string) => number | null | undefined) =>
    sumOrNull(members.map((m) => pick(m, key)));
  const tailBlank = (bold: boolean) => (
    <>
      {showStatus && <TableCell />}
      {extraColumns.map((key) => (
        <TableCell key={key} sx={bold ? { fontWeight: 700 } : undefined} />
      ))}
    </>
  );
  const totalsCells = (members: LicensingTableRow[]) => (
    <>
      {countCells(
        (k) => sumType(members, k, licensedOf) ?? 0,
        (k) => sumType(members, k, actualOf),
        null,
        true,
      )}
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        {members.reduce((s, m) => s + totalLic(m), 0)}
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        {num(sumOrNull(members.map(totalAct)))}
      </TableCell>
      {tailBlank(true)}
    </>
  );

  const sorted = [...rows].sort(byColumn);

  return (
    <Paper variant="outlined" sx={{ overflow: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {sortHead("name", t("common:labels.name"), "left")}
            {types.map((x) => (
              <Fragment key={x.key}>
                {sortHead(`lic:${x.key}`, t("licensing.colLic", { label: labelOf(x.key) }))}
                {sortHead(`act:${x.key}`, t("licensing.colAct", { label: labelOf(x.key) }))}
                {sortHead(`pct:${x.key}`, t("licensing.colPct", { label: labelOf(x.key) }))}
              </Fragment>
            ))}
            {sortHead("total_lic", t("licensing.totalLic"))}
            {sortHead("total_act", t("licensing.totalAct"))}
            {showStatus && sortHead("status", t("licensing.status"), "left")}
            {extraColumns.map((key) => (
              <TableCell key={key} align="right">
                {extraLabel(key)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups
            ? groups.map((g) => {
                const members = sorted.filter((r) => r.group === g.key);
                return (
                  <Fragment key={g.key}>
                    <TableRow
                      hover
                      sx={{ bgcolor: "action.hover", cursor: "pointer" }}
                      onContextMenu={(e: React.MouseEvent) => {
                        e.preventDefault();
                        onDrill({ group: g.key });
                      }}
                    >
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {g.label}
                        <Box component="span" sx={{ ml: 1, color: "text.secondary", fontSize: "0.75rem" }}>
                          ({members.length})
                        </Box>
                      </TableCell>
                      {totalsCells(members)}
                    </TableRow>
                    {members.map((r) => cardRow(r, true))}
                  </Fragment>
                );
              })
            : sorted.map((r) => cardRow(r, false))}
          <TableRow sx={{ bgcolor: "action.selected" }} data-testid="licensing-total-row">
            <TableCell sx={{ fontWeight: 700 }}>{t("cost.total")}</TableCell>
            {totalsCells(rows)}
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  );
}
