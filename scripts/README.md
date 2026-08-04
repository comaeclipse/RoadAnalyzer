# RoadAnalyzer Scripts

This directory contains utility scripts for database management and analysis.

## Available Scripts

### 1. `backfill-roughness.ts`

**Purpose**: Calculates and updates roughness scores for drives that don't have them.

This is useful when:
- You've added the roughness analysis feature after recording some drives
- Database migration removed roughness data
- You want to recalculate scores with updated algorithm

**Usage**:
```bash
npm run backfill-roughness
```

**What it does**:
1. Finds all completed drives with `roughnessScore: null`
2. Fetches accelerometer data for each drive
3. Applies the roughness analysis algorithm (rolling standard deviation on Z-axis)
4. Updates the drive with:
   - `roughnessScore` (0-100, where 100 = smoothest)
   - `roughnessBreakdown` (percentages for smooth/light/moderate/rough/veryRough)

**Output**:
```
🔍 Finding drives without roughness scores...

Found 10 drives without roughness scores.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Processing: Drive 12/1/2025, 4:26:21 PM
Date: 12/1/2025, 4:26:21 PM
Duration: 28s
Samples: 142 accelerometer readings

📊 Roughness Analysis:
   Score: 95/100
   Breakdown:
   - Smooth: 79%
   - Light: 21%
   - Moderate: 0%
   - Rough: 0%
   - Very Rough: 0%
   Avg Roughness: 0.447
   Max Roughness: 0.819
✅ Updated successfully!

...

📈 SUMMARY
Total drives processed: 10
✅ Successful: 10
❌ Failed: 0
```

**Error Handling**:
- Skips drives with no accelerometer data
- Skips drives with insufficient samples (< 15)
- Reports failures but continues processing other drives

---

### 2. `analyze-data.ts`

**Purpose**: Comprehensive analysis of all recorded drives and sensor data.

**Usage**:
```bash
npm run analyze-data
```

**What it does**:
1. Fetches all drives from the database
2. Calculates aggregate statistics
3. Analyzes each drive individually
4. Assesses data quality (GPS accuracy, sample rates, etc.)
5. Examines sample sensor data

**Output Includes**:
- Total drives, samples, distance, duration
- Drive status breakdown (COMPLETED/RECORDING/FAILED)
- Average road quality scores
- Individual drive analysis:
  - Duration, distance, speeds
  - Road quality score and breakdown
  - Sample accelerometer and GPS data
  - Data quality metrics (sample frequency, null values, moving vs stationary)

**Example Output**:
```
📊 TOTAL DRIVES: 30

✅ Completed: 30
🔴 Recording: 0
❌ Failed: 0

📈 AGGREGATE STATISTICS (Completed Drives):
   Total Distance: 17.02 miles
   Total Duration: 26.7 minutes
   Average Road Quality: 77.8/100
   Total Accelerometer Samples: 8,200
   Total GPS Samples: 1,600

🚗 INDIVIDUAL DRIVE ANALYSIS:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Drive ID: cminx5r6e01erjl040axrpzx2
Name: Drive 12/1/2025, 7:48:29 PM
Status: COMPLETED
Duration: 3m 31s
Distance: 2.57 miles
Max Speed: 53.5 mph
Avg Speed: 43.3 mph

🛣️  Road Quality Score: 87.0/100
   Breakdown:
   - Smooth: 52.0%
   - Light: 44.0%
   - Moderate: 4.0%
   - Rough: 0.0%
   - Very Rough: 0.0%

✨ Data Quality Analysis:
   Accel frequency: 5.12 Hz (target: 5 Hz)
   GPS frequency: 1.01 Hz (target: 1 Hz)
   GPS null values: 0 samples (0.0%)
   Moving samples: 98.5%
```

---

### 3. `rebuild-segment-stats.ts`

**Purpose**: Recomputes the entire `SegmentStatistics` table from the `CongestionEvent` rows that actually exist.

`SegmentStatistics` is a pre-aggregated (materialized view) table that the live pipeline maintains **incrementally** — `eventCount` and `totalDuration` are written with Prisma's `increment`, so they only ever grow. Nothing ever subtracts. This means:

- **Deleting drives leaves their contributions permanently baked in.** Cascade deletes remove the `CongestionEvent` rows but cannot touch the aggregates derived from them.
- **The percentage and score columns disagree with the counts.** `pctFreeFlow`, `congestionScore`, etc. are *overwritten* by whichever drive last touched a segment, so they describe a single drive while `eventCount` describes all of them.

This script fixes both by discarding the table and rebuilding it, using the same
`aggregateSegmentStatistics()` function the live pipeline uses — so the two cannot drift.

**Usage**:
```bash
npm run rebuild-segment-stats
```

Dry run by default: it prints the diff and writes nothing. To actually rebuild:

```bash
npm run rebuild-segment-stats -- --apply
```

**What it does**:
1. Loads every `CongestionEvent` in the database (these cascade with their drive, so they are by definition current)
2. Aggregates them into the five time windows: all-time, per day-of-week, per hour, per day+hour, and per week
3. Diffs the result against the stored rows and reports removed / corrected / added / unchanged
4. With `--apply`, replaces the table inside a single transaction and verifies the final row count

**When to run it**:
- After deleting any drives
- After noticing `eventCount` that looks too high for the number of drives on record
- Any time the aggregates need to be trusted

**Output**:
```
🔄 Rebuilding segment statistics from congestion events

🔍 MODE: DRY RUN (no changes)

Congestion events found:      40
SegmentStatistics rows now:   114
SegmentStatistics rows after: 106

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DIFF
   Removed (no events left):  8
   Corrected (stale totals):  1
   Added (missing window):    0
   Unchanged:                 105
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✏️  Corrected rows:
   New Warrington Blvd [all-time] — events 11 → 5, duration 744s → 312s
```

**Notes**:
- `sampleCount` is left at `0`. The live pipeline never populates it either, and it counts GPS samples rather than congestion events, so there is no honest value to derive from `CongestionEvent` rows alone.
- Week buckets are computed in **UTC** (`getWeekStart` in `lib/post-processing.ts`). The deployment runs in UTC, so every stored `weekStart` is UTC midnight; using local-time methods on a developer machine would produce a second, offset set of weekly rows for the same weeks.

---

### `load-env.ts` (helper, not a script)

Side-effect module that loads `.env` into `process.env`. Next.js does this automatically for the app, but standalone `tsx` scripts get no such help, and `dotenv` is only present transitively via Prisma rather than declared in `package.json`.

Import it **first**, before anything that reads `process.env` at module scope:

```ts
import './load-env';
import { prisma } from '../lib/prisma';
```

ES module imports are hoisted, so calling a loader *function* inline would not reliably run before the Prisma import is evaluated. Imported modules are evaluated in source order, which is the guarantee this relies on.

> `backfill-roughness.ts` and `analyze-data.ts` do **not** import it yet and will fail with
> `Environment variable not found: DATABASE_URL` when run outside Next.js.

---

## Running Scripts Manually

If you prefer to run the scripts directly with `tsx`:

```bash
# Backfill roughness scores
npx tsx scripts/backfill-roughness.ts

# Analyze data
npx tsx scripts/analyze-data.ts

# Rebuild segment statistics (dry run)
npx tsx scripts/rebuild-segment-stats.ts

# Rebuild segment statistics (write)
npx tsx scripts/rebuild-segment-stats.ts --apply
```

> **Note**: `tsx` is referenced by these npm scripts but is not currently listed in
> `package.json` dependencies, so `npm run <script>` fails with
> `'tsx' is not recognized`. Use `npx tsx ...` until it is added as a devDependency.

## Requirements

- `.env` file with `DATABASE_URL` configured
- Prisma client generated (`npx prisma generate`)
- Node.js and npm installed

## Algorithm Details

### Roughness Analysis Algorithm

The roughness score is calculated using a **rolling standard deviation** of the Z-axis (vertical) acceleration:

1. **Window**: 15 samples (~3 seconds at 5 Hz)
2. **Metric**: Standard deviation of Z acceleration within window
3. **Categories**:
   - **Smooth**: < 0.5 std dev (100 points)
   - **Light**: 0.5-1.5 std dev (75 points)
   - **Moderate**: 1.5-3.0 std dev (50 points)
   - **Rough**: 3.0-5.0 std dev (25 points)
   - **Very Rough**: > 5.0 std dev (0 points)

4. **Scoring**: Weighted average of category percentages
   ```
   score = (smooth% × 100 + light% × 75 + moderate% × 50 + rough% × 25 + veryRough% × 0) / 100
   ```

**Example**:
- 52% smooth, 44% light, 4% moderate = (52×100 + 44×75 + 4×50) / 100 = 87/100

### Why Z-axis?

Vertical acceleration is the primary indicator of road roughness:
- Bumps, potholes → sudden Z-axis spikes
- Smooth roads → low Z-axis variation
- X and Y axes measure lateral movement (turns, swerving)

---

## Troubleshooting

### "Prisma Client not initialized"
```bash
npx prisma generate
```

### "Environment variable not found: DATABASE_URL"
Create a `.env` file with your database connection string:
```env
DATABASE_URL=postgresql://user:pass@host/db
```

### "No drives without roughness scores"
All drives already have scores! The backfill script only processes drives where `roughnessScore IS NULL`.

### "Not enough data for roughness analysis"
Drive needs at least 15 accelerometer samples for the rolling window algorithm to work. Very short drives (< 3 seconds) may not have enough data.

---

## Adding New Scripts

To add a new utility script:

1. Create `scripts/your-script.ts`
2. Import Prisma client: `import { prisma } from '../lib/prisma'`
3. Add script to `package.json`:
   ```json
   "scripts": {
     "your-script": "tsx scripts/your-script.ts"
   }
   ```
4. Document it in this README

---

## Best Practices

- **Always test on development database first**
- **Backup production data before running bulk updates**
- **Check script output for errors before assuming success**
- **Use `--dry-run` flags for destructive operations** (add this feature to scripts)

---

*Generated for RoadAnalyzer v0.1.0*
