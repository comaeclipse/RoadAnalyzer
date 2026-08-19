/**
 * Cross-check imported OSM controls against what we learned by driving.
 *
 * Read-only. Three questions:
 *
 *   1. Do the approaches the driver tagged RED_LIGHT sit at an OSM signal?
 *      Driver tags are the closest thing to ground truth here, so a
 *      disagreement in either direction is worth looking at.
 *   2. Which approaches have no control in OSM at all? Either the map is
 *      incomplete or we are clustering stops somewhere that is not a junction.
 *   3. Which controls on roads we drive have no approach? Those are the
 *      intersections we sail through -- invisible to a pipeline seeded by
 *      stops, and the reason this import exists.
 *
 *   npx tsx scripts/osm-signal-coverage.ts
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import * as turf from '@turf/turf';
import { prisma } from '../lib/prisma';
import { analyzeIntersections, type AnalysisDrive } from '../lib/intersection-stops';
import { associateSignal, kindForHighwayTag, type OsmNode } from '../lib/osm-signals';

/** How near a control must be to a driven road to count as one we pass. */
const ON_ROUTE_METERS = 25;

async function main() {
  const signals: OsmNode[] = (await prisma.osmSignal.findMany({
    select: { osmNodeId: true, latitude: true, longitude: true, highway: true, direction: true, tags: true },
  })).map((row) => ({
    osmNodeId: Number(row.osmNodeId),
    latitude: row.latitude,
    longitude: row.longitude,
    highway: row.highway,
    direction: row.direction,
    tags: row.tags as Record<string, string>,
  }));
  console.log(`cached controls: ${signals.length} ` +
    `(${signals.filter((s) => s.highway === 'traffic_signals').length} signals, ` +
    `${signals.filter((s) => s.highway === 'stop').length} stop signs)`);

  const drives = await prisma.drive.findMany({
    where: { status: 'COMPLETED', recordingMode: 'TRAFFIC' },
    select: {
      id: true, name: true, startTime: true,
      gpsData: {
        orderBy: { timestamp: 'asc' },
        select: {
          latitude: true, longitude: true, speed: true, timestamp: true,
          segmentMatches: { take: 1, select: { segment: { select: { name: true } } } },
        },
      },
      trafficTags: { select: { latitude: true, longitude: true, kind: true, startTime: true, note: true } },
    },
  });

  const analysisDrives: AnalysisDrive[] = drives
    .filter((drive) => drive.gpsData.length >= 2)
    .map((drive) => ({
      id: drive.id,
      name: drive.name,
      startTime: drive.startTime.toISOString(),
      points: drive.gpsData.map((point) => ({
        lat: point.latitude, lng: point.longitude, speed: point.speed,
        timestamp: Number(point.timestamp),
        roadName: point.segmentMatches[0]?.segment.name ?? null,
      })),
      tags: drive.trafficTags.map((tag) => {
        const match = /approach=(\d+(?:\.\d+)?)/.exec(tag.note ?? '');
        return {
          lat: tag.latitude, lng: tag.longitude, kind: tag.kind,
          bearing: match ? Number(match[1]) : null,
          timestamp: tag.startTime.getTime(),
        };
      }),
    }));

  const approaches = analyzeIntersections(analysisDrives).filter((approach) => approach.passes >= 3);
  console.log(`approaches (seen 3+ times): ${approaches.length}`);

  let matched = 0;
  const agreements: string[] = [];
  const disagreements: string[] = [];
  const usedNodes = new Set<number>();

  for (const approach of approaches) {
    const found = associateSignal(approach, signals);
    const label = `${approach.roadName ?? 'unnamed'} ${approach.direction}`;
    if (found) {
      matched++;
      usedNodes.add(found.signal.osmNodeId);
      const osmKind = kindForHighwayTag(found.signal.highway);
      const line = `  ${label.padEnd(42)} driver=${approach.kind.padEnd(13)} osm=${osmKind} @ ${Math.round(found.distance)} m`;
      if (approach.kind === 'UNCLASSIFIED' || approach.kind === osmKind) agreements.push(line);
      else disagreements.push(line);
    } else {
      disagreements.push(`  ${label.padEnd(42)} driver=${approach.kind.padEnd(13)} osm=none`);
    }
  }

  console.log(`\napproaches with an OSM control ahead: ${matched} of ${approaches.length}`);
  console.log('\nagreeing, or OSM labelling something the driver never tagged:');
  agreements.forEach((line) => console.log(line));
  console.log('\ndisagreeing, or with nothing in OSM:');
  disagreements.forEach((line) => console.log(line));

  // Controls on roads we drive that never produced an approach: the coverage
  // gap this import exists to close.
  const segments = await prisma.roadSegment.findMany({
    where: { source: 'MAPBOX' },
    select: { name: true, geometry: true },
  });
  const lines = segments
    .map((segment) => segment.geometry as unknown as GeoJSON.LineString)
    .filter((geometry) => geometry?.coordinates?.length >= 2)
    .map((geometry) => turf.lineString(geometry.coordinates));

  const onRoute = signals.filter((signal) => {
    const point = turf.point([signal.longitude, signal.latitude]);
    return lines.some((line) =>
      Number(turf.nearestPointOnLine(line, point, { units: 'meters' }).properties.dist) <= ON_ROUTE_METERS);
  });
  const neverStopped = onRoute.filter((signal) => !usedNodes.has(signal.osmNodeId));

  console.log(`\ncontrols on roads we have driven: ${onRoute.length}`);
  console.log(`  of those, never associated with an approach: ${neverStopped.length}`);
  console.log(`  by type: ` + Array.from(
    neverStopped.reduce((counts, signal) => counts.set(signal.highway, (counts.get(signal.highway) ?? 0) + 1), new Map<string, number>())
  ).map(([highway, count]) => `${highway}=${count}`).join(' '));
  console.log('  these are the junctions we pass without stopping — invisible to a');
  console.log('  pipeline seeded by stop events, which is the point of the import.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
