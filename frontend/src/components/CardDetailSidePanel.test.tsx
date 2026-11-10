/**
 * The card preview drawer is modal by default — every caller (and the
 * extension SDK) relies on that — and non-modal on request. The Inventory asks
 * for the non-modal form so the grid and filter sidebar beside the panel stay
 * usable while a card is previewed (#1289).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import CardDetailSidePanel from "./CardDetailSidePanel";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ getType: () => undefined, types: [], relationTypes: [] }),
}));
vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({ aiStatus: { enabled: false, configured: false, enabled_types: [] } }),
  aiSuggestEnabledFor: () => false,
}));
// The real content drags in the whole card-detail graph; this suite is about
// the drawer around it.
vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({
    card,
    onCardUpdate,
    onSaveOrigin,
  }: {
    card: { name: string; data_quality: number };
    onCardUpdate: (c: unknown) => void;
    onSaveOrigin?: (anchor: string) => void;
  }) => (
    <div data-testid="card-content">
      {card.name}
      <button type="button" onClick={() => onCardUpdate({ ...card, data_quality: 60 })}>
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          onSaveOrigin?.("card-section-lifecycle");
          onCardUpdate({ ...card, data_quality: 40 });
        }}
      >
        Clear lifecycle
      </button>
    </div>
  ),
}));
vi.mock("@/features/cards/gamification/GainFlight", () => ({
  GainFlight: ({
    gain,
    targetEl,
    onImpact,
  }: {
    gain: { nonce: number; delta: number; originAnchor: string | null };
    targetEl: HTMLElement | null;
    onImpact: (nonce: number) => void;
  }) => (
    <button
      type="button"
      data-testid="flight"
      data-origin={gain.originAnchor ?? ""}
      data-delta={String(gain.delta)}
      data-target={targetEl?.getAttribute("data-testid") ?? "none"}
      onClick={() => onImpact(gain.nonce)}
    >
      Land
    </button>
  ),
}));
vi.mock("@/features/cards/sections", () => ({
  DataQualityPill: ({
    value,
    animate,
    gain,
    impactNonce,
    onRootRef,
  }: {
    value: number;
    animate?: boolean;
    gain?: { delta: number } | null;
    impactNonce?: number | null;
    onRootRef?: (el: HTMLElement | null) => void;
  }) => (
    <span
      ref={onRootRef}
      data-impact={String(impactNonce)}
      data-testid="dq-pill"
      data-value={value}
      data-animate={String(!!animate)}
      data-gain={gain ? String(gain.delta) : ""}
    />
  ),
}));
const gamification = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/hooks/useGamificationEnabled", () => ({
  useGamificationEnabled: () => gamification.enabled,
}));

import { api } from "@/api/client";

const CARD = {
  id: "c1",
  name: "SAP ERP",
  type: "Application",
  subtype: null,
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 50,
  lifecycle: {},
  attributes: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  gamification.enabled = false;
  document.body.style.overflow = "";
  vi.mocked(api.get).mockImplementation((path: string) =>
    path.endsWith("/my-permissions")
      ? Promise.resolve({ effective: {} })
      : Promise.resolve(CARD),
  );
});

function mount(props: { nonModal?: boolean; open?: boolean } = {}) {
  const onClose = vi.fn();
  const onPage = vi.fn();
  const view = (open: boolean) => (
    <MemoryRouter>
      <button type="button" onClick={onPage}>
        Page behind
      </button>
      <CardDetailSidePanel cardId="c1" open={open} onClose={onClose} nonModal={props.nonModal} />
    </MemoryRouter>
  );
  const utils = render(view(props.open ?? true));
  return { ...utils, onClose, onPage, rerenderOpen: (open: boolean) => utils.rerender(view(open)) };
}

const backdrop = () => document.querySelector(".MuiBackdrop-root");
const panel = () => document.querySelector(".MuiDrawer-paper") as HTMLElement;
const closeButton = () => panel().querySelector("button") as HTMLButtonElement;

describe("CardDetailSidePanel — modal by default", () => {
  it("renders a backdrop, locks the page scroll and hides the page from assistive tech", async () => {
    mount();
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(backdrop()).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    // The Modal marks the page aria-hidden — the very reason the Inventory
    // cannot use this form.
    expect(screen.queryByRole("button", { name: "Page behind" })).toBeNull();
  });

  it("closes from the close button and from Escape", async () => {
    const { onClose } = mount();
    await screen.findByTestId("card-content");
    await userEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CardDetailSidePanel — nonModal", () => {
  it("renders no backdrop and no scroll lock", async () => {
    mount({ nonModal: true });
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(backdrop()).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("does not take focus, and leaves the page reachable and clickable without closing", async () => {
    const { onClose, onPage } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    expect(panel().contains(document.activeElement)).toBe(false);

    const behind = screen.getByRole("button", { name: "Page behind" });
    await userEvent.click(behind);
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(behind);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape inside the panel and from the close button", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    closeButton().focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores an Escape typed in the page, or one a nested control already consumed", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    screen.getByRole("button", { name: "Page behind" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    closeButton().dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores every key but Escape inside the panel", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    closeButton().focus();
    await userEvent.keyboard("a{Tab}{ArrowDown}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unmounts its content once closed, as the modal drawer does", async () => {
    const { rerenderOpen } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    rerenderOpen(false);
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
  });

  it("does not fetch while closed", () => {
    mount({ nonModal: true, open: false });
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("card-content")).toBeNull();
  });
});

describe("CardDetailSidePanel — gamified data quality", () => {
  it("hands the pill the save's gain when the toggle is on", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    const pill = screen.getByTestId("dq-pill");
    expect(pill).toHaveAttribute("data-animate", "true");
    expect(pill).toHaveAttribute("data-gain", "");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-value", "60");
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-gain", "10");
  });

  it("flies a section's change off the pill and hands the pill the impact", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear lifecycle" }));
    const flight = screen.getByTestId("flight");
    expect(flight).toHaveAttribute("data-origin", "card-section-lifecycle");
    expect(flight).toHaveAttribute("data-delta", "-10");
    expect(flight).toHaveAttribute("data-target", "dq-pill");
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-impact", "null");

    await userEvent.click(flight);
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-impact", "1");
  });

  it("flies nothing for a save that names no section", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
  });

  it("animates nothing when the toggle is off", async () => {
    mount();
    await screen.findByTestId("card-content");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const pill = screen.getByTestId("dq-pill");
    expect(pill).toHaveAttribute("data-value", "60");
    expect(pill).toHaveAttribute("data-animate", "false");
    expect(pill).toHaveAttribute("data-gain", "");
    await userEvent.click(screen.getByRole("button", { name: "Clear lifecycle" }));
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
  });
});

it("loads BO detail and permissions only from the scoped endpoint", async () => {
  vi.mocked(api.get).mockImplementation((path: string) => path === "/bo-relationship/objects/c1/detail"
    ? Promise.resolve({ card: CARD, permissions: { can_view: true, can_edit: false } })
    : Promise.reject(new Error("unexpected inventory read")));
  render(<MemoryRouter><CardDetailSidePanel cardId="c1" open onClose={() => {}} nonModal boScoped /></MemoryRouter>);
  expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
  expect(api.get).toHaveBeenCalledWith("/bo-relationship/objects/c1/detail", expect.anything());
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith("/cards/"))).toBe(false);
});

it("renders docked BO details inside their host without hiding the canvas", async () => {
  vi.mocked(api.get).mockResolvedValue({ card: CARD, permissions: { can_view: true } });
  const onClose = vi.fn();
  render(<MemoryRouter>
    <button>Diagram node</button>
    <aside aria-label="Details column">
      <CardDetailSidePanel cardId="c1" open onClose={onClose} docked boScoped />
    </aside>
  </MemoryRouter>);
  const details = await screen.findByTestId("card-content");
  expect(screen.getByRole("complementary", { name: "Details column" })).toContainElement(details);
  expect(screen.getByRole("button", { name: "Diagram node" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("does not replace the current card with a late BO detail response", async () => {
  let resolveFirst!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation((path: string) => path.includes("/c1/")
    ? new Promise((resolve) => { resolveFirst = resolve; })
    : Promise.resolve({ card: { ...CARD, id: "c2", name: "Second" }, permissions: { can_view: true, can_edit: false } }));
  const view = render(<MemoryRouter><CardDetailSidePanel cardId="c1" open onClose={() => {}} boScoped /></MemoryRouter>);
  view.rerender(<MemoryRouter><CardDetailSidePanel cardId="c2" open onClose={() => {}} boScoped /></MemoryRouter>);
  expect(await screen.findByTestId("card-content")).toHaveTextContent("Second");
  resolveFirst({ card: CARD, permissions: { can_view: true } });
  await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Second"));
});

it("reloads scoped detail after a BO card save instead of showing the write response", async () => {
  let detailCalls = 0;
  vi.mocked(api.get).mockImplementation(() => {
    detailCalls += 1;
    return Promise.resolve({ card: { ...CARD, name: detailCalls === 1 ? "Original" : "Scoped result" }, permissions: { can_view: true, can_edit: true } });
  });
  render(<MemoryRouter><CardDetailSidePanel cardId="c1" open onClose={() => {}} boScoped /></MemoryRouter>);
  expect(await screen.findByTestId("card-content")).toHaveTextContent("Original");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Scoped result"));
});

it("does not offer inventory navigation from the scoped panel", async () => {
  vi.mocked(api.get).mockResolvedValue({ card: CARD, permissions: { can_view: true } });
  render(<MemoryRouter><CardDetailSidePanel cardId="c1" open onClose={() => {}} boScoped /></MemoryRouter>);
  await screen.findByTestId("card-content");
  expect(screen.queryByRole("button", { name: "Open full page" })).not.toBeInTheDocument();
});
