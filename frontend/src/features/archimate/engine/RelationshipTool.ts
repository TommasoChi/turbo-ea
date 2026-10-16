/** Which relationship the NEXT connect gesture draws (set by the palette/context pad, spent by one gesture). */
import type EventBus from "diagram-js/lib/core/EventBus";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

export class RelationshipTool {
  static $inject = ["eventBus"];

  current: RelationshipType | null = null;
  accessType: AccessType | null = null;

  constructor(eventBus: EventBus) {
    // Above Connect's own end handler (which returns false for a refused drop and would stop later ones).
    eventBus.on("connect.end", 1500, () => this.clear());
    eventBus.on("connect.cleanup", () => this.clear());
  }

  set(type: RelationshipType, accessType?: AccessType): void {
    this.current = type;
    this.accessType = accessType ?? null;
  }

  clear(): void {
    this.current = null;
    this.accessType = null;
  }
}
