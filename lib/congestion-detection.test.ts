import { describe, expect, it } from 'vitest';
import { detectCongestion } from './congestion-detection';

function sample(index: number, segmentId?: string, timestamp = index * 10_000) {
  return {
    id: `gps-${index}`,
    driveId: 'drive',
    timestamp: BigInt(timestamp),
    speed: 2,
    distanceFromPrev: 10,
    segmentId,
  };
}

describe('congestion chronology', () => {
  it('does not merge separate visits to the same segment', () => {
    const events = detectCongestion([
      sample(0, 'segment-a', 0),
      sample(1, 'segment-a', 10_000),
      sample(2, 'segment-a', 20_000),
      sample(3, 'segment-a', 30_000),
      sample(4, undefined, 40_000),
      sample(5, 'segment-a', 100_000),
      sample(6, 'segment-a', 110_000),
      sample(7, 'segment-a', 120_000),
      sample(8, 'segment-a', 130_000),
    ]);
    expect(events).toHaveLength(2);
  });

  it('splits candidates on segment and timestamp gaps', () => {
    const events = detectCongestion([
      sample(0, 'segment-a', 0),
      sample(1, 'segment-a', 10_000),
      sample(2, 'segment-b', 20_000),
      sample(3, 'segment-b', 60_000),
    ]);
    expect(events).toHaveLength(0);
  });
});
