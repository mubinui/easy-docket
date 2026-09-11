import { describe, expect, it } from 'vitest';
import {
  ClockDriftError,
  HybridLogicalClock,
  compareHlc,
  decodeHlc,
  encodeHlc,
} from './hlc';

/** A clock we can wind by hand, so ordering assertions are not timing-dependent. */
function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => (now += ms),
    set: (ms: number) => (now = ms),
  };
}

describe('HybridLogicalClock', () => {
  it('encodes to a fixed-width, lexicographically sortable stamp', () => {
    const stamp = encodeHlc({ physical: 1_700_000_000_000, counter: 7 }, 'a1b2c3d4');
    expect(stamp).toBe('0000001700000000000-0007-a1b2c3d4');
    expect(decodeHlc(stamp)).toEqual({
      physical: 1_700_000_000_000,
      counter: 7,
      device: 'a1b2c3d4',
    });
  });

  it('rejects malformed stamps rather than silently mis-ordering history', () => {
    expect(() => decodeHlc('nope')).toThrow(/Malformed/);
    expect(() => decodeHlc('17-0000-device')).toThrow(/Malformed/);
  });

  it('bumps the counter when two events land in the same millisecond', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('devicaaa', clock.now);
    const first = hlc.tick();
    const second = hlc.tick();
    expect(decodeHlc(first).counter).toBe(0);
    expect(decodeHlc(second).counter).toBe(1);
    expect(compareHlc(first, second)).toBeLessThan(0);
  });

  it('resets the counter once physical time moves on', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('devicaaa', clock.now);
    hlc.tick();
    hlc.tick();
    clock.advance(5);
    expect(decodeHlc(hlc.tick()).counter).toBe(0);
  });

  it('never moves backwards when the wall clock does', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('devicaaa', clock.now);
    const before = hlc.tick();
    clock.advance(-10_000); // NTP correction, or the user changing timezone
    const after = hlc.tick();
    expect(compareHlc(after, before)).toBeGreaterThan(0);
  });

  it('adopts a remote stamp that is ahead of local time', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('devicaaa', clock.now);
    const local = hlc.tick();
    const remote = encodeHlc({ physical: clock.now() + 5_000, counter: 0 }, 'devicbbb');

    const merged = hlc.observe(remote);
    expect(compareHlc(merged, remote)).toBeGreaterThan(0);
    expect(compareHlc(merged, local)).toBeGreaterThan(0);
    // Subsequent local events stay above the remote high-water mark.
    expect(compareHlc(hlc.tick(), merged)).toBeGreaterThan(0);
  });

  it('refuses a remote stamp from a badly broken clock', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('devicaaa', clock.now);
    const absurd = encodeHlc({ physical: clock.now() + 86_400_000, counter: 0 }, 'devicbbb');
    expect(() => hlc.observe(absurd)).toThrow(ClockDriftError);
  });

  it('converges when two devices exchange stamps in either order', () => {
    const clock = fakeClock();
    const a = new HybridLogicalClock('aaaaaaaa', clock.now);
    const b = new HybridLogicalClock('bbbbbbbb', clock.now);

    const fromA = a.tick();
    const fromB = b.tick();
    // Same millisecond, same counter: the device id breaks the tie, and both
    // sides agree on which stamp wins.
    expect(compareHlc(fromA, fromB)).toBeLessThan(0);

    b.observe(fromA);
    a.observe(fromB);
    expect(compareHlc(a.tick(), fromB)).toBeGreaterThan(0);
    expect(compareHlc(b.tick(), fromA)).toBeGreaterThan(0);
  });
});
