import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { StatementSummary } from '../../core/cards/statement';
import { PayBillService } from '../../core/cards/pay-bill.service';
import { Account } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { AccountsService } from '../../core/repositories/accounts.service';
import { toIsoDate } from '../../core/util/dates';
import { formatAmount, formatMoney, parseAmount } from '../../core/util/money';

/** Which figure the user is paying. */
export type PayChoice = 'statement' | 'full' | 'custom';

@Component({
  selector: 'app-pay-bill',
  standalone: true,
  imports: [FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonNote, IonRadio, IonRadioGroup, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Pay {{ card()?.name }}</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!canPay()" (click)="pay()">Pay</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-radio-group
          [ngModel]="choice()"
          (ngModelChange)="choice.set($event)"
        >
          @if (summary(); as bill) {
            <ion-item>
              <ion-radio value="statement">
                <ion-label>
                  <h3>Statement balance</h3>
                  <p>{{ money(bill.remaining) }} — due {{ when(bill.dueOn) }}</p>
                </ion-label>
              </ion-radio>
            </ion-item>
          }

          <ion-item>
            <ion-radio value="full">
              <ion-label>
                <h3>Full balance</h3>
                <p>{{ money(currentOwed()) }} — everything on the card today</p>
              </ion-label>
            </ion-radio>
          </ion-item>

          <ion-item>
            <ion-radio value="custom"><ion-label><h3>Another amount</h3></ion-label></ion-radio>
          </ion-item>
        </ion-radio-group>

        @if (choice() === 'custom') {
          <ion-item>
            <ion-input
              label="Amount"
              labelPlacement="stacked"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
              [ngModel]="custom()"
              (ngModelChange)="custom.set($event)"
            />
          </ion-item>
        }

        <ion-item>
          <ion-select
            label="Pay from"
            labelPlacement="stacked"
            placeholder="Choose an account"
            [ngModel]="fromId()"
            (ngModelChange)="fromId.set($event)"
          >
            @for (account of fundingAccounts(); track account.id) {
              <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-input
            label="Date"
            labelPlacement="stacked"
            type="date"
            [ngModel]="date()"
            (ngModelChange)="date.set($event)"
          />
        </ion-item>
      </ion-list>

      <ion-item lines="none">
        <ion-note>
          @if (!fundingAccounts().length) {
            There is no account in {{ card()?.currency }} to pay this card from. A payment is a
            transfer, and a transfer moves one amount between two accounts — so both have to be
            in the same currency.
          } @else {
            Recorded as a transfer from the account you choose onto the card. Nothing is sent to
            your bank; this is your record of a payment you have made.
          }
        </ion-note>
      </ion-item>

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }
    </ion-content>
  `,
})
export class PayBillComponent {
  private readonly accounts = inject(AccountsService);
  private readonly groups = inject(AccountGroupsService);
  private readonly bills = inject(PayBillService);

  readonly card = input<Account | null>(null);
  readonly paid = output<void>();
  readonly cancelled = output<void>();

  readonly summary = signal<StatementSummary | null>(null);
  readonly choice = signal<PayChoice>('statement');
  readonly custom = signal('');
  readonly fromId = signal<string | null>(null);
  readonly date = signal(toIsoDate());
  readonly error = signal<string | null>(null);

  /** What the card owes today, as a positive amount. */
  readonly currentOwed = computed(() => {
    const card = this.card();
    if (!card) return 0;
    const balance = this.accounts.balances().get(card.id) ?? card.openingBalance;
    return balance === 0 ? 0 : -balance;
  });

  /**
   * Accounts a payment could come from.
   *
   * Not the card itself, and nothing else on the liability side of the balance
   * sheet: paying a card with another card, or out of a loan, is not something
   * this app models. Only accounts sharing the card's currency, because a
   * transfer carries a single amount.
   */
  readonly fundingAccounts = computed(() => {
    const card = this.card();
    if (!card) return [];
    return this.accounts
      .active()
      .filter(
        (account) =>
          account.id !== card.id &&
          !this.groups.isLiability(account) &&
          account.currency.toUpperCase() === card.currency.toUpperCase(),
      );
  });

  readonly amount = computed(() => {
    const card = this.card();
    if (!card) return 0;

    switch (this.choice()) {
      case 'statement':
        return this.summary()?.remaining ?? 0;
      case 'full':
        return this.currentOwed();
      case 'custom':
        return safeAmount(this.custom(), card.currency);
    }
  });

  canPay(): boolean {
    return this.amount() > 0 && this.fromId() !== null;
  }

  money(amount: number): string {
    return formatMoney(amount, this.card()?.currency ?? 'USD');
  }

  /** A readable date rather than the stored `YYYY-MM-DD`. */
  when(date: string, locale?: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
    });
  }

  constructor() {
    effect(() => {
      const card = this.card();
      this.error.set(null);
      this.date.set(toIsoDate());
      this.custom.set('');
      if (!card) {
        this.summary.set(null);
        return;
      }

      void this.bills.summarise(card).then((summary) => {
        this.summary.set(summary);
        // A card with no statement to speak of starts on the whole balance,
        // since offering "statement balance" of nothing would be a dead option.
        this.choice.set(summary && summary.remaining > 0 ? 'statement' : 'full');
        if (this.choice() === 'custom') this.custom.set(formatAmount(0, card.currency));
      });

      // Defaulted, not forced: this effect re-runs whenever the accounts change
      // — a sync arriving, say — and overwriting a choice the user has already
      // made would be worse than offering none.
      const options = this.fundingAccounts();
      if (!options.some((account) => account.id === this.fromId())) {
        this.fromId.set(options[0]?.id ?? null);
      }
    });
  }

  async pay(): Promise<void> {
    this.error.set(null);
    const card = this.card();
    const from = this.fundingAccounts().find((a) => a.id === this.fromId());
    if (!card || !from) return;

    try {
      await this.bills.pay({ card, from, amount: this.amount(), date: this.date() });
      this.paid.emit();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

/** A typed amount that may be nonsense; nonsense is worth nothing. */
function safeAmount(input: string, currency: string): number {
  try {
    return parseAmount(input.trim() || '0', currency);
  } catch {
    return 0;
  }
}
