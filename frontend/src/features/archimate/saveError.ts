/** One readable line out of whatever a failed request threw (never empty). */
import { ApiError } from "@/api/client";

const MAX_ISSUES = 3;

interface Issue { code?: unknown; ref?: unknown }

function fromDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() || null;
  if (!detail || typeof detail !== "object") return null;
  const { message, issues } = detail as { message?: unknown; issues?: unknown };
  const head = typeof message === "string" ? message.trim() : "";
  const list = Array.isArray(issues) ? (issues as Issue[]) : [];
  const shown = list
    .slice(0, MAX_ISSUES)
    .map((i) => {
      const code = typeof i?.code === "string" ? i.code : "";
      const ref = typeof i?.ref === "string" && i.ref ? ` (${i.ref})` : "";
      return `${code}${ref}`.trim();
    })
    .filter(Boolean);
  if (list.length > MAX_ISSUES) shown.push(`+${list.length - MAX_ISSUES} more`);
  const tail = shown.join(", ");
  if (head && tail) return `${head}: ${tail}`;
  return head || tail || null;
}

export function describeApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return fromDetail(e.detail) ?? (e.message.trim() || fallback);
  if (e instanceof Error) return e.message.trim() || fallback;
  return fallback;
}
