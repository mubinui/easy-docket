import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Transaction, TransactionKind } from '../../core/models/domain';
import { AccountsService } from '../../core/repositories/accounts.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { RatesService } from '../../core/repositories/rates.service';
import { TransactionsService } from '../../core/repositories/transactions.service';
import { toIsoDate } from '../../core/util/dates';
import { convert } from '../../core/money/conversion';
import { formatAmount, formatMoney, parseAmount } from '../../core/util/money';
import {
  IonButton,
  IonNote,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';

/**
 * Create or edit one transaction.
 *
 * The form is kept in signals rather than a reactive form because the shape
 * changes with the selected kind — a transfer needs a second account and no
 * category — and expressing that as computed signals is considerably clearer
 * than toggling validators.
 */
@Component({
  selector: 'app-transaction-editor',
  standalone: true,
  imports: [FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonText, IonTitle, IonToggle, IonToolbar, IonNote],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} transaction</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-segment [ngModel]="kind()" (ngModelChange)="setKind($event)">
        <ion-segment-button value="expense"><ion-label>Expense</ion-label></ion-segment-button>
        <ion-segment-button value="income"><ion-label>Income</ion-label></ion-segment-button>
        <ion-segment-button value="transfer"><ion-label>Transfer</ion-label></ion-segment-button>
      </ion-segment>

      <ion-list>
        <ion-item>
          <ion-input
            label="Amount"
            labelPlacement="stacked"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            [ngModel]="amount()"
            (ngModelChange)="amount.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-select
            label="{{ kind() === 'transfer' ? 'From account' : 'Account' }}"
            labelPlacement="stacked"
            [ngModel]="accountId()"
            (ngModelChange)="setAccount($event)"
          >
            @for (account of accounts.active(); track account.id) {
              <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        @if (kind() === 'transfer') {
          <ion-item>
            <ion-select
              label="To account"
              labelPlacement="stacked"
              [ngModel]="counterAccountId()"
              (ngModelChange)="counterAccountId.set($event)"
            >
              @for (account of accounts.active(); track account.id) {
                @if (account.id !== accountId()) {
                  <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
                }
              }
            </ion-select>
          </ion-item>
        } @else {
          <ion-item>
            <ion-select
              label="Category"
              labelPlacement="stacked"
              [ngModel]="categoryId()"
              (ngModelChange)="categoryId.set($event)"
            >
              @for (category of categoryOptions(); track category.id) {
                <ion-select-option [value]="category.id">{{ category.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>
        }

        <ion-item>
          <ion-input
            label="Payee"
            labelPlacement="stacked"
            [ngModel]="payee()"
            (ngModelChange)="payee.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-input
            label="Date"
            labelPlacement="stacked"
            type="date"
            [ngModel]="date()"
            (ngModelChange)="setDate($event)"
          />
        </ion-item>

        <ion-item>
          <ion-input
            label="Note"
            labelPlacement="stacked"
            [ngModel]="note()"
            (ngModelChange)="note.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-toggle [ngModel]="cleared()" (ngModelChange)="cleared.set($event)">
            Cleared
          </ion-toggle>
        </ion-item>

        @if (needsRate()) {
          <!--
            The rate is stored on the transaction, so it has to be known now.
            It is prefilled with the last one recorded and shown converted, so a
            mistyped figure is obvious before saving rather than months later.
          -->
          <ion-item>
            <ion-input
              label="Rate to {{ reportingCurrency() }}"
              labelPlacement="stacked"
              type="number"
              inputmode="decimal"
              [ngModel]="rate()"
              (ngModelChange)="rate.set($event)"
            />
          </ion-item>
          <ion-item lines="none">
            <ion-note>
              @if (converted()) {
                Worth {{ converted() }} · 1 {{ currency() }} = {{ rate() }}
                {{ reportingCurrency() }}
              } @else {
                Enter what one {{ currency() }} was worth in
                {{ reportingCurrency() }} on this date.
              }
            </ion-note>
          </ion-item>
        }
      </ion-list>

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }

      @if (existing()) {
        <ion-button expand="block" fill="clear" color="danger" (click)="remove()">
          Delete transaction
        </ion-button>
      }
    </ion-content>
  `,
})
export class TransactionEditorComponent {
  readonly accounts = inject(AccountsService);
  readonly categories = inject(CategoriesService);
  private readonly transactions = inject(TransactionsService);
  private readonly rates = inject(RatesService);

  /** The transaction being edited, or null to create a new one. */
  readonly existing = input<Transaction | null>(null);

  readonly saved = output<Transaction>();
  readonly deleted = output<string>();
  readonly cancelled = output<void>();

  readonly kind = signal<TransactionKind>('expense');
  readonly amount = signal('');
  readonly accountId = signal<string | null>(null);
  readonly counterAccountId = signal<string | null>(null);
  readonly categoryId = signal<string | null>(null);
  readonly payee = signal('');
  readonly note = signal('');
  readonly date = signal(toIsoDate());
  readonly cleared = signal(true);
  readonly rate = signal<string>('');
  readonly error = signal<string | null>(null);

  /** The account's currency, which is what the amount is expressed in. */
  readonly currency = computed(
    () => this.accounts.byId(this.accountId() ?? '')?.currency ?? this.rates.reportingCurrency(),
  );

  /** A rate is only wanted when the account is in another currency. */
  readonly needsRate = computed(
    () => this.currency().toUpperCase() !== this.rates.reportingCurrency().toUpperCase(),
  );

  /** What the entered rate makes this worth, so a mistyped rate is visible. */
  readonly converted = computed(() => {
    const value = Number(this.rate());
    const amount = Number.parseFloat(this.amount().replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(amount)) return null;

    try {
      const minor = parseAmount(this.amount(), this.currency());
      return formatMoney(
        convert(minor, value, this.currency(), this.rates.reportingCurrency()),
        this.rates.reportingCurrency(),
      );
    } catch {
      return null;
    }
  });

  readonly categoryOptions = computed(() =>
    this.categories.forKind(this.kind() === 'income' ? 'income' : 'expense'),
  );

  readonly canSave = computed(
    () => this.amount().trim() !== '' && this.accountId() !== null,
  );

  constructor() {
    // Load the incoming transaction, or reset to a sensible new one. Defaulting
    // the account to the first available saves a tap on the common path.
    effect(() => {
      const txn = this.existing();
    // Only `existing()` is tracked. Everything below reads other signals —
    // the account list, the rate table — and this effect *resets the form*, so
    // tracking them would mean a sync landing, or another tab writing, silently
    // wiping whatever the user had typed. That is a data-loss bug of the
    // quietest kind: the sheet simply looks as though nothing was entered.
      untracked(() => this.load(txn));
    });

    /**
     * Fill in the default account once the account list has arrived.
     *
     * The reset above runs before Dexie's first emission, when there is nothing
     * to default to. This fills the gap — but only while the field is still
     * empty, so a later change to the accounts (a sync landing, another tab)
     * can never overwrite an account the user has chosen.
     */
    effect(() => {
      const first = this.accounts.active()[0];
      untracked(() => {
        if (this.existing() || this.accountId() !== null || !first) return;
        this.accountId.set(first.id);
        this.suggestRate();
      });
    });
  }

  private load(txn: Transaction | null): void {
    {
      if (txn) {
        this.kind.set(txn.kind);
        this.amount.set(formatAmount(txn.amount, txn.currency));
        this.accountId.set(txn.accountId);
        this.counterAccountId.set(txn.counterAccountId);
        this.categoryId.set(txn.categoryId);
        this.payee.set(txn.payee);
        this.note.set(txn.note);
        this.date.set(txn.date);
        this.cleared.set(txn.cleared);
        this.rate.set(txn.rate !== undefined ? String(txn.rate) : '');
      } else {
        this.kind.set('expense');
        this.amount.set('');
        this.accountId.set(this.accounts.active()[0]?.id ?? null);
        this.counterAccountId.set(null);
        this.categoryId.set(null);
        this.payee.set('');
        this.note.set('');
        this.date.set(toIsoDate());
        this.cleared.set(true);
        this.rate.set('');
      }
      this.error.set(null);

      // Also on open, not only on change: the default account may itself be in
      // another currency, in which case the field would otherwise sit empty
      // with a rate already known.
      this.suggestRate();
    }
  }

  readonly reportingCurrency = computed(() => this.rates.reportingCurrency());

  setKind(kind: TransactionKind): void {
    this.kind.set(kind);
    // A category from the other direction would be meaningless, and a transfer
    // has no category at all.
    this.categoryId.set(null);
  }

  /** Changing the account can change the currency, and so whether a rate is needed. */
  setAccount(accountId: string): void {
    this.accountId.set(accountId);
    this.suggestRate();
  }

  /** A rate is quoted for a day, so moving the date can change which one applies. */
  setDate(date: string): void {
    this.date.set(date);
    this.suggestRate();
  }

  /**
   * Offer the last rate recorded for this currency and date, if there is one.
   *
   * The current value is read untracked: this runs from the initialising
   * effect, and an effect that both reads and writes `rate` would re-run
   * itself forever.
   */
  suggestRate(): void {
    if (!this.needsRate() || untracked(this.rate).trim() !== '') return;

    const suggestion = this.rates.rateToReporting(this.currency(), this.date());
    if (suggestion !== null) this.rate.set(String(suggestion));
  }

  async save(): Promise<void> {
    this.error.set(null);
    const account = this.accounts.byId(this.accountId() ?? '');
    if (!account) {
      this.error.set('Choose an account first');
      return;
    }

    try {
      const saved = await this.transactions.save({
        id: this.existing()?.id ?? crypto.randomUUID(),
        kind: this.kind(),
        amount: parseAmount(this.amount(), account.currency),
        currency: account.currency,
        accountId: account.id,
        counterAccountId: this.kind() === 'transfer' ? this.counterAccountId() : null,
        categoryId: this.kind() === 'transfer' ? null : this.categoryId(),
        date: this.date(),
        payee: this.payee().trim(),
        note: this.note().trim(),
        tags: this.existing()?.tags ?? [],
        cleared: this.cleared(),
        // Only stored when it means something: a transaction already in the
        // reporting currency needs no rate, and carrying one would invite a
        // future reader to apply it.
        ...(this.needsRate() && Number(this.rate()) > 0
          ? { rate: Number(this.rate()), rateDate: this.date() }
          : {}),
        createdAt: this.existing()?.createdAt ?? Date.now(),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  async remove(): Promise<void> {
    const txn = this.existing();
    if (!txn) return;
    await this.transactions.remove(txn.id);
    this.deleted.emit(txn.id);
  }
}
