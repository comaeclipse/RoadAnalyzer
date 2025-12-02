# Accelerometer Sample Rate Increase: 5 Hz → 10 Hz

**Date**: December 2, 2025
**Change**: Increased accelerometer sampling rate from 5 Hz to 10 Hz

---

## What Changed

### Configuration Updates
- `ACCELEROMETER_INTERVAL`: 200ms → 100ms (lib/constants.ts)
- `ACCEL_BUFFER_THRESHOLD`: 50 samples → 100 samples (RecordingProvider.tsx)
- Buffer flush timing: Still every 10 seconds (unchanged)

### Expected Improvements

**Better Detection:**
- ✅ **Nyquist frequency**: 2.5 Hz → 5 Hz (2× improvement)
- ✅ **Rapid bumps**: Now detectable up to 5 Hz (previously 2.5 Hz)
- ✅ **Waveform detail**: 2× more samples per road feature
- ✅ **Speed bumps**: Better characterization at highway speeds
- ✅ **Consecutive bumps**: Less likely to miss in rapid sequences

**What We Can Now Capture:**
| Feature | Frequency | 5 Hz Status | 10 Hz Status |
|---------|-----------|-------------|--------------|
| Potholes | 0.5-2 Hz | ✅ Good | ✅ Excellent |
| Speed bumps | 1-3 Hz | ✅ Good | ✅ Excellent |
| Suspension oscillations | 1-3 Hz | ✅ Good | ✅ Excellent |
| General roughness | 2-8 Hz | ⚠️ Partial | ✅ Good |
| Small bumps at speed | 5-10 Hz | ❌ Missed | ⚠️ Partial |
| Tire vibrations | 10-30 Hz | ❌ Missed | ❌ Missed |

---

## Trade-offs

### Costs (Increased):
- **Data per drive**: ~28 KB → ~56 KB (2× increase)
- **Database storage**: 1.8 MB/hour → 3.2 MB/hour
- **Network bandwidth**: 2× more data to upload
- **Battery usage**: Slightly higher (~5-10% more processing)
- **Monthly storage (20 drives)**: 18 MB → 32 MB

### Benefits (Gained):
- **Better bump detection**: Won't miss rapid consecutive bumps
- **More accurate roughness**: 2× detail in waveform analysis
- **Highway performance**: Better capture at 60+ mph speeds
- **Statistical confidence**: More samples = more reliable std dev
- **Future-proofing**: Ready for advanced analysis features

---

## Impact on Existing Data

**Backward compatibility**: ✅ Fully compatible
- Old drives (5 Hz) remain valid
- Roughness algorithm works with both rates
- No database migration needed

**Comparing old vs new drives:**
- Expect similar roughness scores on same roads
- New drives may show slightly more detail in breakdowns
- Rolling window (15 samples) now covers 1.5s instead of 3s

---

## What to Test

### Immediate Testing Checklist:

1. **Record a short test drive (30-60 seconds)**
   - Verify data is collected at ~10 Hz
   - Check buffer status shows ~100 samples before flush
   - Monitor battery and performance

2. **Compare with existing data**
   - Drive same route as previous recording
   - Compare roughness scores
   - Look for more detailed breakdown

3. **Check data quality**
   - Run `npm run analyze-data`
   - Verify accel frequency shows ~10 Hz
   - Confirm no dropped samples

4. **Monitor network/storage**
   - Check API payload sizes (~12 KB vs 6 KB)
   - Verify flush timing still ~10 seconds
   - Confirm database growth rate

### Expected Results:

**Same road should show:**
- Similar overall roughness score (±5 points)
- More granular breakdown percentages
- Possible detection of features missed at 5 Hz

**Data frequency check:**
```bash
npm run analyze-data
# Look for: "Accel frequency: ~10.00 Hz (target: 10 Hz)"
```

---

## Rolling Back (If Needed)

If 10 Hz causes issues (battery drain, data costs, etc.), revert with:

```typescript
// lib/constants.ts
ACCELEROMETER_INTERVAL: 200, // Back to 5 Hz

// RecordingProvider.tsx
const ACCEL_BUFFER_THRESHOLD = 50; // Back to 5 Hz buffer
```

---

## Technical Details

### Sampling Theory

**5 Hz sampling:**
```
Sample rate: 5 Hz
Nyquist: 2.5 Hz
Can detect: 0-2.5 Hz vibrations
Rolling window: 15 samples = 3.0 seconds
```

**10 Hz sampling:**
```
Sample rate: 10 Hz
Nyquist: 5 Hz
Can detect: 0-5 Hz vibrations
Rolling window: 15 samples = 1.5 seconds
```

### Data Size Math

**Per minute of recording:**
```
5 Hz:  300 samples × ~80 bytes = 24 KB/min
10 Hz: 600 samples × ~80 bytes = 48 KB/min
```

**10-second flush:**
```
5 Hz:  50 samples × ~80 bytes = 4 KB per flush
10 Hz: 100 samples × ~80 bytes = 8 KB per flush
```

### Buffer Behavior

**Before (5 Hz):**
- Collect 50 samples
- Wait ~10 seconds
- Send 4 KB payload
- Repeat

**After (10 Hz):**
- Collect 100 samples
- Wait ~10 seconds
- Send 8 KB payload
- Repeat

**Network requests**: Same frequency (every 10s), just larger payloads

---

## Next Steps

### Short-term (This Week):
1. Record several test drives with different road types
2. Compare roughness scores vs historical data
3. Monitor app performance and battery usage
4. Check for any issues with data transmission

### Medium-term (Next Month):
1. Analyze score distribution differences
2. Update roughness algorithm if needed
3. Consider adaptive sampling (burst to 10 Hz on rough roads only)
4. Evaluate if further increase to 20 Hz is beneficial

### Long-term:
1. A/B test with users: 5 Hz vs 10 Hz
2. Machine learning on higher resolution data
3. Individual pothole detection and GPS tagging
4. Heatmap of specific hazards, not just general roughness

---

## Questions to Answer with Real Data

After collecting several drives at 10 Hz:

1. **Did roughness scores change significantly?**
   - Expected: ±5 point variation on same roads
   - If > 10 point difference, investigate

2. **Are we detecting more bumps?**
   - Compare "moderate" and "rough" percentages
   - Should see increase if roads have rapid features

3. **Is data quality better?**
   - Check standard deviation of repeat measurements
   - Lower variation = better consistency

4. **Are there performance issues?**
   - Battery drain acceptable?
   - Data transmission reliable?
   - App still responsive?

---

## Success Criteria

Consider 10 Hz successful if:
- ✅ Roughness scores remain stable for known roads (±5 points)
- ✅ Better detection of rapid bump sequences
- ✅ No significant battery or performance issues
- ✅ Data transmission remains reliable
- ✅ Users report improved accuracy

Consider reverting to 5 Hz if:
- ❌ Battery drain complaints
- ❌ Data transmission failures
- ❌ Scores become erratic/unstable
- ❌ Database fills up too quickly

---

## Documentation Updates

Updated files:
- ✅ `lib/constants.ts` - Accelerometer interval
- ✅ `components/providers/RecordingProvider.tsx` - Buffer threshold
- ✅ `TODO.md` - Storage estimates and architecture docs
- ✅ `scripts/analyze-data.ts` - Target frequency in analysis
- ✅ `SENSOR_ANALYSIS.md` - Technical analysis reference
- ✅ `CHANGELOG_10HZ.md` - This document

---

## References

- **Nyquist-Shannon Sampling Theorem**: Sample rate must be 2× highest frequency
- **Road vibration frequencies**: Most features 1-10 Hz
- **Professional systems**: Typically 50-500 Hz for engineering analysis
- **Smartphone surveys**: Usually 5-20 Hz for crowdsourcing

---

**Status**: ✅ Ready to test
**Risk level**: Low (easy to revert)
**Recommended action**: Deploy and monitor for 1 week

*Changelog created December 2, 2025*
