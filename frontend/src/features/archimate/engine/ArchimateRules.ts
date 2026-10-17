/**
 * The modeling rules: which connections the relation matrix allows, and where shapes may be nested.
 *
 * `connection.create` answers `false` or the `{ relationship, accessType? }` attrs diagram-js's Connect
 * hands to `modeling.connect` (a bare `true` would create a connection with no type).
 */
import RuleProvider from "diagram-js/lib/features/rules/RuleProvider";
import type EventBus from "diagram-js/lib/core/EventBus";
import type { Element } from "diagram-js/lib/model/Types";
import { ELEMENT_INFO, isConnector, type ElementType } from "../taxonomy/elements";
import { isRelationshipAllowed, type AccessType, type RelationshipType } from "../taxonomy/relationships";
import type { RelationshipTool } from "./RelationshipTool";

/** The smallest a shape may be resized to (applied to every resize through the context `minDimensions`). */
export const MIN_SIZE = { width: 30, height: 20 } as const;

type ConnectionAttrs = { relationship: RelationshipType; accessType?: AccessType };
type ConnectionElement = Element & { businessObject: { type: RelationshipType } };

/** `null` is the canvas root. */
export function canNestIn(parentType: ElementType | null): boolean {
  return parentType === null || !isConnector(parentType);
}

export function connectionAttrs(
  sourceType: string,
  targetType: string,
  tool: { current: RelationshipType | null; accessType: AccessType | null },
): ConnectionAttrs | false {
  const relationship = tool.current;
  if (!relationship || !isRelationshipAllowed(sourceType, targetType, relationship)) return false;
  return relationship === "Access"
    ? { relationship, accessType: tool.accessType ?? "Access" }
    : { relationship };
}

/** The element type of a shape, or undefined for the root, a label or a connection. */
function elementTypeOf(element: Element | undefined): ElementType | undefined {
  const type = (element as { businessObject?: { type?: string } } | undefined)?.businessObject?.type;
  return !(element as { waypoints?: unknown } | undefined)?.waypoints && type && type in ELEMENT_INFO
    ? (type as ElementType)
    : undefined;
}

/** The type of a nesting target; `null` for the root, `undefined` for anything that cannot hold shapes. */
function parentTypeOf(target: Element | undefined): ElementType | null | undefined {
  if (!target || (target as { waypoints?: unknown }).waypoints) return undefined;
  return (target as { businessObject?: unknown }).businessObject ? elementTypeOf(target) : null;
}

export default class ArchimateRules extends RuleProvider {
  static $inject = ["eventBus", "relationshipTool"];

  constructor(eventBus: EventBus, private readonly relationshipTool: RelationshipTool) {
    super(eventBus); // calls init(); the rules below only read relationshipTool once they run
    // Resize reads minDimensions from the context at resize.start (as bpmn-js's ResizeBehavior sets it).
    eventBus.on("resize.start", 1500, ({ context }: { context: { minDimensions?: typeof MIN_SIZE } }) => {
      context.minDimensions = MIN_SIZE;
    });
  }

  init(): void {
    const attrs = (source: Element, target: Element, tool: Pick<RelationshipTool, "current" | "accessType">) => {
      const sourceType = elementTypeOf(source);
      const targetType = elementTypeOf(target);
      if (!sourceType || !targetType || source === target) return false;
      return connectionAttrs(sourceType, targetType, tool);
    };

    this.addRule("connection.create", 1500, ({ source, target }: { source: Element; target: Element }) =>
      attrs(source, target, this.relationshipTool),
    );

    // The existing relationship must stay allowed between the new ends.
    this.addRule("connection.reconnect", 1500, ({ connection, source, target }: { connection: Element; source: Element; target: Element }) =>
      attrs(source, target, { current: (connection as ConnectionElement).businessObject.type, accessType: null }) !== false,
    );

    const canDrop = (target: Element) => {
      const parent = parentTypeOf(target);
      return parent !== undefined && canNestIn(parent);
    };
    this.addRule(["shape.create", "elements.create"], 1500, ({ target }: { target: Element }) => canDrop(target)); // elements.create: paste
    // No target: a keyboard move, which keeps the parent.
    this.addRule("elements.move", 1500, ({ target }: { target?: Element }) => !target || canDrop(target));

    this.addRule("shape.resize", 1500, ({ shape }: { shape: Element }) => {
      const type = elementTypeOf(shape);
      return type === undefined || !isConnector(type);
    });
    this.addRule(["elements.delete", "connection.start", "element.copy"], 1500, () => true);
  }
}
