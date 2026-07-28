import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n";

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
});

// Ensure i18n is set to English for all tests so t() returns English text.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
