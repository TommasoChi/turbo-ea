/**
 * The Diagrams gallery's filter sidebar: scope (all/mine/favorites/group),
 * the drawio/archimate type filter with its layer -> viewpoint cascade, and
 * the Groups list with its split Draw.io/ArchiMate counts.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramsFilterSidebar, { DEFAULT_TYPE_FILTER } from "./DiagramsFilterSidebar";
import type { ArchimateViewpoint, DiagramGroup } from "@/types";

const GROUPS: DiagramGroup[] = [
  {
    id: "g1",
    name: "Architecture",
    color: "#ff0000",
    sort_order: 0,
    diagram_count: 3,
    diagram_count_drawio: 2,
    diagram_count_archimate: 1,
  },
];

const VIEWPOINTS: ArchimateViewpoint[] = [
  {
    key: "vp-biz",
    name: "Business VP",
    icon: "hub",
    description: null,
    layer: "business",
    is_standard: true,
    is_hidden: false,
    sort_order: 0,
    objects: [],
    domains: ["business"],
    examples: [],
  },
  {
    key: "vp-tech",
    name: "Tech VP",
    icon: "hub",
    description: null,
    layer: "technology",
    is_standard: true,
    is_hidden: false,
    sort_order: 1,
    objects: [],
    domains: ["technology"],
    examples: [],
  },
];

type Overrides = Partial<React.ComponentProps<typeof DiagramsFilterSidebar>>;

function renderSidebar(overrides: Overrides = {}) {
  const onScopeChange = vi.fn();
  const onTypeFilterChange = vi.fn();
  const onManageGroups = vi.fn();
  const onToggleCollapse = vi.fn();
  const onWidthChange = vi.fn();
  const user = userEvent.setup();
  const result = render(
    <DiagramsFilterSidebar
      scope={{ kind: "all" }}
      onScopeChange={onScopeChange}
      groups={GROUPS}
      onManageGroups={onManageGroups}
      collapsed={false}
      onToggleCollapse={onToggleCollapse}
      width={280}
      onWidthChange={onWidthChange}
      typeFilter={DEFAULT_TYPE_FILTER}
      onTypeFilterChange={onTypeFilterChange}
      showArchimateFilter={true}
      viewpoints={VIEWPOINTS}
      {...overrides}
    />,
  );
  return { ...result, user, onScopeChange, onTypeFilterChange, onManageGroups, onToggleCollapse };
}

describe("DiagramsFilterSidebar — type filter", () => {
  it("lists All types, Draw.io and ArchiMate when the archimate filter is allowed", () => {
    renderSidebar();
    expect(screen.getByText("All types")).toBeInTheDocument();
    expect(screen.getByText("Draw.io")).toBeInTheDocument();
    expect(screen.getByText("ArchiMate")).toBeInTheDocument();
  });

  it("hides the ArchiMate row when the caller disallows it", () => {
    renderSidebar({ showArchimateFilter: false });
    expect(screen.getByText("All types")).toBeInTheDocument();
    expect(screen.getByText("Draw.io")).toBeInTheDocument();
    expect(screen.queryByText("ArchiMate")).not.toBeInTheDocument();
  });

  it("marks the active kind row selected and no other", () => {
    renderSidebar({ typeFilter: { ...DEFAULT_TYPE_FILTER, kind: "drawio" } });
    expect(screen.getByText("Draw.io").closest("div[role], .MuiListItemButton-root")).toHaveClass(
      "Mui-selected",
    );
    expect(screen.getByText("All types").closest(".MuiListItemButton-root")).not.toHaveClass(
      "Mui-selected",
    );
  });

  it("picks a kind on click, resetting layer and viewpoint", async () => {
    const { user, onTypeFilterChange } = renderSidebar();
    await user.click(screen.getByText("Draw.io"));
    expect(onTypeFilterChange).toHaveBeenCalledWith({
      kind: "drawio",
      layer: null,
      viewpointKey: null,
    });
  });

  it("shows the layer/viewpoint cascade only once kind is archimate", () => {
    const { rerender } = renderSidebar({ typeFilter: { ...DEFAULT_TYPE_FILTER, kind: "drawio" } });
    expect(screen.queryByLabelText("Layer")).not.toBeInTheDocument();
    rerender(
      <DiagramsFilterSidebar
        scope={{ kind: "all" }}
        onScopeChange={vi.fn()}
        groups={GROUPS}
        onManageGroups={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        width={280}
        onWidthChange={vi.fn()}
        typeFilter={{ ...DEFAULT_TYPE_FILTER, kind: "archimate" }}
        onTypeFilterChange={vi.fn()}
        showArchimateFilter={true}
        viewpoints={VIEWPOINTS}
      />,
    );
    expect(screen.getByLabelText("Layer")).toBeInTheDocument();
  });

  it("offers only the layers present in the viewpoint catalog, in LAYER_ORDER", async () => {
    const { user } = renderSidebar({
      typeFilter: { ...DEFAULT_TYPE_FILTER, kind: "archimate" },
    });
    await user.click(screen.getByLabelText("Layer"));
    const listbox = screen.getByRole("listbox");
    const options = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    // business before technology (LAYER_ORDER), and strategy (no viewpoint) absent.
    expect(options).toEqual(["Any layer", "Business", "Technology"]);
  });

  it("shows the layer currently selected and clears the viewpoint on a new one", async () => {
    const { user, onTypeFilterChange } = renderSidebar({
      typeFilter: { kind: "archimate", layer: "business", viewpointKey: "vp-biz" },
    });
    expect(screen.getByLabelText("Layer")).toHaveTextContent("Business");
    await user.click(screen.getByLabelText("Layer"));
    await user.click(screen.getByRole("option", { name: "Technology" }));
    expect(onTypeFilterChange).toHaveBeenCalledWith({
      kind: "archimate",
      layer: "technology",
      viewpointKey: null,
    });
  });

  it("only offers the viewpoint select once a layer is picked, scoped to that layer", () => {
    renderSidebar({ typeFilter: { kind: "archimate", layer: null, viewpointKey: null } });
    expect(screen.queryByLabelText("Viewpoint")).not.toBeInTheDocument();
  });

  it("lists viewpoints of the chosen layer only, and picks one", async () => {
    const { user, onTypeFilterChange } = renderSidebar({
      typeFilter: { kind: "archimate", layer: "business", viewpointKey: null },
    });
    await user.click(screen.getByLabelText("Viewpoint"));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any viewpoint",
      "Business VP",
    ]);
    await user.click(screen.getByRole("option", { name: "Business VP" }));
    expect(onTypeFilterChange).toHaveBeenCalledWith({
      kind: "archimate",
      layer: "business",
      viewpointKey: "vp-biz",
    });
  });
});

describe("DiagramsFilterSidebar — active filter count", () => {
  it("shows no badge when scope and type are both at their default", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("counts a non-default scope alone as 1", () => {
    renderSidebar({ collapsed: true, scope: { kind: "mine" } });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("counts a non-default type filter alone as 1", () => {
    renderSidebar({ collapsed: true, typeFilter: { ...DEFAULT_TYPE_FILTER, kind: "drawio" } });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("counts both a non-default scope and type filter as 2, not their difference", () => {
    renderSidebar({
      collapsed: true,
      scope: { kind: "favorites" },
      typeFilter: { ...DEFAULT_TYPE_FILTER, kind: "archimate" },
    });
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("DiagramsFilterSidebar — Groups", () => {
  it("shows the empty hint and no per-kind header icons when there are no groups", () => {
    renderSidebar({ groups: [] });
    expect(screen.getByText("No groups yet")).toBeInTheDocument();
    // The type filter's own Draw.io/ArchiMate rows always render these icons
    // once, so count instances rather than asserting absence.
    expect(screen.getAllByText("schema")).toHaveLength(1);
    expect(screen.getAllByText("hub")).toHaveLength(1);
  });

  it("shows the Draw.io/ArchiMate header icons once there is at least one group", () => {
    renderSidebar();
    // One from the type filter's own row, one more from the Groups header.
    expect(screen.getAllByText("schema")).toHaveLength(2);
    expect(screen.getAllByText("hub")).toHaveLength(2);
  });

  it("shows each group's split counts with accessible labels", () => {
    renderSidebar();
    const drawioCount = screen.getByLabelText("Draw.io diagrams: 2");
    const archimateCount = screen.getByLabelText("ArchiMate diagrams: 1");
    expect(within(drawioCount).getByText("2")).toBeInTheDocument();
    expect(within(archimateCount).getByText("1")).toBeInTheDocument();
  });

  it("picks a group as the scope on click and opens Manage groups", async () => {
    const { user, onScopeChange, onManageGroups } = renderSidebar();
    await user.click(screen.getByText("Architecture"));
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "group", id: "g1" });
    await user.click(screen.getByText("Manage groups"));
    expect(onManageGroups).toHaveBeenCalledTimes(1);
  });
});

describe("DiagramsFilterSidebar — collapsed rail", () => {
  it("expands the sidebar on click", async () => {
    const { user, onToggleCollapse } = renderSidebar({ collapsed: true });
    await user.click(screen.getByRole("button"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
