import { CurrencyFieldComponent } from '../../shared/currency-field.component';
import { LedgerDotsComponent } from '../../shared/ledger-dots.component';
import { BrandMarkComponent } from '../../shared/brand-mark.component';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { lockClosedOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { activateVault } from '../../core/app-bootstrap';
import { VaultService } from '../../core/keys/vault.service';
import { guessCurrency } from '../../core/money/currencies';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { RatesService } from '../../core/repositories/rates.service';
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
  imports: [BrandMarkComponent, CurrencyFieldComponent, FormsModule, IonButton, IonContent, IonIcon, IonInput, IonNote, IonSpinner, IonText, LedgerDotsComponent],
  styleUrls: ['./vault.page.scss'],
  template: `
    <ion-content>
      <div class="vault-layout">
      <section class="welcome-panel">
        <div class="wordmark"><app-brand-mark />Easy Docket</div>
        <div class="welcome-copy">
          <h1>A clear view.<br />A calmer mind.</h1>
          <p>All your accounts, everyday spending, and plans. In one personal space.</p>
          <div class="welcome-detail"><ion-icon name="shield-checkmark-outline" /><div><strong>Personal by design.</strong><span>Your ledger is encrypted on your device.<br />You choose where it goes.</span></div></div>
        </div>
        <app-ledger-dots class="welcome-dots" />
      </section>
      <div class="vault">
        <div class="brand">
          <ion-icon [name]="creating() ? 'shield-checkmark-outline' : 'lock-closed-outline'" />
          <h2>{{ creating() ? 'Set up your vault' : 'Welcome back' }}</h2>
          <p>{{ creating() ? 'A private home for your money.' : 'Your ledger is right where you left it.' }}</p>
        </div>

        <ion-input
          label="Passphrase"
          labelPlacement="stacked"
          type="password"
          fill="outline"
          [autocomplete]="creating() ? 'new-password' : 'current-password'"
          [ngModel]="passphrase()"
          (ngModelChange)="passphrase.set($event)"
          (keyup.enter)="submit()"
        />

        @if (creating()) {
          <!--
            Checked as it is typed rather than only on submit. Finding out the
            two do not match after pressing the button means retyping both,
            and a passphrase that cannot be reset is a bad place to learn that.
          -->
          <ion-input
            label="Confirm passphrase"
            labelPlacement="stacked"
            type="password"
            fill="outline"
            autocomplete="new-password"
            [ngModel]="confirmation()"
            (ngModelChange)="confirmation.set($event)"
            (ionBlur)="confirmationBlurred.set(true)"
            (keyup.enter)="submit()"
          />
          @if (mismatch()) {
            <ion-text color="danger"><small>The two passphrases do not match</small></ion-text>
          }
          <ion-note>
            This passphrase encrypts your ledger. It is never uploaded and cannot be reset. Lose it
            and the data is unrecoverable by design.
          </ion-note>

          <!--
            Asked now rather than settled silently. Totals are shown in this
            currency and the starter accounts are opened in it, and finding out
            a month later that the vault thinks in dollars is expensive to
            undo. It can still be changed later in Settings.
          -->
          <app-currency-field
            fill="outline"
            footnote="Totals use this, and your starter accounts open in it. Change it later in Settings."
            [value]="currency()"
            (valueChange)="currency.set($event)"
          />
        }

        <div class="error" aria-live="polite">
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
      </div>
    </ion-content>
  `,
})
export class VaultPage {
  readonly vault = inject(VaultService);
  private readonly categories = inject(CategoriesService);
  private readonly groups = inject(AccountGroupsService);
  private readonly rates = inject(RatesService);

  /** Guessed from the device's locale, and shown as a choice rather than applied. */
  readonly currency = signal(guessCurrency());
  private readonly router = inject(Router);
  private readonly injector = inject(EnvironmentInjector);

  readonly passphrase = signal('');
  readonly confirmation = signal('');

  /** Whether the confirm field has been left, so it is not marked wrong mid-type. */
  readonly confirmationBlurred = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly creating = computed(() => this.vault.status() === 'uninitialised');

  /**
   * Whether to say the two do not match yet.
   *
   * Only once the field has been left: calling a half-typed confirmation wrong
   * on its first keystroke is noise, because it is wrong until the moment it
   * is right.
   */
  readonly mismatch = computed(
    () =>
      this.creating() &&
      this.confirmationBlurred() &&
      this.confirmation().length > 0 &&
      this.confirmation() !== this.passphrase(),
  );

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);

    if (this.creating() && this.passphrase() !== this.confirmation()) {
      // Said under the field rather than in the strip at the bottom: the box
      // that has to change is the one that should be carrying the message.
      this.confirmationBlurred.set(true);
      // Empty is a different problem from wrong, and reads as one.
      if (!this.confirmation()) this.error.set('Confirm your passphrase');
      return;
    }

    this.busy.set(true);
    try {
      if (this.creating()) {
        await this.vault.create(this.passphrase());
        // Before the seed: the starter accounts are opened in the vault's
        // currency, and the seed reads it.
        await this.rates.setReportingCurrency(this.currency());
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
      this.confirmationBlurred.set(false);
    }
  }

  constructor() {
    addIcons({ lockClosedOutline, shieldCheckmarkOutline });
  }
}
