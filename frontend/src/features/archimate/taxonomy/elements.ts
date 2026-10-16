/** ArchiMate 3.x element taxonomy (the 62 names of the Open Group Exchange XSD 3.1). */

export type ArchimateLayer =
  | "strategy" | "business" | "application" | "technology"
  | "physical" | "motivation" | "implementation" | "other";
export type ElementAspect = "active" | "behavior" | "passive" | "composite" | "motivation" | "connector";

// Layer by layer, in palette order.
export const ELEMENT_TYPES = [
  // strategy
  "Resource", "Capability", "ValueStream", "CourseOfAction",
  // business
  "BusinessActor", "BusinessRole", "BusinessCollaboration", "BusinessInterface", "BusinessProcess",
  "BusinessFunction", "BusinessInteraction", "BusinessEvent", "BusinessService", "BusinessObject",
  "Contract", "Representation", "Product",
  // application
  "ApplicationComponent", "ApplicationCollaboration", "ApplicationInterface", "ApplicationFunction",
  "ApplicationInteraction", "ApplicationProcess", "ApplicationEvent", "ApplicationService", "DataObject",
  // technology
  "Node", "Device", "SystemSoftware", "TechnologyCollaboration", "TechnologyInterface", "Path",
  "CommunicationNetwork", "TechnologyFunction", "TechnologyProcess", "TechnologyInteraction",
  "TechnologyEvent", "TechnologyService", "Artifact",
  // physical
  "Equipment", "Facility", "DistributionNetwork", "Material",
  // motivation
  "Stakeholder", "Driver", "Assessment", "Goal", "Outcome", "Principle", "Requirement", "Constraint",
  "Meaning", "Value",
  // implementation & migration
  "WorkPackage", "Deliverable", "ImplementationEvent", "Plateau", "Gap",
  // other
  "Grouping", "Location", "AndJunction", "OrJunction",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export interface ElementInfo {
  type: ElementType;
  layer: ArchimateLayer;
  aspect: ElementAspect;
  width: number;
  height: number;
}

export const LAYER_ORDER: ArchimateLayer[] = [
  "strategy", "business", "application", "technology", "physical", "motivation", "implementation", "other",
];

const LAYER_SIZES: [ArchimateLayer, number][] = [
  ["strategy", 4], ["business", 13], ["application", 9], ["technology", 13],
  ["physical", 4], ["motivation", 10], ["implementation", 5], ["other", 4],
];

const ACTIVE = new Set<string>([
  "BusinessActor", "BusinessRole", "BusinessCollaboration", "BusinessInterface", "ApplicationComponent",
  "ApplicationCollaboration", "ApplicationInterface", "Node", "Device", "SystemSoftware",
  "TechnologyCollaboration", "TechnologyInterface", "Path", "CommunicationNetwork", "Equipment",
  "Facility", "DistributionNetwork", "Resource",
]);
const BEHAVIOR_EXTRA = new Set<string>(["Capability", "ValueStream", "CourseOfAction", "WorkPackage", "ImplementationEvent"]);
const PASSIVE = new Set<string>([
  "BusinessObject", "Contract", "Representation", "DataObject", "Artifact", "Material", "Deliverable",
]);
const COMPOSITE = new Set<string>(["Product", "Plateau", "Gap", "Grouping", "Location"]);
const CONNECTOR = new Set<string>(["AndJunction", "OrJunction"]);

/** A junction (And/Or): a 15px connector with no name, never a parent. */
export const isConnector = (type: string): boolean => CONNECTOR.has(type);

function aspectOf(type: string, layer: ArchimateLayer): ElementAspect {
  if (layer === "motivation") return "motivation";
  if (CONNECTOR.has(type)) return "connector";
  if (COMPOSITE.has(type)) return "composite";
  if (PASSIVE.has(type)) return "passive";
  if (ACTIVE.has(type)) return "active";
  if (BEHAVIOR_EXTRA.has(type) || /(Process|Function|Interaction|Event|Service)$/.test(type)) return "behavior";
  throw new Error(`no aspect for ${type}`);
}

function sizeOf(type: string): { width: number; height: number } {
  if (CONNECTOR.has(type)) return { width: 15, height: 15 };
  if (type === "Grouping") return { width: 200, height: 120 };
  return { width: 120, height: 55 };
}

export const ELEMENT_INFO = (() => {
  const info = {} as Record<ElementType, ElementInfo>;
  let i = 0;
  for (const [layer, n] of LAYER_SIZES)
    for (const type of ELEMENT_TYPES.slice(i, (i += n)))
      info[type] = { type, layer, aspect: aspectOf(type, layer), ...sizeOf(type) };
  return info;
})();

const TYPE_SET = new Set<string>(ELEMENT_TYPES);
export function isElementType(v: unknown): v is ElementType {
  return typeof v === "string" && TYPE_SET.has(v);
}

export function layerOf(type: ElementType): ArchimateLayer {
  return ELEMENT_INFO[type].layer;
}

export function elementsOfLayer(layer: ArchimateLayer): ElementType[] {
  return ELEMENT_TYPES.filter((t) => ELEMENT_INFO[t].layer === layer);
}
