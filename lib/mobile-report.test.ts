import { describe, expect, it } from 'vitest';
import { validateMobileReport } from './mobile-report';

function report(schemaVersion: string) {
  return {
    schemaVersion,
    idempotencyKey: '1234567890abcdef',
    startedAt: 1_000,
    endedAt: 2_000,
    locations: [
      { timestamp: 1_000, latitude: 30, longitude: -87, accuracy: 10, speedAccuracy: 1, courseAccuracy: 2 },
      { timestamp: 2_000, latitude: 30.001, longitude: -87.001, accuracy: 10 },
    ],
  };
}

describe('mobile report compatibility', () => {
  it('accepts schema versions 1 and 2', () => {
    expect(validateMobileReport(report('1')).valid).toBe(true);
    expect(validateMobileReport(report('2')).valid).toBe(true);
  });

  it('rejects invalid accuracy metadata and future schemas', () => {
    const invalid = report('2');
    invalid.locations[0].courseAccuracy = -1;
    expect(validateMobileReport(invalid).valid).toBe(false);
    expect(validateMobileReport(report('3')).valid).toBe(false);
  });
});
