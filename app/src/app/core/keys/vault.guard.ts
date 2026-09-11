import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { VaultService } from './vault.service';

/**
 * Keeps ledger screens behind an unlocked vault. There is nothing to render
 * without a key: the data on disk is decryptable only while one is held.
 */
export const vaultGuard: CanActivateFn = () => {
  const vault = inject(VaultService);
  const router = inject(Router);

  if (vault.isUnlocked()) return true;
  return router.createUrlTree(['/vault']);
};

/** The mirror image: keeps an unlocked user off the unlock screen. */
export const unlockedRedirectGuard: CanActivateFn = () => {
  const vault = inject(VaultService);
  const router = inject(Router);

  return vault.isUnlocked() ? router.createUrlTree(['/tabs/dashboard']) : true;
};
