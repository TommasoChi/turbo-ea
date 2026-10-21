import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders Card Mapping directly, with no Relations Mapping sub-tab", async () => {
    render(<ArchitectureStudioTab types={[]} />);

    expect(await screen.findByRole("button", { name: /New Architecture Object/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Relations Mapping/ })).not.toBeInTheDocument();
  });
});
