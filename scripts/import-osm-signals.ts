/**
 * Import traffic controls from OpenStreetMap for the roads we have driven.
 *
 * Overpass is rate limited and unreliable under load, so this is invoked by
 * hand or on a schedule and the result is cached in OsmSignal. Nothing fetches
 * it per request; a page that failed because a third-party API was busy would
 * be a bad trade for a label.
 *
 * Queries one box per driven region rather than one box over everything: a few
 * stray drives in other cities stretch a single bbox across a continent.
 *
 * Idempotent — upserts on the OSM node id, which is stable.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/import-osm-signals.ts             # show what would be fetched
 *   npx tsx scripts/import-osm-signals.ts --apply     # fetch and cache
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import * as turf from '@turf/turf';
import { prisma } from '../lib/prisma';
import {
  drivenBoundingBoxes,
  overpassQuery,
  parseOverpassResponse,
  type BoundingBox,
  type OsmNode,
} from '../lib/osm-signals';

const APPLY = process.argv.includes('--apply');
/** How near a control must be to a driven road to count as one we pass. */
const ON_ROUTE_METERS = 25;
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const areaKm2 = (box: BoundingBox) =>
  (box.maxLat - box.minLat) * 111.32 *
  (box.maxLon - box.minLon) * 111.32 * Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Overpass says "later" with these; anything else is a real failure. */
const RETRYABLE = new Set([429, 502, 503, 504]);

async function fetchBox(box: BoundingBox, attempt = 0): Promise<OsmNode[]> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    // Overpass answers 406 to a request without a descriptive User-Agent, which
    // is its way of asking clients to identify themselves.
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RoadAnalyzer/1.0 (github.com/comaeclipse/RoadAnalyzer)',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ data: overpassQuery(box) }),
  });

  if (RETRYABLE.has(response.status) && attempt < 4) {
    // The public instance hands out a small number of slots and expects a
    // client to wait for one rather than to hammer.
    const wait = 15_000 * 2 ** attempt;
    console.log(`\n    ${response.status} — waiting ${wait / 1000}s for a slot`);
    await sleep(wait);
    return fetchBox(box, attempt + 1);
  }
  if (!response.ok) {
    // Nothing has been written at this point, and nothing will be: the caller
    // fetches every region before touching the cache, so a failure here leaves
    // it exactly as it was rather than half rewritten.
    throw new Error(`Overpass returned ${response.status} ${response.statusText}`);
  }
  return parseOverpassResponse(await response.json());
}

async function main() {
  const segments = await prisma.roadSegment.findMany({
    where: { source: 'MAPBOX' },
    select: { minLat: true, maxLat: true, minLon: true, maxLon: true, geometry: true },
  });
  if (segments.length === 0) {
    console.log('No driven roads yet — nothing to query.');
    return;
  }

  const boxes = drivenBoundingBoxes(segments);
  console.log(`driven road rows: ${segments.length}`);
  console.log(`regions to query: ${boxes.length}`);
  for (const box of boxes) {
    console.log(`  ${box.minLat.toFixed(4)},${box.minLon.toFixed(4)} .. ${box.maxLat.toFixed(4)},${box.maxLon.toFixed(4)}` +
      `  (${areaKm2(box).toFixed(0)} km2)`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing fetched, nothing written.');
    console.log('Re-run with --apply to query Overpass and cache the result:');
    console.log('  npx tsx scripts/import-osm-signals.ts --apply');
    return;
  }

  // Fetch everything before writing anything: a rate limit partway through
  // should leave the cache exactly as it was.
  const nodes: OsmNode[] = [];
  for (const [index, box] of boxes.entries()) {
    // Overpass asks for one request at a time from a given client.
    if (index > 0) await sleep(5_000);
    process.stdout.write(`  querying region ${index + 1}/${boxes.length}... `);
    const found = await fetchBox(box);
    console.log(`${found.length} nodes`);
    nodes.push(...found);
  }

  const unique = new Map(nodes.map((node) => [node.osmNodeId, node]));
  const fetchedAt = new Date();

  // Which controls sit on ground we actually drive. Done here, where the driven
  // geometry is already loaded, so nothing has to sweep it per request.
  const lines = segments
    .map((segment) => segment.geometry as unknown as GeoJSON.LineString)
    .filter((geometry) => (geometry?.coordinates?.length ?? 0) >= 2)
    .map((geometry) => turf.lineString(geometry.coordinates));
  const onRoute = (node: OsmNode) => {
    const point = turf.point([node.longitude, node.latitude]);
    return lines.some((line) =>
      Number(turf.nearestPointOnLine(line, point, { units: 'meters' }).properties.dist) <= ON_ROUTE_METERS);
  };

  let created = 0;
  let updated = 0;

  for (const node of Array.from(unique.values())) {
    const data = {
      latitude: node.latitude,
      longitude: node.longitude,
      highway: node.highway,
      direction: node.direction,
      tags: node.tags,
      onDrivenRoad: onRoute(node),
      fetchedAt,
    };
    const result = await prisma.osmSignal.upsert({
      where: { osmNodeId: BigInt(node.osmNodeId) },
      create: { osmNodeId: BigInt(node.osmNodeId), ...data },
      update: data,
      select: { createdAt: true, updatedAt: true },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
  }

  const byHighway = new Map<string, number>();
  for (const node of Array.from(unique.values())) {
    byHighway.set(node.highway, (byHighway.get(node.highway) ?? 0) + 1);
  }

  const driven = await prisma.osmSignal.count({ where: { onDrivenRoad: true } });
  console.log(`\nCached ${unique.size} nodes: ${created} new, ${updated} refreshed.`);
  console.log(`  on roads we have driven: ${driven}`);
  for (const [highway, count] of Array.from(byHighway.entries())) {
    console.log(`  ${highway}: ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
