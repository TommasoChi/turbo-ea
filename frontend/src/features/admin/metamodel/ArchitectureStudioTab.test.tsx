import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@/types";
import ArchitectureStudioTab from "./ArchitectureStudioTab";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/AuthContext", () => ({ useAuthContext: vi.fn(), useOptionalAuthUser: vi.fn() }));

import { api } from "@/api/client";
import { useAuthContext, useOptionalAuthUser } from "@/hooks/AuthContext";

describe("ArchitectureStudioTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue([]);
    const user = { id: "u1", permissions: { "*": true } } as unknown as User;
    vi.mocked(useAuthContext).mockReturnValue({ user, refreshUser: vi.fn() });
    vi.mocked(useOptionalAuthUser).mockReturnValue(user);
  });

  it("renders Card Mapping directly, with no Relations Mapping sub-tab", async () => {
    render(<ArchitectureStudioTab types={[]} />);

    expect(await screen.findByRole("button", { name: /New Architecture Object/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Relations Mapping/ })).not.toBeInTheDocument();
  });

  it("switches to the Viewpoint Catalog sub-tab on click", async () => {
    const user = userEvent.setup();
    render(<ArchitectureStudioTab types={[]} />);
    await screen.findByRole("button", { name: /New Architecture Object/ });

    await user.click(screen.getByRole("tab", { name: /Viewpoint Catalog/ }));

    expect(screen.getByRole("tab", { name: /Viewpoint Catalog/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
