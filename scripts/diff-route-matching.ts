/**
 * Compare route assignment by edge sequence against route assignment by
 * geometry, over every drive already recorded.
 *
 * Swapping the matcher changes which template a drive belongs to, and a drive
 * silently moving between templates corrupts per-route statistics without
 * anything looking wrong. This prints both answers side by side so every
 * disagreement can be looked at before it is written.
 *
 * Dry-run by default. Pass --apply to write the sequence matcher's answers onto
 * the drives, which is only worth doing once every disagreement above has been
 * read and understood.
 *
 *   npx tsx scripts/diff-route-matching.ts
 *   npx tsx scripts/diff-route-matching.ts --threshold 0.6
 *   npx tsx scripts/diff-route-matching.ts --apply
 */

// Must come first: populates process.env before the Prisma client is evaluated.
import './load-env';

import { prisma } from '../lib/prisma';
import { routeSteps, routeSimilarity, routeLength, type MatchedSample } from '../lib/route-signature';
import {
  findMatchingRouteTemplate,
  matchRouteTemplate,
  ROUTE_MATCH_THRESHOLD,
  type TemplateSignature,
} from '../lib/route-template-matching';

const APPLY = process.argv.includes('--apply');
const thresholdArg = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdArg === -1 ? ROUTE_MATCH_THRESHOLD : Number(process.argv[thresholdArg + 1]);

async function stepsForDrive(driveId: string) {
  const rows = await prisma.gpsSegmentMatch.findMany({
    where: { gps: { driveId } },
    select: { segmentId: true, gps: { select: { timestamp: true, distanceFromPrev: true } } },
  });
  const samples: MatchedSample[] = rows.map((row) => ({
    segmentId: row.segmentId,
    timestamp: Number(row.gps.timestamp),
    distanceFromPrev: row.gps.distanceFromPrev,
  }));
  return routeSteps(samples);
}

async function main() {
  const templateRows = await prisma.routeTemplate.findMany({
    where: { isActive: true },
    select: { id: true, name: true, geometry: true, distance: true, direction: true, referenceDriveId: true },
  });

  const templates: (TemplateSignature & { name: string })[] = [];
  for (const row of templateRows) {
    templates.push({ ...row, steps: await stepsForDrive(row.referenceDriveId) });
  }
  const nameById = new Map(templates.map((template) => [template.id, template.name]));

  console.log(`threshold: ${THRESHOLD}`);
  console.log('templates:');
  for (const template of templates) {
    console.log(`  ${template.name}: ${template.steps.length} steps, ${Math.round(routeLength(template.steps))} m`);
  }

  const drives = await prisma.drive.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, routeTemplateId: true, distance: true,
      tripAnalysis: { select: { matchedGeometry: true, coverage: true, dominantDirection: true, matchedDistance: true } },
    },
  });

  let agree = 0;
  let newlyMatched = 0;
  let unmatched = 0;
  const disagreements: string[] = [];
  const reassign = new Map<string, string | null>();

  for (const drive of drives) {
    const analysis = drive.tripAnalysis;
    const geometry = analysis?.matchedGeometry as GeoJSON.LineString | null;
    if (!geometry || geometry.type !== 'LineString') continue;

    const steps = await stepsForDrive(drive.id);
    const distance = analysis?.matchedDistance ?? drive.distance ?? 0;
    const direction = analysis?.dominantDirection ?? null;

    const geometryId = findMatchingRouteTemplate(geometry, distance, direction, templates);
    const sequence = matchRouteTemplate({ steps, geometry, distance, direction }, templates);

    // Best score against every template, so a near miss is visible rather than
    // just absent.
    const scored = templates
      .map((template) => ({ name: template.name, ...routeSimilarity(steps, template.steps) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];

    const label = `${drive.startTime.toISOString().slice(0, 16).replace('T', ' ')} ${drive.id.slice(0, 8)}`;
    const target = sequence?.templateId ?? null;
    if (target !== drive.routeTemplateId) reassign.set(drive.id, target);
    const stored = drive.routeTemplateId ? nameById.get(drive.routeTemplateId) ?? '(inactive)' : 'none';
    const byGeometry = geometryId ? nameById.get(geometryId) ?? '(inactive)' : 'none';
    const bySequence = sequence ? nameById.get(sequence.templateId) ?? '(inactive)' : 'none';

    if (byGeometry === bySequence) {
      agree++;
    } else if (byGeometry === 'none') {
      newlyMatched++;
      disagreements.push(`  ${label}  stored=${stored}  geometry=none  sequence=${bySequence} (${best.score.toFixed(2)})`);
    } else if (bySequence === 'none') {
      unmatched++;
      const divergence = best.divergence ? ` diverges at step ${best.divergence.at}` : '';
      disagreements.push(`  ${label}  stored=${stored}  geometry=${byGeometry}  sequence=none (best ${best.name} ${best.score.toFixed(2)}${divergence})`);
    } else {
      disagreements.push(`  ${label}  stored=${stored}  geometry=${byGeometry}  sequence=${bySequence} (${best.score.toFixed(2)})  *** MOVED ***`);
    }

    const runnerUp = scored[1];
    console.log(`${label}  steps=${String(steps.length).padStart(3)}  dir=${(direction ?? '-').padEnd(5)}  ` +
      `best=${best.name} ${best.score.toFixed(2)}  next=${runnerUp ? runnerUp.name + ' ' + runnerUp.score.toFixed(2) : '-'}  ` +
      `stored=${stored}  seq=${bySequence}`);
  }

  console.log(`\nagree: ${agree}`);
  console.log(`geometry found nothing, sequence did: ${newlyMatched}`);
  console.log(`geometry matched, sequence refused: ${unmatched}`);
  console.log(`disagreements:`);
  disagreements.forEach((line) => console.log(line));

  console.log(`\ndrives whose stored assignment would change: ${reassign.size}`);
  for (const [driveId, templateId] of Array.from(reassign.entries())) {
    console.log(`  ${driveId.slice(0, 8)} -> ${templateId ? nameById.get(templateId) ?? templateId : 'none'}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    if (reassign.size) {
      console.log('Re-run with --apply to store the sequence matcher\'s answers:');
      console.log('  npx tsx scripts/diff-route-matching.ts --apply');
    }
    return;
  }

  for (const [driveId, routeTemplateId] of Array.from(reassign.entries())) {
    await prisma.drive.update({ where: { id: driveId }, data: { routeTemplateId } });
  }
  console.log(`\nApplied to ${reassign.size} drive(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
