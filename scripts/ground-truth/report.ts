/**
 * Print how accurate the delay estimates are against a labelled corpus.
 *
 * The committed baseline in lib/intersection-delay-accuracy.test.ts comes from
 * this. Run it after changing anything in lib/intersection-stops.ts to see
 * which way the numbers moved.
 *
 *   npx tsx scripts/ground-truth/report.ts
 *   npx tsx scripts/ground-truth/report.ts 2000
 */
import { generateCorpus, measureDelayAccuracy } from '../../lib/ground-truth';

const count = Number(process.argv[2] ?? 500);
const missingArg = process.argv.indexOf('--missing');
const missingSpeedRate = missingArg === -1 ? undefined : Number(process.argv[missingArg + 1]);
const report = measureDelayAccuracy(generateCorpus(count, missingSpeedRate == null ? {} : { missingSpeedRate }));

if (missingSpeedRate != null) console.log(`missing-speed rate: ${missingSpeedRate}`);

console.log(`scenarios: ${report.scenarios}`);
console.log(`detectable (true stop over the 2 s floor): ${report.detectable}`);
console.log(`detected: ${report.detected} (${(100 * report.detected / report.detectable).toFixed(1)}%)`);
console.log(`false positives: ${report.falsePositives}`);
console.log(`median abs error: ${report.medianAbsError.toFixed(2)} s`);
console.log(`p90 abs error:    ${report.p90AbsError.toFixed(2)} s`);
console.log(`max abs error:    ${report.maxAbsError.toFixed(2)} s`);
console.log(`bias:             ${report.bias >= 0 ? '+' : ''}${report.bias.toFixed(2)} s`);
console.log(`median abs error vs control delay: ${report.medianAbsErrorVsControlDelay.toFixed(2)} s`);
console.log('\nby scenario class:');
for (const [label, bucket] of Object.entries(report.byClass)) {
  console.log(`  ${label.padEnd(16)} n=${String(bucket.scenarios).padStart(4)}  detected=${String(bucket.detected).padStart(4)}  ` +
    `median abs error=${Number.isNaN(bucket.medianAbsError) ? '-' : bucket.medianAbsError.toFixed(2) + ' s'}`);
}

console.log('\nqueue-versus-signal confound:');
console.log(`  detected stops: ${report.confound.detectedStops}`);
console.log(`  caused by the queue alone, on green: ${report.confound.causedByQueueAlone} ` +
  `(${(100 * report.confound.fraction).toFixed(1)}%)`);
console.log(`  median delay when the queue alone caused it: ${report.confound.medianQueueOnlyDelay.toFixed(1)} s`);
console.log(`  median delay when the signal caused it:      ${report.confound.medianSignalDelay.toFixed(1)} s`);
console.log(`  share of all measured delay: ${(100 * report.confound.shareOfDelay).toFixed(1)}%`);
console.log('  the pipeline reports both identically.');
