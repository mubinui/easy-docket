import { Component, computed, input, signal } from '@angular/core';
import { areaPath, linePath, linePoints, nearestIndex, niceAxis } from '../../core/reports/geometry';
import { formatMoney } from '../../core/util/money';
import { ChartDatum } from './chart-types';

const PLOT_WIDTH = 320;
const PLOT_HEIGHT = 120;

/**
 * A single series over time — net worth, as it stands.
 *
 * One series, so no legend: the card's title already says what is plotted, and
 * a box with one swatch would restate it. The end point is direct-labelled
 * because that is the number the reader came for; the rest are carried by the
 * axis, the hover readout and the table.
 */
@Component({
  selector: 'app-trend-line-chart',
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
        touch-action: pan-y;
      }
      .grid {
        stroke: var(--viz-grid);
        stroke-width: 1;
      }
      .zero {
        stroke: var(--viz-axis);
        stroke-width: 1;
      }
      .line {
        fill: none;
        stroke: var(--viz-series-1);
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
      .area {
        fill: var(--viz-series-1);
        opacity: 0.1;
      }
      .marker {
        fill: var(--viz-series-1);
        stroke: var(--viz-surface);
        stroke-width: 2;
      }
      .crosshair {
        stroke: var(--viz-axis);
        stroke-width: 1;
      }
      .tick,
      .endLabel {
        font-size: 10px;
        fill: var(--viz-muted);
        font-variant-numeric: tabular-nums;
      }
      .tick {
        text-anchor: end;
      }
      .endLabel {
        text-anchor: end;
        fill: var(--ion-text-color);
        font-size: 11px;
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
    @if (points().length) {
      <figure>
        <svg
          #plot
          [attr.viewBox]="'-38 -10 ' + (plotWidth + 50) + ' ' + (plotHeight + 28)"
          role="img"
          [attr.aria-label]="summary()"
          (pointermove)="track($event, plot)"
          (pointerleave)="active.set(null)"
        >
          @for (tick of axis().ticks; track tick) {
            <line class="grid" x1="0" [attr.y1]="y(tick)" [attr.x2]="plotWidth" [attr.y2]="y(tick)" />
            <text class="tick" x="-6" [attr.y]="y(tick) + 3">{{ shortMoney(tick) }}</text>
          }

          @if (axis().min < 0) {
            <line class="zero" x1="0" [attr.y1]="y(0)" [attr.x2]="plotWidth" [attr.y2]="y(0)" />
          }

          @if (area()) {
            <path class="area" [attr.d]="area()" />
          }
          <path class="line" [attr.d]="path()" />

          @if (hovered(); as hover) {
            <line class="crosshair" [attr.x1]="hover.x" y1="0" [attr.x2]="hover.x" [attr.y2]="plotHeight" />
            <circle class="marker" [attr.cx]="hover.x" [attr.cy]="hover.y" r="4" />
          } @else {
            <circle class="marker" [attr.cx]="last().x" [attr.cy]="last().y" r="4" />
            <text class="endLabel" [attr.x]="plotWidth" [attr.y]="last().y - 10">
              {{ money(rows()[rows().length - 1].value) }}
            </text>
          }
        </svg>
      </figure>

      <p class="readout">{{ readout() }}</p>

      <table [class.visually-hidden]="!showTable()">
        <caption class="visually-hidden">{{ caption() }}</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Balance</th></tr>
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
      <p class="empty">Not enough history to chart yet.</p>
    }
  `,
})
export class TrendLineChartComponent {
  readonly rows = input.required<ChartDatum[]>();
  readonly currency = input('USD');
  readonly caption = input('Net worth over time');
  readonly showTable = input(false);

  readonly plotWidth = PLOT_WIDTH;
  readonly plotHeight = PLOT_HEIGHT;

  protected readonly active = signal<number | null>(null);

  readonly axis = computed(() => {
    const values = this.rows().map((row) => row.value);
    return niceAxis(Math.min(0, ...values), Math.max(0, ...values));
  });

  readonly points = computed(() =>
    linePoints(
      this.rows().map((row) => row.value),
      this.axis(),
      PLOT_WIDTH,
      PLOT_HEIGHT,
    ),
  );

  readonly path = computed(() => linePath(this.points()));
  readonly area = computed(() => areaPath(this.points(), this.y(Math.max(0, this.axis().min))));
  readonly last = computed(() => this.points()[this.points().length - 1] ?? { x: 0, y: 0 });

  readonly hovered = computed(() => {
    const index = this.active();
    return index === null ? null : (this.points()[index] ?? null);
  });

  readonly readout = computed(() => {
    const index = this.active();
    if (index === null) return '';

    const row = this.rows()[index];
    return row ? `${row.label}: ${this.money(row.value)}` : '';
  });

  readonly summary = computed(() => {
    const rows = this.rows();
    if (rows.length === 0) return 'Not enough history to chart yet.';

    const first = rows[0];
    const last = rows[rows.length - 1];
    const direction = last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat';

    return `${this.caption()}, ${first.label} to ${last.label}: ${this.money(
      first.value,
    )} to ${this.money(last.value)}, trending ${direction}.`;
  });

  /**
   * Map a pointer position onto the nearest reading.
   *
   * The SVG scales to its container, so client pixels have to be converted back
   * into view units before they mean anything — otherwise the crosshair drifts
   * further from the finger the wider the screen gets.
   */
  track(event: PointerEvent, plot: Element): void {
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;

    const viewWidth = PLOT_WIDTH + 50;
    const viewX = ((event.clientX - bounds.left) / bounds.width) * viewWidth - 38;

    const index = nearestIndex(this.points(), viewX);
    this.active.set(index >= 0 ? index : null);
  }

  y(value: number): number {
    const { min, max } = this.axis();
    if (max === min) return PLOT_HEIGHT;
    return PLOT_HEIGHT - ((value - min) / (max - min)) * PLOT_HEIGHT;
  }

  money(value: number): string {
    return formatMoney(value, this.currency());
  }

  shortMoney(value: number): string {
    const major = value / 100;
    if (Math.abs(major) >= 1000) return `${Math.round(major / 100) / 10}k`;
    return String(Math.round(major));
  }
}
