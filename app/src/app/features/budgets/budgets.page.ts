import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBackButton,
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
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, alertCircleOutline, pieChartOutline } from 'ionicons/icons';
import { describeWindow } from '../../core/budgets/period';
import { BudgetStatus } from '../../core/repositories/budgets.service';
import { Budget } from '../../core/models/domain';
import { AccountsService } from '../../core/repositories/accounts.service';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { BudgetBarComponent } from '../../shared/budget-bar.component';
import { MoneyPipe } from '../../shared/money.pipe';
import { BudgetEditorComponent } from './budget-editor.component';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    MoneyPipe,
    BudgetBarComponent,
    BudgetEditorComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonNote,
    IonIcon,
    IonText,
    IonFab,
    IonFabButton,
    IonModal,
  ],
  styles: [
    `
      .row {
        display: flex;
        justify-content: space-between;
        font-size: 0.8rem;
      }
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      .warning {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        margin-top: 0.3rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/dashboard" /></ion-buttons>
        <ion-title>Budgets</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (statuses().length) {
        <ion-list>
          @for (status of statuses(); track status.budget.id) {
            <ion-item button (click)="edit(status.budget)">
              <ion-label>
                <h3>{{ status.budget.name }}</h3>

                @if (status.progress; as progress) {
                  <app-budget-bar [share]="progress.share" [over]="progress.over" />
                  <div class="row">
                    <span>
                      {{ progress.spent | money: status.budget.currency }} of
                      {{ progress.allowance | money: status.budget.currency }}
                    </span>
                    <ion-text [color]="progress.over ? 'danger' : 'medium'">
                      {{ progress.over ? 'over by ' : '' }}
                      {{ absolute(progress.remaining) | money: status.budget.currency }}
                      {{ progress.over ? '' : 'left' }}
                    </ion-text>
                  </div>
                  <p>{{ describe(status) }}</p>

                  @if (progress.unconverted) {
                    <div class="warning">
                      <ion-icon name="alert-circle-outline" color="warning" />
                      <ion-text color="warning">
                        {{ progress.unconverted }} transaction(s) not counted: no rate to
                        {{ status.budget.currency }}
                      </ion-text>
                    </div>
                  }

                  @if (progress.carried !== 0) {
                    <p>
                      {{ progress.carried > 0 ? 'Carried in' : 'Carried over from overspending' }}:
                      {{ absolute(progress.carried) | money: status.budget.currency }}
                    </p>
                  }
                } @else {
                  <p>Starts {{ status.budget.startDate }}</p>
                }

                @if (status.staleCategoryIds.length) {
                  <div class="warning">
                    <ion-icon name="alert-circle-outline" color="warning" />
                    <ion-text color="warning">
                      {{ status.staleCategoryIds.length }} deleted
                      {{ status.staleCategoryIds.length === 1 ? 'category' : 'categories' }}:
                      this budget is missing spending
                    </ion-text>
                    <ion-button size="small" fill="clear" (click)="fix(status, $event)">
                      Fix
                    </ion-button>
                  </div>
                }
              </ion-label>
            </ion-item>
          }
        </ion-list>
      } @else {
        <div class="empty">
          <ion-icon name="pie-chart-outline" size="large" color="medium" />
          <p>
            <ion-note>
              No budgets yet. Set a limit on a category and this screen tracks it for you.
            </ion-note>
          </p>
        </div>
      }

      @if (archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          @for (budget of archived(); track budget.id) {
            <ion-item button (click)="edit(budget)">
              <ion-label color="medium">{{ budget.name }}</ion-label>
              <ion-note slot="end">{{ budget.amount | money: budget.currency }}</ion-note>
            </ion-item>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button aria-label="Add budget" [disabled]="!categories.expense().length" (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-budget-editor [existing]="editing()" (saved)="close()" (cancelled)="close()" />
          @if (editing(); as budget) {
            <ion-button expand="block" fill="clear" (click)="toggleArchive(budget)">
              {{ budget.archived ? 'Restore' : 'Archive' }} budget
            </ion-button>
            <ion-button expand="block" fill="clear" color="danger" (click)="confirmDelete(budget)">
              Delete budget
            </ion-button>
          }
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class BudgetsPage {
  readonly budgets = inject(BudgetsService);
  readonly categories = inject(CategoriesService);
  readonly accounts = inject(AccountsService);
  private readonly alerts = inject(AlertController);

  readonly editorOpen = signal(false);
  readonly editing = signal<Budget | null>(null);

  /** Closest to the limit first, so what needs attention is at the top. */
  readonly statuses = computed(() => this.budgets.byUrgency());
  readonly archived = computed(() => this.budgets.all().filter((budget) => budget.archived));

  describe(status: BudgetStatus): string {
    return status.progress
      ? describeWindow(status.budget.period, status.progress.window)
      : `Starts ${status.budget.startDate}`;
  }

  absolute(amount: number): number {
    return Math.abs(amount);
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(budget: Budget): void {
    this.editing.set(budget);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  async toggleArchive(budget: Budget): Promise<void> {
    await this.budgets.setArchived(budget.id, !budget.archived);
    this.close();
  }

  /**
   * Repair a budget that references deleted categories. The tap must not also
   * open the editor behind the warning, hence stopping propagation.
   */
  async fix(status: BudgetStatus, event: Event): Promise<void> {
    event.stopPropagation();

    try {
      await this.budgets.pruneStaleCategories(status.budget.id);
    } catch (error) {
      const alert = await this.alerts.create({
        header: 'Nothing left to track',
        message: (error as Error).message,
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  async confirmDelete(budget: Budget): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Delete budget?',
      // Worth saying plainly: people hesitate to delete a budget for fear of
      // losing the spending it was tracking.
      message: `${budget.name} will be removed from every device you sync with. Your transactions are not affected.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.budgets.remove(budget.id).then(() => this.close());
          },
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({ addOutline, alertCircleOutline, pieChartOutline });
  }
}
