import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import i18n from "@/i18n";
// AG Grid module registration (mandatory since v33) for every test that
// mounts a real <AgGridReact> — same side-effect import the grid pages use.
import "@/lib/agGridSetup";
import { installAgGridScrollbarProbe } from "./agGridScrollbarProbe";
import { installMatchMedia, setViewportWidth } from "./matchMedia";

// The scripts/ tests run under `@vitest-environment node` (they exercise the
// coverage tooling CI runs, not the page), so nothing below may assume a DOM.
const hasDom = typeof window !== "undefined";

if (hasDom) {
  installMatchMedia();
  // Must run before any grid mounts: it is what lets AG Grid cache its scrollbar
  // measurement instead of re-probing `document` from a timer that can outlive
  // the test environment. See the module for the full account.
  installAgGridScrollbarProbe();
}

// Node 22+ defines its own global `localStorage` accessor (backed by
// --localstorage-file, behind an experimental flag) that shadows jsdom's on
// the shared global object and reads as `undefined` without the flag, so any
// test touching `localStorage` dies with "Cannot read properties of undefined
// (reading 'clear')". Our fork and upstream ship byte-identical vitest config,
// so this is a Node-version artifact on whichever machine runs the suite, not
// a project gap. Where jsdom's own storage is intact, leave it alone.
function nativeLocalStorageWorks(): boolean {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return false;
    ls.setItem("__probe__", "1");
    const ok = ls.getItem("__probe__") === "1";
    ls.removeItem("__probe__");
    return ok;
  } catch {
    return false;
  }
}

/** A working in-memory `localStorage`, reachable through `Storage.prototype`.
 *
 *  Where it puts its methods is the whole difficulty. They cannot sit on a
 *  prototype of the shim's own: that shadows `Storage.prototype`, and a test
 *  spying on `Storage.prototype.setItem` — the only place a write can be
 *  observed — would then record nothing while the write really happened. They
 *  cannot simply replace `Storage.prototype`'s either: that object is what
 *  `sessionStorage` inherits from, and tests make its methods throw on
 *  purpose. So the methods go on `Storage.prototype` and dispatch on the
 *  receiver — the shim gets ours, everything else the original. */
function installLocalStorageShim(): void {
  const proto = (globalThis as { Storage?: { prototype: Storage } }).Storage?.prototype;
  const store = new Map<string, string>();
  const impl: Record<string, (...args: never[]) => unknown> = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  } as Record<string, (...args: never[]) => unknown>;

  const shim = (proto ? Object.create(proto) : {}) as Storage;
  if (proto) {
    for (const [name, mine] of Object.entries(impl)) {
      const original = (proto as unknown as Record<string, unknown>)[name] as
        | ((...args: unknown[]) => unknown)
        | undefined;
      Object.defineProperty(proto, name, {
        value: function (this: Storage, ...args: unknown[]) {
          if (this === shim) return (mine as (...a: unknown[]) => unknown)(...args);
          return original?.apply(this, args);
        },
        writable: true,
        configurable: true,
      });
    }
  } else {
    Object.assign(shim, impl);
  }
  // Own property: `Storage.prototype.length` is non-configurable on Node's own
  // class, and nothing in the suite reads it off the prototype.
  Object.defineProperty(shim, "length", { get: () => store.size, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}

// DOM suites only: a `node`-environment test has no business with web storage.
if (hasDom && !nativeLocalStorageWorks()) {
  installLocalStorageShim();
}

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
  if (!hasDom) return;
  sessionStorage.clear();
  localStorage.clear();
  // Desktop by default, so every pre-existing test keeps seeing exactly what
  // it saw when jsdom had no matchMedia at all (every query false).
  setViewportWidth(1280);
});

// Drain pending async work after each test, so nothing lands after Vitest has
// torn jsdom down and deleted `window`. The symptom is an unhandled
// "ReferenceError: window is not defined" — typically AG Grid's
// `LocalEventService.dispatchAsync`, reached from a late `RowRenderer` redraw
// — which fails the run even though every test passed, and only on loaded CI
// runners.
//
// One member of that family is NOT a race and cannot be drained away: AG
// Grid's scrollbar probe re-armed itself on every call under jsdom. That one is
// closed at the source by `installAgGridScrollbarProbe` above.
//
// Two queues matter, and they are drained separately because neither drains
// the other:
//   - the timer queue (`setTimeout`), which is what AG Grid itself schedules;
//   - Node's check phase (`setImmediate`), which is what React 19's scheduler
//     posts its work through. jsdom's teardown calls `window.close()` and so
//     cancels every `window.setTimeout`/rAF, but it has no say over
//     `setImmediate` — that is the queue a late React commit rides in on.
//
// Hooks run in reverse registration order, so Testing Library's auto-cleanup
// (registered by the test file's imports) has already unmounted by the time
// this runs; the drain therefore also catches work scheduled during unmount.
//
// This is defence in depth, NOT a guarantee: React re-posts itself whenever it
// yields, so a fixed number of drains narrows the window rather than closing
// it. The deterministic fix for any one file is to leave nothing in flight —
// either stub the grid (`InventoryDragFill.test.tsx`) or end the test by
// awaiting the grid's own DOM (`InventoryFreezePersistence.test.tsx`,
// `InventoryOrderPersistence.test.tsx`). A test that mounts a real AG Grid and
// does neither will eventually trip this again.
//
// Skipped under fake timers: mocked timeouts die with the mock clock and never
// reach the real event loop.
afterEach(async () => {
  if (vi.isFakeTimers()) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
});

// Ensure i18n is set to English for all tests so t() returns English text.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
