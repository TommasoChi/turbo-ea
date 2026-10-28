import { useEffect, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface CostHistoryRow {
  fiscal_year: number;
  field_key: string;
  value: number;
}

interface CostHistoryEditorProps {
  cardId: string;
  fieldKey: string;
  fieldLabel: string;
}

/** A small, standalone editor for a single cost field's per-fiscal-year
 * history rows (add/edit/delete) — the current year is synced automatically
 * from the scalar field, so this only ever deals with other years. */
export default function CostHistoryEditor({
  cardId,
  fieldKey,
  fieldLabel,
}: CostHistoryEditorProps) {
  const [rows, setRows] = useState<CostHistoryRow[]>([]);
  const [newYear, setNewYear] = useState("");
  const [newValue, setNewValue] = useState("");

  const reload = useCallback(async () => {
    const r = await api.get<{ rows: CostHistoryRow[] }>(
      `/cards/${cardId}/cost-history`,
    );
    setRows(r.rows.filter((row) => row.field_key === fieldKey));
  }, [cardId, fieldKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleAdd = async () => {
    const fiscal_year = Number(newYear);
    const value = Number(newValue);
    if (!Number.isFinite(fiscal_year) || !Number.isFinite(value)) return;
    await api.put(`/cards/${cardId}/cost-history`, {
      fiscal_year,
      field_key: fieldKey,
      value,
    });
    setNewYear("");
    setNewValue("");
    await reload();
  };

  const handleDelete = async (fiscal_year: number) => {
    await api.delete(`/cards/${cardId}/cost-history/${fiscal_year}/${fieldKey}`);
    await reload();
  };

  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Fiscal year</TableCell>
            <TableCell>{fieldLabel}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows
            .sort((a, b) => b.fiscal_year - a.fiscal_year)
            .map((row) => (
              <TableRow key={row.fiscal_year}>
                <TableCell>{row.fiscal_year}</TableCell>
                <TableCell>${row.value}</TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    aria-label={`delete ${row.fiscal_year}`}
                    onClick={() => handleDelete(row.fiscal_year)}
                  >
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <Box sx={{ display: "flex", gap: 1, mt: 1, alignItems: "center" }}>
        <TextField
          size="small"
          label="Fiscal year"
          value={newYear}
          onChange={(e) => setNewYear(e.target.value)}
          sx={{ width: 120 }}
        />
        <TextField
          size="small"
          label="Value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          sx={{ width: 120 }}
        />
        <Button size="small" variant="outlined" onClick={handleAdd}>
          Add
        </Button>
      </Box>
    </Box>
  );
}
