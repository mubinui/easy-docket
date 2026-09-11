import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  arrowDownOutline,
  arrowUpOutline,
  chevronForwardOutline,
  cloudOfflineOutline,
} from 'ionicons/icons';
import { AccountsService } from '../../core/repositories/accounts.service';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { TransactionsService } from '../../core/repositories/transactions.service';
import { SyncSchedulerService } from '../../core/sync/sync-scheduler.service';
import { SyncStatusComponent } from '../../shared/sync-status.component';
import { MoneyPipe } from '../../shared/money.pipe';
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

/**
 * The opening screen: what you have, what moved this month, and where it went.
 * Everything here is derived from signals over the local database, so it is
 * fully populated before any network call is even attempted.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, MoneyPipe, SyncStatusComponent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonRefresher, IonRefresherContent, IonTitle, IonToolbar],
  styles: [
    `
      .net-worth {
        font-size: 2rem;
        font-weight: 600;
        margin: 0;
      }
      .flows {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      .flow {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .flow strong {
        display: block;
        font-size: 1.1rem;
      }
      .bar {
        height: 6px;
        border-radius: 3px;
        background: var(--ion-color-step-150, #e0e0e0);
        overflow: hidden;
      }
      .bar span {
        display: block;
        height: 100%;
      }
      .empty {
        text-align: center;
        padding: 2rem 1rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Summary</ion-title>
        <app-sync-status slot="end" />
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Net worth</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p class="net-worth">{{ accounts.netWorth() | money: currency() }}</p>
          <ion-note>across {{ accounts.active().length }} account(s)</ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>This month</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div class="flows">
            <div class="flow">
              <ion-icon name="arrow-down-outline" color="success" />
              <div>
                <strong>{{ transactions.totals().income | money: currency() }}</strong>
                <ion-note>in</ion-note>
              </div>
            </div>
            <div class="flow">
              <ion-icon name="arrow-up-outline" color="danger" />
              <div>
                <strong>{{ transactions.totals().expense | money: currency() }}</strong>
                <ion-note>out</ion-note>
              </div>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Where it went</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          @if (topCategories().length) {
            <ion-list lines="none">
              @for (row of topCategories(); track row.categoryId) {
                <ion-item>
                  <ion-label>
                    <h3>{{ row.name }}</h3>
                    <div class="bar">
                      <span [style.width.%]="row.share" [style.background]="row.colour"></span>
                    </div>
                  </ion-label>
                  <ion-note slot="end">{{ row.amount | money: currency() }}</ion-note>
                </ion-item>
              }
            </ion-list>
          } @else {
            <div class="empty">
              <ion-note>No spending recorded this month yet.</ion-note>
            </div>
          }
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Budgets</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-list lines="none">
            <ion-item button [routerLink]="['/budgets']" detail="true">
              <ion-label>
                @if (budgetCount()) {
                  <h3>{{ budgetCount() }} active</h3>
                  <p>
                    {{ overspentCount() ? overspentCount() + ' over budget' : 'All within limit' }}
                  </p>
                } @else {
                  <h3>Set a spending limit</h3>
                  <p>Track a category against a monthly or weekly budget</p>
                }
              </ion-label>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Recent activity</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          @if (recent().length) {
            <ion-list lines="full">
              @for (txn of recent(); track txn.id) {
                <ion-item [routerLink]="['/tabs/transactions']">
                  <ion-label>
                    <h3>{{ txn.payee || 'Untitled' }}</h3>
                    <p>{{ categories.byId(txn.categoryId)?.name ?? 'Uncategorised' }}</p>
                  </ion-label>
                  <ion-note slot="end" [color]="txn.kind === 'income' ? 'success' : undefined">
                    {{ txn.kind === 'income' ? '+' : '−' }}{{ txn.amount | money: currency() }}
                  </ion-note>
                </ion-item>
              }
            </ion-list>
          } @else {
            <div class="empty">
              <ion-icon name="cloud-offline-outline" size="large" color="medium" />
              <p><ion-note>Nothing recorded yet. Add your first transaction from Activity.</ion-note></p>
            </div>
          }
        </ion-card-content>
      </ion-card>
    </ion-content>
  `,
})
export class DashboardPage {
  readonly accounts = inject(AccountsService);
  readonly categories = inject(CategoriesService);
  readonly transactions = inject(TransactionsService);
  readonly budgets = inject(BudgetsService);
  private readonly scheduler = inject(SyncSchedulerService);

  /** The currency of the first account; a multi-currency ledger is out of scope for now. */
  readonly currency = computed(() => this.accounts.active()[0]?.currency ?? 'USD');

  readonly recent = computed(() => this.transactions.visible().slice(0, 5));

  // Task 2.4 turns this into a card showing the budgets nearest their limit;
  // for now the Summary screen just has to be able to reach the budgets page.
  readonly budgetCount = computed(() => this.budgets.statuses().length);
  readonly overspentCount = computed(() => this.budgets.overspent().length);

  /** Top five spending categories, with each one's share of the largest. */
  readonly topCategories = computed(() => {
    const rows = this.transactions.spendByCategory().slice(0, 5);
    const largest = rows[0]?.amount ?? 1;

    return rows.map((row) => {
      const category = this.categories.byId(row.categoryId);
      return {
        ...row,
        name: category?.name ?? 'Uncategorised',
        colour: category?.colour ?? 'var(--ion-color-medium)',
        share: Math.round((row.amount / largest) * 100),
      };
    });
  });

  async refresh(event: CustomEvent): Promise<void> {
    await this.scheduler.syncNow();
    (event.target as HTMLIonRefresherElement).complete();
  }

  constructor() {
    addIcons({ arrowDownOutline, arrowUpOutline, chevronForwardOutline, cloudOfflineOutline });
  }
}
