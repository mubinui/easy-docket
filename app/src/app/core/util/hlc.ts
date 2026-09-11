/**
 * Hybrid logical clock.
 *
 * A wall-clock timestamp alone cannot order events across devices whose clocks
 * disagree, and a pure logical counter loses the human-meaningful ordering we
 * want when merging a ledger. The HLC keeps both: it tracks physical time but
 * never moves backwards, bumping a counter when time stands still or when a
 * remote stamp is ahead of us.
 *
 * The encoded form is fixed width so plain string comparison is also causal
 * comparison, which lets us sort operations in IndexedDB and name remote
 * objects without decoding anything.
 *
 *   `0000001739059200000-0000-3f9a2c17`
 *    physical ms (19)    ctr  device (8)
 */
export interface HlcState {
  physical: number;
  counter: number;
}

const PHYSICAL_WIDTH = 19;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 0xffff;
/** Reject remote stamps this far ahead of us; they are a clock fault, not history. */
export const MAX_DRIFT_MS = 60 * 60 * 1000;

export class ClockDriftError extends Error {
  constructor(drift: number) {
    super(`Remote clock is ${Math.round(drift / 1000)}s ahead of this device`);
    this.name = 'ClockDriftError';
  }
}

export function encodeHlc(state: HlcState, device: string): string {
  const physical = String(state.physical).padStart(PHYSICAL_WIDTH, '0');
  const counter = state.counter.toString(16).padStart(COUNTER_WIDTH, '0');
  return `${physical}-${counter}-${device}`;
}

export function decodeHlc(stamp: string): HlcState & { device: string } {
  const parts = stamp.split('-');
  if (parts.length !== 3) throw new Error(`Malformed HLC stamp: ${stamp}`);
  const [physical, counter, device] = parts;
  if (physical.length !== PHYSICAL_WIDTH || counter.length !== COUNTER_WIDTH) {
    throw new Error(`Malformed HLC stamp: ${stamp}`);
  }
  return { physical: Number(physical), counter: parseInt(counter, 16), device };
}

/** `now` is injectable so tests can drive the clock deterministically. */
export class HybridLogicalClock {
  private state: HlcState;

  constructor(
    readonly device: string,
    private readonly now: () => number = Date.now,
    initial?: HlcState,
  ) {
    this.state = initial ?? { physical: 0, counter: 0 };
  }

  get snapshot(): HlcState {
    return { ...this.state };
  }

  /** Stamp a locally authored event. */
  tick(): string {
    const wall = this.now();
    if (wall > this.state.physical) {
      this.state = { physical: wall, counter: 0 };
    } else {
      this.state = { physical: this.state.physical, counter: this.bump() };
    }
    return encodeHlc(this.state, this.device);
  }

  /** Fold a stamp observed from another device into our clock. */
  observe(stamp: string): string {
    const remote = decodeHlc(stamp);
    const wall = this.now();

    if (remote.physical - wall > MAX_DRIFT_MS) {
      throw new ClockDriftError(remote.physical - wall);
    }

    const physical = Math.max(wall, this.state.physical, remote.physical);
    let counter: number;
    if (physical === this.state.physical && physical === remote.physical) {
      counter = Math.max(this.state.counter, remote.counter) + 1;
    } else if (physical === this.state.physical) {
      counter = this.state.counter + 1;
    } else if (physical === remote.physical) {
      counter = remote.counter + 1;
    } else {
      counter = 0;
    }
    if (counter > MAX_COUNTER) throw new Error('HLC counter overflow');

    this.state = { physical, counter };
    return encodeHlc(this.state, this.device);
  }

  private bump(): number {
    const next = this.state.counter + 1;
    if (next > MAX_COUNTER) throw new Error('HLC counter overflow');
    return next;
  }
}

/** Causal comparison of two stamps. Returns <0, 0 or >0 like a sort comparator. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
