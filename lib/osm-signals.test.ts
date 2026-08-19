import { describe, expect, it } from 'vitest';
import {
  associateSignal,
  drivenBoundingBoxes,
  kindForHighwayTag,
  overpassQuery,
  parseOverpassResponse,
  type OsmNode,
} from './osm-signals';

const METRE_LAT = 1 / 111_320;

const node = (id: number, lat: number, lng: number, highway = 'traffic_signals'): OsmNode =>
  ({ osmNodeId: id, latitude: lat, longitude: lng, highway, direction: null, tags: { highway } });

describe('drivenBoundingBoxes', () => {
  const commute = { minLat: 30.39, maxLat: 30.47, minLon: -87.29, maxLon: -87.20 };

  it('keeps one commute as one box', () => {
    expect(drivenBoundingBoxes([commute, { ...commute, maxLat: 30.50 }])).toHaveLength(1);
  });

  it('does not stretch one box across a continent for a stray drive', () => {
    // The real situation: a handful of segments in Chicago, San Francisco and
    // Portland alongside the Pensacola commute. One box over all of them asks
    // Overpass for a third of a country.
    const boxes = drivenBoundingBoxes([
      commute,
      { minLat: 41.88, maxLat: 41.89, minLon: -87.66, maxLon: -87.65 },
      { minLat: 37.77, maxLat: 37.78, minLon: -122.43, maxLon: -122.41 },
    ]);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect((box.maxLat - box.minLat) * 111.32).toBeLessThan(50);
    }
  });

  it('merges regions that turn out to touch once grown', () => {
    // Two boxes far apart, and a third bridging them.
    const boxes = drivenBoundingBoxes([
      { minLat: 30.40, maxLat: 30.41, minLon: -87.29, maxLon: -87.28 },
      { minLat: 30.60, maxLat: 30.61, minLon: -87.29, maxLon: -87.28 },
      { minLat: 30.40, maxLat: 30.61, minLon: -87.29, maxLon: -87.28 },
    ]);
    expect(boxes).toHaveLength(1);
  });

  it('pads each box, so a control just off the driven line is caught', () => {
    const [box] = drivenBoundingBoxes([commute]);
    expect(box.minLat).toBeLessThan(commute.minLat);
    expect(box.maxLon).toBeGreaterThan(commute.maxLon);
  });
});

describe('overpassQuery', () => {
  it('asks for both control types inside the box', () => {
    const query = overpassQuery({ minLat: 30.4, maxLat: 30.5, minLon: -87.3, maxLon: -87.2 });
    expect(query).toContain('"highway"="traffic_signals"');
    expect(query).toContain('"highway"="stop"');
    expect(query).toContain('30.400000,-87.300000,30.500000,-87.200000');
    expect(query).toContain('[out:json]');
  });
});

describe('parseOverpassResponse', () => {
  it('reads nodes and their direction tag', () => {
    const nodes = parseOverpassResponse({
      elements: [{ type: 'node', id: 42, lat: 30.44, lon: -87.26, tags: { highway: 'traffic_signals', direction: 'forward' } }],
    });
    expect(nodes).toEqual([{
      osmNodeId: 42, latitude: 30.44, longitude: -87.26,
      highway: 'traffic_signals', direction: 'forward',
      tags: { highway: 'traffic_signals', direction: 'forward' },
    }]);
  });

  it('drops what it cannot use rather than throwing', () => {
    // A partial response should cost the elements it mangled, not the import.
    expect(parseOverpassResponse({
      elements: [
        { type: 'way', id: 1, tags: { highway: 'traffic_signals' } },
        { type: 'node', id: 2, lat: 30.4, lon: -87.2, tags: { highway: 'crossing' } },
        { type: 'node', id: 3, lat: 30.4 },
        { type: 'node', id: 4, lat: 30.4, lon: -87.2, tags: { highway: 'stop' } },
      ],
    }).map((n) => n.osmNodeId)).toEqual([4]);
    expect(parseOverpassResponse({})).toEqual([]);
    expect(parseOverpassResponse(null)).toEqual([]);
  });
});

describe('associateSignal', () => {
  // A signal at an intersection, with the northbound stop line 40 m south of it
  // and the southbound stop line 40 m north.
  const signal = node(1, 30.4400, -87.2600);
  const northbound = { id: 'nb', lat: 30.4400 - 40 * METRE_LAT, lng: -87.2600, bearing: 0 };
  const southbound = { id: 'sb', lat: 30.4400 + 40 * METRE_LAT, lng: -87.2600, bearing: 180 };

  it('attaches a signal that lies ahead of the approach', () => {
    expect(associateSignal(northbound, [signal])?.signal.osmNodeId).toBe(1);
    expect(associateSignal(southbound, [signal])?.signal.osmNodeId).toBe(1);
  });

  it('does not attach a control sitting behind the driver', () => {
    // The #2 item 5 regression: a proximity-only test would take this, since
    // it is well inside any sane radius.
    const behind = node(2, 30.4400 - 80 * METRE_LAT, -87.2600);
    expect(associateSignal(northbound, [behind])).toBeNull();
  });

  it('gives each approach its own stop line-s control, not the far one', () => {
    // Larger junctions map a node per stop line. The northbound driver stops at
    // the near one; the far one governs oncoming traffic and is 50 m past the
    // junction.
    const nearSide = node(10, 30.4400 - 25 * METRE_LAT, -87.2600);
    const farSide = node(11, 30.4400 + 25 * METRE_LAT, -87.2600);
    expect(associateSignal(northbound, [nearSide, farSide])?.signal.osmNodeId).toBe(10);
    expect(associateSignal(southbound, [nearSide, farSide])?.signal.osmNodeId).toBe(11);
  });

  it('prefers a control ahead over a nearer one behind', () => {
    // The sharpest form of the #2 item 5 bug: proximity alone takes the wrong
    // one, because the opposing stop line is closer than this approach-s own.
    const ahead = node(20, 30.4400 - 5 * METRE_LAT, -87.2600);
    const nearerButBehind = node(21, 30.4400 - 42 * METRE_LAT, -87.2600);
    const chosen = associateSignal(northbound, [nearerButBehind, ahead]);
    expect(chosen?.signal.osmNodeId).toBe(20);
  });

  it('ignores a control too far ahead to be what stopped you', () => {
    const distant = node(3, 30.4400 + 300 * METRE_LAT, -87.2600);
    expect(associateSignal(northbound, [distant])).toBeNull();
  });

  it('takes the nearest when several qualify', () => {
    const near = node(4, 30.4400 - 20 * METRE_LAT, -87.2600);
    const far = node(5, 30.4400 + 20 * METRE_LAT, -87.2600);
    expect(associateSignal(northbound, [far, near])?.signal.osmNodeId).toBe(4);
  });

  it('accepts a node sitting on the cluster centre, where ahead means nothing', () => {
    const onTop = node(6, northbound.lat, northbound.lng);
    expect(associateSignal(northbound, [onTop])?.signal.osmNodeId).toBe(6);
  });
});

describe('kindForHighwayTag', () => {
  it('maps the tags we import onto the kinds we already use', () => {
    expect(kindForHighwayTag('traffic_signals')).toBe('RED_LIGHT');
    expect(kindForHighwayTag('stop')).toBe('STOP_SIGN');
    expect(kindForHighwayTag('crossing')).toBeNull();
  });
});
