import { api } from "@/api/client";
import type { CardSearchSource } from "@/hooks/useCardSearch";

export const searchBoApplications: CardSearchSource = async (params) => {
  const query = new URLSearchParams(params);
  query.delete("type");
  query.set("page_size", String(Math.min(Number(query.get("page_size")), 100)));
  const { items, total } = await api.get<{ items: { id: string; name: string }[]; total: number }>(
    `/bo-relationship/applications?${query.toString()}`,
  );
  return { items: items.map((item) => ({ ...item, type: "Application" })), total };
};
