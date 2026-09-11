import { InjectionToken } from '@angular/core';
import { DocketDb, getDb } from './docket-db';

/**
 * Injected rather than imported so that tests can supply a throwaway database
 * (fake-indexeddb backed) without any module-level patching.
 */
export const DOCKET_DB = new InjectionToken<DocketDb>('DOCKET_DB', {
  providedIn: 'root',
  factory: () => getDb(),
});
