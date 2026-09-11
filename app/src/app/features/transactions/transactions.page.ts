import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { addOutline, chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { Transaction } from '../../core/models/domain';
import { AccountsService } from '../../core/repositories/accounts.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { TransactionsService } from '../../core/repositories/transactions.service';
import { shiftMonth } from '../../core/util/dates';
import { SyncSchedulerService } from '../../core/sync/sync-scheduler.service';
import { DayPipe } from '../../shared/day.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { SyncStatusComponent } from '../../shared/sync-status.component';
import { TransactionEditorComponent } from './transaction-editor.component';
import {
  IonButton,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

/** The ledger itself: a month at a time, grouped by day. */
@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [FormsModule, MoneyPipe, DayPipe, SyncStatusComponent, TransactionEditorComponent, IonButton, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonItemDivider, IonItemGroup, IonLabel, IonList, IonModal, IonNote, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar],
  styles: [
    `
      .month {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 0.5rem;
      }
      .month strong {
        font-size: 0.95rem;
      }
      .totals {
        display: flex;
        gap: 1rem;
        justify-content: center;
        padding: 0.25rem 0 0.5rem;
        font-size: 0.85rem;
      }
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Activity</ion-title>
        <app-sync-status slot="end" />
      </ion-toolbar>
      <ion-toolbar>
        <div class="month">
          <ion-button fill="clear" (click)="shift(-1)">
            <ion-icon slot="icon-only" name="chevron-back-outline" />
          </ion-button>
          <strong>{{ monthLabel() }}</strong>
          <ion-button fill="clear" (click)="shift(1)">
            <ion-icon slot="icon-only" name="chevron-forward-outline" />
          </ion-button>
        </div>
        <div class="totals">
          <ion-note color="success">+{{ transactions.totals().income | money: currency() }}</ion-note>
          <ion-note color="danger">−{{ transactions.totals().expense | money: currency() }}</ion-note>
        </div>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search payee, note or tag"
          [debounce]="200"
          [ngModel]="transactions.filter().search"
          (ngModelChange)="transactions.patchFilter({ search: $event })"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      @if (transactions.byDay().length) {
        <ion-list>
          @for (group of transactions.byDay(); track group.date) {
            <ion-item-group>
              <ion-item-divider sticky="true">
                <ion-label>{{ group.date | day }}</ion-label>
              </ion-item-divider>

              @for (txn of group.items; track txn.id) {
                <ion-item button (click)="edit(txn)">
                  <ion-label>
                    <h3>{{ txn.payee || label(txn) }}</h3>
                    <p>{{ subtitle(txn) }}</p>
                  </ion-label>
                  <ion-note slot="end" [color]="colourFor(txn)">
                    {{ sign(txn) }}{{ txn.amount | money: txn.currency }}
                  </ion-note>
                </ion-item>
              }
            </ion-item-group>
          }
        </ion-list>
      } @else {
        <div class="empty">
          <ion-note>
            Nothing recorded for {{ monthLabel() }}.
            @if (!accounts.active().length) {
              <br />Add an account first, on the Accounts tab.
            }
          </ion-note>
        </div>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button [disabled]="!accounts.active().length" (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-transaction-editor
            [existing]="editing()"
            (saved)="close()"
            (deleted)="close()"
            (cancelled)="close()"
          />
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class TransactionsPage {
  readonly transactions = inject(TransactionsService);
  readonly accounts = inject(AccountsService);
  readonly categories = inject(CategoriesService);
  private readonly scheduler = inject(SyncSchedulerService);

  readonly editorOpen = signal(false);
  readonly editing = signal<Transaction | null>(null);

  readonly currency = computed(() => this.accounts.active()[0]?.currency ?? 'USD');

  readonly monthLabel = computed(() =>
    new Date(`${this.transactions.filter().range.from}T00:00:00`).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
  );

  shift(delta: number): void {
    this.transactions.setRange(shiftMonth(this.transactions.filter().range, delta));
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(txn: Transaction): void {
    this.editing.set(txn);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.scheduler.syncNow();
    (event.target as HTMLIonRefresherElement).complete();
  }

  label(txn: Transaction): string {
    return txn.kind === 'transfer' ? 'Transfer' : (this.categories.byId(txn.categoryId)?.name ?? 'Untitled');
  }

  subtitle(txn: Transaction): string {
    const account = this.accounts.byId(txn.accountId)?.name ?? 'Unknown account';
    if (txn.kind === 'transfer') {
      return `${account} → ${this.accounts.byId(txn.counterAccountId ?? '')?.name ?? 'Unknown'}`;
    }
    const category = this.categories.byId(txn.categoryId)?.name ?? 'Uncategorised';
    return `${category} · ${account}`;
  }

  sign(txn: Transaction): string {
    if (txn.kind === 'income') return '+';
    if (txn.kind === 'expense') return '−';
    return '';
  }

  colourFor(txn: Transaction): string | undefined {
    if (txn.kind === 'income') return 'success';
    if (txn.kind === 'transfer') return 'medium';
    return undefined;
  }

  constructor() {
    addIcons({ addOutline, chevronBackOutline, chevronForwardOutline });
  }
}
