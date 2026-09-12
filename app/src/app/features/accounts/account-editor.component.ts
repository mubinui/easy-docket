import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Account, AccountKind } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { AccountsService } from '../../core/repositories/accounts.service';
import { formatAmount, parseAmount } from '../../core/util/money';
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

/** Common ISO 4217 codes; the field accepts any three-letter code. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'BDT', 'AUD', 'CAD', 'JPY', 'SGD', 'AED'];

@Component({
  selector: 'app-account-editor',
  standalone: true,
  imports: [FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonList, IonNote, IonSelect, IonSelectOption, IonText, IonTitle, IonToggle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} account</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!name().trim()" (click)="save()">Save</ion-button>
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

        <ion-item>
          <ion-select
            label="Currency"
            labelPlacement="stacked"
            [disabled]="!!existing()"
            [ngModel]="currency()"
            (ngModelChange)="currency.set($event)"
          >
            @for (code of currencies; track code) {
              <ion-select-option [value]="code">{{ code }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

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

        @if (existing()) {
          <ion-item>
            <ion-toggle [ngModel]="archived()" (ngModelChange)="archived.set($event)">
              Archived
            </ion-toggle>
          </ion-item>
        }
      </ion-list>

      <ion-item lines="none">
        <ion-note>
          @if (existing()) {
            The currency is fixed once an account exists, because changing it would silently
            reinterpret every amount already recorded against it.
          } @else {
            The opening balance is what the account held before your first recorded transaction.
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
export class AccountEditorComponent {
  private readonly accounts = inject(AccountsService);
  readonly groups = inject(AccountGroupsService);

  readonly existing = input<Account | null>(null);
  readonly saved = output<Account>();
  readonly cancelled = output<void>();

  readonly kinds = KINDS;
  readonly currencies = CURRENCIES;

  readonly name = signal('');
  readonly kind = signal<AccountKind>('bank');
  readonly currency = signal('USD');
  readonly openingBalance = signal('0.00');
  readonly groupId = signal<string | null>(null);
  readonly archived = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const account = this.existing();
      if (account) {
        this.name.set(account.name);
        this.kind.set(account.kind);
        this.currency.set(account.currency);
        this.openingBalance.set(formatAmount(account.openingBalance, account.currency));
        // A group deleted elsewhere reads as no group rather than as a dangling
        // selection the picker could not display.
        this.groupId.set(this.groups.byId(account.groupId)?.id ?? null);
        this.archived.set(account.archived);
      } else {
        this.name.set('');
        this.kind.set('bank');
        // Match the ledger's existing currency so a second account lines up
        // with the first by default.
        this.currency.set(this.accounts.active()[0]?.currency ?? 'USD');
        this.openingBalance.set('0.00');
        this.groupId.set(null);
        this.archived.set(false);
      }
      this.error.set(null);
    });
  }

  async save(): Promise<void> {
    this.error.set(null);
    try {
      const existing = this.existing();
      const saved = await this.accounts.save({
        id: existing?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        kind: this.kind(),
        currency: this.currency(),
        openingBalance: parseAmount(this.openingBalance() || '0', this.currency()),
        groupId: this.groupId(),
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
