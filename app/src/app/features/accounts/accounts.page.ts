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
import { Account } from '../../core/models/domain';
import { convert } from '../../core/money/conversion';
import { AccountsService } from '../../core/repositories/accounts.service';
import { RatesService } from '../../core/repositories/rates.service';
import { formatMoney } from '../../core/util/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { SyncStatusComponent } from '../../shared/sync-status.component';
import { AccountEditorComponent } from './account-editor.component';
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
  imports: [RouterLink, MoneyPipe, SyncStatusComponent, AccountEditorComponent, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonItemDivider, IonLabel, IonList, IonModal, IonNote, IonTitle, IonToolbar],
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

        <ion-list>
          @for (account of accounts.active(); track account.id) {
            <ion-item button (click)="edit(account)">
              <ion-icon slot="start" [name]="account.icon" [style.color]="account.colour" />
              <ion-label>
                <h3>{{ account.name }}</h3>
                <p>{{ account.kind }}</p>
              </ion-label>
              <ion-note slot="end" [color]="balanceOf(account) < 0 ? 'danger' : undefined">
                {{ balanceOf(account) | money: account.currency }}
                @if (converted(account); as inReporting) {
                  <br /><small>≈ {{ inReporting }}</small>
                }
              </ion-note>
            </ion-item>
          }
        </ion-list>
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
  private readonly rates = inject(RatesService);
  private readonly alerts = inject(AlertController);

  readonly reportingCurrency = computed(() => this.rates.reportingCurrency());
  readonly unconverted = computed(() => this.accounts.netWorthDetail().unconverted);

  readonly editorOpen = signal(false);
  readonly editing = signal<Account | null>(null);

  archived(): Account[] {
    return this.accounts.all().filter((account) => account.archived);
  }

  balanceOf(account: Account): number {
    return this.accounts.balances().get(account.id) ?? account.openingBalance;
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
