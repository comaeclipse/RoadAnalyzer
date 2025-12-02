import { prisma } from '../lib/prisma';

async function analyzeData() {
  console.log('🔍 Analyzing RoadAnalyzer Database...\n');

  // Get all drives
  const drives = await prisma.drive.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          accelerometerData: true,
          gpsData: true,
        },
      },
    },
  });

  console.log(`📊 TOTAL DRIVES: ${drives.length}\n`);

  if (drives.length === 0) {
    console.log('No drives recorded yet.');
    return;
  }

  // Calculate aggregate statistics
  const completedDrives = drives.filter(d => d.status === 'COMPLETED');
  const recordingDrives = drives.filter(d => d.status === 'RECORDING');
  const failedDrives = drives.filter(d => d.status === 'FAILED');

  console.log(`✅ Completed: ${completedDrives.length}`);
  console.log(`🔴 Recording: ${recordingDrives.length}`);
  console.log(`❌ Failed: ${failedDrives.length}\n`);

  // Aggregate statistics for completed drives
  if (completedDrives.length > 0) {
    const totalDistance = completedDrives.reduce((sum, d) => sum + (d.distance || 0), 0);
    const totalDuration = completedDrives.reduce((sum, d) => sum + (d.duration || 0), 0);
    const avgQuality = completedDrives
      .filter(d => d.roughnessScore !== null)
      .reduce((sum, d) => sum + (d.roughnessScore || 0), 0) / completedDrives.filter(d => d.roughnessScore !== null).length;

    const totalAccelSamples = completedDrives.reduce((sum, d) => sum + d._count.accelerometerData, 0);
    const totalGpsSamples = completedDrives.reduce((sum, d) => sum + d._count.gpsData, 0);

    console.log('📈 AGGREGATE STATISTICS (Completed Drives):');
    console.log(`   Total Distance: ${totalDistance.toFixed(2)} miles`);
    console.log(`   Total Duration: ${(totalDuration / 60).toFixed(1)} minutes`);
    console.log(`   Average Road Quality: ${avgQuality.toFixed(1)}/100`);
    console.log(`   Total Accelerometer Samples: ${totalAccelSamples.toLocaleString()}`);
    console.log(`   Total GPS Samples: ${totalGpsSamples.toLocaleString()}\n`);
  }

  // Analyze each drive
  console.log('🚗 INDIVIDUAL DRIVE ANALYSIS:\n');

  for (const drive of drives) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Drive ID: ${drive.id}`);
    console.log(`Name: ${drive.name || 'Unnamed'}`);
    console.log(`Status: ${drive.status}`);
    console.log(`Date: ${drive.createdAt.toLocaleString()}`);

    if (drive.status === 'COMPLETED') {
      console.log(`Duration: ${Math.floor((drive.duration || 0) / 60)}m ${(drive.duration || 0) % 60}s`);
      console.log(`Distance: ${(drive.distance || 0).toFixed(2)} miles`);
      console.log(`Max Speed: ${(drive.maxSpeed || 0).toFixed(1)} mph`);
      console.log(`Avg Speed: ${(drive.avgSpeed || 0).toFixed(1)} mph`);
      console.log(`Samples: ${drive._count.accelerometerData} accel, ${drive._count.gpsData} GPS`);

      if (drive.roughnessScore !== null) {
        console.log(`\n🛣️  Road Quality Score: ${drive.roughnessScore.toFixed(1)}/100`);

        if (drive.roughnessBreakdown) {
          const breakdown = drive.roughnessBreakdown as any;
          console.log(`   Breakdown:`);
          console.log(`   - Smooth: ${breakdown.smooth?.toFixed(1)}%`);
          console.log(`   - Light: ${breakdown.light?.toFixed(1)}%`);
          console.log(`   - Moderate: ${breakdown.moderate?.toFixed(1)}%`);
          console.log(`   - Rough: ${breakdown.rough?.toFixed(1)}%`);
          console.log(`   - Very Rough: ${breakdown.veryRough?.toFixed(1)}%`);
        }
      }

      // Get sample accelerometer data to analyze
      const accelSamples = await prisma.accelerometerSample.findMany({
        where: { driveId: drive.id },
        orderBy: { timestamp: 'asc' },
        take: 5,
      });

      const gpsSamples = await prisma.gpsSample.findMany({
        where: { driveId: drive.id },
        orderBy: { timestamp: 'asc' },
        take: 5,
      });

      if (accelSamples.length > 0) {
        console.log(`\n📊 Sample Accelerometer Data (first 5):`);
        accelSamples.forEach((sample, i) => {
          console.log(`   ${i + 1}. x:${sample.x.toFixed(2)} y:${sample.y.toFixed(2)} z:${sample.z.toFixed(2)} mag:${sample.magnitude.toFixed(2)}`);
        });
      }

      if (gpsSamples.length > 0) {
        console.log(`\n📍 Sample GPS Data (first 5):`);
        gpsSamples.forEach((sample, i) => {
          console.log(`   ${i + 1}. lat:${sample.latitude.toFixed(6)} lng:${sample.longitude.toFixed(6)} speed:${sample.speed?.toFixed(1) || 'null'} alt:${sample.altitude?.toFixed(1) || 'null'}`);
        });
      }

      // Analyze data quality
      console.log(`\n✨ Data Quality Analysis:`);
      const accelFrequency = drive.duration ? drive._count.accelerometerData / (drive.duration / 1000) : 0;
      const gpsFrequency = drive.duration ? drive._count.gpsData / (drive.duration / 1000) : 0;

      console.log(`   Accel frequency: ${accelFrequency.toFixed(2)} Hz (target: 10 Hz)`);
      console.log(`   GPS frequency: ${gpsFrequency.toFixed(2)} Hz (target: 1 Hz)`);

      // Check for GPS nulls
      const gpsNullCount = await prisma.gpsSample.count({
        where: {
          driveId: drive.id,
          OR: [
            { speed: null },
            { altitude: null },
            { accuracy: null },
          ],
        },
      });

      const gpsNullPercentage = drive._count.gpsData > 0 ? (gpsNullCount / drive._count.gpsData) * 100 : 0;
      console.log(`   GPS null values: ${gpsNullCount} samples (${gpsNullPercentage.toFixed(1)}%)`);

      // Check for stationary GPS points
      const stationaryPoints = await prisma.gpsSample.count({
        where: {
          driveId: drive.id,
          speed: 0,
        },
      });

      const movingPercentage = drive._count.gpsData > 0 ? ((drive._count.gpsData - stationaryPoints) / drive._count.gpsData) * 100 : 0;
      console.log(`   Moving samples: ${movingPercentage.toFixed(1)}% (${drive._count.gpsData - stationaryPoints}/${drive._count.gpsData})`);
    }

    console.log('');
  }

  await prisma.$disconnect();
}

analyzeData().catch(console.error);
