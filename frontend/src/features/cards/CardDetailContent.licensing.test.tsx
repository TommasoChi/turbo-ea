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
  default: ({
    cardId,
    modelField,
    onSaveModel,
  }: {
    cardId: string;
    modelField?: { key: string };
    onSaveModel?: (next: string[]) => Promise<void>;
  }) => (
    <div data-testid="licensing-section">
      {cardId}
      <span data-testid="model-field">{modelField?.key}</span>
      <button onClick={() => onSaveModel?.(["users"])}>save-model</button>
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

import { api } from "@/api/client";
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
      section: "Licensing",
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

function renderFor(
  type: string,
  sectionConfig: Record<string, unknown> = {},
  permissions: typeof perms = perms,
) {
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
        perms={permissions}
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

  it("does not render licensingModel (nor its dedicated section) as a generic field", async () => {
    renderFor("Application");
    expect(await screen.findByTestId("licensing-section")).toBeInTheDocument();
    expect(screen.getByText("Indicator A")).toBeInTheDocument();
    expect(screen.queryByText("Licensing model")).not.toBeInTheDocument();
    expect(document.getElementById("card-section-custom-licensing")).toBeNull();
  });

  it("hands the Licensing section the model field and a save that merges the attributes", async () => {
    const user = userEvent.setup();
    renderFor("Application");
    expect(await screen.findByTestId("model-field")).toHaveTextContent("licensingModel");
    await user.click(screen.getByRole("button", { name: "save-model" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/cards/card-1", {
        attributes: { fieldA: "a", licensingModel: ["users"] },
      }),
    );
  });

  it("offers no model save to a reader", async () => {
    renderFor("Application", {}, { ...perms, can_edit: false });
    await screen.findByTestId("licensing-section");
    await userEvent.setup().click(screen.getByRole("button", { name: "save-model" }));
    expect(api.patch).not.toHaveBeenCalled();
  });
});
