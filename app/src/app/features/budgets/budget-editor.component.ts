import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { Budget, BudgetPeriod } from '../../core/models/domain';
import { AccountsService } from '../../core/repositories/accounts.service';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { toIsoDate } from '../../core/util/dates';
import { formatAmount, parseAmount } from '../../core/util/money';

const PERIODS: ReadonlyArray<{ value: BudgetPeriod; label: string }> = [
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

/**
 * Create or edit a budget.
 *
 * Only expense categories are offered. A budget on an income category would
 * have nothing to count, since income is deliberately excluded from spend.
 */
@Component({
  selector: 'app-budget-editor',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonNote,
    IonText,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} budget</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" fill="solid" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item>
          <ion-input
            label="Name"
            labelPlacement="stacked"
            placeholder="Groceries"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-input
            label="Amount per period"
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
            label="Categories"
            labelPlacement="stacked"
            [multiple]="true"
            placeholder="Choose at least one"
            [ngModel]="categoryIds()"
            (ngModelChange)="categoryIds.set($event)"
          >
            @for (category of categories.expense(); track category.id) {
              <ion-select-option [value]="category.id">{{ category.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-select
            label="Repeats"
            labelPlacement="stacked"
            [ngModel]="period()"
            (ngModelChange)="period.set($event)"
          >
            @for (option of periods; track option.value) {
              <ion-select-option [value]="option.value">{{ option.label }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-input
            label="Starting"
            labelPlacement="stacked"
            type="date"
            [ngModel]="startDate()"
            (ngModelChange)="startDate.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-toggle [ngModel]="rollover()" (ngModelChange)="rollover.set($event)">
            Carry balance over
          </ion-toggle>
        </ion-item>
      </ion-list>

      <ion-item lines="none">
        <ion-note>
          {{ anchorHint() }}
          @if (rollover()) {
            Anything left over is added to the next period, and anything overspent is taken off it.
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
export class BudgetEditorComponent {
  readonly categories = inject(CategoriesService);
  private readonly accounts = inject(AccountsService);
  private readonly budgets = inject(BudgetsService);

  readonly existing = input<Budget | null>(null);
  readonly saved = output<Budget>();
  readonly cancelled = output<void>();

  readonly periods = PERIODS;

  readonly name = signal('');
  readonly amount = signal('');
  readonly categoryIds = signal<string[]>([]);
  readonly period = signal<BudgetPeriod>('monthly');
  readonly startDate = signal(toIsoDate());
  readonly rollover = signal(false);
  readonly error = signal<string | null>(null);

  readonly canSave = computed(
    () =>
      this.name().trim().length > 0 &&
      this.amount().trim().length > 0 &&
      this.categoryIds().length > 0,
  );

  /** Explains the start date's consequence, which is otherwise a surprise. */
  readonly anchorHint = computed(() => {
    const day = Number(this.startDate().slice(8, 10));
    switch (this.period()) {
      case 'monthly':
        return day === 1
          ? 'Runs in calendar months.'
          : `Runs from the ${ordinal(day)} of one month to the ${ordinal(day - 1 || 31)} of the next.`;
      case 'weekly':
        return 'Runs in seven-day periods from the start date.';
      default:
        return 'Runs for a year from the start date.';
    }
  });

  constructor() {
    effect(() => {
      const budget = this.existing();
      if (budget) {
        this.name.set(budget.name);
        this.amount.set(formatAmount(budget.amount, budget.currency));
        this.categoryIds.set([...budget.categoryIds]);
        this.period.set(budget.period);
        this.startDate.set(budget.startDate);
        this.rollover.set(budget.rollover);
      } else {
        this.name.set('');
        this.amount.set('');
        this.categoryIds.set([]);
        this.period.set('monthly');
        this.startDate.set(toIsoDate());
        this.rollover.set(false);
      }
      this.error.set(null);
    });
  }

  async save(): Promise<void> {
    this.error.set(null);
    const currency = this.existing()?.currency ?? this.accounts.active()[0]?.currency ?? 'USD';

    try {
      const saved = await this.budgets.save({
        id: this.existing()?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        amount: parseAmount(this.amount(), currency),
        categoryIds: this.categoryIds(),
        period: this.period(),
        currency,
        startDate: this.startDate(),
        rollover: this.rollover(),
        archived: this.existing()?.archived ?? false,
        createdAt: this.existing()?.createdAt ?? Date.now(),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

function ordinal(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}
