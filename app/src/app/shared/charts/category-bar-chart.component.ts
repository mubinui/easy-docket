import { Component, computed, input, signal } from '@angular/core';
import { barPath, horizontalBars } from '../../core/reports/geometry';
import { formatMoney } from '../../core/util/money';
import { ChartDatum } from './chart-types';

const PLOT_WIDTH = 300;
const BAND = 42;
const THICKNESS = 8;
const LABEL_HEIGHT = 18;

/**
 * Spending per category, as horizontal bars.
 *
 * A bar chart rather than a donut: the reader's job here is comparing
 * magnitudes, and a donut makes close values nearly impossible to rank. Long
 * category names also fit a horizontal layout, which matters on a phone.
 *
 * Every bar is one colour. Categories have no natural order, so shading them
 * by size would double-encode the length the bar already shows and would spend
 * the only free channel on information the chart is not short of.
 */
@Component({
  selector: 'app-category-bar-chart',
  standalone: true,
  styles: [
    `
      :host {
        display: block;
      }
      figure {
        margin: 0;
      }
      svg {
        display: block;
        width: 100%;
        overflow: visible;
      }
      .label,
      .value {
        font-size: 11px;
        /* Secondary ink, not the muted axis token: these are content, and
           muted sits under 3:1 on a light surface. */
        fill: var(--viz-ink-secondary);
      }
      .value {
        text-anchor: end;
        font-variant-numeric: tabular-nums;
      }
      .row:hover .label,
      .row:hover .value,
      .row:focus-visible .label,
      .row:focus-visible .value {
        fill: var(--ion-text-color);
      }
      .row {
        cursor: default;
      }
      .row:focus-visible {
        outline: none;
      }
      .hit {
        fill: transparent;
      }
      .empty {
        font-size: 12px;
        color: var(--viz-muted);
        text-align: center;
        padding: 1.5rem 0;
        margin: 0;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.8rem;
        margin-top: 0.75rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.3rem 0;
        border-bottom: 1px solid var(--viz-grid);
      }
      td:last-child,
      th:last-child {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
  template: `
    @if (rows().length) {
      <figure>
        <svg
          [attr.viewBox]="'0 0 ' + plotWidth + ' ' + height()"
          role="img"
          [attr.aria-label]="summary()"
          preserveAspectRatio="none"
        >
          @for (row of placed(); track row.datum.id) {
            <g
              class="row"
              tabindex="0"
              (pointerenter)="active.set(row.index)"
              (pointerleave)="active.set(null)"
              (focus)="active.set(row.index)"
              (blur)="active.set(null)"
            >
              <!-- A generous, invisible hit area: the bar itself is 8px tall,
                   far below a comfortable touch target. -->
              <rect class="hit" x="0" [attr.y]="row.index * band" [attr.width]="plotWidth" [attr.height]="band" />

              <text class="label" x="0" [attr.y]="row.index * band + 12">{{ row.datum.label }}</text>
              <text class="value" [attr.x]="plotWidth" [attr.y]="row.index * band + 12">
                {{ money(row.datum.value) }}
              </text>

              <path
                [attr.d]="row.path"
                [attr.fill]="'var(--viz-series-1)'"
                [attr.opacity]="active() === null || active() === row.index ? 1 : 0.55"
              />
            </g>
          }
        </svg>
      </figure>

      <!-- The table twin: every value is reachable without reading the chart. -->
      <table [class.visually-hidden]="!showTable()">
        <caption class="visually-hidden">{{ caption() }}</caption>
        <thead>
          <tr><th scope="col">Category</th><th scope="col">Spent</th></tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.id) {
            <tr>
              <td>{{ row.label }}</td>
              <td>{{ money(row.value) }}</td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p class="empty">No spending in this period.</p>
    }
  `,
})
export class CategoryBarChartComponent {
  readonly rows = input.required<ChartDatum[]>();
  readonly currency = input('USD');
  readonly caption = input('Spending by category');
  /** Show the table view alongside the chart rather than only to assistive tech. */
  readonly showTable = input(false);

  readonly plotWidth = PLOT_WIDTH;
  readonly band = BAND;

  protected readonly active = signal<number | null>(null);

  readonly height = computed(() => Math.max(BAND, this.rows().length * BAND));

  readonly placed = computed(() => {
    const rects = horizontalBars(
      this.rows().map((row) => row.value),
      { width: PLOT_WIDTH, band: BAND, thickness: THICKNESS, labelHeight: LABEL_HEIGHT },
    );
    return this.rows().map((datum, index) => ({
      datum,
      index,
      rect: rects[index],
      path: barPath(rects[index], 4, 'right'),
    }));
  });

  readonly summary = computed(() => {
    const rows = this.rows();
    if (rows.length === 0) return 'No spending in this period.';

    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return `${this.caption()}. ${rows.length} categories totalling ${this.money(total)}. Largest: ${
      rows[0].label
    } at ${this.money(rows[0].value)}.`;
  });

  money(value: number): string {
    return formatMoney(value, this.currency());
  }
}
