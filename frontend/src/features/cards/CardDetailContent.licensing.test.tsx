import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real AttributeSection, a marker for the Licensing section, every other section stubbed.
vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: () => ({ calculatedFields: {}, isCalculated: () => false, loading: false }),
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: { format: (v: number) => `$${v}` }, fmtShort: (v: number) => `$${v}`, symbol: "$" }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: false }) }));
vi.mock("@/hooks/useGrcEnabled", () => ({ useGrcEnabled: () => ({ grcEnabled: false }) }));
vi.mock("@/hooks/useCardTabActivity", () => ({
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: () => {} }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/EolLinkSection", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessFlowTab", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/SoAWTab", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/CostsSection", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/LicensingSection", () => ({
  default: ({ cardId, onEditModel }: { cardId: string; onEditModel?: () => void }) => (
    <div data-testid="licensing-section">
      {cardId}
      <button onClick={onEditModel}>edit-model</button>
    </div>
  ),
}));
vi.mock("@/features/cards/sections", async () => {
  const mod = (await vi.importActual("@/features/cards/sections/AttributeSection")) as {
    default: unknown;
  };
  const stub = () => null;
  return {
    AttributeSection: mod.default,
    DescriptionSection: stub,
    LifecycleSection: stub,
    HierarchySection: stub,
    SuccessorsSection: stub,
    RelationsSection: stub,
    LayeredDependencySection: stub,
    CommentsTab: stub,
    TodosTab: stub,
    StakeholdersTab: stub,
    ResourcesTab: stub,
    AdrsTab: stub,
    HistoryTab: stub,
    RisksTab: stub,
    ComplianceTab: stub,
    TagsSection: stub,
    DataQualityPill: stub,
  };
});

import { useMetamodel } from "@/hooks/useMetamodel";
import { resetExtensionHost } from "@/lib/extensionHost";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

const typeOf = (key: string, sectionConfig: Record<string, unknown> = {}) => ({
  key,
  label: key,
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
  subtypes: [],
  fields_schema: [
    { section: "Basics", fields: [{ key: "fieldA", label: "Indicator A", type: "text" }] },
    {
      section: "Application Information",
      fields: [{ key: "licensingModel", label: "Licensing model", type: "multiple_select" }],
    },
  ],
  section_config: sectionConfig,
});

const cardOf = (type: string) =>
  ({
    id: "card-1",
    name: "X",
    type,
    description: "",
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 50,
    lifecycle: {},
    attributes: { fieldA: "a" },
    tags: [],
    stakeholders: [],
  }) as unknown as Card;

const perms = { can_view: true, can_edit: true, can_view_costs: true } as unknown as Parameters<
  typeof CardDetailContent
>[0]["perms"];

function renderFor(type: string, sectionConfig: Record<string, unknown> = {}) {
  const def = typeOf(type, sectionConfig);
  vi.mocked(useMetamodel).mockReturnValue({
    types: [def],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === type ? def : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  return render(
    <MemoryRouter>
      <CardDetailContent
        card={cardOf(type)}
        perms={perms}
        onCardUpdate={() => {}}
        showLdvSection={false}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => resetExtensionHost());

describe("CardDetailContent licensing section", () => {
  it.each(["Application", "ITComponent"])("mounts the Licensing section for %s", async (type) => {
    renderFor(type);
    expect(await screen.findByTestId("licensing-section")).toHaveTextContent("card-1");
  });

  it("leaves another type unchanged: no Licensing section", async () => {
    renderFor("Initiative");
    expect(await screen.findByText("Indicator A")).toBeInTheDocument();
    expect(screen.queryByTestId("licensing-section")).not.toBeInTheDocument();
  });

  it("honours the admin hiding the section", async () => {
    renderFor("Application", { licensing: { hidden: true } });
    expect(await screen.findByText("Indicator A")).toBeInTheDocument();
    expect(screen.queryByTestId("licensing-section")).not.toBeInTheDocument();
  });

  it("the model Edit link scrolls to the section that holds licensingModel", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const user = userEvent.setup();
    renderFor("Application");
    await user.click(await screen.findByRole("button", { name: "edit-model" }));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    const target = scroll.mock.instances[0] as HTMLElement;
    expect(target.id).toBe("card-section-custom-application-information");
  });
});
