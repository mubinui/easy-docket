import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButton,
  IonButtons,
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
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { downloadOutline, statsChartOutline } from 'ionicons/icons';
import { FileExportService } from '../../core/export/file-export.service';
import { csvFilename, toCsv } from '../../core/reports/csv';
import { RANGE_OPTIONS, RangePreset, ReportsService } from '../../core/reports/reports.service';
import { formatAmount } from '../../core/util/money';
import { CategoryBarChartComponent } from '../../shared/charts/category-bar-chart.component';
import { FlowColumnChartComponent } from '../../shared/charts/flow-column-chart.component';
import { TrendLineChartComponent } from '../../shared/charts/trend-line-chart.component';
import { MoneyPipe } from '../../shared/money.pipe';

/**
 * Where the money went, and whether that is normal.
 *
 * One filter row at the top scopes every card beneath it. Per-chart ranges
 * would let two cards disagree about the period they describe, which is the
 * quickest way to make a report untrustworthy.
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    FormsModule,
    MoneyPipe,
    CategoryBarChartComponent,
    FlowColumnChartComponent,
    TrendLineChartComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonSegment,
    IonSegmentButton,
  ],
  styles: [
    `
      .filters {
        padding: 0 0.5rem 0.5rem;
      }
      .totals {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        text-align: center;
      }
      .totals strong {
        display: block;
        font-size: 1rem;
      }
      .totals ion-note {
        font-size: 0.7rem;
      }
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      .unconverted {
        text-align: center;
        margin: 0.75rem 0 0;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        padding: 0 1rem 2rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/dashboard" /></ion-buttons>
        <ion-title>Reports</ion-title>
      </ion-toolbar>

      @if (reports.hasHistory()) {
        <ion-toolbar>
          <!-- One filter row, scoping every card below it. -->
          <div class="filters">
            <ion-segment
              scrollable="true"
              [ngModel]="reports.preset()"
              (ngModelChange)="setRange($event)"
            >
              @for (option of ranges; track option.id) {
                <ion-segment-button [value]="option.id">
                  <ion-label>{{ option.label }}</ion-label>
                </ion-segment-button>
              }
            </ion-segment>
          </div>
        </ion-toolbar>
      }
    </ion-header>

    <ion-content>
      @if (!reports.hasHistory()) {
        <div class="empty">
          <ion-icon name="stats-chart-outline" size="large" color="medium" />
          <p><ion-note>Record a few transactions and this screen will have something to say.</ion-note></p>
        </div>
      } @else {
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ rangeLabel() }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="totals">
              <div>
                <strong>{{ data().totals.income | money: data().currency }}</strong>
                <ion-note>in</ion-note>
              </div>
              <div>
                <strong>{{ data().totals.expense | money: data().currency }}</strong>
                <ion-note>out</ion-note>
              </div>
              <div>
                <strong [style.color]="data().totals.net < 0 ? 'var(--ion-color-danger)' : null">
                  {{ data().totals.net | money: data().currency }}
                </strong>
                <ion-note>{{ data().totals.net < 0 ? 'overspent' : 'saved' }}</ion-note>
              </div>
            </div>

            @if (data().unconverted; as missing) {
              <p class="unconverted">
                <ion-note color="warning">
                  {{ missing }} transaction(s) left out — no rate to
                  {{ data().currency }}
                </ion-note>
              </p>
            }
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Where it went</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <app-category-bar-chart
              [rows]="categoryRows()"
              [currency]="data().currency"
              [showTable]="showData()"
              caption="Spending by category"
            />
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>In and out</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <app-flow-column-chart
              [groups]="flowGroups()"
              [currency]="data().currency"
              [showTable]="showData()"
              caption="Money in and out by month"
            />
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Net worth</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <app-trend-line-chart
              [rows]="netWorthRows()"
              [currency]="data().currency"
              [showTable]="showData()"
              caption="Net worth over time"
            />
          </ion-card-content>
        </ion-card>

        @if (data().payees.length) {
          <ion-card>
            <ion-card-header>
              <ion-card-title>Top payees</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                @for (payee of data().payees; track payee.payee) {
                  <ion-item>
                    <ion-label>
                      <h3>{{ payee.payee }}</h3>
                      <p>{{ payee.count }} {{ payee.count === 1 ? 'payment' : 'payments' }}</p>
                    </ion-label>
                    <ion-note slot="end">{{ payee.amount | money: data().currency }}</ion-note>
                  </ion-item>
                }
              </ion-list>
            </ion-card-content>
          </ion-card>
        }

        <div class="actions">
          <ion-button expand="block" fill="outline" (click)="toggleData()">
            {{ showData() ? 'Hide' : 'Show' }} data
          </ion-button>
          <ion-button expand="block" (click)="exportCsv()">
            <ion-icon slot="start" name="download-outline" />
            Export CSV
          </ion-button>
        </div>
      }
    </ion-content>
  `,
})
export class ReportsPage {
  readonly reports = inject(ReportsService);
  private readonly files = inject(FileExportService);
  private readonly toasts = inject(ToastController);

  readonly ranges = RANGE_OPTIONS;
  readonly showData = signal(false);

  readonly data = computed(() => this.reports.data());

  readonly rangeLabel = computed(() => {
    const option = RANGE_OPTIONS.find((r) => r.id === this.reports.preset());
    return option?.label ?? 'This month';
  });

  readonly categoryRows = computed(() =>
    this.data().categories.map((row) => ({
      id: row.categoryId ?? 'uncategorised',
      label: this.reports.nameFor(row.categoryId),
      value: row.amount,
    })),
  );

  readonly flowGroups = computed(() =>
    this.data().flow.map((row) => ({
      id: row.month,
      label: this.reports.labelFor(row.month),
      values: [row.income, row.expense],
    })),
  );

  readonly netWorthRows = computed(() =>
    this.data().netWorth.map((point) => ({
      id: point.date,
      label: this.reports.labelFor(point.date.slice(0, 7)),
      value: point.amount,
    })),
  );

  setRange(preset: RangePreset): void {
    this.reports.setPreset(preset);
  }

  toggleData(): void {
    this.showData.update((shown) => !shown);
  }

  /**
   * Export what is on screen, not the whole ledger: the button sits beneath a
   * filtered view, so exporting anything else would surprise the user.
   */
  async exportCsv(): Promise<void> {
    const data = this.data();
    const currency = data.currency;

    const rows: (string | number)[][] = [];
    for (const row of data.categories) {
      rows.push(['Category', this.reports.nameFor(row.categoryId), formatAmount(row.amount, currency), row.count]);
    }
    for (const row of data.flow) {
      rows.push(['Income', this.reports.labelFor(row.month), formatAmount(row.income, currency), '']);
      rows.push(['Expense', this.reports.labelFor(row.month), formatAmount(row.expense, currency), '']);
    }
    for (const point of data.netWorth) {
      rows.push(['Net worth', point.date, formatAmount(point.amount, currency), '']);
    }
    for (const payee of data.payees) {
      rows.push(['Payee', payee.payee, formatAmount(payee.amount, currency), payee.count]);
    }

    const csv = toCsv({ headers: ['Section', 'Item', `Amount (${currency})`, 'Count'], rows });

    try {
      await this.files.exportText(csvFilename('easy-docket-report', data.range), csv);
    } catch (error) {
      const toast = await this.toasts.create({
        message: `Could not export: ${(error as Error).message}`,
        duration: 2500,
        color: 'danger',
      });
      await toast.present();
    }
  }

  constructor() {
    addIcons({ downloadOutline, statsChartOutline });
  }
}
