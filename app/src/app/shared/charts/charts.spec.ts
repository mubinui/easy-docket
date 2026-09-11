import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CategoryBarChartComponent } from './category-bar-chart.component';
import { FlowColumnChartComponent } from './flow-column-chart.component';
import { TrendLineChartComponent } from './trend-line-chart.component';
import { ChartDatum, ChartGroup } from './chart-types';

/**
 * Chart rendering.
 *
 * The geometry is proven in `geometry.spec.ts`; what these check is everything
 * that surrounds it and is just as easy to get wrong — that the shapes reach
 * the DOM, that every value stays reachable without reading the chart, that an
 * empty series says so rather than rendering a blank box, and that nothing
 * relies on colour alone.
 */
function render<T>(component: Type<T>, inputs: Record<string, unknown>): ComponentFixture<T> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [component] });

  const fixture = TestBed.createComponent(component);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture;
}

const CATEGORIES: ChartDatum[] = [
  { id: 'food', label: 'Groceries', value: 40_000 },
  { id: 'transport', label: 'Transport', value: 10_000 },
];

describe('CategoryBarChartComponent', () => {
  let fixture: ComponentFixture<CategoryBarChartComponent>;

  beforeEach(() => {
    fixture = render(CategoryBarChartComponent, { rows: CATEGORIES, currency: 'USD' });
  });

  it('draws one bar per category', () => {
    expect(fixture.nativeElement.querySelectorAll('svg path')).toHaveLength(2);
  });

  it('sizes bars against the largest value', () => {
    const [largest, smaller] = fixture.nativeElement.querySelectorAll('svg path');
    // The horizontal run before the rounded end: 300 wide against 75.
    expect(largest.getAttribute('d')).toContain('H296');
    expect(smaller.getAttribute('d')).toContain('H71');
  });

  it('gives every bar the same colour', () => {
    // Categories have no natural order, so shading by size would double-encode
    // the length the bar already shows.
    const fills = [...fixture.nativeElement.querySelectorAll('svg path')].map((bar: Element) =>
      bar.getAttribute('fill'),
    );
    expect(new Set(fills).size).toBe(1);
    expect(fills[0]).toBe('var(--viz-series-1)');
  });

  it('leaves the baseline end square', () => {
    const [bar] = fixture.nativeElement.querySelectorAll('svg path');
    expect(bar.getAttribute('d').startsWith('M0 18 H296')).toBe(true);
  });

  it('labels each row and its amount', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Groceries');
    expect(text).toContain('$400.00');
    expect(text).toContain('$100.00');
  });

  it('carries a table twin so no value is gated behind the chart', () => {
    const rows = fixture.nativeElement.querySelectorAll('table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Groceries');
    expect(rows[0].textContent).toContain('$400.00');
  });

  it('describes itself for assistive technology', () => {
    const label = fixture.nativeElement.querySelector('svg').getAttribute('aria-label');
    expect(label).toContain('2 categories');
    expect(label).toContain('Groceries');
  });

  it('says so when there is nothing to show', () => {
    const empty = render(CategoryBarChartComponent, { rows: [] });
    expect(empty.nativeElement.textContent).toContain('No spending in this period');
    expect(empty.nativeElement.querySelector('svg')).toBeNull();
  });

  it('still renders a row for a zero-value category', () => {
    const zeroed = render(CategoryBarChartComponent, {
      rows: [{ id: 'a', label: 'Nothing', value: 0 }],
    });
    expect(zeroed.nativeElement.querySelectorAll('svg path')).toHaveLength(1);
  });
});

const MONTHS: ChartGroup[] = [
  { id: '2026-01', label: 'Jan 2026', values: [300_000, 45_000] },
  { id: '2026-02', label: 'Feb 2026', values: [0, 20_000] },
  { id: '2026-03', label: 'Mar 2026', values: [0, 0] },
];

describe('FlowColumnChartComponent', () => {
  let fixture: ComponentFixture<FlowColumnChartComponent>;

  beforeEach(() => {
    fixture = render(FlowColumnChartComponent, { groups: MONTHS, currency: 'USD' });
  });

  it('draws two columns per month', () => {
    const columns = [...fixture.nativeElement.querySelectorAll('svg path')];
    expect(columns).toHaveLength(6);

    // Only the non-zero values have any area: January has both, February has
    // expense alone, and March is empty on both sides.
    const drawn = columns.filter((column: Element) => (column.getAttribute('d') ?? '') !== '');
    expect(drawn).toHaveLength(3);
  });

  it('always shows a legend, so identity never rests on colour', () => {
    const legend = fixture.nativeElement.querySelectorAll('.legend li');
    expect(legend).toHaveLength(2);
    expect(legend[0].textContent).toContain('In');
    expect(legend[1].textContent).toContain('Out');
  });

  it('keeps a month with no activity rather than closing the gap', () => {
    expect(fixture.nativeElement.textContent).toContain('Mar');
  });

  it('uses one axis for both series', () => {
    // A second scale would let the chart invent a relationship the data does
    // not contain.
    const ticks = fixture.nativeElement.querySelectorAll('.tick');
    expect(ticks.length).toBeGreaterThan(1);
    const values = [...ticks].map((tick: Element) => tick.textContent?.trim());
    expect(new Set(values).size).toBe(values.length);
  });

  it('draws solid hairline gridlines, never dashed', () => {
    const grid = fixture.nativeElement.querySelector('.grid');
    expect(grid.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('carries a table twin with both series', () => {
    const headers = [...fixture.nativeElement.querySelectorAll('table thead th')].map(
      (th: Element) => th.textContent?.trim(),
    );
    expect(headers).toEqual(['Period', 'In', 'Out']);
    expect(fixture.nativeElement.querySelectorAll('table tbody tr')).toHaveLength(3);
  });

  it('says so when there is nothing to show', () => {
    const empty = render(FlowColumnChartComponent, { groups: [] });
    expect(empty.nativeElement.textContent).toContain('Nothing recorded');
  });
});

const NET_WORTH: ChartDatum[] = [
  { id: '2026-01', label: 'Jan 2026', value: 330_000 },
  { id: '2026-02', label: 'Feb 2026', value: 310_000 },
  { id: '2026-03', label: 'Mar 2026', value: 355_000 },
];

describe('TrendLineChartComponent', () => {
  let fixture: ComponentFixture<TrendLineChartComponent>;

  beforeEach(() => {
    fixture = render(TrendLineChartComponent, { rows: NET_WORTH, currency: 'USD' });
  });

  it('draws a line through every reading', () => {
    const path = fixture.nativeElement.querySelector('.line').getAttribute('d');
    expect(path.match(/L/g)).toHaveLength(2);
  });

  it('has no legend, because there is only one series', () => {
    // A box with one swatch would only restate the title.
    expect(fixture.nativeElement.querySelector('.legend')).toBeNull();
  });

  it('direct-labels the end point and nothing else', () => {
    const labels = fixture.nativeElement.querySelectorAll('.endLabel');
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toContain('$3,550.00');
  });

  it('marks the end point large enough to see and ringed against the line', () => {
    const marker = fixture.nativeElement.querySelector('.marker');
    expect(Number(marker.getAttribute('r'))).toBeGreaterThanOrEqual(4);
  });

  it('draws a zero rule only when the data goes negative', () => {
    expect(fixture.nativeElement.querySelector('.zero')).toBeNull();

    const overdrawn = render(TrendLineChartComponent, {
      rows: [
        { id: 'a', label: 'Jan', value: -50_000 },
        { id: 'b', label: 'Feb', value: 20_000 },
      ],
    });
    expect(overdrawn.nativeElement.querySelector('.zero')).not.toBeNull();
  });

  it('renders a single reading without a line', () => {
    const single = render(TrendLineChartComponent, {
      rows: [{ id: 'a', label: 'Jan', value: 1_000 }],
    });
    // Mid-plot horizontally, because a lone dot against the left edge reads as
    // a line that failed to draw. Vertically it sits at its true position: the
    // axis runs 0 to 1,000, so the only reading is at the top of it.
    expect(single.nativeElement.querySelector('.line').getAttribute('d')).toBe('M160 0');
    // No area beneath a single point: there is no span to fill.
    expect(single.nativeElement.querySelector('.area')).toBeNull();
  });

  it('carries a table twin', () => {
    expect(fixture.nativeElement.querySelectorAll('table tbody tr')).toHaveLength(3);
  });

  it('describes its direction for assistive technology', () => {
    const label = fixture.nativeElement.querySelector('svg').getAttribute('aria-label');
    expect(label).toContain('trending up');
  });

  it('says so when there is nothing to chart', () => {
    const empty = render(TrendLineChartComponent, { rows: [] });
    expect(empty.nativeElement.textContent).toContain('Not enough history');
  });
});
