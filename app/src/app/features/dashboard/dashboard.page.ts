import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  arrowDownOutline,
  arrowUpOutline,
  chevronForwardOutline,
  cloudOfflineOutline,
  pieChartOutline,
  listOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { balanceSheet, buildSections } from '../../core/accounts/sections';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { CardBillsService } from '../../core/cards/card-bills.service';
import { daysBetween } from '../../core/cards/statement';
import { toIsoDate } from '../../core/util/dates';
import { AccountsService } from '../../core/repositories/accounts.service';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { RatesService } from '../../core/repositories/rates.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { TransactionsService } from '../../core/repositories/transactions.service';
import { SyncSchedulerService } from '../../core/sync/sync-scheduler.service';
import { SyncStatusComponent } from '../../shared/sync-status.component';
import { BudgetBarComponent } from '../../shared/budget-bar.component';
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
  imports: [RouterLink, MoneyPipe, BudgetBarComponent, SyncStatusComponent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonRefresher, IonRefresherContent, IonTitle, IonToolbar],
  styleUrls: ['./dashboard.page.scss'],
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

      <div class="dashboard-layout">
      <section class="page-intro">
        <div><h1>Your money, at a glance.</h1><p>A little clarity for your everyday.</p></div>
        <span class="month-label">{{ currentMonth }}</span>
      </section>
      <ion-card class="balance-card">
        <ion-card-header>
          <ion-card-title>Net worth</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p class="net-worth">{{ accounts.netWorth() | money: currency() }}</p>
          <ion-note>Across {{ accounts.counted().length }} {{ accounts.counted().length === 1 ? 'account' : 'accounts' }}</ion-note>

          @if (sheet().liabilities !== 0) {
            <!-- Only worth the space once something is owed. -->
            <p>
              <ion-note>
                {{ sheet().assets | money: currency() }} held less
                {{ sheet().liabilities | money: currency() }} owed
              </ion-note>
            </p>
          }

          @if (unconvertedAccounts().length) {
            <!-- Never a silently short total: say which currencies are missing. -->
            <p>
              <ion-note color="warning">
                Excludes {{ unconvertedAccounts().join(', ') }}: no rate recorded
              </ion-note>
            </p>
          }
        </ion-card-content>
      </ion-card>

      @if (cards.dueSoon().length) {
        <!--
          Only rendered when something is actually due: a card that is always on
          screen saying "nothing due" is a card people stop reading.
        -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Bills due</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-list lines="none">
              @for (bill of cards.dueSoon(); track bill.card.id) {
                <ion-item button routerLink="/tabs/accounts">
                  <ion-label>
                    <h3>{{ bill.card.name }}</h3>
                    <p>{{ dueIn(bill.summary.dueOn) }}</p>
                  </ion-label>
                  <ion-note slot="end">
                    {{ bill.summary.remaining | money: bill.card.currency }}
                  </ion-note>
                </ion-item>
              }
            </ion-list>
          </ion-card-content>
        </ion-card>
      }

      <ion-card class="cashflow-card">
        <ion-card-header>
          <ion-card-title>This month</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div class="flows">
            <div class="flow">
              <ion-icon name="arrow-down-outline" color="success" />
              <div>
                <strong>{{ transactions.totals().income | money: currency() }}</strong>
                <ion-note>Income</ion-note>
              </div>
            </div>
            <div class="flow">
              <ion-icon name="arrow-up-outline" color="danger" />
              <div>
                <strong>{{ transactions.totals().expense | money: currency() }}</strong>
                <ion-note>Expenses</ion-note>
              </div>
            </div>
          </div>

          @if (transactions.totals().unconverted; as missing) {
            <p>
              <ion-note color="warning">
                {{ missing }} transaction(s) excluded: no exchange rate
              </ion-note>
            </p>
          }
        </ion-card-content>
      </ion-card>

      <ion-card class="spending-card">
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
              <ion-icon name="pie-chart-outline" aria-hidden="true" />
              <h3>Make sense of your spending.</h3>
              <p>No spending recorded this month yet.</p>
              <a routerLink="/tabs/transactions">Add your first expense <ion-icon name="chevron-forward-outline" /></a>
            </div>
          }

          <ion-list lines="none">
            <ion-item button [routerLink]="['/reports']" detail="true">
              <ion-label color="primary"><h3>Reports</h3></ion-label>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card class="budgets-card">
        <ion-card-header>
          <ion-card-title>Budgets</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          @if (headline().length) {
            <ion-list lines="none">
              @for (status of headline(); track status.budget.id) {
                <ion-item button [routerLink]="['/budgets']">
                  <ion-label>
                    <div class="budget-name">
                      <h3>{{ status.budget.name }}</h3>
                      @if (status.progress!.over) {
                        <ion-note color="danger">OVER</ion-note>
                      }
                    </div>
                    <app-budget-bar
                      [share]="status.progress!.share"
                      [over]="status.progress!.over"
                    />
                    <ion-note [color]="status.progress!.over ? 'danger' : 'medium'">
                      @if (status.progress!.over) {
                        over by
                        {{ -status.progress!.remaining | money: status.budget.currency }}
                      } @else {
                        {{ status.progress!.remaining | money: status.budget.currency }} left
                      }
                    </ion-note>
                  </ion-label>
                </ion-item>
              }

              <ion-item button [routerLink]="['/budgets']" detail="true">
                <ion-label color="primary">
                  <h3>{{ viewAllLabel() }}</h3>
                </ion-label>
              </ion-item>
            </ion-list>
          } @else {
            <ion-list lines="none">
              <ion-item button [routerLink]="['/budgets']" detail="true">
                <ion-label>
                  <h3>Set a spending limit</h3>
                  <p>Track a category against a weekly or monthly budget</p>
                </ion-label>
              </ion-item>
            </ion-list>
          }
        </ion-card-content>
      </ion-card>

      <ion-card class="activity-card">
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
              <ion-icon name="list-outline" aria-hidden="true" />
              <h3>Your story starts here.</h3>
              <p>Nothing recorded yet. Add your first transaction from Activity.</p>
              <a routerLink="/tabs/transactions">Go to Activity <ion-icon name="chevron-forward-outline" /></a>
            </div>
          }
        </ion-card-content>
      </ion-card>
      <p class="dashboard-footnote"><ion-icon name="shield-checkmark-outline" /> Your ledger stays with you. Even when you’re offline.</p>
      </div>
    </ion-content>
  `,
})
export class DashboardPage {
  readonly currentMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date());
  readonly accounts = inject(AccountsService);
  readonly categories = inject(CategoriesService);
  readonly transactions = inject(TransactionsService);
  readonly budgets = inject(BudgetsService);
  readonly cards = inject(CardBillsService);
  private readonly groups = inject(AccountGroupsService);
  readonly rates = inject(RatesService);
  private readonly scheduler = inject(SyncSchedulerService);

  /** The currency of the first account; a multi-currency ledger is out of scope for now. */
  /** Totals are shown in the vault's reporting currency. */
  readonly currency = computed(() => this.rates.reportingCurrency());

  readonly unconvertedAccounts = computed(() => this.accounts.netWorthDetail().unconverted);

  /** The balance sheet behind the headline: what is held, what is owed. */
  readonly sheet = computed(() =>
    balanceSheet(
      buildSections({
        accounts: this.accounts.active(),
        groups: this.groups.active(),
        balances: this.accounts.balances(),
        reporting: this.currency(),
        rateFor: (code) => this.rates.rateToReporting(code),
      }),
    ),
  );

  readonly recent = computed(() => this.transactions.visible().slice(0, 5));

  /** "due today", "due tomorrow", "due in 9 days" — a distance, not a date. */
  dueIn(date: string): string {
    const days = daysBetween(toIsoDate(), date);
    if (days <= 0) return 'due today';
    if (days === 1) return 'due tomorrow';
    return `due in ${days} days`;
  }

  /**
   * The few budgets worth seeing without opening the budgets screen: those
   * closest to their limits. Three is the most that fits before the card starts
   * competing with the rest of the summary for attention.
   */
  readonly headline = computed(() =>
    this.budgets
      .byUrgency()
      .filter((status) => status.progress !== null)
      .slice(0, 3),
  );

  readonly budgetCount = computed(() => this.budgets.statuses().length);
  readonly overspentCount = computed(() => this.budgets.overspent().length);

  /** Says what the rest of the list holds, rather than a bare "View all". */
  readonly viewAllLabel = computed(() => {
    const remaining = this.budgetCount() - this.headline().length;
    const over = this.overspentCount();

    if (remaining > 0) return `View all ${this.budgetCount()} budgets`;
    if (over > 0) return over === 1 ? '1 budget over its limit' : `${over} budgets over their limit`;
    return 'All budgets within their limits';
  });

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
    addIcons({ pieChartOutline, listOutline, shieldCheckmarkOutline, arrowDownOutline, arrowUpOutline, chevronForwardOutline, cloudOfflineOutline });
  }
}
