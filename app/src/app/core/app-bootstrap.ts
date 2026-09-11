import { inject } from '@angular/core';
import { VaultService } from './keys/vault.service';
import { LedgerService } from './repositories/ledger.service';
import { SyncSettingsService } from './sync/sync-settings.service';
import { SyncSchedulerService } from './sync/sync-scheduler.service';
import { SyncService } from './sync/sync.service';
import { ThemeService } from './theme/theme.service';

/**
 * Work that must happen before the first screen renders.
 *
 * Ordering matters here. The theme is applied first so an unlock screen never
 * flashes white at a dark-mode user. The vault comes next, because the ledger's
 * clock is keyed to the device identity it restores, and sync settings cannot
 * be decrypted until a key exists.
 *
 * Nothing in this path touches the network, so a cold start offline is exactly
 * as fast as a cold start online.
 */
export async function bootstrapApp(): Promise<void> {
  const theme = inject(ThemeService);
  const vault = inject(VaultService);
  const ledger = inject(LedgerService);
  const settings = inject(SyncSettingsService);
  const sync = inject(SyncService);
  const scheduler = inject(SyncSchedulerService);

  await theme.initialise();
  const state = await vault.initialise();
  await ledger.initialise(vault.requireDeviceId());

  if (state === 'unlocked') {
    await settings.load();
    await sync.initialise();
    await scheduler.start();
    // Catch up in the background: the UI must not wait on the network.
    void scheduler.syncNow();
  }
}

/**
 * The same steps that were skipped at startup because the vault was locked.
 * Called once an unlock succeeds.
 */
export async function activateVault(): Promise<void> {
  const settings = inject(SyncSettingsService);
  const sync = inject(SyncService);
  const scheduler = inject(SyncSchedulerService);

  await settings.load();
  await sync.initialise();
  await scheduler.start();
  void scheduler.syncNow();
}
