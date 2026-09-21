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
import { Account, AccountKind } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { AccountsService } from '../../core/repositories/accounts.service';
import { RatesService } from '../../core/repositories/rates.service';
import { formatAmount, parseAmount } from '../../core/util/money';
import { CurrencyFieldComponent } from '../../shared/currency-field.component';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';

const KINDS: ReadonlyArray<{ value: AccountKind; label: string; icon: string }> = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'bank', label: 'Bank account', icon: 'business-outline' },
  { value: 'card', label: 'Credit card', icon: 'card-outline' },
  { value: 'wallet', label: 'Digital wallet', icon: 'phone-portrait-outline' },
  { value: 'savings', label: 'Savings', icon: 'save-outline' },
  { value: 'investment', label: 'Investment', icon: 'trending-up-outline' },
];



@Component({
  selector: 'app-account-editor',
  standalone: true,
  imports: [CurrencyFieldComponent, FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonList, IonNote, IonSelect, IonSelectOption, IonText, IonTitle, IonToggle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} account</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" fill="solid" [disabled]="!name().trim()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item>
          <ion-input
            label="Name"
            labelPlacement="stacked"
            placeholder="Everyday current account"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-select
            label="Type"
            labelPlacement="stacked"
            [ngModel]="kind()"
            (ngModelChange)="kind.set($event)"
          >
            @for (option of kinds; track option.value) {
              <ion-select-option [value]="option.value">{{ option.label }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-select
            label="Group"
            labelPlacement="stacked"
            placeholder="No group"
            [ngModel]="groupId()"
            (ngModelChange)="groupId.set($event)"
          >
            <!--
              An explicit "No group" rather than a clearable select: ungrouped is
              a real place accounts live, not the absence of a choice.
            -->
            <ion-select-option [value]="null">No group</ion-select-option>
            @for (group of groups.active(); track group.id) {
              <ion-select-option [value]="group.id">{{ group.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item [lines]="currencyLocked() ? 'none' : undefined">
          <app-currency-field
            [value]="currency()"
            [disabled]="currencyLocked()"
            [footnote]="currencyFootnote()"
            (valueChange)="setCurrency($event)"
          />
        </ion-item>
        <!--
          The one case that still needs copy on the form. Everywhere else the
          picker carries it, but a locked field cannot be opened, so an
          unexplained dead control is all the user would see.
        -->
        @if (currencyLocked()) {
          <ion-item>
            <ion-note>Fixed once an account has transactions.</ion-note>
          </ion-item>
        }

        <ion-item>
          <ion-input
            label="Opening balance"
            labelPlacement="stacked"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            [ngModel]="openingBalance()"
            (ngModelChange)="openingBalance.set($event)"
          />
        </ion-item>

        @if (isCreditCard()) {
          <ion-item>
            <ion-input
              label="Credit limit"
              labelPlacement="stacked"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
              [ngModel]="creditLimit()"
              (ngModelChange)="creditLimit.set($event)"
            />
          </ion-item>

          <ion-item>
            <ion-input
              label="Statement closes on day"
              labelPlacement="stacked"
              type="number"
              inputmode="numeric"
              min="1"
              max="31"
              placeholder="25"
              [ngModel]="statementDay()"
              (ngModelChange)="statementDay.set($event)"
            />
          </ion-item>

          <ion-item>
            <ion-input
              label="Payment due on day"
              labelPlacement="stacked"
              type="number"
              inputmode="numeric"
              min="1"
              max="31"
              placeholder="15"
              [ngModel]="dueDay()"
              (ngModelChange)="dueDay.set($event)"
            />
          </ion-item>
        }

        @if (existing()) {
          <ion-item>
            <ion-toggle [ngModel]="archived()" (ngModelChange)="archived.set($event)">
              Archived
            </ion-toggle>
          </ion-item>
        }
      </ion-list>

      @if (isCreditCard()) {
        <ion-item lines="none">
          <ion-note>
            A day past the end of a short month falls on that month's last day, so 31 means the
            31st where there is one and the 28th in February.
          </ion-note>
        </ion-item>
      }

      @if (!existing()) {
        <ion-item lines="none">
          <ion-note>
            The opening balance is what the account held before your first recorded transaction.
          </ion-note>
        </ion-item>
      }

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }
    </ion-content>
  `,
})
export class AccountEditorComponent {
  private readonly accounts = inject(AccountsService);
  readonly groups = inject(AccountGroupsService);
  private readonly rates = inject(RatesService);

  readonly existing = input<Account | null>(null);
  readonly saved = output<Account>();
  readonly cancelled = output<void>();

  readonly kinds = KINDS;

  readonly name = signal('');
  readonly kind = signal<AccountKind>('bank');
  readonly currency = signal('USD');
  readonly openingBalance = signal('0.00');
  readonly groupId = signal<string | null>(null);
  readonly creditLimit = signal('');
  readonly statementDay = signal<number | null>(null);
  readonly dueDay = signal<number | null>(null);
  readonly archived = signal(false);

  /**
   * Card terms are shown only where they mean something: an account filed in a
   * credit-card group. They follow the picker live, so choosing that group
   * reveals them without a save-and-reopen.
   */
  readonly isCreditCard = computed(
    () => this.groups.byId(this.groupId())?.type === 'credit-card',
  );
  readonly error = signal<string | null>(null);

  /** Transactions already recorded against this account, or null while counting. */
  readonly recorded = signal<number | null>(null);

  /** Whether the user has picked a currency, as opposed to being offered one. */
  private readonly currencyTouched = signal(false);

  setCurrency(code: string): void {
    this.currencyTouched.set(true);
    this.currency.set(code);
  }

  /**
   * Whether the currency may still be changed.
   *
   * History is what locks it, not existence. Changing the currency of an
   * account that has transactions silently reinterprets every amount on it —
   * 4,100 dollars becomes 4,100 taka. An account with nothing on it has nothing
   * to reinterpret, which is what makes a seeded account fixable rather than
   * something to delete and recreate.
   *
   * Locked while the count is unknown: refusing briefly is recoverable, and
   * offering a change that turns out to be unsafe is not.
   */
  readonly currencyLocked = computed(() => this.existing() !== null && this.recorded() !== 0);

  /** Shown under the picker's grid, where the choice is actually being made. */
  readonly currencyFootnote = computed(() =>
    this.existing()
      ? 'Changeable while the account has no transactions.'
      : 'What this account is held in. Totals convert into the vault currency.',
  );

  constructor() {
    effect(() => {
      const account = this.existing();
      // Only `existing()` is tracked: this effect resets the form, and the
      // account list it reads below changes whenever a sync lands. Tracking it
      // would wipe what the user had typed.
      untracked(() => this.load(account));
    });
  }

  private load(account: Account | null): void {
    {
      if (account) {
        this.name.set(account.name);
        this.kind.set(account.kind);
        this.currency.set(account.currency);
        this.currencyTouched.set(true);
        this.openingBalance.set(formatAmount(account.openingBalance, account.currency));
        // A group deleted elsewhere reads as no group rather than as a dangling
        // selection the picker could not display.
        this.groupId.set(this.groups.byId(account.groupId)?.id ?? null);
        this.recorded.set(null);
        void this.accounts.transactionCount(account.id).then((count) => this.recorded.set(count));
        this.creditLimit.set(
          typeof account.creditLimit === 'number'
            ? formatAmount(account.creditLimit, account.currency)
            : '',
        );
        this.statementDay.set(account.statementDay ?? null);
        this.dueDay.set(account.dueDay ?? null);
        this.archived.set(account.archived);
      } else {
        this.name.set('');
        this.kind.set('bank');
        // The vault's currency, not the first account's. Copying whichever
        // account happens to sort first means a vault that works in taka
        // offers dollars the moment one foreign account exists.
        this.currency.set(this.rates.reportingCurrency());
        this.currencyTouched.set(false);
        this.openingBalance.set('0.00');
        this.groupId.set(null);
        this.recorded.set(0);
        this.creditLimit.set('');
        this.statementDay.set(null);
        this.dueDay.set(null);
        this.archived.set(false);
      }
      this.error.set(null);
    }
  }

  /**
   * Offer the vault's currency once it is known.
   *
   * The reset above runs before Dexie has read the settings row, so it sees the
   * fallback rather than the vault's own currency. This fills that in — but
   * only for a new account and only while the field has not been touched, so a
   * deliberate choice is never overwritten.
   */
  private readonly offerVaultCurrency = effect(() => {
    const vaultCurrency = this.rates.reportingCurrency();
    untracked(() => {
      if (this.existing() || this.currencyTouched()) return;
      this.currency.set(vaultCurrency);
    });
  });

  async save(): Promise<void> {
    this.error.set(null);
    try {
      const existing = this.existing();
      const card = this.isCreditCard();
      const saved = await this.accounts.save({
        id: existing?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        kind: this.kind(),
        currency: this.currency(),
        openingBalance: parseAmount(this.openingBalance() || '0', this.currency()),
        groupId: this.groupId(),
        // Written only for a card, and cleared when an account stops being one:
        // a limit left behind on a current account would be read as real by
        // anything that asks what credit is available.
        creditLimit: card ? parseOptionalAmount(this.creditLimit(), this.currency()) : undefined,
        statementDay: card ? dayOrUndefined(this.statementDay()) : undefined,
        dueDay: card ? dayOrUndefined(this.dueDay()) : undefined,
        archived: this.archived(),
        colour: existing?.colour ?? '#3880ff',
        icon: KINDS.find((k) => k.value === this.kind())?.icon ?? 'wallet-outline',
        createdAt: existing?.createdAt ?? Date.now(),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

/** An amount field that is allowed to be blank: blank means "not recorded". */
function parseOptionalAmount(input: string, currency: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const amount = parseAmount(trimmed, currency);
  // A limit is a capacity, not a balance; zero and negatives are not limits.
  return amount > 0 ? amount : undefined;
}

/** A day-of-month field, ignored unless it is one. */
function dayOrUndefined(value: number | string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const day = Math.trunc(Number(value));
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : undefined;
}
