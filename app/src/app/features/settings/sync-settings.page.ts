import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdapterFactory } from '../../core/sync/adapter-factory';
import { SyncSettingsService } from '../../core/sync/sync-settings.service';
import {
  DEFAULT_SYNC_SETTINGS,
  GitTarget,
  S3Target,
  ServerTarget,
  SyncTarget,
  SyncTargetKind,
} from '../../core/sync/sync-target';
import { SyncService } from '../../core/sync/sync.service';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';

/**
 * Where the vault replicates to.
 *
 * Credentials entered here are encrypted under the master key before they touch
 * disk, the same as ledger data — see `SyncSettingsService`. "Test connection"
 * exercises the adapter's `probe`, which authenticates without writing, so a
 * typo is caught here rather than as a silent background failure later.
 */
@Component({
  selector: 'app-sync-settings',
  standalone: true,
  imports: [FormsModule, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToggle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/settings" /></ion-buttons>
        <ion-title>Sync destination</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item>
          <ion-select
            label="Destination"
            labelPlacement="stacked"
            [ngModel]="kind()"
            (ngModelChange)="setKind($event)"
          >
            <ion-select-option value="none">This device only</ion-select-option>
            <ion-select-option value="server">Easy Docket sync server</ion-select-option>
            <ion-select-option value="s3">S3-compatible storage</ion-select-option>
            <ion-select-option value="git">Git repository</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item lines="none">
          <ion-note>{{ explanation() }}</ion-note>
        </ion-item>
      </ion-list>

      @switch (kind()) {
        @case ('server') {
          <ion-list>
            <ion-list-header><ion-label>Server</ion-label></ion-list-header>
            <ion-item>
              <ion-input
                label="Endpoint"
                labelPlacement="stacked"
                placeholder="https://docket.example.com"
                [ngModel]="server().endpoint"
                (ngModelChange)="patchServer({ endpoint: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Access token"
                labelPlacement="stacked"
                type="password"
                [ngModel]="server().token"
                (ngModelChange)="patchServer({ token: $event })"
              />
            </ion-item>
          </ion-list>
        }

        @case ('s3') {
          <ion-list>
            <ion-list-header><ion-label>Bucket</ion-label></ion-list-header>
            <ion-item>
              <ion-input
                label="Bucket name"
                labelPlacement="stacked"
                [ngModel]="s3().bucket"
                (ngModelChange)="patchS3({ bucket: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Region"
                labelPlacement="stacked"
                placeholder="auto"
                [ngModel]="s3().region"
                (ngModelChange)="patchS3({ region: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Endpoint"
                labelPlacement="stacked"
                placeholder="Leave blank for AWS"
                [ngModel]="s3().endpoint"
                (ngModelChange)="patchS3({ endpoint: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Key prefix"
                labelPlacement="stacked"
                placeholder="Optional"
                [ngModel]="s3().prefix"
                (ngModelChange)="patchS3({ prefix: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Access key id"
                labelPlacement="stacked"
                [ngModel]="s3().accessKeyId"
                (ngModelChange)="patchS3({ accessKeyId: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Secret access key"
                labelPlacement="stacked"
                type="password"
                [ngModel]="s3().secretAccessKey"
                (ngModelChange)="patchS3({ secretAccessKey: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-toggle
                [ngModel]="s3().forcePathStyle"
                (ngModelChange)="patchS3({ forcePathStyle: $event })"
              >
                Path-style addressing
              </ion-toggle>
            </ion-item>
            <ion-item lines="none">
              <ion-note>
                Required by Cloudflare R2 and MinIO. Scope these credentials to this one bucket:
                your data stays encrypted, but the key can still delete it.
              </ion-note>
            </ion-item>
          </ion-list>
        }

        @case ('git') {
          <ion-list>
            <ion-list-header><ion-label>Repository</ion-label></ion-list-header>
            <ion-item>
              <ion-input
                label="HTTPS clone URL"
                labelPlacement="stacked"
                placeholder="https://github.com/you/docket-vault.git"
                [ngModel]="git().repoUrl"
                (ngModelChange)="patchGit({ repoUrl: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Branch"
                labelPlacement="stacked"
                placeholder="main"
                [ngModel]="git().branch"
                (ngModelChange)="patchGit({ branch: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Username"
                labelPlacement="stacked"
                [ngModel]="git().username"
                (ngModelChange)="patchGit({ username: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="Access token"
                labelPlacement="stacked"
                type="password"
                [ngModel]="git().token"
                (ngModelChange)="patchGit({ token: $event })"
              />
            </ion-item>
            <ion-item>
              <ion-input
                label="CORS proxy"
                labelPlacement="stacked"
                placeholder="https://cors.isomorphic-git.org"
                [ngModel]="git().corsProxy"
                (ngModelChange)="patchGit({ corsProxy: $event })"
              />
            </ion-item>
            <ion-item lines="none">
              <ion-note>
                A browser cannot reach most Git hosts directly, so the web app needs a proxy. The
                Android app does not. The proxy only ever relays encrypted data, but it does see
                your repository URL and token — run your own if that matters to you.
              </ion-note>
            </ion-item>
          </ion-list>
        }
      }

      @if (kind() !== 'none') {
        <ion-list>
          <ion-list-header><ion-label>Schedule</ion-label></ion-list-header>
          <ion-item>
            <ion-select
              label="Sync every"
              labelPlacement="stacked"
              [ngModel]="intervalMinutes()"
              (ngModelChange)="intervalMinutes.set($event)"
            >
              <ion-select-option [value]="0">Manually only</ion-select-option>
              <ion-select-option [value]="5">5 minutes</ion-select-option>
              <ion-select-option [value]="15">15 minutes</ion-select-option>
              <ion-select-option [value]="60">Hour</ion-select-option>
              <ion-select-option [value]="360">6 hours</ion-select-option>
              <ion-select-option [value]="1440">Day</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-toggle [ngModel]="syncOnReconnect()" (ngModelChange)="syncOnReconnect.set($event)">
              Sync when back online
            </ion-toggle>
          </ion-item>
          <ion-item>
            <ion-toggle [ngModel]="wifiOnly()" (ngModelChange)="wifiOnly.set($event)">
              Wi-Fi only
            </ion-toggle>
          </ion-item>
        </ion-list>
      }

      @if (message()) {
        <ion-item lines="none">
          <ion-text [color]="messageColour()"><small>{{ message() }}</small></ion-text>
        </ion-item>
      }

      <div class="ion-padding">
        @if (kind() !== 'none') {
          <ion-button expand="block" fill="outline" [disabled]="busy()" (click)="test()">
            @if (busy()) { <ion-spinner name="dots" /> } @else { Test connection }
          </ion-button>
        }
        <ion-button expand="block" [disabled]="busy()" (click)="save()">Save</ion-button>
      </div>
    </ion-content>
  `,
})
export class SyncSettingsPage {
  private readonly settings = inject(SyncSettingsService);
  private readonly adapters = inject(AdapterFactory);
  private readonly sync = inject(SyncService);
  private readonly toasts = inject(ToastController);

  readonly kind = signal<SyncTargetKind>('none');
  readonly intervalMinutes = signal(DEFAULT_SYNC_SETTINGS.intervalMinutes);
  readonly syncOnReconnect = signal(DEFAULT_SYNC_SETTINGS.syncOnReconnect);
  readonly wifiOnly = signal(DEFAULT_SYNC_SETTINGS.wifiOnly);
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly messageColour = signal<'danger' | 'success'>('success');

  // One draft per kind, so switching destinations to compare does not discard
  // what was already typed into the other.
  readonly server = signal<ServerTarget>({
    kind: 'server',
    label: 'Sync server',
    endpoint: '',
    token: '',
  });
  readonly s3 = signal<S3Target>({
    kind: 's3',
    label: 'S3 storage',
    bucket: '',
    region: 'auto',
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: true,
    prefix: '',
  });
  readonly git = signal<GitTarget>({
    kind: 'git',
    label: 'Git repository',
    repoUrl: '',
    branch: 'main',
    token: '',
    username: 'docket',
    corsProxy: '',
    authorName: 'Easy Docket',
    authorEmail: 'docket@localhost',
  });

  readonly explanation = computed(() => {
    switch (this.kind()) {
      case 'server':
        return 'The self-hosted Go server that ships with Easy Docket. It stores encrypted blobs and can read none of them.';
      case 's3':
        return 'Any S3-compatible bucket: AWS, Cloudflare R2, Backblaze B2 or MinIO.';
      case 'git':
        return 'Each sync becomes one commit of encrypted files, giving you a versioned history you own.';
      default:
        return 'Your ledger stays on this device. Nothing leaves it, and nothing arrives from other devices.';
    }
  });

  constructor() {
    const current = this.settings.settings();
    this.kind.set(current.target.kind);
    this.intervalMinutes.set(current.intervalMinutes);
    this.syncOnReconnect.set(current.syncOnReconnect);
    this.wifiOnly.set(current.wifiOnly);

    if (current.target.kind === 'server') this.server.set(current.target);
    if (current.target.kind === 's3') this.s3.set(current.target);
    if (current.target.kind === 'git') this.git.set(current.target);
  }

  setKind(kind: SyncTargetKind): void {
    this.kind.set(kind);
    this.message.set(null);
  }

  patchServer(partial: Partial<ServerTarget>): void {
    this.server.update((current) => ({ ...current, ...partial }));
  }

  patchS3(partial: Partial<S3Target>): void {
    this.s3.update((current) => ({ ...current, ...partial }));
  }

  patchGit(partial: Partial<GitTarget>): void {
    this.git.update((current) => ({ ...current, ...partial }));
  }

  async test(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const adapter = await this.adapters.create(this.target());
      await adapter.probe();
      this.messageColour.set('success');
      this.message.set('Connected successfully.');
    } catch (error) {
      this.messageColour.set('danger');
      this.message.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async save(): Promise<void> {
    this.busy.set(true);
    try {
      await this.settings.save({
        target: this.target(),
        intervalMinutes: this.intervalMinutes(),
        syncOnReconnect: this.syncOnReconnect(),
        wifiOnly: this.wifiOnly(),
      });

      const toast = await this.toasts.create({
        message: 'Sync settings saved',
        duration: 1500,
        position: 'bottom',
      });
      await toast.present();

      if (this.kind() !== 'none') void this.sync.sync();
    } finally {
      this.busy.set(false);
    }
  }

  private target(): SyncTarget {
    switch (this.kind()) {
      case 'server':
        return this.server();
      case 's3':
        return this.s3();
      case 'git':
        return this.git();
      default:
        return { kind: 'none', label: 'Not configured' };
    }
  }
}
