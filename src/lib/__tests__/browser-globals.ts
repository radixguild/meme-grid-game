/**
 * The two browser globals src/lib/session.ts touches, for tests that run under
 * `tsx --test` in plain Node: `window` (only checked for existence — it is the
 * server-render guard) and `localStorage`.
 *
 * Not a test file (the test:web glob only picks up *.test.ts). `node --test`
 * runs every test file in its own process, so each file installs these once in
 * before() and removes them in after(); nothing carries over between files.
 */

/** In-memory stand-in for the Web Storage API, enough of it for session.ts. */
export class MemoryStorage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

export interface BrowserGlobals {
  storage: MemoryStorage;
  /**
   * Runs `fn` as a server render would see the module: `window` undefined.
   * `localStorage` stays defined on purpose, so a test can prove the guard
   * returned before touching it.
   */
  withoutWindow<T>(fn: () => T): T;
  /** Puts back whatever `window` and `localStorage` were before install. */
  uninstall(): void;
}

const NAMES = ["window", "localStorage"] as const;

function define(name: (typeof NAMES)[number], value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

export function installBrowserGlobals(): BrowserGlobals {
  const saved = NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const storage = new MemoryStorage();

  // In a browser `window` IS the global object; mirror that.
  define("window", globalThis);
  define("localStorage", storage);

  return {
    storage,
    withoutWindow(fn) {
      Reflect.deleteProperty(globalThis, "window");
      try {
        return fn();
      } finally {
        define("window", globalThis);
      }
    },
    uninstall() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
