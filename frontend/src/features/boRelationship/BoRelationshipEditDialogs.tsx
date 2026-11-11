import { useId, useState, type ReactNode } from "react";
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Stack, TextField, Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSubtypeLabel } from "@/hooks/useResolveLabel";
import type { BoApplication, BoNode } from "./BoRelationshipPage";
import { searchBoApplications } from "./boRelationshipSearch";
import { CARDINALITIES, type BoApplicationInput, type BoLinkInput, type BoObjectInput, type BoRole } from "./useBoDrawing";

type DialogProps = { onClose: () => void };

function StageDialog({
  title, action, ready, pending, onClose, onStage, children,
}: DialogProps & {
  title: string;
  action: string;
  ready: boolean;
  pending?: boolean;
  onStage: () => void;
  children: ReactNode;
}) {
  const { t: tCommon } = useTranslation("common");
  const titleId = useId();
  return (
    <Dialog open onClose={pending ? undefined : onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) onStage();
      }}>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>{children}</Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={onClose}>{tCommon("actions.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!ready || pending}>{action}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const nativeSelect = { select: { native: true } } as const;
const nameLimit = 500;

export function BoNewObjectDialog({ onClose, onStage, copy }: DialogProps & {
  onStage: (input: BoObjectInput) => void;
  copy?: BoNode;
}) {
  const { t } = useTranslation("reports");
  const id = useId();
  const { types } = useMetamodel();
  const subtypeLabel = useSubtypeLabel();
  const subtypes = types.find(({ key }) => key === "DataObject")?.subtypes ?? [];
  const [name, setName] = useState(() => copy ? t("boRelationship.copyName", { name: copy.name }) : "");
  const [subtype, setSubtype] = useState(copy?.subtype ?? "");
  const [isPersonalData, setPersonalData] = useState(copy?.isPersonalData ?? false);
  const [isPaymentData, setPaymentData] = useState(copy?.isPaymentData ?? false);
  const trimmedName = name.trim();
  const tooLong = [...trimmedName].length > nameLimit;
  return (
    <StageDialog
      title={t("boRelationship.newObject")}
      action={t("boRelationship.stageObject")}
      ready={!!trimmedName && !tooLong && subtypes.some(({ key }) => key === subtype)}
      onClose={onClose}
      onStage={() => onStage({ name: trimmedName, subtype, isPersonalData, isPaymentData })}
    >
      <TextField
        id={`${id}-name`} label={t("boRelationship.objectName")}
        value={name} onChange={(event) => setName(event.target.value)} autoFocus
        error={tooLong}
        helperText={tooLong ? t("boRelationship.objectNameTooLong", { max: nameLimit }) : undefined}
      />
      <TextField
        id={`${id}-subtype`} label={t("boRelationship.subtype")} value={subtype}
        select slotProps={nativeSelect} onChange={(event) => setSubtype(event.target.value)}
      >
        <option value="" />
        {subtypes.map((item) => <option key={item.key} value={item.key}>{subtypeLabel(item)}</option>)}
      </TextField>
      <FormControlLabel
        control={<Checkbox checked={isPersonalData} onChange={(_, checked) => setPersonalData(checked)} />}
        label={t("boRelationship.personalData")}
      />
      <FormControlLabel
        control={<Checkbox checked={isPaymentData} onChange={(_, checked) => setPaymentData(checked)} />}
        label={t("boRelationship.paymentData")}
      />
    </StageDialog>
  );
}

export function BoRenameDialog({ object, error, pending, onClose, onRename }: DialogProps & {
  object: BoNode;
  error: string;
  pending: boolean;
  onRename: (name: string) => void;
}) {
  const { t } = useTranslation(["reports", "archimate", "common"]);
  const [name, setName] = useState(object.name);
  const trimmed = name.trim();
  const tooLong = [...trimmed].length > nameLimit;
  return (
    <StageDialog
      title={t("archimate:shortcuts.edit")}
      action={t("common:actions.save")}
      ready={!!trimmed && !tooLong && trimmed !== object.name}
      pending={pending}
      onClose={onClose}
      onStage={() => onRename(trimmed)}
    >
      {error && <Alert severity="error">{error}</Alert>}
      <TextField label={t("boRelationship.objectName")} value={name} autoFocus disabled={pending}
        onChange={(event) => setName(event.target.value)} error={tooLong}
        helperText={tooLong ? t("boRelationship.objectNameTooLong", { max: nameLimit }) : undefined} />
    </StageDialog>
  );
}

export function BoObjectLinkDialog({
  source, targets, onClose, onStage,
}: DialogProps & { source: BoNode; targets: BoNode[]; onStage: (input: BoLinkInput) => void }) {
  const { t } = useTranslation("reports");
  const id = useId();
  const [target, setTarget] = useState("");
  const [cardinality, setCardinality] = useState<BoLinkInput["cardinality"]>(null);
  return (
    <StageDialog
      title={t("boRelationship.linkObjects")}
      action={t("boRelationship.stageLink")}
      ready={targets.some((item) => item.id === target)}
      onClose={onClose}
      onStage={() => onStage({ source: source.id, target, cardinality })}
    >
      <Typography>{source.name}</Typography>
      <TextField
        id={`${id}-target`} label={t("boRelationship.targetObject")} value={target}
        select slotProps={nativeSelect} onChange={(event) => setTarget(event.target.value)}
      >
        <option value="" />
        {targets.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
      </TextField>
      <TextField
        id={`${id}-cardinality`} label={t("boRelationship.cardinality")} value={cardinality ?? ""}
        select slotProps={nativeSelect}
        onChange={(event) => {
          const selected = CARDINALITIES.find((item) => item === event.target.value);
          setCardinality(selected ?? null);
        }}
      >
        <option value="">{t("boRelationship.unspecifiedCardinality")}</option>
        {CARDINALITIES.map((value) => <option key={value} value={value}>{value}</option>)}
      </TextField>
    </StageDialog>
  );
}

export function BoApplicationLinkDialog({
  object, excludeIds, canManageMaster, master, pendingMaster, onClose, onStage,
}: DialogProps & {
  object: BoNode;
  excludeIds: string[];
  canManageMaster: boolean;
  master?: BoApplication | null;
  pendingMaster?: BoApplication;
  onStage: (input: BoApplicationInput) => void;
}) {
  const { t } = useTranslation("reports");
  const id = useId();
  const [application, setApplication] = useState<CardOption | null>(null);
  const [role, setRole] = useState<BoRole>(master || pendingMaster ? "slave" : "unclassified");
  const baseRole = master || pendingMaster ? "slave" : "unclassified";
  const roles: BoRole[] = [baseRole];
  if (canManageMaster && !pendingMaster) roles.push("master");
  return (
    <StageDialog
      title={t("boRelationship.linkApplication")}
      action={t("boRelationship.stageLink")}
      ready={!!application && roles.includes(role)}
      onClose={onClose}
      onStage={() => {
        if (application) {
          onStage({ objectId: object.id, application: { id: application.id, name: application.name }, role });
        }
      }}
    >
      <Typography>{object.name}</Typography>
      <CardPicker
        types="Application"
        searchSource={searchBoApplications}
        label={t("boRelationship.application")}
        value={application}
        onChange={setApplication}
        excludeIds={excludeIds}
        pageSize={20}
      />
      <TextField
        id={`${id}-role`} label={t("boRelationship.role")} value={role}
        select slotProps={nativeSelect}
        onChange={(event) => {
          const selected = roles.find((item) => item === event.target.value);
          if (selected) setRole(selected);
        }}
      >
        {roles.map((value) => <option key={value} value={value}>{t(`boRelationship.${value}`)}</option>)}
      </TextField>
      {role === "master" && master && (
        <Typography color="text.secondary">{t("boRelationship.replaceMaster", { name: master.name })}</Typography>
      )}
    </StageDialog>
  );
}
