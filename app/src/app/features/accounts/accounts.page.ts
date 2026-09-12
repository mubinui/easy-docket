import { Component, computed, inject, signal } from '@angular/core';
import { addIcons } from 'ionicons';
import {
  addOutline,
  businessOutline,
  cardOutline,
  cashOutline,
  folderOutline,
  phonePortraitOutline,
  saveOutline,
  trendingUpOutline,
  walletOutline,
} from 'ionicons/icons';
import { AccountSection, buildSections, displayBalance } from '../../core/accounts/sections';
import { availableCredit, dueDateFor, hasCycle, lastStatementDate } from '../../core/cards/statement';
import { Account } from '../../core/models/domain';
import { convert } from '../../core/money/conversion';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { AccountsService } from '../../core/repositories/accounts.service';
import { RatesService } from '../../core/repositories/rates.service';
import { formatMoney } from '../../core/util/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { SyncStatusComponent } from '../../shared/sync-status.component';
import { AccountEditorComponent } from './account-editor.component';
import { PayBillComponent } from './pay-bill.component';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
  AlertController,
} from '@ionic/angular';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [RouterLink, MoneyPipe, SyncStatusComponent, AccountEditorComponent, PayBillComponent, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonItemDivider, IonLabel, IonList, IonModal, IonNote, IonTitle, IonToolbar],
  styles: [
    `
      .total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 1rem;
      }
      .total strong {
        font-size: 1.4rem;
      }
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      .warning {
        padding: 0 1rem 0.75rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Accounts</ion-title>
        <ion-buttons slot="end">
          <ion-button routerLink="/account-groups" aria-label="Account groups">
            <ion-icon slot="icon-only" name="folder-outline" />
          </ion-button>
        </ion-buttons>
        <app-sync-status slot="end" />
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (accounts.active().length) {
        <div class="total">
          <ion-note>Net worth</ion-note>
          <strong>{{ accounts.netWorth() | money: reportingCurrency() }}</strong>
        </div>
        @if (unconverted().length) {
          <div class="warning">
            <ion-note color="warning">
              Excludes {{ unconverted().join(', ') }} — add a rate to include them
            </ion-note>
          </div>
        }

        @for (section of sections(); track section.group?.id ?? 'ungrouped') {
          <ion-list>
            <ion-item-divider>
              <ion-label>{{ section.group?.name ?? 'Not in a group' }}</ion-label>
              <ion-note slot="end">
                {{ section.subtotal | money: reportingCurrency() }}
                @if (section.owed) {
                  <small>owed</small>
                }
              </ion-note>
            </ion-item-divider>

            @if (section.unconverted.length) {
              <div class="warning">
                <ion-note color="warning">
                  Subtotal excludes {{ section.unconverted.join(', ') }}
                </ion-note>
              </div>
            }

            @for (account of section.accounts; track account.id) {
              <ion-item button (click)="edit(account)">
                <ion-icon slot="start" [name]="account.icon" [style.color]="account.colour" />
                <ion-label>
                  <h3>{{ account.name }}</h3>
                  <p>{{ subtitle(account, section) }}</p>
                </ion-label>
                <ion-note slot="end" [color]="alarming(account, section) ? 'danger' : undefined">
                  {{ shown(account, section) | money: account.currency }}
                  @if (section.owed) {
                    <small> owed</small>
                  }
                  @if (converted(account); as inReporting) {
                    <br /><small>≈ {{ inReporting }}</small>
                  }
                </ion-note>
                @if (payable(account, section)) {
                  <!--
                    A button inside the row rather than a swipe action: a swipe
                    is invisible until you try it, and this is the one thing a
                    person opens the app to do on a card.
                  -->
                  <ion-button
                    slot="end"
                    fill="outline"
                    size="small"
                    [attr.aria-label]="'Pay ' + account.name + ' bill'"
                    (click)="startPayment(account, $event)"
                  >
                    Pay
                  </ion-button>
                }
              </ion-item>
            }
          </ion-list>
        }
      } @else {
        <div class="empty">
          <ion-icon name="wallet-outline" size="large" color="medium" />
          <p><ion-note>No accounts yet. Add one to start recording transactions.</ion-note></p>
        </div>
      }

      @if (archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          @for (account of archived(); track account.id) {
            <ion-item button (click)="edit(account)">
              <ion-label color="medium">{{ account.name }}</ion-label>
              <ion-note slot="end">{{ balanceOf(account) | money: account.currency }}</ion-note>
            </ion-item>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="paying() !== null" (didDismiss)="paying.set(null)">
        <ng-template>
          <app-pay-bill
            [card]="paying()"
            (paid)="paying.set(null)"
            (cancelled)="paying.set(null)"
          />
        </ng-template>
      </ion-modal>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-account-editor
            [existing]="editing()"
            (saved)="close()"
            (cancelled)="close()"
          />
          @if (editing(); as account) {
            <ion-button expand="block" fill="clear" color="danger" (click)="confirmDelete(account)">
              Delete account
            </ion-button>
          }
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class AccountsPage {
  readonly accounts = inject(AccountsService);
  readonly groups = inject(AccountGroupsService);
  private readonly rates = inject(RatesService);
  private readonly alerts = inject(AlertController);

  readonly reportingCurrency = computed(() => this.rates.reportingCurrency());
  readonly unconverted = computed(() => this.accounts.netWorthDetail().unconverted);

  /**
   * The active accounts arranged by group, with a subtotal each.
   *
   * The net worth figure above is deliberately left alone: a card debt already
   * subtracts there, and flipping its sign for display must not change what the
   * ledger adds up to.
   */
  readonly sections = computed<AccountSection[]>(() =>
    buildSections({
      accounts: this.accounts.active(),
      groups: this.groups.active(),
      balances: this.accounts.balances(),
      reporting: this.reportingCurrency(),
      rateFor: (currency) => this.rates.rateToReporting(currency),
    }),
  );

  readonly editorOpen = signal(false);
  readonly editing = signal<Account | null>(null);
  readonly paying = signal<Account | null>(null);

  archived(): Account[] {
    return this.accounts.all().filter((account) => account.archived);
  }

  balanceOf(account: Account): number {
    return this.accounts.balances().get(account.id) ?? account.openingBalance;
  }

  /**
   * The line under an account's name.
   *
   * For a card this is what the terms are for: how much credit is left and when
   * the bill is due. Each part appears only if its terms are recorded — a card
   * with no limit says nothing about available credit rather than implying one.
   */
  subtitle(account: Account, section: AccountSection): string {
    if (!section.owed) return account.kind;

    const parts: string[] = [];

    const available = availableCredit(this.balanceOf(account), account.creditLimit);
    if (available !== null) {
      parts.push(`${formatMoney(available, account.currency)} available`);
    }

    if (hasCycle(account)) {
      const due = dueDateFor(account.dueDay!, lastStatementDate(account.statementDay!));
      parts.push(`due ${formatDueDate(due)}`);
    }

    return parts.length ? parts.join(' · ') : account.kind;
  }

  /** Whether this row offers a payment: a card with something on it. */
  payable(account: Account, section: AccountSection): boolean {
    return section.owed && this.balanceOf(account) < 0;
  }

  /**
   * Open the payment sheet.
   *
   * The click is stopped from reaching the row, which would otherwise open the
   * account editor underneath the sheet.
   */
  startPayment(account: Account, event: Event): void {
    event.stopPropagation();
    this.paying.set(account);
  }

  /** What the row shows: money owed on a card, money held everywhere else. */
  shown(account: Account, section: AccountSection): number {
    return displayBalance(this.balanceOf(account), section.owed);
  }

  /**
   * Whether the figure deserves the danger colour.
   *
   * An overdrawn current account is worth flagging. A balance on a credit card
   * is not — that is what a credit card is for — so a card section is never
   * coloured, in either direction.
   */
  alarming(account: Account, section: AccountSection): boolean {
    return !section.owed && this.balanceOf(account) < 0;
  }

  /**
   * A foreign balance shown in the reporting currency too, so the list adds up
   * to the headline. Null when the account is already in that currency, or when
   * no rate is known — in which case the figure would be a guess.
   */
  converted(account: Account): string | null {
    const reporting = this.reportingCurrency();
    if (account.currency.toUpperCase() === reporting.toUpperCase()) return null;

    const rate = this.rates.rateToReporting(account.currency);
    if (rate === null) return null;

    return formatMoney(
      convert(this.balanceOf(account), rate, account.currency, reporting),
      reporting,
    );
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(account: Account): void {
    this.editing.set(account);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  /**
   * Deleting an account with history would leave transactions pointing at
   * nothing, so that case is steered towards archiving instead.
   */
  async confirmDelete(account: Account): Promise<void> {
    const count = await this.accounts.transactionCount(account.id);

    if (count > 0) {
      const alert = await this.alerts.create({
        header: 'Archive instead?',
        message: `${account.name} has ${count} transaction(s). Deleting it would leave them without an account. Archive it to hide it from the lists while keeping its history.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Archive',
            handler: () => {
              void this.accounts.setArchived(account.id, true).then(() => this.close());
            },
          },
        ],
      });
      await alert.present();
      return;
    }

    const alert = await this.alerts.create({
      header: 'Delete account?',
      message: `${account.name} will be removed from every device you sync with.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.accounts.remove(account.id).then(() => this.close());
          },
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({
      addOutline,
      walletOutline,
      cashOutline,
      folderOutline,
      businessOutline,
      cardOutline,
      phonePortraitOutline,
      saveOutline,
      trendingUpOutline,
    });
  }
}

/**
 * A short date to sit under an account name — "15 Apr", or "Apr 15" where the
 * viewer's locale puts the month first. Day and month only: the year would be
 * noise on a bill due within the next few weeks.
 */
function formatDueDate(date: string, locale?: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
}
