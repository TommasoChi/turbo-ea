/**
 * Nav menu definitions, extracted from `AppLayout` so the route-permission
 * parity test can read them without mounting the whole layout.
 *
 * Core entries that point at a route carry **no** `permission` — it is derived
 * from `ROUTE_PERMISSIONS` (`lib/routePermissions.ts`) instead, so the menu and
 * the router can never disagree about what a page needs. `permission` survives
 * on the type for the two cases that genuinely need their own: the pathless
 * Reports *group*, and nav entries contributed by installed UI extensions,
 * whose permission comes from the extension manifest.
 */
export interface NavItemDef {
  labelKey: string;
  icon: string;
  path?: string;
  children?: {
    labelKey: string;
    icon: string;
    path: string;
    permission?: string | string[];
  }[];
  permission?: string | string[];
}

export const NAV_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "dashboard", icon: "dashboard", path: "/" },
  { labelKey: "inventory", icon: "inventory_2", path: "/inventory" },
  {
    labelKey: "reports",
    icon: "analytics",
    // The group itself has no route, so it keeps an explicit permission.
    permission: "reports.ea_dashboard",
    children: [
      { labelKey: "reports.portfolio", icon: "dashboard", path: "/reports/portfolio" },
      { labelKey: "reports.flexiblePortfolio", icon: "dashboard_customize", path: "/reports/flexible-portfolio" },
      { labelKey: "reports.capabilityMap", icon: "grid_view", path: "/reports/capability-map" },
      { labelKey: "reports.lifecycle", icon: "timeline", path: "/reports/lifecycle" },
      { labelKey: "reports.dependencies", icon: "hub", path: "/reports/dependencies" },
      { labelKey: "reports.cost", icon: "payments", path: "/reports/cost" },
      { labelKey: "reports.matrix", icon: "table_chart", path: "/reports/matrix" },
      { labelKey: "reports.dataQuality", icon: "verified", path: "/reports/data-quality" },
      { labelKey: "reports.endOfLife", icon: "update", path: "/reports/eol" },
      // EA Delivery lives inside /ppm as a tab when PPM is enabled. When PPM
      // is disabled the nav memo in AppLayout promotes EA Delivery to a
      // top-level nav item (in PPM's old slot) so the surface stays reachable.
      { labelKey: "reports.saved", icon: "bookmarks", path: "/reports/saved" },
    ],
  },
  // "strategy_process"/"app_data" are fork-local legacy EXTENSION_NAV_GROUPS
  // an installed extension may target (see extensionHost.tsx) — these are
  // what give their routes a grouped dropdown instead of scattering each one
  // as its own top-level icon. The labelKey MUST equal the group string
  // verbatim: the group-injection loop in AppLayout finds the host by
  // `item.labelKey === group`. BPM is a static child of strategy_process
  // (fork-local — this is the "Business Architecture" grouping the fork has
  // always had, under its older "Org&Process" label; upstream keeps BPM flat
  // since it carries no extensions of its own).
  // Since the ArchiMate Viewpoint Catalog work, both strategy_process and
  // app_data also carry a static "<Layer> Diagram" entry point (scoped
  // ArchimateViewpointPicker, tab fixed to that layer) that only needs
  // `diagrams.view` — so, unlike before, neither host is ever reduced to
  // zero children purely by a module flag being off; AppLayout's final
  // resolve pass still drops a host down to nothing for a user who also
  // lacks `diagrams.view` and has no matching extension installed.
  {
    labelKey: "strategy_process",
    icon: "route",
    // No group-level permission gate: bpm.view and (extension) permissions
    // like ext.value-chain.view are independent, so a user could have
    // either without the other. The group is hidden entirely if permission
    // filtering leaves it with zero children. bpm's own permission is
    // derived from ROUTE_PERMISSIONS via its path, same as every other
    // route-carrying entry — no explicit `permission` needed here. Value
    // Chain is a second static child on the same terms (bpm.value_chain,
    // derived from its path; AppLayout drops it when its module is off).
    // Business Diagram is a third static child, gated on `diagrams.view`
    // like every other diagram entry point (see api/diagrams.ts's
    // `ViewpointTab`) — independent of the bpm/valueChain module flags.
    children: [
      { labelKey: "valueChain", icon: "conveyor_belt", path: "/value-chain" },
      { labelKey: "bpm", icon: "route", path: "/bpm" },
      { labelKey: "businessDiagram", icon: "schema", path: "/business-architecture/diagram" },
    ],
  },
  // Application & Data Architecture: three "coming soon" placeholders
  // (SWOT / What-if / Data Flow analysis — explicitly scoped out of this
  // feature, see the ArchiMate Viewpoint spec) plus the real Application
  // Diagram entry point. All four are plain route links gated on
  // `diagrams.view` (see ROUTE_PERMISSIONS) rather than an extension
  // permission, since none of them is extension-contributed.
  {
    labelKey: "app_data",
    icon: "apps",
    children: [
      { labelKey: "swotAnalysis", icon: "balance", path: "/application-architecture/swot" },
      { labelKey: "whatIfAnalysis", icon: "query_stats", path: "/application-architecture/what-if" },
      { labelKey: "dataFlow", icon: "device_hub", path: "/application-architecture/data-flow" },
      { labelKey: "applicationDiagram", icon: "schema", path: "/application-architecture/diagram" },
    ],
  },
  // Technology Architecture: new top-level dropdown, mirroring Business
  // Architecture's Diagram entry but for the technology layer. One static
  // child today; left as a dropdown (rather than a flat link) so a later
  // technology-layer page has somewhere to land without reshaping the bar.
  {
    labelKey: "technologyArchitecture",
    icon: "memory",
    children: [
      { labelKey: "technologyDiagram", icon: "schema", path: "/technology-architecture/diagram" },
    ],
  },
  { labelKey: "ppm", icon: "view_timeline", path: "/ppm" },
  { labelKey: "diagrams", icon: "schema", path: "/diagrams" },
  // `children` is filled only by extension routes requesting navGroup "grc";
  // with none installed this stays a plain top-level link.
  { labelKey: "grc", icon: "policy", path: "/grc", children: [] },
  { labelKey: "todos", icon: "checklist", path: "/todos" },
];

/**
 * The nav positions an extension route may name in its `navPlacement`.
 *
 * Deliberately the `labelKey`s above and nothing else: they are stable
 * identifiers core already owns, and an extension naming one is naming a
 * place in the bar rather than a place in an array that renumbers whenever a
 * module toggle changes what is on screen.
 */
export const NAV_ANCHORS = NAV_ITEM_DEFS.map((item) => item.labelKey);

export const DEFAULT_NAV_PLACEMENT = "end";

/**
 * Index at which a contributed nav entry should be inserted.
 *
 * The frontend mirror of `resolve_placement` in
 * `backend/app/services/extensions/field_contributions.py` — same grammar
 * (`start` / `end` / `before:<anchor>` / `after:<anchor>`), same
 * degrade-to-default rule, so an author who has placed a field section
 * already knows how to place a nav entry.
 *
 * An anchor that is not currently in the bar is NOT an error: `bpm`, `ppm`
 * and `grc` come and go with their module flags, so a placement that names
 * one is right on some instances and unresolvable on others. It degrades to
 * the default rather than being dropped — the entry still appears, just where
 * it would have appeared without the hint.
 *
 * `order` is the list of labelKeys as it stands at this moment, which is what
 * makes the module-flag case fall out for free.
 */
export function resolveNavPlacement(order: string[], placement?: string | null): number {
  const spec = (placement || DEFAULT_NAV_PLACEMENT).trim();
  for (const candidate of [spec, DEFAULT_NAV_PLACEMENT]) {
    if (candidate === "start") return 0;
    if (candidate === "end") return order.length;
    const at = candidate.indexOf(":");
    const prefix = at < 0 ? candidate : candidate.slice(0, at);
    const anchorKey = at < 0 ? "" : candidate.slice(at + 1);
    const index = order.indexOf(anchorKey);
    if (index >= 0) return index + (prefix === "after" ? 1 : 0);
  }
  return order.length;
}

export const ADMIN_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "admin.metamodel", icon: "settings_suggest", path: "/admin/metamodel" },
  { labelKey: "admin.usersAndRoles", icon: "group", path: "/admin/users" },
  { labelKey: "admin.surveys", icon: "assignment", path: "/admin/surveys" },
  { labelKey: "admin.extensions", icon: "extension", path: "/admin/extensions" },
  { labelKey: "admin.settings", icon: "settings", path: "/admin/settings" },
];
