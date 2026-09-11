import { Buffer } from 'buffer';

/**
 * `Buffer` for the browser.
 *
 * `isomorphic-git` is written against Node's Buffer and throws "Missing Buffer
 * dependency" the moment it needs one. Angular does not polyfill Node globals,
 * so without this the Git adapter compiles, type-checks, and fails at the first
 * real request — which is precisely how it shipped broken until an end-to-end
 * test pushed to an actual repository.
 *
 * Imported for its side effect, and only from the Git adapter, which is itself
 * loaded on demand: a vault syncing to a server or a bucket never pays for it.
 */
const globalScope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };

if (typeof globalScope.Buffer === 'undefined') {
  globalScope.Buffer = Buffer;
}

export {};
