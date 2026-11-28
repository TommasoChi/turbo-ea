/** True when the heading's row draws a bottom border or has a `<Divider/>` / `<hr>` in or beside it. */
export function hasSectionDivider(heading: HTMLElement): boolean {
  const row = heading.parentElement!;
  if (getComputedStyle(row).borderBottomWidth === "1px") return true;
  const selector = "hr, .MuiDivider-root";
  return (
    !!row.querySelector(selector) ||
    [row.previousElementSibling, row.nextElementSibling].some((el) => !!el?.matches(selector))
  );
}
