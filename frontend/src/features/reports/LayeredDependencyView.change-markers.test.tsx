import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LdvNode,
  changeKindPresentation,
} from "./LayeredDependencyView";
import type {
  DependencyChangeKind,
  LdvNodeData,
} from "./layeredDependencyLayout";

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    Handle: () => null,
  };
});

const ACCENT = "#123456";

const BASE_DATA: LdvNodeData = {
  name: "Database Node",
  typeKey: "ITComponent",
  typeLabel: "IT Component",
  typeColor: ACCENT,
  typeIcon: "",
  category: "Technical Architecture",
};

function renderNode(changeKind?: DependencyChangeKind) {
  const props = {
    id: "n1",
    data: { ...BASE_DATA, changeKind },
    selected: false,
  } as unknown as ComponentProps<typeof LdvNode>;
  return render(<LdvNode {...props} />);
}

describe("changeKindPresentation", () => {
  it("keeps AS-IS presentation unchanged", () => {
    expect(changeKindPresentation(undefined, ACCENT)).toEqual({
      badgeKey: null,
      borderStyle: "solid",
      opacity: 1,
    });
  });

  it("maps every supported marker to its native badge", () => {
    expect(changeKindPresentation("added", ACCENT).badgeKey).toBe(
      "dependency.addedBadge",
    );
    expect(changeKindPresentation("modified", ACCENT).badgeKey).toBe(
      "dependency.modifiedBadge",
    );
    expect(changeKindPresentation("removed", ACCENT)).toMatchObject({
      badgeKey: "dependency.removedBadge",
      opacity: 0.62,
    });
    expect(changeKindPresentation("potentialImpact", ACCENT).badgeKey).toBe(
      "dependency.potentialImpactBadge",
    );
  });
});

describe("LDV change marker rendering", () => {
  it("renders an AS-IS node without a change badge", () => {
    renderNode();

    expect(screen.getByRole("button")).not.toHaveAttribute("data-change-kind");
    for (const label of ["NEW", "MODIFIED", "REMOVED", "POTENTIAL IMPACT"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it.each([
    ["added", "NEW"],
    ["modified", "MODIFIED"],
    ["removed", "REMOVED"],
    ["potentialImpact", "POTENTIAL IMPACT"],
  ] as const)("renders the localized %s badge using the metamodel accent", (kind, label) => {
    renderNode(kind);

    const card = screen.getByRole("button");
    expect(card).toHaveAttribute("data-change-kind", kind);
    expect(card).toHaveStyle({ borderColor: ACCENT });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

