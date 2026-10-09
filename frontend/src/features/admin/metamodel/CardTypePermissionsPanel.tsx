import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardTypePermissionCell, CardTypePermissionMatrix } from "@/types";

/**
 * Per-card-type RBAC overrides (discussion #1068).
 *
 * Every cell is tri-state: *inherit* (no stored value — the role's
 * landscape-wide grant decides), *allow*, or *deny*. That is what lets one
 * type both take a permission away from a role that has it globally and give
 * one to a role that does not, without minting a role per card type.
 *
 * Only overridden cells are sent; an action switched back to inherit is
 * deleted from the payload rather than stored as its inherited value, so a
 * later change to the role itself keeps flowing through.
 *
 * A cell that is allow/deny may also carry a subtype scope — see
 * `CardTypePermissionCell` — rendered as a small "tune" icon button next to
 * the ToggleButtonGroup, only when the type actually has subtypes.
 */

type CellState = "inherit" | "allow" | "deny";

/** The View action. An *unscoped* View deny locks the role's other cells: a
 *  role that may not see a type's cards holds no authority over them (the
 *  backend's `type_cell_decision`). A View deny scoped to some subtypes does
 *  NOT lock them — it decides only for the subtypes it names, so the other
 *  actions still mean something for the rest of the type. */
const VIEW_ACTION = "inventory.view";

/** The draft map mirrors the wire shape: `{roleKey: {permission: cell}}`. */
type Draft = Record<string, Record<string, CardTypePermissionCell>>;

interface CardTypePermissionsPanelProps {
  typeKey: string;
  onError: (msg: string) => void;
  /** Called after a successful save so the drawer can refresh the metamodel. */
  onSaved?: () => void;
}

function toDraft(matrix: CardTypePermissionMatrix): Draft {
  const draft: Draft = {};
  for (const role of matrix.roles) {
    if (Object.keys(role.overrides).length > 0) {
      draft[role.key] = { ...role.overrides };
    }
  }
  return draft;
}

function cellValue(cell: CardTypePermissionCell): boolean {
  return typeof cell === "object" ? cell.value : cell;
}

function cellState(draft: Draft, roleKey: string, action: string): CellState {
  const cell = draft[roleKey]?.[action];
  if (cell === undefined) return "inherit";
  return cellValue(cell) ? "allow" : "deny";
}

/** `[]` for an unscoped cell ("All subtypes") or when there's no cell at all. */
function cellSubtypes(draft: Draft, roleKey: string, action: string): string[] {
  const cell = draft[roleKey]?.[action];
  return typeof cell === "object" ? cell.subtypes : [];
}

export default function CardTypePermissionsPanel({
  typeKey,
  onError,
  onSaved,
}: CardTypePermissionsPanelProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [matrix, setMatrix] = useState<CardTypePermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [scopeAnchor, setScopeAnchor] = useState<{
    el: HTMLElement;
    roleKey: string;
    action: string;
  } | null>(null);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<CardTypePermissionMatrix>(
        `/metamodel/types/${typeKey}/permissions`
      );
      setMatrix(data);
      setDraft(toDraft(data));
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.permissionsPanel.failedToFetch"));
    } finally {
      setLoading(false);
    }
    // `t` is stable enough for an error fallback; refetching on a language
    // switch would throw away unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, onError]);

  useEffect(() => {
    setSaveError(null);
    setSaved(false);
    fetchMatrix();
  }, [fetchMatrix]);

  const original = useMemo(() => (matrix ? toDraft(matrix) : {}), [matrix]);
  const dirty = useMemo(
    () => JSON.stringify(original) !== JSON.stringify(draft),
    [original, draft]
  );

  const setCell = (roleKey: string, action: string, state: CellState) => {
    setSaved(false);
    setDraft((prev) => {
      const next: Draft = { ...prev, [roleKey]: { ...(prev[roleKey] ?? {}) } };
      if (state === "inherit") {
        delete next[roleKey][action];
      } else {
        // Flipping allow<->deny keeps an existing subtype scope — the admin
        // picked those subtypes on purpose, switching the verdict shouldn't
        // silently widen it back to "All".
        const existing = prev[roleKey]?.[action];
        const value = state === "allow";
        next[roleKey][action] = typeof existing === "object" ? { ...existing, value } : value;
      }
      // An empty override map means "inherit everything", which is the same
      // statement as having no entry at all — and is what the API stores.
      if (Object.keys(next[roleKey]).length === 0) delete next[roleKey];
      return next;
    });
  };

  const setCellSubtypes = (roleKey: string, action: string, subtypes: string[]) => {
    setSaved(false);
    setDraft((prev) => {
      const current = prev[roleKey]?.[action];
      if (current === undefined) return prev;
      const value = cellValue(current);
      const next: Draft = { ...prev, [roleKey]: { ...prev[roleKey] } };
      // No subtypes selected collapses back to a plain bool ("All subtypes").
      next[roleKey][action] = subtypes.length > 0 ? { value, subtypes } : value;
      return next;
    });
  };

  const resetRole = (roleKey: string) => {
    setSaved(false);
    setDraft((prev) => {
      const next = { ...prev };
      delete next[roleKey];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/metamodel/types/${typeKey}`, { role_permissions: draft });
      await fetchMatrix();
      setSaved(true);
      onSaved?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t("metamodel.permissionsPanel.failedToSave");
      setSaveError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  const actionLabel = (key: string) => {
    const suffix = key.split(".")[1] ?? key;
    const translated = t(`metamodel.permissionsPanel.action.${suffix}`, { defaultValue: "" });
    return translated || key;
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!matrix) return null;

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
        {t("metamodel.permissionsPanel.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("metamodel.permissionsPanel.description")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("metamodel.permissionsPanel.viewNote")}
      </Typography>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {saved && !dirty && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
          {t("metamodel.permissionsPanel.saved")}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>
                {t("metamodel.permissionsPanel.roleColumn")}
              </TableCell>
              {matrix.actions.map((action) => (
                <TableCell key={action.key} align="center" sx={{ fontWeight: 600 }}>
                  <Tooltip title={action.description}>
                    <span>{actionLabel(action.key)}</span>
                  </Tooltip>
                </TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {matrix.roles.map((role) => {
              const hasOverrides = Object.keys(draft[role.key] ?? {}).length > 0;
              return (
                <TableRow key={role.key} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: role.color,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2">{role.label}</Typography>
                    </Box>
                  </TableCell>

                  {matrix.actions.map((action) => {
                    // The admin (wildcard) role is never overridable — that is
                    // the escape hatch that keeps an instance recoverable.
                    if (role.is_wildcard) {
                      return (
                        <TableCell key={action.key} align="center">
                          <Tooltip title={t("metamodel.permissionsPanel.adminLocked")}>
                            <span>
                              <MaterialSymbol icon="lock" size={18} color="#9e9e9e" />
                            </span>
                          </Tooltip>
                        </TableCell>
                      );
                    }

                    // View denied for the whole type → every other action on
                    // it is denied too. The stored cells are kept (they come
                    // back if View is reset), but they are not editable
                    // meanwhile. A View deny scoped to some subtypes is left
                    // alone: it only decides for those subtypes, so locking
                    // the row would hide cells that still apply to the rest.
                    if (
                      action.key !== VIEW_ACTION &&
                      cellState(draft, role.key, VIEW_ACTION) === "deny" &&
                      cellSubtypes(draft, role.key, VIEW_ACTION).length === 0
                    ) {
                      return (
                        <TableCell key={action.key} align="center">
                          <Tooltip title={t("metamodel.permissionsPanel.lockedByView")}>
                            <span aria-label={t("metamodel.permissionsPanel.lockedByView")}>
                              <MaterialSymbol icon="visibility_off" size={18} color="#9e9e9e" />
                            </span>
                          </Tooltip>
                        </TableCell>
                      );
                    }

                    const state = cellState(draft, role.key, action.key);
                    const inherited = !!role.inherited[action.key];
                    const scopedSubtypes = cellSubtypes(draft, role.key, action.key);
                    const showScopeControl = state !== "inherit" && matrix.subtypes.length > 0;
                    return (
                      <TableCell key={action.key} align="center" sx={{ px: 0.5 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                          <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={state}
                            onChange={(_, v) => {
                              if (v) setCell(role.key, action.key, v as CellState);
                            }}
                            aria-label={`${role.label} ${actionLabel(action.key)}`}
                          >
                            <ToggleButton
                              value="inherit"
                              aria-label={t("metamodel.permissionsPanel.inherit")}
                            >
                              <Tooltip
                                title={t(
                                  inherited
                                    ? "metamodel.permissionsPanel.inheritedAllowed"
                                    : "metamodel.permissionsPanel.inheritedDenied"
                                )}
                              >
                                <span style={{ display: "flex" }}>
                                  <MaterialSymbol
                                    icon={inherited ? "check" : "close"}
                                    size={16}
                                    color={inherited ? "#2e7d32" : "#9e9e9e"}
                                  />
                                </span>
                              </Tooltip>
                            </ToggleButton>
                            <ToggleButton
                              value="allow"
                              aria-label={t("metamodel.permissionsPanel.allow")}
                            >
                              <Tooltip title={t("metamodel.permissionsPanel.allow")}>
                                <span style={{ display: "flex" }}>
                                  <MaterialSymbol icon="check_circle" size={16} color="#2e7d32" />
                                </span>
                              </Tooltip>
                            </ToggleButton>
                            <ToggleButton
                              value="deny"
                              aria-label={t("metamodel.permissionsPanel.deny")}
                            >
                              <Tooltip title={t("metamodel.permissionsPanel.deny")}>
                                <span style={{ display: "flex" }}>
                                  <MaterialSymbol icon="block" size={16} color="#c62828" />
                                </span>
                              </Tooltip>
                            </ToggleButton>
                          </ToggleButtonGroup>
                          {showScopeControl && (
                            <Tooltip
                              title={
                                scopedSubtypes.length > 0
                                  ? t("metamodel.permissionsPanel.scope.scopedTooltip", {
                                      subtypes: scopedSubtypes
                                        .map(
                                          (key) =>
                                            matrix.subtypes.find((s) => s.key === key)?.label ??
                                            key
                                        )
                                        .join(", "),
                                    })
                                  : t("metamodel.permissionsPanel.scope.allTooltip")
                              }
                            >
                              <IconButton
                                size="small"
                                onClick={(e) =>
                                  setScopeAnchor({
                                    el: e.currentTarget,
                                    roleKey: role.key,
                                    action: action.key,
                                  })
                                }
                                aria-label={t("metamodel.permissionsPanel.scope.button")}
                              >
                                <MaterialSymbol
                                  icon="tune"
                                  size={16}
                                  color={scopedSubtypes.length > 0 ? "#1976d2" : "#9e9e9e"}
                                />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    );
                  })}

                  <TableCell align="right" sx={{ width: 48 }}>
                    {!role.is_wildcard && (
                      <Tooltip title={t("metamodel.permissionsPanel.resetRow")}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!hasOverrides}
                            onClick={() => resetRole(role.key)}
                            aria-label={t("metamodel.permissionsPanel.resetRow")}
                          >
                            <MaterialSymbol icon="restart_alt" size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button variant="contained" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? t("metamodel.permissionsPanel.saving") : t("common:actions.save")}
        </Button>
        <Button
          variant="text"
          color="inherit"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(original);
            setSaveError(null);
          }}
        >
          {t("common:actions.cancel")}
        </Button>
      </Box>

      <Popover
        open={!!scopeAnchor}
        anchorEl={scopeAnchor?.el}
        onClose={() => setScopeAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 2, minWidth: 220 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {t("metamodel.permissionsPanel.scope.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("metamodel.permissionsPanel.scope.hint")}
          </Typography>
          <FormGroup>
            {matrix.subtypes.map((subtype) => {
              const current = scopeAnchor
                ? cellSubtypes(draft, scopeAnchor.roleKey, scopeAnchor.action)
                : [];
              const checked = current.includes(subtype.key);
              return (
                <FormControlLabel
                  key={subtype.key}
                  control={
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={(_, isChecked) => {
                        if (!scopeAnchor) return;
                        const next = isChecked
                          ? [...current, subtype.key]
                          : current.filter((k) => k !== subtype.key);
                        setCellSubtypes(scopeAnchor.roleKey, scopeAnchor.action, next);
                      }}
                    />
                  }
                  label={subtype.label}
                />
              );
            })}
          </FormGroup>
        </Box>
      </Popover>
    </Box>
  );
}
