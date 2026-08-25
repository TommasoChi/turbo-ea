import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import i18n from "@/i18n";
// AG Grid module registration (mandatory since v33) for every test that
// mounts a real <AgGridReact> — same side-effect import the grid pages use.
import "@/lib/agGridSetup";
import { installMatchMedia, setViewportWidth } from "./matchMedia";

installMatchMedia();

// Node 22+ defines its own global `localStorage` accessor (backed by
// --localstorage-file, gated behind an experimental flag) that shadows
// jsdom's simulated window.localStorage on the shared global object and
// resolves to `undefined` when the flag isn't passed — breaking any test
// that touches `localStorage` directly with
// "TypeError: Cannot read properties of undefined (reading 'clear')" or
// similar. Both our fork and upstream ship byte-identical vitest config
// here, so this isn't a project gap, it's a Node-version artifact on
// whichever machine runs the suite. Polyfill with a real in-memory Storage
// implementation so tests are correct regardless of the host Node version.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
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
