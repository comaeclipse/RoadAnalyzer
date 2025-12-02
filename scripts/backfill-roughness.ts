/**
 * Backfill Roughness Scores
 *
 * This script analyzes drives that are missing roughness scores and calculates them
 * based on their accelerometer data. Useful for drives recorded before the roughness
 * feature was implemented.
 */

import { prisma } from '../lib/prisma';
import { analyzeRoughness, type AccelSample } from '../lib/roughness';

async function backfillRoughnessScores() {
  console.log('🔍 Finding drives without roughness scores...\n');

  // Find all drives that don't have roughness scores
  const drivesWithoutRoughness = await prisma.drive.findMany({
    where: {
      roughnessScore: null,
      status: 'COMPLETED', // Only process completed drives
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`Found ${drivesWithoutRoughness.length} drives without roughness scores.\n`);

  if (drivesWithoutRoughness.length === 0) {
    console.log('✅ All drives already have roughness scores!');
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const drive of drivesWithoutRoughness) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Processing: ${drive.name || drive.id}`);
    console.log(`Date: ${drive.createdAt.toLocaleString()}`);
    console.log(`Duration: ${drive.duration ? Math.floor(drive.duration / 1000) : 0}s`);

    try {
      // Fetch accelerometer data for this drive
      const accelData = await prisma.accelerometerSample.findMany({
        where: {
          driveId: drive.id,
        },
        orderBy: {
          timestamp: 'asc',
        },
        select: {
          x: true,
          y: true,
          z: true,
          timestamp: true,
        },
      });

      console.log(`Samples: ${accelData.length} accelerometer readings`);

      if (accelData.length === 0) {
        console.log('⚠️  No accelerometer data found - skipping');
        failureCount++;
        continue;
      }

      // Convert to AccelSample format
      const samples: AccelSample[] = accelData.map((sample) => ({
        x: sample.x,
        y: sample.y,
        z: sample.z,
        timestamp: Number(sample.timestamp),
      }));

      // Analyze roughness
      const result = analyzeRoughness(samples);

      if (!result) {
        console.log('⚠️  Not enough data for roughness analysis (need at least 15 samples)');
        failureCount++;
        continue;
      }

      console.log(`\n📊 Roughness Analysis:`);
      console.log(`   Score: ${result.score}/100`);
      console.log(`   Breakdown:`);
      console.log(`   - Smooth: ${result.breakdown.smooth}%`);
      console.log(`   - Light: ${result.breakdown.light}%`);
      console.log(`   - Moderate: ${result.breakdown.moderate}%`);
      console.log(`   - Rough: ${result.breakdown.rough}%`);
      console.log(`   - Very Rough: ${result.breakdown.veryRough}%`);
      console.log(`   Avg Roughness: ${result.avgRoughness.toFixed(3)}`);
      console.log(`   Max Roughness: ${result.maxRoughness.toFixed(3)}`);

      // Update the drive with roughness data
      await prisma.drive.update({
        where: {
          id: drive.id,
        },
        data: {
          roughnessScore: result.score,
          roughnessBreakdown: {
            smooth: result.breakdown.smooth,
            light: result.breakdown.light,
            moderate: result.breakdown.moderate,
            rough: result.breakdown.rough,
            veryRough: result.breakdown.veryRough,
          },
        },
      });

      console.log(`✅ Updated successfully!`);
      successCount++;
    } catch (error) {
      console.error(`❌ Error processing drive: ${error}`);
      failureCount++;
    }

    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📈 SUMMARY');
  console.log(`Total drives processed: ${drivesWithoutRoughness.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);

  if (successCount > 0) {
    console.log('\n🎉 Roughness scores have been backfilled!');
    console.log('You can now view the updated scores on the /recordings page.');
  }
}

// Run the script
backfillRoughnessScores()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
