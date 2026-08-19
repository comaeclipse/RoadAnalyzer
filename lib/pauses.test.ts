import { describe, expect, it } from 'vitest';
import { isWithinPause, splitAtPauses, straddlesPause } from './pauses';

const at = (timestamp: number) => ({ timestamp });
const END = 100;

describe('pause spans', () => {
  it('treats an open pause as running to the end of the drive', () => {
    const pauses = [{ startedAt: 50, endedAt: null }];
    expect(isWithinPause(pauses, 40, END)).toBe(false);
    expect(isWithinPause(pauses, 60, END)).toBe(true);
    expect(isWithinPause(pauses, 99, END)).toBe(true);
  });

  it('flags a leg whose endpoints bracket a pause, which is the usual shape', () => {
    // GPS is off during a pause, so neither neighbouring fix is inside it.
    const pauses = [{ startedAt: 30, endedAt: 70 }];
    expect(straddlesPause(pauses, 29, 71, END)).toBe(true);
    expect(straddlesPause(pauses, 10, 20, END)).toBe(false);
    expect(straddlesPause(pauses, 80, 90, END)).toBe(false);
  });

  it('splits a trace into recorded runs and drops paused samples', () => {
    const points = [at(10), at(20), at(40), at(50), at(80), at(90)];
    const spans = splitAtPauses(points, [{ startedAt: 30, endedAt: 60 }], (p) => p.timestamp, END);

    expect(spans.map((span) => span.map((p) => p.timestamp))).toEqual([[10, 20], [80, 90]]);
  });

  it('returns one span when nothing was paused', () => {
    const points = [at(10), at(20), at(30)];
    expect(splitAtPauses(points, [], (p) => p.timestamp, END)).toEqual([points]);
    expect(splitAtPauses(points, undefined, (p) => p.timestamp, END)).toEqual([points]);
    expect(splitAtPauses([], [{ startedAt: 1, endedAt: 2 }], (p: { timestamp: number }) => p.timestamp, END)).toEqual([]);
  });
});
