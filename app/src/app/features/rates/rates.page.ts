import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, swapHorizontalOutline } from 'ionicons/icons';
import { AccountsService } from '../../core/repositories/accounts.service';
import { PairSummary, RatesService } from '../../core/repositories/rates.service';
import { toIsoDate } from '../../core/util/dates';

/**
 * Exchange rates, entered by hand.
 *
 * No automatic fetch: every rate provider is a third party who would learn
 * which currencies this vault deals in, which is exactly the kind of leak the
 * rest of the app goes to lengths to avoid. Rates change slowly enough that
 * typing one occasionally is a fair trade for that.
 */
@Component({
  selector: 'app-rates',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonText,
    IonFab,
    IonFabButton,
    IonModal,
  ],
  styles: [
    `
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      .rate {
        font-variant-numeric: tabular-nums;
      }
      .converted {
        padding: 0 1rem 1rem;
        font-size: 0.8rem;
        color: var(--ion-color-medium);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/settings" /></ion-buttons>
        <ion-title>Exchange rates</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-list-header><ion-label>Reporting currency</ion-label></ion-list-header>
        <ion-item>
          <ion-select
            label="Totals shown in"
            labelPlacement="stacked"
            [ngModel]="rates.reportingCurrency()"
            (ngModelChange)="changeReporting($event)"
          >
            @for (code of currencyOptions(); track code) {
              <ion-select-option [value]="code">{{ code }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
        <ion-item lines="none">
          <ion-note>
            Rates are recorded against this currency at the moment each transaction happens, so
            changing it later leaves older figures quoted against the currency you used before.
          </ion-note>
        </ion-item>
      </ion-list>

      @if (rates.pairs().length) {
        <ion-list>
          <ion-list-header><ion-label>Rates</ion-label></ion-list-header>
          @for (pair of rates.pairs(); track pair.base + pair.quote) {
            <ion-item button (click)="addFor(pair)">
              <ion-label>
                <h3>{{ pair.base }} → {{ pair.quote }}</h3>
                <p>{{ pair.date }} · {{ pair.count }} {{ pair.count === 1 ? 'quote' : 'quotes' }}</p>
              </ion-label>
              <ion-note slot="end" class="rate">{{ pair.rate }}</ion-note>
            </ion-item>
          }
        </ion-list>
      } @else {
        <div class="empty">
          <ion-icon name="swap-horizontal-outline" size="large" color="medium" />
          <p>
            <ion-note>
              No rates yet. Add one when you record something in another currency.
            </ion-note>
          </p>
        </div>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="add()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-buttons slot="start"><ion-button (click)="close()">Cancel</ion-button></ion-buttons>
              <ion-title>Add rate</ion-title>
              <ion-buttons slot="end">
                <ion-button strong="true" [disabled]="!canSave()" (click)="save()">Save</ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>

          <ion-content>
            <ion-list>
              <ion-item>
                <ion-input
                  label="From"
                  labelPlacement="stacked"
                  placeholder="EUR"
                  maxlength="3"
                  [ngModel]="base()"
                  (ngModelChange)="base.set(($event || '').toUpperCase())"
                />
              </ion-item>
              <ion-item>
                <ion-input
                  label="To"
                  labelPlacement="stacked"
                  maxlength="3"
                  [ngModel]="quote()"
                  (ngModelChange)="quote.set(($event || '').toUpperCase())"
                />
              </ion-item>
              <ion-item>
                <ion-input
                  label="Rate"
                  labelPlacement="stacked"
                  type="number"
                  inputmode="decimal"
                  placeholder="1.0842"
                  [ngModel]="rate()"
                  (ngModelChange)="rate.set($event)"
                />
              </ion-item>
              <ion-item>
                <ion-input
                  label="Quoted on"
                  labelPlacement="stacked"
                  type="date"
                  [ngModel]="date()"
                  (ngModelChange)="date.set($event)"
                />
              </ion-item>
            </ion-list>

            <div class="converted">{{ explanation() }}</div>

            @if (error()) {
              <ion-item lines="none">
                <ion-text color="danger"><small>{{ error() }}</small></ion-text>
              </ion-item>
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class RatesPage {
  readonly rates = inject(RatesService);
  private readonly accounts = inject(AccountsService);
  private readonly alerts = inject(AlertController);

  readonly editorOpen = signal(false);
  readonly base = signal('');
  readonly quote = signal('');
  readonly rate = signal<string | number>('');
  readonly date = signal(toIsoDate());
  readonly error = signal<string | null>(null);

  /** Currencies in play, plus the common ones, so the picker is never empty. */
  readonly currencyOptions = computed(() => {
    const used = this.accounts.all().map((account) => account.currency);
    const common = ['USD', 'EUR', 'GBP', 'INR', 'BDT', 'AUD', 'CAD', 'JPY', 'SGD', 'AED'];
    return [...new Set([...used, this.rates.reportingCurrency(), ...common])].sort();
  });

  readonly canSave = computed(
    () => this.base().length === 3 && this.quote().length === 3 && Number(this.rate()) > 0,
  );

  /** States the quote in words, so a mistyped direction is obvious before saving. */
  readonly explanation = computed(() => {
    if (!this.canSave()) return 'One unit of the first currency, in units of the second.';
    return `1 ${this.base()} = ${this.rate()} ${this.quote()}`;
  });

  add(): void {
    this.base.set('');
    this.quote.set(this.rates.reportingCurrency());
    this.rate.set('');
    this.date.set(toIsoDate());
    this.error.set(null);
    this.editorOpen.set(true);
  }

  /** Adding a fresh quote for a pair already listed: prefill the direction. */
  addFor(pair: PairSummary): void {
    this.add();
    this.base.set(pair.base);
    this.quote.set(pair.quote);
    this.rate.set(pair.rate);
  }

  close(): void {
    this.editorOpen.set(false);
  }

  async save(): Promise<void> {
    this.error.set(null);
    try {
      await this.rates.save({
        base: this.base(),
        quote: this.quote(),
        rate: Number(this.rate()),
        date: this.date(),
      });
      this.close();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  /**
   * Changing the reporting currency does not re-rate existing transactions —
   * each carries the rate that applied when it happened, quoted against
   * whatever the reporting currency was then. Saying so is better than silently
   * mixing two bases in one total.
   */
  async changeReporting(currency: string): Promise<void> {
    if (currency === this.rates.reportingCurrency()) return;

    const alert = await this.alerts.create({
      header: `Report in ${currency}?`,
      message:
        'Transactions already recorded keep the rate they were given at the time. New ones will be converted to ' +
        currency +
        '. Figures from before the change stay quoted against the old currency.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Change',
          handler: () => {
            void this.rates.setReportingCurrency(currency);
          },
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({ addOutline, swapHorizontalOutline });
  }
}
