import type { CardType } from "@/types";
import CardMappingTabContent from "./CardMappingTabContent";

interface Props {
  /** Forwarded to `CardMappingTabContent`'s bridge-table editor -- fetched
   *  once by `MetamodelAdmin` and shared with every tab, no second fetch. */
  types: CardType[];
}

/**
 * The Architecture Studio tab. "Relations Mapping" (RelationsMappingTabContent)
 * is hidden -- the generated standard ArchiMate relation matrix is too
 * restrictive to be useful (most structural relation columns only ever
 * resolve to Grouping/And/OrJunction as a valid target); the component is
 * kept in the repo, just not routed to, in case the matrix source improves.
 */
export default function ArchitectureStudioTab({ types }: Props) {
  return <CardMappingTabContent types={types} />;
}
