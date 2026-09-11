import { Component, computed, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import {
  cloudDoneOutline,
  cloudOfflineOutline,
  cloudUploadOutline,
  warningOutline,
} from 'ionicons/icons';
import { SyncSchedulerService } from '../core/sync/sync-scheduler.service';
import { SyncService } from '../core/sync/sync.service';
import { SyncSettingsService } from '../core/sync/sync-settings.service';
import {
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/angular';

/**
 * The toolbar sync indicator. Deliberately small and non-blocking: sync is a
 * background convenience in this app, never something the user waits on.
 */
@Component({
  selector: 'app-sync-status',
  standalone: true,
  imports: [IonButton, IonIcon, IonSpinner],
  template: `
    <ion-button
      fill="clear"
      [attr.aria-label]="label()"
      [disabled]="status().state === 'syncing'"
      (click)="syncNow()"
    >
      @if (status().state === 'syncing') {
        <ion-spinner name="dots" />
      } @else {
        <ion-icon slot="icon-only" [name]="icon()" [color]="colour()" />
      }
    </ion-button>
  `,
})
export class SyncStatusComponent {
  private readonly sync = inject(SyncService);
  private readonly scheduler = inject(SyncSchedulerService);
  private readonly settings = inject(SyncSettingsService);

  readonly status = this.sync.status;

  readonly icon = computed(() => {
    if (this.settings.settings().target.kind === 'none') return 'cloud-offline-outline';
    if (this.status().state === 'error') return 'warning-outline';
    return this.status().pending > 0 ? 'cloud-upload-outline' : 'cloud-done-outline';
  });

  readonly colour = computed(() => {
    if (this.status().state === 'error') return 'danger';
    if (this.settings.settings().target.kind === 'none') return 'medium';
    return this.status().pending > 0 ? 'warning' : 'success';
  });

  /** An icon alone says nothing to a screen reader; this is the same state in words. */
  readonly label = computed(() => {
    if (this.status().state === 'syncing') return 'Syncing';
    if (this.status().state === 'error') return 'Sync failed — tap to retry';
    if (this.settings.settings().target.kind === 'none') return 'Sync not configured';
    return this.status().pending > 0
      ? `Sync ${this.status().pending} pending change(s)`
      : 'Synced — tap to sync now';
  });

  async syncNow(): Promise<void> {
    await this.scheduler.syncNow();
  }

  constructor() {
    addIcons({ cloudDoneOutline, cloudOfflineOutline, cloudUploadOutline, warningOutline });
  }
}
