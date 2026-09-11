/**
 * Chart geometry.
 *
 * Kept pure and apart from the components so the shapes a chart draws can be
 * asserted directly, from known inputs, rather than inferred from rendered
 * markup. A chart that plots the wrong rectangle is a lie told confidently, and
 * this is the layer where that would happen.
 *
 * Everything works in a unit-free coordinate space that the SVG viewBox maps to
 * pixels, so the charts stay resolution-independent and resize without
 * recalculating anything.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A y-axis: rounded tick values plus the domain actually drawn. */
export interface Axis {
  ticks: number[];
  min: number;
  max: number;
}

/**
 * Round a domain outwards to human tick values — 0, 50, 100 rather than
 * 0, 37.5, 75. Axis labels exist to be read at a glance, and an axis reading
 * "1,237" is doing the opposite.
 */
export function niceAxis(min: number, max: number, targetTicks = 4): Axis {
  // A flat series still needs an axis with height, or every mark would sit on
  // the baseline and the chart would look broken rather than flat.
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min === 0 && max === 0)) {
    return { ticks: [0, 1], min: 0, max: 1 };
  }

  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (low === high) return { ticks: [low, low + 1], min: low, max: low + 1 };

  const step = niceStep((high - low) / Math.max(1, targetTicks));
  const niceLow = Math.floor(low / step) * step;
  const niceHigh = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  // Accumulate by index rather than repeated addition: adding 0.1 twenty times
  // drifts, and a drifted tick renders as 1999.9999999.
  const count = Math.round((niceHigh - niceLow) / step);
  for (let i = 0; i <= count; i++) {
    ticks.push(round(niceLow + i * step));
  }

  return { ticks, min: niceLow, max: niceHigh };
}

/** The next "nice" step at or above a raw interval: 1, 2, 2.5 or 5 × a power of ten. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;

  const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return factor * magnitude;
}

/** Map a value from a domain onto a range. Returns the range start for a zero-width domain. */
export function scale(value: number, domain: Axis, from: number, to: number): number {
  const span = domain.max - domain.min;
  if (span === 0) return from;
  return from + ((value - domain.min) / span) * (to - from);
}

export interface BarOptions {
  /** Plot width in view units. */
  width: number;
  /** Vertical space allotted to each bar, label included. */
  band: number;
  /** Bar thickness; capped so a band always keeps some air. */
  thickness: number;
  /** Space above each bar, where its label sits. */
  labelHeight: number;
}

/**
 * Horizontal bars, one per value, growing from a shared left baseline.
 *
 * Bars are scaled against the largest value rather than an axis, because the
 * question these answer is "how do these compare to each other", and a rounded
 * axis maximum would leave the biggest bar mysteriously short of the edge.
 */
export function horizontalBars(values: readonly number[], options: BarOptions): Rect[] {
  const largest = Math.max(0, ...values);

  return values.map((value, index) => ({
    x: 0,
    y: index * options.band + options.labelHeight,
    // A zero-value bar still draws a sliver, so the row does not look like a
    // rendering failure.
    width: largest > 0 ? Math.max(2, (value / largest) * options.width) : 2,
    height: options.thickness,
  }));
}

export interface ColumnOptions {
  width: number;
  height: number;
  /** Number of series in each group. */
  series: number;
  /** Gap between the columns within one group, in view units. */
  innerGap: number;
  /** Fraction of each band left as air between groups, 0-1. */
  bandPadding: number;
  maxThickness: number;
}

/**
 * Grouped columns: one band per group, `series` columns inside it.
 *
 * Returns a rect per series per group, indexed `[group][series]`, each anchored
 * to the baseline at the bottom of the plot.
 */
export function groupedColumns(
  groups: readonly (readonly number[])[],
  domain: Axis,
  options: ColumnOptions,
): Rect[][] {
  if (groups.length === 0) return [];

  const band = options.width / groups.length;
  const usable = band * (1 - options.bandPadding);
  const thickness = Math.min(
    options.maxThickness,
    Math.max(2, (usable - options.innerGap * (options.series - 1)) / options.series),
  );
  const groupWidth = thickness * options.series + options.innerGap * (options.series - 1);
  const baseline = scale(0, domain, options.height, 0);

  return groups.map((values, groupIndex) => {
    const left = groupIndex * band + (band - groupWidth) / 2;

    return values.map((value, seriesIndex) => {
      const top = scale(value, domain, options.height, 0);
      return {
        x: left + seriesIndex * (thickness + options.innerGap),
        y: Math.min(top, baseline),
        width: thickness,
        height: Math.abs(baseline - top),
      };
    });
  });
}

/** Evenly spaced points across the plot width, scaled onto the domain. */
export function linePoints(
  values: readonly number[],
  domain: Axis,
  width: number,
  height: number,
): Point[] {
  if (values.length === 0) return [];
  // A single reading is drawn mid-plot rather than hard against the left edge,
  // where it would read as the start of a line that failed to render.
  if (values.length === 1) {
    return [{ x: width / 2, y: scale(values[0], domain, height, 0) }];
  }

  const step = width / (values.length - 1);
  return values.map((value, index) => ({
    x: index * step,
    y: scale(value, domain, height, 0),
  }));
}

/** An SVG path through the points. Empty string for no points. */
export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

/** The same line closed down to the baseline, for the area wash beneath it. */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];

  return `${linePath(points)} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(
    baseline,
  )} Z`;
}

/**
 * A bar as a path, rounded only at the data end.
 *
 * The baseline end stays square: a pill floating free of the axis loses the
 * visual anchor that makes bar lengths comparable in the first place. SVG's
 * `rx` rounds all four corners, so the shape is drawn explicitly.
 */
export function barPath(rect: Rect, radius = 4, direction: 'right' | 'up' = 'right'): string {
  const { x, y, width, height } = rect;
  if (width <= 0 || height <= 0) return '';

  if (direction === 'right') {
    const r = Math.min(radius, width, height / 2);
    return [
      `M${round(x)} ${round(y)}`,
      `H${round(x + width - r)}`,
      `Q${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)}`,
      `V${round(y + height - r)}`,
      `Q${round(x + width)} ${round(y + height)} ${round(x + width - r)} ${round(y + height)}`,
      `H${round(x)}`,
      'Z',
    ].join(' ');
  }

  const r = Math.min(radius, height, width / 2);
  return [
    `M${round(x)} ${round(y + height)}`,
    `V${round(y + r)}`,
    `Q${round(x)} ${round(y)} ${round(x + r)} ${round(y)}`,
    `H${round(x + width - r)}`,
    `Q${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)}`,
    `V${round(y + height)}`,
    'Z',
  ].join(' ');
}

/** Index of the point nearest an x position, for hover and touch. */
export function nearestIndex(points: readonly Point[], x: number): number {
  if (points.length === 0) return -1;

  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.abs(points[i].x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Two decimals is far below a pixel at these sizes, and keeps the DOM readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
