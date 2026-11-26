import { cardLogoUrl } from "@/components/CardLogoAvatar";
import { escapeHtml } from "@/lib/escapeHtml";

export interface CostCardIdentity {
  /** The row's key: the card id, or card and provider when grouped by provider. */
  id?: string;
  /** The card's own id when `id` is a composite row key. */
  cardId?: string;
  typeIcon?: string;
  logo_updated_at?: string | null;
}

/** Tooltip HTML is escaped because chart tooltips render strings as HTML. */
export function costCardIdentityHtml(card: CostCardIdentity): string {
  const cardId = card.cardId ?? card.id;
  if (!cardId || !card.typeIcon) return "";
  const icon = escapeHtml(card.typeIcon);
  const logo = card.logo_updated_at
    ? escapeHtml(cardLogoUrl(encodeURIComponent(cardId), card.logo_updated_at).replace(/'/g, "%27"))
    : "";
  const image = logo
    ? `<img src="${logo}" alt="${icon}" class="material-symbols-outlined" style="width:28px;height:28px;object-fit:contain;background:Canvas">`
    : `<span class="material-symbols-outlined">${icon}</span>`;
  return `<span style="display:inline-flex;position:relative;width:28px;height:28px;align-items:center;justify-content:center;vertical-align:middle">${image}${logo ? `<span class="material-symbols-outlined" style="position:absolute;right:-3px;bottom:-3px;font-size:12px;background:Canvas">${icon}</span>` : ""}</span> `;
}

export function costCardRichStyle(card: CostCardIdentity): Record<string, unknown> | undefined {
  const cardId = card.cardId ?? card.id;
  if (!cardId || !card.typeIcon) return undefined;
  return card.logo_updated_at
    ? {
        width: 20,
        height: 20,
        backgroundColor: { image: cardLogoUrl(cardId, card.logo_updated_at) },
      }
    : { fontFamily: "Material Symbols Outlined", fontSize: 18 };
}
