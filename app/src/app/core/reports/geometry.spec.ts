import { describe, expect, it } from 'vitest';
import {
  areaPath,
  barPath,
  groupedColumns,
  horizontalBars,
  linePath,
  linePoints,
  nearestIndex,
  niceAxis,
  scale,
} from './geometry';

describe('niceAxis', () => {
  it('rounds outwards to readable ticks', () => {
    const axis = niceAxis(0, 37_500);
    expect(axis.ticks).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    expect(axis.max).toBe(40_000);
  });

  it('always includes zero, so bar lengths stay comparable', () => {
    // A bar chart that starts at 900 exaggerates every difference above it.
    const axis = niceAxis(900, 1_000);
    expect(axis.min).toBe(0);
  });

  it('extends below zero when the data does', () => {
    const axis = niceAxis(-4_200, 8_000);
    expect(axis.min).toBeLessThan(0);
    expect(axis.max).toBeGreaterThanOrEqual(8_000);
    expect(axis.ticks).toContain(0);
  });

  it('gives a flat series somewhere to sit', () => {
    // Without a non-zero span every point would land on the baseline and the
    // chart would look broken rather than flat.
    expect(niceAxis(0, 0)).toEqual({ ticks: [0, 1], min: 0, max: 1 });
    expect(niceAxis(500, 500).max).toBeGreaterThan(500);
  });

  it('survives an empty or nonsensical domain', () => {
    expect(niceAxis(NaN, NaN).ticks).toEqual([0, 1]);
    expect(niceAxis(Infinity, -Infinity).ticks).toEqual([0, 1]);
  });

  it('produces exact tick values rather than floating-point drift', () => {
    for (const tick of niceAxis(0, 1).ticks) {
      expect(tick).toBe(Math.round(tick * 1000) / 1000);
    }
    expect(niceAxis(0, 5).ticks.every((t) => Number.isInteger(t))).toBe(true);
  });
});

describe('scale', () => {
  const axis = niceAxis(0, 100);

  it('maps a domain onto a range', () => {
    expect(scale(0, axis, 200, 0)).toBe(200);
    expect(scale(100, axis, 200, 0)).toBe(0);
    expect(scale(50, axis, 200, 0)).toBe(100);
  });

  it('does not divide by zero on a collapsed domain', () => {
    const flat = { ticks: [5], min: 5, max: 5 };
    expect(scale(5, flat, 200, 0)).toBe(200);
  });
});

describe('horizontalBars', () => {
  const options = { width: 300, band: 44, thickness: 8, labelHeight: 18 };

  it('scales bars against the largest value', () => {
    const bars = horizontalBars([100, 50, 25], options);

    expect(bars[0].width).toBe(300);
    expect(bars[1].width).toBe(150);
    expect(bars[2].width).toBe(75);
  });

  it('stacks bars down the plot', () => {
    const bars = horizontalBars([1, 1], options);
    expect(bars[0].y).toBe(18);
    expect(bars[1].y).toBe(62);
    expect(bars.every((bar) => bar.height === 8)).toBe(true);
  });

  it('draws a sliver for a zero value rather than nothing at all', () => {
    // A missing row reads as a rendering failure; a sliver reads as zero.
    const bars = horizontalBars([100, 0], options);
    expect(bars[1].width).toBe(2);
  });

  it('handles an all-zero series', () => {
    const bars = horizontalBars([0, 0], options);
    expect(bars.every((bar) => bar.width === 2)).toBe(true);
  });

  it('handles an empty series', () => {
    expect(horizontalBars([], options)).toEqual([]);
  });
});

describe('groupedColumns', () => {
  const options = {
    width: 300,
    height: 100,
    series: 2,
    innerGap: 2,
    bandPadding: 0.3,
    maxThickness: 24,
  };
  const axis = niceAxis(0, 100);

  it('returns a rect per series per group', () => {
    const groups = groupedColumns([[10, 20], [30, 40], [50, 60]], axis, options);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(2);
  });

  it('anchors every column to the baseline', () => {
    const [[income, expense]] = groupedColumns([[100, 50]], axis, options);

    // Taller column, smaller y; both end at the plot floor.
    expect(income.y + income.height).toBeCloseTo(100);
    expect(expense.y + expense.height).toBeCloseTo(100);
    expect(income.height).toBeGreaterThan(expense.height);
  });

  it('scales height against the axis, not the largest value', () => {
    const [[bar]] = groupedColumns([[50]], niceAxis(0, 100), { ...options, series: 1 });
    expect(bar.height).toBeCloseTo(50);
  });

  it('keeps the columns of a group side by side and inside their band', () => {
    const groups = groupedColumns([[10, 20], [30, 40]], axis, options);
    const [first, second] = groups[0];

    expect(second.x).toBeGreaterThan(first.x);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(groups[1][1].x + groups[1][1].width).toBeLessThanOrEqual(300);
  });

  it('caps thickness so a two-month chart is not two slabs', () => {
    const groups = groupedColumns([[10, 20]], axis, options);
    expect(groups[0][0].width).toBeLessThanOrEqual(24);
  });

  it('keeps a sliver of width when there are many groups', () => {
    const many = Array.from({ length: 24 }, () => [1, 2]);
    const groups = groupedColumns(many, axis, options);
    expect(groups[0][0].width).toBeGreaterThanOrEqual(2);
  });

  it('gives a zero value no height, but still a rect', () => {
    const [[bar]] = groupedColumns([[0]], axis, { ...options, series: 1 });
    expect(bar.height).toBe(0);
    expect(bar.y).toBeCloseTo(100);
  });

  it('handles no groups', () => {
    expect(groupedColumns([], axis, options)).toEqual([]);
  });
});

describe('linePoints', () => {
  const axis = niceAxis(0, 100);

  it('spreads points evenly across the width', () => {
    const points = linePoints([0, 50, 100], axis, 200, 100);

    expect(points.map((p) => p.x)).toEqual([0, 100, 200]);
    // y is inverted: the largest value sits at the top of the plot.
    expect(points.map((p) => p.y)).toEqual([100, 50, 0]);
  });

  it('places a lone reading mid-plot', () => {
    // Hard against the left edge it reads as a line that failed to draw.
    const [point] = linePoints([50], axis, 200, 100);
    expect(point.x).toBe(100);
  });

  it('handles no readings', () => {
    expect(linePoints([], axis, 200, 100)).toEqual([]);
  });

  it('plots negative values below the zero line', () => {
    const negative = niceAxis(-100, 100);
    const points = linePoints([-100, 0, 100], negative, 200, 100);

    expect(points[0].y).toBeGreaterThan(points[1].y);
    expect(points[2].y).toBeLessThan(points[1].y);
  });
});

describe('paths', () => {
  const points = [
    { x: 0, y: 100 },
    { x: 100, y: 50 },
    { x: 200, y: 0 },
  ];

  it('draws a line through every point', () => {
    expect(linePath(points)).toBe('M0 100 L100 50 L200 0');
  });

  it('closes the area down to the baseline', () => {
    expect(areaPath(points, 100)).toBe('M0 100 L100 50 L200 0 L200 100 L0 100 Z');
  });

  it('draws nothing for too few points', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([{ x: 0, y: 0 }], 100)).toBe('');
  });
});

describe('barPath', () => {
  it('rounds the data end and leaves the baseline square', () => {
    // A pill floating free of the axis loses the anchor that makes bar lengths
    // comparable, so the baseline corners stay sharp.
    const path = barPath({ x: 0, y: 0, width: 100, height: 8 }, 4, 'right');

    expect(path.startsWith('M0 0 H96')).toBe(true);
    expect(path.endsWith('H0 Z')).toBe(true);
    expect(path).toContain('Q100 0 100 4');
  });

  it('rounds the cap of an upward column', () => {
    const path = barPath({ x: 0, y: 0, width: 10, height: 50 }, 3, 'up');

    expect(path.startsWith('M0 50')).toBe(true);
    expect(path.endsWith('V50 Z')).toBe(true);
  });

  it('never rounds more than the bar can take', () => {
    // A 3px bar with a 4px radius would invert the curve.
    const path = barPath({ x: 0, y: 0, width: 3, height: 4 }, 4, 'right');
    expect(path).not.toContain('-');
  });

  it('draws nothing for a bar with no area', () => {
    expect(barPath({ x: 0, y: 0, width: 0, height: 8 })).toBe('');
    expect(barPath({ x: 0, y: 0, width: 10, height: 0 })).toBe('');
  });
});

describe('nearestIndex', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ];

  it('finds the closest point to a pointer', () => {
    expect(nearestIndex(points, 0)).toBe(0);
    expect(nearestIndex(points, 60)).toBe(1);
    expect(nearestIndex(points, 190)).toBe(2);
  });

  it('clamps beyond either end', () => {
    expect(nearestIndex(points, -50)).toBe(0);
    expect(nearestIndex(points, 500)).toBe(2);
  });

  it('reports nothing to hover when there are no points', () => {
    expect(nearestIndex([], 10)).toBe(-1);
  });
});
