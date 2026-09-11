import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BiometricAvailability, BiometricService } from '../../core/keys/biometric.service';
import { VaultService } from '../../core/keys/vault.service';
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
  IonText,
  IonTextarea,
  IonTitle,
  IonToolbar,
  AlertController,
  ToastController,
} from '@ionic/angular';

/**
 * Passphrase management and recovery.
 *
 * The recovery bundle shown here is the *wrapped* key: useless without the
 * passphrase, which is exactly why it is safe to write down or photograph. It
 * is what lets a second device join the vault, and what makes the difference
 * between "my phone died" and "my ledger is gone".
 */
@Component({
  selector: 'app-security',
  standalone: true,
  imports: [FormsModule, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonText, IonTextarea, IonTitle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/settings" /></ion-buttons>
        <ion-title>Security</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-list-header><ion-label>Key storage</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-note>
            @if (vault.keyIsDurable) {
              Your master key is held in this device's hardware-backed keystore. It is never written
              to ordinary storage and never leaves the device.
            } @else {
              On the web the key exists only in memory for this session. There is nowhere in a
              browser to store it that a future attacker could not also read, so Easy Docket asks
              for your passphrase each time instead of pretending otherwise.
            }
          </ion-note>
        </ion-item>
      </ion-list>

      @if (biometrics(); as check) {
        <ion-list>
          <ion-list-header><ion-label>Device lock</ion-label></ion-list-header>

          @if (check.available) {
            <ion-item>
              <ion-toggle [ngModel]="biometricLock()" (ngModelChange)="setBiometricLock($event)">
                Require {{ check.kind }} to open
              </ion-toggle>
            </ion-item>
            <ion-item lines="none">
              <ion-note>
                Your key stays in the device keystore either way. This asks the device to check
                you are the one holding it before the ledger opens — without it, a phone found
                unlocked is a ledger left open. Your passphrase still works if the check fails.
              </ion-note>
            </ion-item>
          } @else {
            <ion-item lines="none">
              <ion-note>{{ check.reason }}.</ion-note>
            </ion-item>
          }
        </ion-list>
      }

      <ion-list>
        <ion-list-header><ion-label>Change passphrase</ion-label></ion-list-header>
        <ion-item>
          <ion-input
            label="Current passphrase"
            labelPlacement="stacked"
            type="password"
            [ngModel]="current()"
            (ngModelChange)="current.set($event)"
          />
        </ion-item>
        <ion-item>
          <ion-input
            label="New passphrase"
            labelPlacement="stacked"
            type="password"
            [ngModel]="next()"
            (ngModelChange)="next.set($event)"
          />
        </ion-item>
        <ion-item>
          <ion-input
            label="Confirm new passphrase"
            labelPlacement="stacked"
            type="password"
            [ngModel]="confirmation()"
            (ngModelChange)="confirmation.set($event)"
          />
        </ion-item>
        <ion-item lines="none">
          <ion-note>
            This re-encrypts your key, not your ledger, so it is instant no matter how much history
            you have. Data already synced stays readable.
          </ion-note>
        </ion-item>
      </ion-list>

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }

      <div class="ion-padding">
        <ion-button expand="block" [disabled]="!canChange()" (click)="change()">
          Change passphrase
        </ion-button>
      </div>

      <ion-list>
        <ion-list-header><ion-label>Recovery bundle</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-note>
            Store this somewhere safe. It lets another device join this vault, and it is worthless
            to anyone without your passphrase.
          </ion-note>
        </ion-item>
        @if (bundle()) {
          <ion-item>
            <ion-textarea [value]="bundle()" [autoGrow]="true" readonly />
          </ion-item>
        }
        <div class="ion-padding">
          <ion-button expand="block" fill="outline" (click)="reveal()">
            {{ bundle() ? 'Hide' : 'Show recovery bundle' }}
          </ion-button>
        </div>
      </ion-list>

      <ion-list>
        <ion-list-header><ion-label>Danger zone</ion-label></ion-list-header>
        <div class="ion-padding">
          <ion-button expand="block" color="danger" fill="outline" (click)="confirmReset()">
            Erase this device's vault
          </ion-button>
        </div>
      </ion-list>
    </ion-content>
  `,
})
export class SecurityPage {
  readonly vault = inject(VaultService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly router = inject(Router);

  private readonly biometricService = inject(BiometricService);

  readonly biometrics = signal<BiometricAvailability | null>(null);
  readonly biometricLock = signal(false);

  readonly current = signal('');
  readonly next = signal('');
  readonly confirmation = signal('');
  readonly error = signal<string | null>(null);
  readonly bundle = signal<string | null>(null);

  constructor() {
    void this.loadBiometrics();
  }

  private async loadBiometrics(): Promise<void> {
    this.biometrics.set(await this.biometricService.availability());
    this.biometricLock.set(await this.biometricService.isEnabled());
  }

  /**
   * Turning it on verifies once, immediately.
   *
   * Enabling a lock that then refuses to open would strand the user behind a
   * check that does not work, so it is proved before it is trusted.
   */
  async setBiometricLock(enabled: boolean): Promise<void> {
    if (enabled && !(await this.biometricService.verify('Confirm it works'))) {
      this.biometricLock.set(false);
      const toast = await this.toasts.create({
        message: 'That check did not pass, so nothing has changed',
        duration: 2500,
      });
      await toast.present();
      return;
    }

    await this.biometricService.setEnabled(enabled);
    this.biometricLock.set(enabled);
  }

  canChange(): boolean {
    return this.current().length > 0 && this.next().length >= 8;
  }

  async change(): Promise<void> {
    this.error.set(null);
    if (this.next() !== this.confirmation()) {
      this.error.set('The two new passphrases do not match');
      return;
    }

    try {
      await this.vault.changePassphrase(this.current(), this.next());
      const toast = await this.toasts.create({
        message: 'Passphrase changed',
        duration: 1500,
      });
      await toast.present();
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.current.set('');
      this.next.set('');
      this.confirmation.set('');
    }
  }

  async reveal(): Promise<void> {
    if (this.bundle()) {
      this.bundle.set(null);
      return;
    }
    const exported = await this.vault.exportWrappedKey();
    this.bundle.set(exported ? JSON.stringify(exported, null, 2) : null);
  }

  /**
   * Erasing is genuinely irreversible for anything not yet synced, so the
   * confirmation says what will actually be lost rather than "are you sure?".
   */
  async confirmReset(): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Erase this vault?',
      message:
        'The key and all local data on this device are destroyed. Anything already synced stays at your destination and can be restored with your recovery bundle and passphrase. Anything not yet synced is gone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Erase',
          role: 'destructive',
          handler: () => {
            void this.vault
              .destroy()
              .then(() => this.router.navigateByUrl('/vault', { replaceUrl: true }));
          },
        },
      ],
    });
    await alert.present();
  }
}
