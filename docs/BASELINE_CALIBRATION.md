# Sensor Baseline Calibration

## Overview

The Baseline Calibration feature analyzes your device's accelerometer when completely stationary to establish a noise floor and sensor bias baseline. This improves the accuracy of road roughness detection by filtering out sensor-specific noise.

## What It Does

### Measurements Collected

When you record a baseline, the system measures:

1. **Accelerometer Mean Values** (X, Y, Z axes)
   - X-axis (lateral): Should be ~0 m/s²
   - Y-axis (longitudinal): Should be ~0 m/s²
   - Z-axis (vertical): Should be ~9.8 m/s² (gravity)

2. **Standard Deviation** (Noise Level)
   - Variation in each axis when device is still
   - Lower = better sensor quality

3. **Sensor Bias**
   - Systematic error in measurements
   - Deviation from expected values

4. **Overall Stability**
   - Classified as: Excellent, Good, Fair, or Poor
   - Based on noise magnitude

### Quality Assessment

The system calculates a **Quality Score (0-100)** based on:
- Noise level (lower is better)
- Gravity measurement accuracy
- Recording duration
- Sample count

**Score Interpretation:**
- **90-100**: Excellent - Sensor performing optimally
- **75-89**: Good - Acceptable for accurate measurements
- **60-74**: Fair - May need better surface or longer recording
- **0-59**: Poor - Retry with improved conditions

---

## How to Use

### Step 1: Prepare Setup

1. Find a flat, hard, stable surface:
   - ✅ Good: Wooden table, stone countertop, floor
   - ❌ Bad: Bed, couch, car dashboard, unstable table

2. Ensure surface is level:
   - Use a bubble level if available
   - Check that device doesn't tilt

3. Choose quiet location:
   - Away from appliances (fridge, washing machine)
   - No foot traffic
   - No vibrations

### Step 2: Record Baseline

1. Navigate to **Dashboard → Calibrate** button
2. Place device on prepared surface
3. Click **"Start Baseline Recording"**
4. 3-second countdown appears
5. **Do not touch or move device** during recording
6. Record for at least 15 seconds
7. Click **"Stop Recording"**

### Step 3: Review Results

The system shows:

**Quality Score**: Your baseline's overall quality

**Statistics:**
- Duration and sample count
- Noise level (target: < 0.01 m/s²)
- Stability rating

**Accelerometer Readings:**
- Mean and standard deviation for each axis
- X/Y should be near 0
- Z should be near 9.8 m/s²

**Gravity Measurement:**
- Expected: 9.80665 m/s²
- Measured: Your device's reading
- Error: Difference (target: < 0.2 m/s²)

**Issues & Recommendations:**
- Specific problems detected
- How to improve results

### Step 4: Save or Retry

- **Score ≥ 75**: Automatically saved ✅
- **Score < 75**: Option to save anyway or retry

---

## Understanding Results

### Excellent Baseline (Score: 90-100)

```
Noise Level: 0.005 m/s²
Stability: Excellent
Gravity Error: 0.05 m/s²

Mean Values:
  X: 0.001 m/s²  (±0.003)
  Y: -0.002 m/s² (±0.004)
  Z: 9.810 m/s²  (±0.006)
```

**Interpretation**: Sensor is extremely stable, minimal noise, accurate gravity measurement. Perfect for high-quality road analysis.

### Good Baseline (Score: 75-89)

```
Noise Level: 0.025 m/s²
Stability: Good
Gravity Error: 0.15 m/s²

Mean Values:
  X: 0.005 m/s²  (±0.015)
  Y: -0.010 m/s² (±0.020)
  Z: 9.950 m/s²  (±0.030)
```

**Interpretation**: Sensor has acceptable noise levels. Suitable for road quality detection but may miss very fine details.

### Fair Baseline (Score: 60-74)

```
Noise Level: 0.060 m/s²
Stability: Fair
Gravity Error: 0.30 m/s²

Mean Values:
  X: 0.020 m/s²  (±0.040)
  Y: 0.015 m/s²  (±0.050)
  Z: 10.100 m/s² (±0.070)
```

**Interpretation**: Moderate noise detected. May be due to:
- Surface not completely stable
- Environmental vibrations
- Device sensor quality
Retry with better conditions if possible.

### Poor Baseline (Score: 0-59)

```
Noise Level: 0.150 m/s²
Stability: Poor
Gravity Error: 0.80 m/s²

Issues:
- High noise level detected
- Large gravity measurement error
- Recording too short
```

**Interpretation**: Significant issues. Do not use this baseline. Retry with:
- More stable surface
- Level device properly
- Longer recording duration
- Different location

---

## Technical Details

### Algorithm

The baseline analysis uses these calculations:

1. **Mean**: Average of all samples
   ```
   mean_x = Σ(x_i) / n
   ```

2. **Standard Deviation**: Measure of noise
   ```
   σ_x = √(Σ(x_i - mean_x)² / n)
   ```

3. **Noise Level**: RMS of all axes
   ```
   noise = √(σ_x² + σ_y² + σ_z²)
   ```

4. **Bias**: Deviation from expected
   ```
   bias_x = mean_x - 0
   bias_z = mean_z - 9.80665
   ```

### Stability Classification

| Noise Level | Stability | Description |
|-------------|-----------|-------------|
| < 0.01 m/s² | Excellent | Professional-grade stability |
| 0.01-0.05 m/s² | Good | Suitable for accurate measurements |
| 0.05-0.1 m/s² | Fair | Acceptable with some limitations |
| > 0.1 m/s² | Poor | Unreliable for precise work |

### Quality Score Calculation

```
score = 100
if (noise > 0.1)          score -= 30
else if (noise > 0.05)    score -= 15

if (|gravityError| > 0.5) score -= 25
else if (|gravityError| > 0.2) score -= 10

if (samples < 100)        score -= 20
if (duration < 10s)       score -= 15

score = max(0, score)
```

---

## Use Cases

### 1. Initial Setup

**When**: First time using the app

**Why**: Establishes your device's specific sensor characteristics

**How**:
1. Record baseline in optimal conditions
2. Aim for score ≥ 80
3. This becomes your reference

### 2. Troubleshooting Bad Readings

**When**: Recordings show unusual roughness values

**Why**: Sensor drift or environmental changes

**How**:
1. Record new baseline
2. Compare with previous baselines
3. If noise increased significantly, investigate device

### 3. Periodic Maintenance

**When**: Every 1-2 weeks

**Why**: Sensors can drift over time, especially after iOS updates

**How**:
1. Quick 15-second baseline check
2. Verify noise levels haven't increased
3. Update baseline if needed

### 4. Scientific Validation

**When**: Comparing results across devices

**Why**: Understand device-to-device variation

**How**:
1. Record baseline on each device
2. Compare noise levels and biases
3. Account for differences in analysis

---

## Storage & Privacy

### Where is Baseline Stored?

- **Location**: Browser's localStorage (local to your device)
- **Key**: `sensor-baseline`
- **Size**: ~1 KB
- **Lifetime**: Until manually cleared or 7 days old

### What is Saved?

```json
{
  "timestamp": 1701537600000,
  "duration": 15000,
  "sampleCount": 150,
  "accelerometer": {
    "mean": { "x": 0.002, "y": -0.001, "z": 9.805 },
    "stdDev": { "x": 0.005, "y": 0.006, "z": 0.007 },
    "bias": { "x": 0.002, "y": -0.001, "z": 0.002 },
    "noiseLevel": 0.010,
    "stability": "excellent"
  },
  "measuredGravity": 9.805,
  "gravityError": 0.002,
  "quality": {
    "score": 95,
    "issues": [],
    "recommendations": ["Excellent baseline! Sensor is performing optimally."]
  }
}
```

### Privacy

- ✅ All data stays on your device
- ✅ Not uploaded to any server
- ✅ Not shared with anyone
- ✅ Can be cleared anytime

---

## FAQ

### Q: How often should I calibrate?

**A**: Every 1-2 weeks, or when you notice:
- Unusual readings during drives
- After iOS updates
- After device restart
- Moving to different geographic location (altitude affects gravity slightly)

### Q: What's a good noise level?

**A**:
- **< 0.01 m/s²**: Excellent
- **0.01-0.05 m/s²**: Good
- **> 0.05 m/s²**: Consider retrying

### Q: Why is my Z-axis not exactly 9.8?

**A**: Several factors affect this:
- **Altitude**: Gravity varies slightly with elevation
- **Latitude**: Earth's rotation causes variation
- **Sensor calibration**: Manufacturing tolerances
- **Device orientation**: Must be perfectly flat

A difference of ±0.2 m/s² is acceptable.

### Q: Can I use baseline on a different device?

**A**: No. Each device has unique sensor characteristics. Each phone needs its own baseline.

### Q: What if I get a poor score?

**A**: Try these:
1. Use a harder, more stable surface
2. Record for longer (20-30 seconds)
3. Move away from vibration sources
4. Ensure device is level
5. Try a different time of day (less activity)

If consistently poor, your device's sensor may have issues.

### Q: Does baseline expire?

**A**: The app marks baselines older than 7 days as "expired" and suggests recalibrating. Old baselines remain usable but may be less accurate.

### Q: Will this improve my recordings?

**A**: Yes! Benefits include:
- More accurate roughness detection
- Better noise filtering
- Consistent results across recordings
- Higher confidence in measurements

---

## Advanced: Using Baseline Data

### In Recording Provider (Future Feature)

```typescript
import { loadBaseline, applyBaselineCorrection } from '@/lib/baseline';

const baseline = loadBaseline();

if (baseline && accelerometer.data) {
  const corrected = applyBaselineCorrection(accelerometer.data, baseline);
  // Use corrected values instead of raw
}
```

### Noise Filtering

```typescript
// Filter out readings below noise floor
if (Math.abs(reading.x) < baseline.accelerometer.stdDev.x * 2) {
  // Likely noise, not real signal
}
```

### Bias Correction

```typescript
// Remove systematic error
const correctedZ = rawZ - baseline.accelerometer.bias.z;
// Now gravity measurement is more accurate
```

---

## Troubleshooting

### Issue: High Noise Levels

**Symptoms**: Noise > 0.1 m/s², "Poor" stability

**Solutions**:
1. Check surface - use solid wood or stone
2. Move away from appliances
3. Wait for quieter time
4. Try different location
5. Place phone in case for damping

### Issue: Gravity Error

**Symptoms**: Z-axis far from 9.8 m/s²

**Solutions**:
1. Ensure phone is perfectly flat (use level)
2. Check phone isn't tilted
3. Try face-up orientation
4. Record longer duration
5. Verify sensor permissions

### Issue: Insufficient Samples

**Symptoms**: "Recording too short" warning

**Solutions**:
1. Record for minimum 15 seconds
2. Don't click stop too early
3. Wait for countdown to finish
4. Check sensors are enabled

### Issue: Can't Save Baseline

**Symptoms**: No "Save" button or error

**Solutions**:
1. Check browser localStorage is enabled
2. Clear old baselines if storage full
3. Try incognito mode
4. Check browser console for errors

---

## Example Report

Here's what a good baseline looks like:

```
SENSOR BASELINE CALIBRATION REPORT
Generated: 12/2/2025, 2:30:45 PM

RECORDING INFO:
  Duration: 18.5s
  Samples: 185
  Sample Rate: 10.0 Hz

ACCELEROMETER ANALYSIS:
  Mean Values:
    X: 0.0025 m/s²
    Y: -0.0018 m/s²
    Z: 9.8145 m/s²

  Standard Deviation (Noise):
    X: 0.0042 m/s²
    Y: 0.0056 m/s²
    Z: 0.0067 m/s²

  Bias (Deviation from Expected):
    X: 0.0025 m/s² (expected: 0)
    Y: -0.0018 m/s² (expected: 0)
    Z: 0.0079 m/s² (expected: 9.80665)

  Overall Noise Level: 0.0091 m/s²
  Stability: EXCELLENT

GRAVITY MEASUREMENT:
  Expected: 9.8067 m/s²
  Measured: 9.8145 m/s²
  Error: 0.0079 m/s² (0.08%)

QUALITY ASSESSMENT:
  Overall Score: 95/100

  No issues detected

  Recommendations:
    - Excellent baseline! Sensor is performing optimally.

STATUS: ✅ PASSED
```

---

*Feature added December 2, 2025*
*Part of RoadAnalyzer v0.1.0*
