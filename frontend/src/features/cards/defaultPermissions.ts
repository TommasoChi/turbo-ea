import type { CardEffectivePermissions } from "@/types";

type Effective = CardEffectivePermissions["effective"];

/**
 * What a card view assumes until `/my-permissions` answers, and for good when it
 * fails: open for ordinary editing, closed for stakeholder management and
 * costs. A key added to `CardEffectivePermissions` is decided here, once.
 */
export const DEFAULT_CARD_PERMISSIONS: Effective = {
  can_view: true,
  can_edit: true,
  can_archive: true,
  can_delete: true,
  can_approval_status: true,
  can_manage_stakeholders: false,
  can_manage_relations: true,
  can_manage_documents: true,
  can_manage_comments: true,
  can_create_comments: true,
  can_bpm_edit: true,
  can_bpm_manage_drafts: true,
  can_bpm_approve: true,
  can_manage_adr_links: true,
  can_manage_diagram_links: true,
  can_view_costs: false,
  can_edit_costs: false,
};

/** Nothing writable and no costs; for a view that must not guess (an Initiative's PML page). */
export const CLOSED_CARD_PERMISSIONS: Effective = {
  ...(Object.fromEntries(
    Object.keys(DEFAULT_CARD_PERMISSIONS).map((k) => [k, false]),
  ) as unknown as Effective),
  can_view: true,
};
