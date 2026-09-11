import { Component, computed, input, signal } from '@angular/core';
import { barPath, groupedColumns, niceAxis } from '../../core/reports/geometry';
import { formatMoney } from '../../core/util/money';
import { ChartGroup, SeriesMeta } from './chart-types';

const PLOT_WIDTH = 320;
const PLOT_HEIGHT = 140;

/**
 * Two series per period, side by side — money in against money out.
 *
 * Grouped rather than stacked: income and expense are not parts of a whole, and
 * stacking them would imply a total that means nothing. One shared axis, never
 * two: a second scale would let the chart invent a relationship the data does
 * not contain.
 *
 * A legend is always shown. Identity must never rest on colour alone.
 */
@Component({
  selector: 'app-flow-column-chart',
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
      }
      .grid {
        stroke: var(--viz-grid);
        stroke-width: 1;
      }
      .baseline {
        stroke: var(--viz-axis);
        stroke-width: 1;
      }
      .tick,
      .period {
        font-size: 10px;
        fill: var(--viz-muted);
        font-variant-numeric: tabular-nums;
      }
      .tick {
        text-anchor: end;
      }
      .period {
        text-anchor: middle;
      }
      .legend {
        display: flex;
        gap: 1rem;
        justify-content: center;
        font-size: 0.75rem;
        color: var(--ion-color-medium);
        margin: 0.5rem 0 0;
        padding: 0;
        list-style: none;
      }
      .legend li {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .swatch {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        display: inline-block;
      }
      .readout {
        text-align: center;
        font-size: 0.75rem;
        color: var(--ion-color-medium);
        min-height: 1.2rem;
        margin: 0.25rem 0 0;
      }
      .empty {
        font-size: 12px;
        color: var(--viz-muted);
        text-align: center;
        padding: 1.5rem 0;
        margin: 0;
      }
      .hit {
        fill: transparent;
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
      td:not(:first-child),
      th:not(:first-child) {
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
    @if (groups().length) {
      <figure>
        <svg
          [attr.viewBox]="'-38 -8 ' + (plotWidth + 46) + ' ' + (plotHeight + 30)"
          role="img"
          [attr.aria-label]="summary()"
        >
          @for (tick of axis().ticks; track tick) {
            <line class="grid" x1="0" [attr.y1]="y(tick)" [attr.x2]="plotWidth" [attr.y2]="y(tick)" />
            <text class="tick" x="-6" [attr.y]="y(tick) + 3">{{ shortMoney(tick) }}</text>
          }

          <line class="baseline" x1="0" [attr.y1]="y(0)" [attr.x2]="plotWidth" [attr.y2]="y(0)" />

          @for (group of placed(); track group.id) {
            <g
              tabindex="0"
              (pointerenter)="active.set(group.index)"
              (pointerleave)="active.set(null)"
              (focus)="active.set(group.index)"
              (blur)="active.set(null)"
            >
              <rect
                class="hit"
                [attr.x]="group.index * bandWidth()"
                y="0"
                [attr.width]="bandWidth()"
                [attr.height]="plotHeight"
              />

              @for (column of group.columns; track $index) {
                <path
                  [attr.d]="column.path"
                  [attr.fill]="'var(' + series()[$index].colour + ')'"
                  [attr.opacity]="active() === null || active() === group.index ? 1 : 0.5"
                />
              }

              <text class="period" [attr.x]="(group.index + 0.5) * bandWidth()" [attr.y]="plotHeight + 14">
                {{ group.shortLabel }}
              </text>
            </g>
          }
        </svg>
      </figure>

      <ul class="legend">
        @for (meta of series(); track meta.label) {
          <li>
            <span class="swatch" [style.background]="'var(' + meta.colour + ')'"></span>
            {{ meta.label }}
          </li>
        }
      </ul>

      <!-- Hovering supplements the chart; it never gates a value. -->
      <p class="readout">{{ readout() }}</p>

      <table [class.visually-hidden]="!showTable()">
        <caption class="visually-hidden">{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            @for (meta of series(); track meta.label) {
              <th scope="col">{{ meta.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.id) {
            <tr>
              <td>{{ group.label }}</td>
              @for (value of group.values; track $index) {
                <td>{{ money(value) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p class="empty">Nothing recorded in this period.</p>
    }
  `,
})
export class FlowColumnChartComponent {
  readonly groups = input.required<ChartGroup[]>();
  readonly series = input<SeriesMeta[]>([
    { label: 'In', colour: '--viz-series-1' },
    { label: 'Out', colour: '--viz-series-2' },
  ]);
  readonly currency = input('USD');
  readonly caption = input('Money in and out by month');
  readonly showTable = input(false);

  readonly plotWidth = PLOT_WIDTH;
  readonly plotHeight = PLOT_HEIGHT;

  protected readonly active = signal<number | null>(null);

  readonly axis = computed(() => {
    const values = this.groups().flatMap((group) => group.values);
    return niceAxis(0, Math.max(0, ...values));
  });

  readonly bandWidth = computed(() =>
    this.groups().length ? PLOT_WIDTH / this.groups().length : PLOT_WIDTH,
  );

  readonly placed = computed(() => {
    const rects = groupedColumns(
      this.groups().map((group) => group.values),
      this.axis(),
      {
        width: PLOT_WIDTH,
        height: PLOT_HEIGHT,
        series: this.series().length,
        innerGap: 2,
        bandPadding: 0.34,
        maxThickness: 18,
      },
    );

    return this.groups().map((group, index) => ({
      ...group,
      index,
      columns: rects[index].map((rect) => ({ rect, path: barPath(rect, 3, 'up') })),
      // Month labels crowd on a phone; the first three characters are enough
      // to tell January from June.
      shortLabel: group.label.slice(0, 3),
    }));
  });

  readonly readout = computed(() => {
    const index = this.active();
    if (index === null) return '';

    const group = this.groups()[index];
    if (!group) return '';

    return `${group.label}: ${group.values
      .map((value, i) => `${this.series()[i].label} ${this.money(value)}`)
      .join(' · ')}`;
  });

  readonly summary = computed(() => {
    const groups = this.groups();
    if (groups.length === 0) return 'Nothing recorded in this period.';

    const totals = this.series().map((meta, index) => {
      const total = groups.reduce((sum, group) => sum + (group.values[index] ?? 0), 0);
      return `${meta.label} ${this.money(total)}`;
    });
    return `${this.caption()}, ${groups.length} periods. Totals: ${totals.join(', ')}.`;
  });

  y(value: number): number {
    const { min, max } = this.axis();
    if (max === min) return PLOT_HEIGHT;
    return PLOT_HEIGHT - ((value - min) / (max - min)) * PLOT_HEIGHT;
  }

  money(value: number): string {
    return formatMoney(value, this.currency());
  }

  /** Axis ticks drop the minor units: "2k" reads at 10px, "$2,000.00" does not. */
  shortMoney(value: number): string {
    const major = value / 100;
    if (Math.abs(major) >= 1000) return `${Math.round(major / 100) / 10}k`;
    return String(Math.round(major));
  }
}
