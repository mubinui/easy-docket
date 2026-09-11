import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { VaultService } from '../keys/vault.service';
import { SyncSettingsService } from './sync-settings.service';
import { SyncService } from './sync.service';

/**
 * Decides *when* to sync. The engine itself has no opinion about scheduling,
 * which keeps it testable and keeps this policy in one readable place.
 *
 * Three triggers, all of which collapse into a single cycle if they coincide,
 * because `SyncService.sync()` coalesces concurrent callers:
 *
 *  - a timer at the user's chosen interval;
 *  - regaining connectivity, which is the moment a backlog can finally drain;
 *  - the app returning to the foreground, so opening it shows fresh data.
 */
@Injectable({ providedIn: 'root' })
export class SyncSchedulerService {
  private readonly sync = inject(SyncService);
  private readonly settings = inject(SyncSettingsService);
  private readonly vault = inject(VaultService);
  private readonly destroyRef = inject(DestroyRef);

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor() {
    // Re-arm whenever the interval changes or the vault is unlocked.
    effect(() => {
      const { intervalMinutes } = this.settings.settings();
      const unlocked = this.vault.isUnlocked();
      this.arm(unlocked ? intervalMinutes : 0);
    });

    this.destroyRef.onDestroy(() => this.disarm());
  }

  /** Attach the event-driven triggers. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await Network.addListener('networkStatusChange', (status) => {
      if (!status.connected) return;
      if (!this.settings.settings().syncOnReconnect) return;
      if (this.settings.settings().wifiOnly && status.connectionType !== 'wifi') return;
      void this.runIfUnlocked();
    });

    await App.addListener('resume', () => void this.runIfUnlocked());
  }

  /** Sync now, regardless of schedule. Used by pull-to-refresh and the button. */
  async syncNow(): Promise<void> {
    await this.sync.sync();
  }

  private async runIfUnlocked(): Promise<void> {
    if (!this.vault.isUnlocked()) return;

    if (this.settings.settings().wifiOnly) {
      const status = await Network.getStatus();
      if (status.connectionType !== 'wifi') return;
    }
    await this.sync.sync();
  }

  private arm(intervalMinutes: number): void {
    this.disarm();
    if (intervalMinutes <= 0) return;

    this.timer = setInterval(
      () => void this.runIfUnlocked(),
      intervalMinutes * 60_000,
    );
  }

  private disarm(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
