/**
 * Merges what the editor shows (the first view, edited) back into the loaded model.
 *
 * The editor only sees the first view, so it may only delete what that view owned: an element or
 * relationship survives when it is still drawn, when another view draws it, or when the first view
 * never drew it (the file defined it; it is not ours to delete). These are the data-loss guards.
 */
import {
  withCardDefinition,
  type ArchimateModel,
  type ModelElement,
  type ModelRelationship,
  type ModelView,
} from "../exchange/exchangeModel";

export interface EditedView { view: ModelView; elements: ModelElement[]; relationships: ModelRelationship[] }

/** Base items in base order (the edited copy wins), then the brand-new ones. */
function merge<T extends { id: string }>(base: T[], edited: T[], keep: (item: T) => boolean): T[] {
  const byId = new Map(edited.map((e) => [e.id, e]));
  const baseIds = new Set(base.map((b) => b.id));
  const kept: T[] = [];
  for (const b of base) {
    const e = byId.get(b.id);
    if (e) kept.push(e);
    else if (keep(b)) kept.push(b);
  }
  return [...kept, ...edited.filter((e) => !baseIds.has(e.id))];
}

export function reconcileModel(base: ArchimateModel, edited: EditedView): ArchimateModel {
  const [first, ...others] = base.views;
  const onFirstNodes = new Set(first?.nodes.map((n) => n.elementRef));
  const onOtherNodes = new Set(others.flatMap((v) => v.nodes.map((n) => n.elementRef)));
  const onFirstConns = new Set(first?.connections.map((c) => c.relationshipRef));
  const onOtherConns = new Set(others.flatMap((v) => v.connections.map((c) => c.relationshipRef)));

  const elements = merge(base.elements, edited.elements, (e) => !onFirstNodes.has(e.id) || onOtherNodes.has(e.id));
  let relationships = merge(
    base.relationships, edited.relationships, (r) => !onFirstConns.has(r.id) || onOtherConns.has(r.id),
  );
  // Both endpoints must survive; an endpoint may itself be a relationship, so drop until stable.
  for (let size = -1; size !== relationships.length; ) {
    size = relationships.length;
    const ends = new Set([...elements.map((e) => e.id), ...relationships.map((r) => r.id)]);
    relationships = relationships.filter((r) => ends.has(r.source) && ends.has(r.target));
  }

  return withCardDefinition({ ...base, elements, relationships, views: [edited.view, ...others] });
}
