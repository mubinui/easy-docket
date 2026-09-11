import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { RecurrenceUnit, RecurringRule, TransactionKind } from '../../core/models/domain';
import { AccountsService } from '../../core/repositories/accounts.service';
import { CategoriesService } from '../../core/repositories/categories.service';
import { RecurringService } from '../../core/repositories/recurring.service';
import { nextOccurrence } from '../../core/recurring/schedule';
import { toIsoDate } from '../../core/util/dates';
import { formatAmount, parseAmount } from '../../core/util/money';
import { DayPipe } from '../../shared/day.pipe';

type Ending = 'never' | 'on' | 'after';

const UNITS: ReadonlyArray<{ value: RecurrenceUnit; one: string; many: string }> = [
  { value: 'day', one: 'day', many: 'days' },
  { value: 'week', one: 'week', many: 'weeks' },
  { value: 'month', one: 'month', many: 'months' },
  { value: 'year', one: 'year', many: 'years' },
];

/**
 * Create or edit a standing instruction.
 *
 * The preview at the bottom is the point of the screen. A schedule expressed as
 * "every 1 month from the 31st" is hard to picture and easy to get wrong, so the
 * editor shows the next three dates it would actually produce — which is where
 * a user discovers that February lands on the 28th.
 */
@Component({
  selector: 'app-rule-editor',
  standalone: true,
  imports: [
    FormsModule,
    DayPipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSegment,
    IonSegmentButton,
    IonNote,
    IonText,
  ],
  styles: [
    `
      .preview {
        padding: 0 1rem 1rem;
        font-size: 0.8rem;
        color: var(--ion-color-medium);
      }
      .preview strong {
        display: block;
        margin-bottom: 0.25rem;
        color: var(--ion-text-color);
      }
      .every {
        display: grid;
        grid-template-columns: 5rem 1fr;
        gap: 0.5rem;
        width: 100%;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} recurring</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-segment [ngModel]="kind()" (ngModelChange)="setKind($event)">
        <ion-segment-button value="expense"><ion-label>Expense</ion-label></ion-segment-button>
        <ion-segment-button value="income"><ion-label>Income</ion-label></ion-segment-button>
        <ion-segment-button value="transfer"><ion-label>Transfer</ion-label></ion-segment-button>
      </ion-segment>

      <ion-list>
        <ion-item>
          <ion-input
            label="Name"
            labelPlacement="stacked"
            placeholder="Rent"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-input
            label="Amount"
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
            label="{{ kind() === 'transfer' ? 'From account' : 'Account' }}"
            labelPlacement="stacked"
            [ngModel]="accountId()"
            (ngModelChange)="accountId.set($event)"
          >
            @for (account of accounts.active(); track account.id) {
              <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        @if (kind() === 'transfer') {
          <ion-item>
            <ion-select
              label="To account"
              labelPlacement="stacked"
              [ngModel]="counterAccountId()"
              (ngModelChange)="counterAccountId.set($event)"
            >
              @for (account of accounts.active(); track account.id) {
                @if (account.id !== accountId()) {
                  <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
                }
              }
            </ion-select>
          </ion-item>
        } @else {
          <ion-item>
            <ion-select
              label="Category"
              labelPlacement="stacked"
              [ngModel]="categoryId()"
              (ngModelChange)="categoryId.set($event)"
            >
              @for (category of categoryOptions(); track category.id) {
                <ion-select-option [value]="category.id">{{ category.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>
        }

        <ion-item>
          <ion-input
            label="Payee"
            labelPlacement="stacked"
            [ngModel]="payee()"
            (ngModelChange)="payee.set($event)"
          />
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-item>
          <div class="every">
            <ion-input
              label="Every"
              labelPlacement="stacked"
              type="number"
              min="1"
              [ngModel]="interval()"
              (ngModelChange)="interval.set(+$event || 1)"
            />
            <ion-select
              label="&nbsp;"
              labelPlacement="stacked"
              [ngModel]="unit()"
              (ngModelChange)="unit.set($event)"
            >
              @for (option of units; track option.value) {
                <ion-select-option [value]="option.value">
                  {{ interval() === 1 ? option.one : option.many }}
                </ion-select-option>
              }
            </ion-select>
          </div>
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
          <ion-select
            label="Ends"
            labelPlacement="stacked"
            [ngModel]="ending()"
            (ngModelChange)="ending.set($event)"
          >
            <ion-select-option value="never">Never</ion-select-option>
            <ion-select-option value="on">On a date</ion-select-option>
            <ion-select-option value="after">After a number of times</ion-select-option>
          </ion-select>
        </ion-item>

        @if (ending() === 'on') {
          <ion-item>
            <ion-input
              label="Last date"
              labelPlacement="stacked"
              type="date"
              [ngModel]="endDate()"
              (ngModelChange)="endDate.set($event)"
            />
          </ion-item>
        }

        @if (ending() === 'after') {
          <ion-item>
            <ion-input
              label="Number of times"
              labelPlacement="stacked"
              type="number"
              min="1"
              [ngModel]="maxOccurrences()"
              (ngModelChange)="maxOccurrences.set(+$event || 1)"
            />
          </ion-item>
        }
      </ion-list>

      <!--
        A schedule is hard to picture and easy to get wrong. Showing the dates
        it would actually produce is where a user finds out that a rule anchored
        to the 31st falls on the 28th in February.
      -->
      <div class="preview">
        <strong>Next few</strong>
        @if (preview().length) {
          {{ previewText() }}
        } @else {
          Nothing further — this rule has finished.
        }
      </div>

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }
    </ion-content>
  `,
})
export class RuleEditorComponent {
  readonly accounts = inject(AccountsService);
  readonly categories = inject(CategoriesService);
  private readonly recurring = inject(RecurringService);

  readonly existing = input<RecurringRule | null>(null);
  readonly saved = output<RecurringRule>();
  readonly cancelled = output<void>();

  readonly units = UNITS;

  readonly name = signal('');
  readonly kind = signal<TransactionKind>('expense');
  readonly amount = signal('');
  readonly accountId = signal<string | null>(null);
  readonly counterAccountId = signal<string | null>(null);
  readonly categoryId = signal<string | null>(null);
  readonly payee = signal('');
  readonly interval = signal(1);
  readonly unit = signal<RecurrenceUnit>('month');
  readonly startDate = signal(toIsoDate());
  readonly ending = signal<Ending>('never');
  readonly endDate = signal<string>(toIsoDate());
  readonly maxOccurrences = signal(12);
  readonly error = signal<string | null>(null);

  readonly categoryOptions = computed(() =>
    this.categories.forKind(this.kind() === 'income' ? 'income' : 'expense'),
  );

  readonly canSave = computed(
    () => this.name().trim().length > 0 && this.amount().trim().length > 0 && !!this.accountId(),
  );

  /** The next few dates this schedule would produce, from the start date. */
  readonly preview = computed(() => {
    const schedule = {
      interval: this.interval(),
      unit: this.unit(),
      startDate: this.startDate(),
      endDate: this.ending() === 'on' ? this.endDate() : null,
      maxOccurrences: this.ending() === 'after' ? this.maxOccurrences() : null,
      skipped: this.existing()?.skipped ?? [],
    };

    const dates: string[] = [];
    // From the day before the start, so the first occurrence is included.
    let cursor = previousDay(schedule.startDate);

    for (let i = 0; i < 3; i++) {
      const next = nextOccurrence(schedule, cursor);
      if (next === null) break;
      dates.push(next);
      cursor = next;
    }
    return dates;
  });

  readonly previewText = computed(() => this.preview().join(' · '));

  constructor() {
    effect(() => {
      const rule = this.existing();
      if (rule) {
        this.name.set(rule.name);
        this.kind.set(rule.kind);
        this.amount.set(formatAmount(rule.amount, rule.currency));
        this.accountId.set(rule.accountId);
        this.counterAccountId.set(rule.counterAccountId);
        this.categoryId.set(rule.categoryId);
        this.payee.set(rule.payee);
        this.interval.set(rule.interval);
        this.unit.set(rule.unit);
        this.startDate.set(rule.startDate);
        this.ending.set(
          rule.endDate !== null ? 'on' : rule.maxOccurrences !== null ? 'after' : 'never',
        );
        this.endDate.set(rule.endDate ?? toIsoDate());
        this.maxOccurrences.set(rule.maxOccurrences ?? 12);
      } else {
        this.name.set('');
        this.kind.set('expense');
        this.amount.set('');
        this.accountId.set(this.accounts.active()[0]?.id ?? null);
        this.counterAccountId.set(null);
        this.categoryId.set(null);
        this.payee.set('');
        this.interval.set(1);
        this.unit.set('month');
        this.startDate.set(toIsoDate());
        this.ending.set('never');
        this.maxOccurrences.set(12);
      }
      this.error.set(null);
    });
  }

  setKind(kind: TransactionKind): void {
    this.kind.set(kind);
    this.categoryId.set(null);
  }

  async save(): Promise<void> {
    this.error.set(null);
    const account = this.accounts.byId(this.accountId() ?? '');
    if (!account) {
      this.error.set('Choose an account first');
      return;
    }

    try {
      const saved = await this.recurring.save({
        id: this.existing()?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        kind: this.kind(),
        amount: parseAmount(this.amount(), account.currency),
        currency: account.currency,
        accountId: account.id,
        counterAccountId: this.kind() === 'transfer' ? this.counterAccountId() : null,
        categoryId: this.kind() === 'transfer' ? null : this.categoryId(),
        payee: this.payee().trim(),
        note: this.existing()?.note ?? '',
        tags: this.existing()?.tags ?? [],
        interval: this.interval(),
        unit: this.unit(),
        startDate: this.startDate(),
        endDate: this.ending() === 'on' ? this.endDate() : null,
        maxOccurrences: this.ending() === 'after' ? this.maxOccurrences() : null,
        skipped: this.existing()?.skipped ?? [],
        archived: this.existing()?.archived ?? false,
        createdAt: this.existing()?.createdAt ?? Date.now(),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

function previousDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() - 1);
  return toIsoDate(parsed);
}
