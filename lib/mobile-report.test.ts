import { describe, expect, it } from 'vitest';
import {
  MAX_PAUSED_INTERVALS,
  MAX_TRAFFIC_TAGS,
  isWithinPause,
  totalPausedDuration,
  validateMobileReport,
} from './mobile-report';

// Realistic epoch milliseconds, spanning ten minutes: the stop/pause window
// checks allow 60 s of slack either side, so a toy 1 s window would make every
// out-of-window case vacuously pass.
const START = 1_760_000_000_000;
const END = START + 600_000;

function report(schemaVersion: string) {
  return {
    schemaVersion,
    idempotencyKey: '1234567890abcdef',
    startedAt: START,
    endedAt: END,
    locations: [
      { timestamp: START, latitude: 30, longitude: -87, accuracy: 10, speedAccuracy: 1, courseAccuracy: 2 },
      { timestamp: END, latitude: 30.001, longitude: -87.001, accuracy: 10 },
    ],
  } as Record<string, unknown>;
}

const tag = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  startedAt: START + 120_000,
  endedAt: START + 140_000,
  latitude: 30,
  longitude: -87,
  accuracy: 8,
  heading: 271.5,
  kind: 'RED_LIGHT',
  taggedDuring: 'LIVE',
  ...overrides,
});

const pause = (overrides: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  startedAt: START + 200_000,
  endedAt: START + 260_000,
  endedBy: 'USER',
  ...overrides,
});

describe('mobile report compatibility', () => {
  it('accepts schema versions 1, 2 and 3', () => {
    expect(validateMobileReport(report('1')).valid).toBe(true);
    expect(validateMobileReport(report('2')).valid).toBe(true);
    expect(validateMobileReport(report('3')).valid).toBe(true);
  });

  it('rejects invalid accuracy metadata and unsupported schemas', () => {
    const invalid = report('2') as { locations: { courseAccuracy?: number }[] };
    invalid.locations[0].courseAccuracy = -1;
    expect(validateMobileReport(invalid).valid).toBe(false);
    expect(validateMobileReport(report('4')).valid).toBe(false);
  });

  // A v2 client keeps uploading after the server moves to v3, and a v3 client
  // that saw no stops sends neither array. Both must stay valid.
  it('treats the new arrays as optional for every version', () => {
    expect(validateMobileReport({ ...report('2'), trafficTags: [tag()] }).valid).toBe(true);
    expect(validateMobileReport(report('3')).valid).toBe(true);
  });
});

describe('traffic tags', () => {
  it('accepts a fully populated tag', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag()] }).valid).toBe(true);
  });

  it('accepts the minimum TrafficTag needs, with the optional fields absent', () => {
    const minimal = tag();
    for (const key of ['accuracy', 'heading', 'anchorId', 'taggedDuring']) {
      delete (minimal as Record<string, unknown>)[key];
    }
    expect(validateMobileReport({ ...report('3'), trafficTags: [minimal] }).valid).toBe(true);
  });

  // TrafficTag.endTime and duration are non-null, so a stop the driver never
  // finished has nowhere to land.
  it('rejects a tag with no end time', () => {
    const open = tag();
    delete (open as Record<string, unknown>).endedAt;
    expect(validateMobileReport({ ...report('3'), trafficTags: [open] }).valid).toBe(false);
  });

  // AUTO is the app applying a settled anchor's tag without prompting. It is a
  // real source alongside the driver's LIVE/REVIEW answers and must validate.
  it('accepts an auto-applied tag source', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ taggedDuring: 'AUTO' })] }).valid).toBe(true);
  });

  it('rejects an unknown tag source', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ taggedDuring: 'ROBOT' })] }).valid).toBe(false);
  });

  it('rejects a kind outside the three the phone offers', () => {
    // Real TrafficTagKind values, but not ones a driver can pick mid-drive.
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ kind: 'PARKING' })] }).valid).toBe(false);
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ kind: 'ROUNDABOUT' })] }).valid).toBe(false);
  });

  // featureKey is unique per drive, so a duplicate would be silently swallowed
  // by skipDuplicates on the retry path instead of surfacing as a lost label.
  it('rejects duplicate ids', () => {
    const result = validateMobileReport({ ...report('3'), trafficTags: [tag(), tag()] });
    expect(result.valid).toBe(false);
  });

  it('rejects timestamps far outside the report window', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ startedAt: 0 })] }).valid).toBe(false);
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ startedAt: END + 600_000 })] }).valid).toBe(false);
  });

  // 60 s of slack absorbs the small clock differences between the GPS fix that
  // opened a stop and the report boundaries.
  it('allows a stop just outside the window, within the slack', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ startedAt: START - 30_000, endedAt: START })] }).valid).toBe(true);
  });

  it('rejects endedAt before startedAt', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ endedAt: START + 100_000 })] }).valid).toBe(false);
  });

  it('rejects an out-of-range heading', () => {
    expect(validateMobileReport({ ...report('3'), trafficTags: [tag({ heading: 400 })] }).valid).toBe(false);
  });

  it('rejects arrays over the cap', () => {
    const overCap = Array.from({ length: MAX_TRAFFIC_TAGS + 1 }, (_, index) =>
      tag({ id: `1111111-2222-3333-4444-${String(index).padStart(12, '0')}` })
    );
    expect(validateMobileReport({ ...report('3'), trafficTags: overCap }).valid).toBe(false);
  });
});

describe('paused intervals', () => {
  it('accepts a sorted, non-overlapping set', () => {
    const intervals = [pause(), pause({ id: 'ffffffff-0000-1111-2222-333333333333', startedAt: START + 300_000, endedAt: START + 320_000 })];
    expect(validateMobileReport({ ...report('3'), pausedIntervals: intervals }).valid).toBe(true);
  });

  it('rejects overlapping intervals', () => {
    const intervals = [pause(), pause({ id: 'ffffffff-0000-1111-2222-333333333333', startedAt: START + 240_000, endedAt: START + 320_000 })];
    expect(validateMobileReport({ ...report('3'), pausedIntervals: intervals }).valid).toBe(false);
  });

  it('rejects an unknown end reason', () => {
    expect(validateMobileReport({ ...report('3'), pausedIntervals: [pause({ endedBy: 'CRASH' })] }).valid).toBe(false);
  });

  it('rejects arrays over the cap', () => {
    const overCap = Array.from({ length: MAX_PAUSED_INTERVALS + 1 }, (_, index) =>
      pause({ startedAt: START + index, endedAt: START + index })
    );
    expect(validateMobileReport({ ...report('3'), pausedIntervals: overCap }).valid).toBe(false);
  });
});

describe('paused-duration helpers', () => {
  it('sums closed intervals', () => {
    expect(totalPausedDuration([pause()], END)).toBe(60_000);
  });

  // A session killed mid-pause uploads an open interval; clamping to endedAt
  // keeps it from swallowing the entire drive.
  it('clamps an open interval to the report end', () => {
    expect(totalPausedDuration([pause({ endedAt: null })], END)).toBe(400_000);
  });

  it('detects timestamps inside a pause', () => {
    expect(isWithinPause([pause()], START + 220_000, END)).toBe(true);
    expect(isWithinPause([pause()], START + 400_000, END)).toBe(false);
  });
});
