// Polyfills for running unit tests under jsdom (the default Vitest environment).
// Ionic components such as ion-menu and ion-split-pane query `window.matchMedia`,
// which jsdom does not implement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom ships `crypto.getRandomValues` but not `crypto.subtle`. The app's
// cryptography is WebCrypto-only by design, so tests run against Node's own
// (standards-compliant) implementation rather than a mock.
import { webcrypto } from 'node:crypto';

// Dexie needs a real IndexedDB. Installing the in-memory implementation here,
// once for every spec file, rather than per-suite: the shim assigns globals,
// and two spec files racing to install it leave one of them with a closed
// database.
import 'fake-indexeddb/auto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
