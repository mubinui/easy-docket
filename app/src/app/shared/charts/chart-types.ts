/** Shared shapes for the chart components. */

export interface ChartDatum {
  /** Stable key, used for tracking and for the table view. */
  id: string;
  label: string;
  value: number;
}

/** One group of values, for a chart with more than one series. */
export interface ChartGroup {
  id: string;
  label: string;
  values: number[];
}

export interface SeriesMeta {
  label: string;
  /** CSS custom property holding this series' colour. */
  colour: string;
}
