import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@/types";
import ArchitectureStudioTab from "./ArchitectureStudioTab";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/AuthContext", () => ({ useAuthContext: vi.fn() }));

import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";

describe("ArchitectureStudioTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(useAuthContext).mockReturnValue({
      user: { id: "u1", permissions: { "*": true } } as unknown as User,
      refreshUser: vi.fn(),
    });
  });

  it("lands on Card Mapping and switches to Relations Mapping on click", async () => {
    const user = userEvent.setup();
    render(<ArchitectureStudioTab types={[]} />);

    expect(await screen.findByRole("button", { name: /New Architecture Object/ })).toBeInTheDocument();
    // Relations Mapping's own content (an ArchiMate relationship column
    // header) must not render while Card Mapping is the active sub-tab.
    expect(screen.queryByText("Serving")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Relations Mapping/ }));

    expect(await screen.findByText("Architecture Object")).toBeInTheDocument();
    expect(screen.getByText("Serving")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Architecture Object/ })).not.toBeInTheDocument();
  });
});
