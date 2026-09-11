import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CategoryBarChartComponent } from './category-bar-chart.component';
import { FlowColumnChartComponent } from './flow-column-chart.component';
import { TrendLineChartComponent } from './trend-line-chart.component';

/**
 * A way to actually look at the charts.
 *
 * Colour can be validated by script and geometry by assertion, but neither
 * catches a clipped label, a collision, or a bar that reads wrong — and those
 * are the failures a reader notices first. This renders every chart in both
 * themes into a standalone page:
 *
 *   CHART_CAPTURE=/tmp/charts.html npm run test:ci
 *
 * Without the variable it does nothing, so it costs a CI run nothing.
 */
const OUT = process.env['CHART_CAPTURE'];

function render<T>(component: Type<T>, inputs: Record<string, unknown>): string {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [component] });
  const fixture = TestBed.createComponent(component);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture.nativeElement.outerHTML;
}

/**
 * Component styles are scoped and do not reach the harness on their own, so
 * they are lifted out of the sources. `:host` becomes the element selector;
 * every other rule is class-based and applies as written.
 */
function stylesFor(name: string): string {
  const source = readFileSync('src/app/shared/charts/' + name + '.component.ts', 'utf8');
  const block = /styles: \[\s*`([\s\S]*?)`,?\s*\]/.exec(source);
  return (block ? block[1] : '').split(':host').join('app-' + name);
}

describe('chart preview', () => {
  it('writes a preview page when CHART_CAPTURE names one', () => {
    if (!OUT) {
      expect(OUT).toBeUndefined();
      return;
    }

    const bars = render(CategoryBarChartComponent, {
      rows: [
        { id: 'a', label: 'Groceries', value: 40_000 },
        { id: 'b', label: 'Eating out', value: 28_500 },
        { id: 'c', label: 'Transport', value: 12_000 },
        { id: 'd', label: 'Subscriptions and streaming', value: 4_200 },
      ],
      currency: 'USD',
    });

    const columns = render(FlowColumnChartComponent, {
      groups: [
        { id: '1', label: 'January', values: [300_000, 145_000] },
        { id: '2', label: 'February', values: [300_000, 220_000] },
        { id: '3', label: 'March', values: [0, 98_000] },
        { id: '4', label: 'April', values: [312_000, 180_000] },
        { id: '5', label: 'May', values: [300_000, 260_000] },
        { id: '6', label: 'June', values: [300_000, 90_000] },
      ],
      currency: 'USD',
    });

    const line = render(TrendLineChartComponent, {
      rows: [
        { id: '1', label: 'January', value: 155_000 },
        { id: '2', label: 'February', value: 235_000 },
        { id: '3', label: 'March', value: 137_000 },
        { id: '4', label: 'April', value: 269_000 },
        { id: '5', label: 'May', value: 309_000 },
        { id: '6', label: 'June', value: 519_000 },
      ],
      currency: 'USD',
    });

    const componentStyles = ['category-bar-chart', 'flow-column-chart', 'trend-line-chart']
      .map(stylesFor)
      .join('\n');

    const card = (title: string, body: string) =>
      '<section class="card"><h2>' + title + '</h2>' + body + '</section>';

    const column = (mode: string) =>
      '<div class="' +
      mode +
      '">' +
      card('Where it went', bars) +
      card('In and out', columns) +
      card('Net worth', line) +
      '</div>';

    const harnessStyles = `
      body { margin:0; font-family: system-ui, sans-serif; display:flex; }
      .light, .dark { flex:1; padding:16px; }
      .light { --viz-surface:#fff; --viz-series-1:#2a78d6; --viz-series-2:#eb6834;
               --viz-grid:#e1e0d9; --viz-axis:#c3c2b7; --viz-muted:#898781;
               --ion-text-color:#0b0b0b; --ion-color-medium:#6b6b6b; background:#f4f4f5; }
      .dark  { --viz-surface:#1e1e1e; --viz-series-1:#3987e5; --viz-series-2:#d95926;
               --viz-grid:#2c2c2a; --viz-axis:#383835; --viz-muted:#898781;
               --ion-text-color:#fff; --ion-color-medium:#a6a6a6; background:#121212; }
      .card { background: var(--viz-surface); border-radius:10px; padding:14px; margin-bottom:14px; }
      .light .card { color:#0b0b0b; } .dark .card { color:#fff; }
      h2 { font-size:0.95rem; margin:0 0 10px; font-weight:600; }
    `;

    writeFileSync(
      OUT,
      '<!doctype html><meta charset="utf-8"><style>' +
        componentStyles +
        harnessStyles +
        '</style>' +
        column('light') +
        column('dark'),
    );

    expect(readFileSync(OUT, 'utf8')).toContain('viz-series-1');
  });
});
