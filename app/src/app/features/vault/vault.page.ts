import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { lockClosedOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { activateVault } from '../../core/app-bootstrap';
import { VaultService } from '../../core/keys/vault.service';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonNote,
  IonSpinner,
  IonText,
} from '@ionic/angular';

/**
 * The gate in front of everything else: create a vault, or unlock an existing one.
 *
 * On a fresh install this is where the master key is generated. On a browser it
 * is also seen once per session, because a PWA has nowhere safe to keep a key
 * between visits — the copy under the passphrase field says so plainly rather
 * than leaving the user to wonder why the app forgot.
 */
@Component({
  selector: 'app-vault',
  standalone: true,
  imports: [FormsModule, IonButton, IonContent, IonIcon, IonInput, IonNote, IonSpinner, IonText],
  styles: [
    `
      .vault {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-height: 100%;
        padding: 2rem 1.5rem;
        max-width: 26rem;
        margin: 0 auto;
        gap: 0.75rem;
      }
      .brand {
        text-align: center;
        margin-bottom: 1.5rem;
      }
      .brand ion-icon {
        font-size: 3rem;
        color: var(--ion-color-primary);
      }
      h1 {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0.5rem 0 0.25rem;
      }
      .error {
        min-height: 1.25rem;
      }
    `,
  ],
  template: `
    <ion-content>
      <div class="vault">
        <div class="brand">
          <ion-icon [name]="creating() ? 'shield-checkmark-outline' : 'lock-closed-outline'" />
          <h1>Easy Docket</h1>
          <ion-note>{{ creating() ? 'Set up your vault' : 'Welcome back' }}</ion-note>
        </div>

        <ion-input
          label="Passphrase"
          labelPlacement="stacked"
          type="password"
          fill="outline"
          autocomplete="current-password"
          [ngModel]="passphrase()"
          (ngModelChange)="passphrase.set($event)"
          (keyup.enter)="submit()"
        />

        @if (creating()) {
          <ion-input
            label="Confirm passphrase"
            labelPlacement="stacked"
            type="password"
            fill="outline"
            autocomplete="new-password"
            [ngModel]="confirmation()"
            (ngModelChange)="confirmation.set($event)"
            (keyup.enter)="submit()"
          />
          <ion-note>
            This passphrase encrypts your ledger. It is never uploaded and cannot be reset — if you
            lose it, the data is unrecoverable by design.
          </ion-note>
        }

        <div class="error">
          @if (error()) {
            <ion-text color="danger"><small>{{ error() }}</small></ion-text>
          }
        </div>

        <ion-button expand="block" [disabled]="busy() || !passphrase()" (click)="submit()">
          @if (busy()) {
            <ion-spinner name="dots" />
          } @else {
            {{ creating() ? 'Create vault' : 'Unlock' }}
          }
        </ion-button>

        @if (!vault.keyIsDurable) {
          <ion-note>
            On the web your key is held in memory for this session only, so you will be asked for
            the passphrase each time you open the app. Installed on Android, the key is kept in the
            device keystore instead.
          </ion-note>
        }
      </div>
    </ion-content>
  `,
})
export class VaultPage {
  readonly vault = inject(VaultService);
  private readonly categories = inject(CategoriesService);
  private readonly groups = inject(AccountGroupsService);
  private readonly router = inject(Router);
  private readonly injector = inject(EnvironmentInjector);

  readonly passphrase = signal('');
  readonly confirmation = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly creating = computed(() => this.vault.status() === 'uninitialised');

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);

    if (this.creating() && this.passphrase() !== this.confirmation()) {
      this.error.set('The two passphrases do not match');
      return;
    }

    this.busy.set(true);
    try {
      if (this.creating()) {
        await this.vault.create(this.passphrase());
        await this.categories.seedIfEmpty();
        await this.groups.seedIfEmpty();
      } else {
        await this.vault.unlock(this.passphrase());
      }

      // `activateVault` uses `inject`, so it needs an injection context.
      await runInInjectionContext(this.injector, activateVault);
      await this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
      this.passphrase.set('');
      this.confirmation.set('');
    }
  }

  constructor() {
    addIcons({ lockClosedOutline, shieldCheckmarkOutline });
  }
}
