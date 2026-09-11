import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  cloudOutline,
  informationCircleOutline,
  lockClosedOutline,
  shieldOutline,
} from 'ionicons/icons';
import { VaultService } from '../../core/keys/vault.service';
import { SyncSettingsService } from '../../core/sync/sync-settings.service';
import { SyncService } from '../../core/sync/sync.service';
import { ThemeChoice, ThemeService } from '../../core/theme/theme.service';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonTitle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-list-header><ion-label>Appearance</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-segment [ngModel]="theme.choice()" (ngModelChange)="setTheme($event)">
            <ion-segment-button value="light"><ion-label>Light</ion-label></ion-segment-button>
            <ion-segment-button value="dark"><ion-label>Dark</ion-label></ion-segment-button>
            <ion-segment-button value="auto"><ion-label>Auto</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
        <ion-item lines="none">
          <ion-note>Auto follows your device's appearance setting.</ion-note>
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header><ion-label>Sync</ion-label></ion-list-header>
        <ion-item button routerLink="/settings/sync" detail="true">
          <ion-icon slot="start" name="cloud-outline" />
          <ion-label>
            <h3>Destination</h3>
            <p>{{ targetLabel() }}</p>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p>{{ syncSummary() }}</p>
          </ion-label>
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header><ion-label>Security</ion-label></ion-list-header>
        <ion-item button routerLink="/settings/security" detail="true">
          <ion-icon slot="start" name="shield-outline" />
          <ion-label>Passphrase and recovery</ion-label>
        </ion-item>
        <ion-item button (click)="lock()">
          <ion-icon slot="start" name="lock-closed-outline" />
          <ion-label>Lock now</ion-label>
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header><ion-label>About</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-icon slot="start" name="information-circle-outline" />
          <ion-label>
            <h3>Easy Docket</h3>
            <p>
              Your ledger is stored on this device and encrypted before it is sent anywhere. No
              server in this system can read it.
            </p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class SettingsPage {
  readonly theme = inject(ThemeService);
  private readonly settings = inject(SyncSettingsService);
  private readonly sync = inject(SyncService);
  private readonly vault = inject(VaultService);
  private readonly router = inject(Router);

  readonly targetLabel = computed(() => {
    const target = this.settings.settings().target;
    switch (target.kind) {
      case 'server':
        return target.endpoint;
      case 's3':
        return `S3 · ${target.bucket}`;
      case 'git':
        return `Git · ${target.repoUrl}`;
      default:
        return 'Not configured — this device only';
    }
  });

  readonly syncSummary = computed(() => {
    const status = this.sync.status();
    if (status.state === 'error') return `Last attempt failed: ${status.lastError}`;
    if (!status.lastSyncAt) return 'Never synced';

    const when = new Date(status.lastSyncAt).toLocaleString();
    const pending = status.pending;
    return pending > 0
      ? `Last synced ${when} · ${pending} change(s) waiting`
      : `Last synced ${when} · up to date`;
  });

  async setTheme(choice: ThemeChoice): Promise<void> {
    await this.theme.set(choice);
  }

  async lock(): Promise<void> {
    await this.vault.lock();
    await this.router.navigateByUrl('/vault', { replaceUrl: true });
  }

  constructor() {
    addIcons({ cloudOutline, shieldOutline, lockClosedOutline, informationCircleOutline });
  }
}
