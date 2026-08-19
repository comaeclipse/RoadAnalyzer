import { describe, expect, it } from 'vitest';
import { detectCongestion } from './congestion-detection';

function sample(index: number, segmentId?: string, timestamp = index * 10_000, roadId?: string) {
  return {
    id: `gps-${index}`,
    driveId: 'drive',
    timestamp: BigInt(timestamp),
    speed: 2,
    distanceFromPrev: 10,
    segmentId,
    roadId,
  };
}

/** Consecutive tiles of one road, as the tiled segment model produces. */
const tile = (index: number, cell: string, timestamp: number) =>
  sample(index, `main-st|${cell}`, timestamp, 'main st');

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

  it('carries one event across the tiles of a single road', () => {
    // A crawl over three tiles. Ending the event at each grid line would leave
    // three 20 s fragments, all of them under minDuration and all discarded.
    const events = detectCongestion([
      tile(0, '6080:-17441', 0),
      tile(1, '6080:-17441', 10_000),
      tile(2, '6080:-17440', 20_000),
      tile(3, '6080:-17440', 30_000),
      tile(4, '6080:-17439', 40_000),
      tile(5, '6080:-17439', 50_000),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].duration).toBe(50_000);
  });

  it('files an event under the tile it spent longest on', () => {
    const events = detectCongestion([
      tile(0, '6080:-17441', 0),
      tile(1, '6080:-17440', 10_000),
      tile(2, '6080:-17440', 20_000),
      tile(3, '6080:-17440', 30_000),
      tile(4, '6080:-17439', 40_000),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].segmentId).toBe('main-st|6080:-17440');
  });

  it('still ends an event when the road changes', () => {
    const events = detectCongestion([
      tile(0, '6080:-17441', 0),
      tile(1, '6080:-17441', 10_000),
      sample(2, 'oak-ave|6080:-17440', 20_000, 'oak ave'),
      sample(3, 'oak-ave|6080:-17440', 30_000, 'oak ave'),
    ]);
    // Neither run reaches minDuration once the road change cuts them apart.
    expect(events).toHaveLength(0);
  });

  it('treats each segment as its own road when no road is given', () => {
    // The pre-tiling behaviour, which callers without a spatialKey still get.
    const events = detectCongestion([
      sample(0, 'segment-a', 0),
      sample(1, 'segment-a', 10_000),
      sample(2, 'segment-b', 20_000),
      sample(3, 'segment-b', 30_000),
      sample(4, 'segment-b', 40_000),
      sample(5, 'segment-b', 50_000),
      sample(6, 'segment-b', 60_000),
    ]);
    // segment-a's two samples span 10 s and are dropped; segment-b's span 40 s
    // and survive as their own event, as they did before roads existed.
    expect(events).toHaveLength(1);
    expect(events[0].segmentId).toBe('segment-b');
    expect(events[0].duration).toBe(40_000);
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
