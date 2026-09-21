import { Component, computed, inject } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { countsInTotals } from '../../core/accounts/totals';
import { Account } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { AccountsService } from '../../core/repositories/accounts.service';
import { MoneyPipe } from '../../shared/money.pipe';
import { RatesService } from '../../core/repositories/rates.service';

/**
 * Which accounts count towards net worth.
 *
 * A list of switches rather than a multi-select: the question is asked once per
 * account and the answer is worth seeing all at once, next to the balance it
 * decides the fate of.
 */
@Component({
  selector: 'app-totals-settings',
  standalone: true,
  imports: [MoneyPipe, IonBackButton, IonButtons, IonContent, IonHeader, IonItem, IonItemDivider, IonLabel, IonList, IonNote, IonTitle, IonToggle, IonToolbar],
  styles: [
    `
      .summary {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 1rem;
      }
      .summary strong {
        font-size: 1.4rem;
      }
      .explain {
        padding: 0 1rem 0.5rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/settings" />
        </ion-buttons>
        <ion-title>Accounts in totals</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="summary">
        <ion-note>Net worth</ion-note>
        <strong>{{ accounts.netWorth() | money: currency() }}</strong>
      </div>
      <div class="explain">
        <ion-note>
          Switch an account off to leave it out of net worth and the balance sheet. It keeps its
          transactions and its own balance either way. This only changes what is added up.
        </ion-note>
      </div>

      @if (accounts.active().length) {
        <ion-list>
          @for (row of rows(); track row.account.id) {
            <ion-item>
              <ion-toggle
                [checked]="row.counted"
                (ionChange)="setCounted(row.account, $event)"
              >
                <ion-label>
                  <h3>{{ row.account.name }}</h3>
                  <p>{{ row.group }}</p>
                </ion-label>
              </ion-toggle>
              <ion-note slot="end">
                {{ balanceOf(row.account) | money: row.account.currency }}
              </ion-note>
            </ion-item>
          }
        </ion-list>
      } @else {
        <ion-item lines="none">
          <ion-note>No accounts yet.</ion-note>
        </ion-item>
      }

      @if (archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          <ion-item lines="none">
            <ion-note>
              Archived accounts are never counted, whatever this screen says about them.
            </ion-note>
          </ion-item>
        </ion-list>
      }
    </ion-content>
  `,
})
export class TotalsSettingsPage {
  readonly accounts = inject(AccountsService);
  private readonly groups = inject(AccountGroupsService);
  private readonly rates = inject(RatesService);

  readonly currency = computed(() => this.rates.reportingCurrency());

  readonly rows = computed(() =>
    this.accounts.active().map((account) => ({
      account,
      counted: countsInTotals(account),
      group: this.groups.byId(account.groupId)?.name ?? 'Not in a group',
    })),
  );

  archived(): Account[] {
    return this.accounts.all().filter((account) => account.archived);
  }

  balanceOf(account: Account): number {
    return this.accounts.balances().get(account.id) ?? account.openingBalance;
  }

  async setCounted(account: Account, event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    await this.accounts.setCountedInTotals(account.id, checked);
  }
}
