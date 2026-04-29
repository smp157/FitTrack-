/**
 * FitTrack Sensor Engine
 * Real phone/browser sensor integrations:
 *  - Step Counter  → DeviceMotionEvent (accelerometer)
 *  - GPS Distance  → navigator.geolocation.watchPosition
 *  - Calories      → Step × weight-based MET formula
 *  - Heart Rate    → Web Bluetooth (BLE Heart Rate Profile 0x180D)
 */

'use strict';

// ─────────────────────────────────────────────────────
// Utility: Haversine distance between two GPS coords (km)
// ─────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────
// Step Counter — DeviceMotionEvent (Accelerometer)
// ─────────────────────────────────────────────────────
class StepCounter {
  constructor(onStep) {
    this.onStep = onStep;         // callback(totalSteps)
    this.steps = 0;
    this._lastMag = 0;
    this._lastStepTime = 0;
    this._threshold = 1.2;        // m/s² above gravity
    this._minInterval = 250;      // ms between valid steps
    this._gravity = 9.81;
    this._alpha = 0.8;            // low-pass filter factor
    this._smoothed = 0;
    this._handler = null;
    this.active = false;
  }

  async start() {
    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== 'granted') throw new Error('Permission denied');
      } catch (err) {
        throw new Error('Motion sensor permission denied. Please allow in iOS Settings → Safari → Motion & Orientation Access.');
      }
    }

    if (!window.DeviceMotionEvent) {
      throw new Error('Accelerometer not supported on this device/browser.');
    }

    this._handler = (e) => this._onMotion(e);
    window.addEventListener('devicemotion', this._handler);
    this.active = true;
  }

  stop() {
    if (this._handler) {
      window.removeEventListener('devicemotion', this._handler);
      this._handler = null;
    }
    this.active = false;
  }

  reset() { this.steps = 0; }

  _onMotion(event) {
    // Prefer linear acceleration (gravity already removed) if available
    const la = event.accelerationIncludingGravity || event.acceleration;
    if (!la || la.x == null) return;

    const x = la.x || 0, y = la.y || 0, z = la.z || 0;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // Low-pass filter to remove noise
    this._smoothed = this._alpha * this._smoothed + (1 - this._alpha) * magnitude;

    const net = Math.abs(magnitude - this._smoothed);
    const now = Date.now();

    // Peak detection: magnitude spike above threshold and enough time has passed
    if (net > this._threshold && (now - this._lastStepTime) > this._minInterval) {
      this.steps++;
      this._lastStepTime = now;
      this.onStep(this.steps);
    }
  }
}

// ─────────────────────────────────────────────────────
// GPS Distance Tracker
// ─────────────────────────────────────────────────────
class GPSTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;   // callback({ distKm, lat, lon, speed })
    this.distKm = 0;
    this._watchId = null;
    this._lastPos = null;
    this.active = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('GPS not supported on this device/browser.'));
      }
      this._watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lon, speed } = pos.coords;
          if (this._lastPos) {
            const delta = haversineKm(this._lastPos.lat, this._lastPos.lon, lat, lon);
            // Filter noise — only count if moved > 5 metres
            if (delta > 0.005) {
              this.distKm = +(this.distKm + delta).toFixed(3);
            }
          }
          this._lastPos = { lat, lon };
          this.onUpdate({
            distKm: this.distKm,
            lat, lon,
            speedKmh: speed ? +(speed * 3.6).toFixed(1) : null,
          });
          resolve();
        },
        (err) => reject(new Error('GPS error: ' + err.message)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
      );
      this.active = true;
    });
  }

  stop() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this.active = false;
  }

  reset() { this.distKm = 0; this._lastPos = null; }
}

// ─────────────────────────────────────────────────────
// Calorie Calculator (MET-based)
// ─────────────────────────────────────────────────────
const CalorieCalc = {
  /**
   * Estimate calories from steps and body weight.
   * Avg stride: 0.762 m  | MET walking: 3.5 | MET running (>10k steps/hr): 8
   * Cal = MET × weight(kg) × duration(hr)
   */
  fromSteps(steps, weightKg = 70) {
    // Each step burns roughly: weight(kg) × 0.0005 kcal (walking pace)
    return Math.round(steps * (weightKg * 0.0005));
  },

  /**
   * Estimate calories from distance (km) and weight.
   */
  fromDistance(distKm, weightKg = 70) {
    // ~1 kcal per kg per km
    return Math.round(distKm * weightKg * 0.9);
  },
};

// ─────────────────────────────────────────────────────
// Heart Rate Monitor — Web Bluetooth (BLE)
// Heart Rate Profile: Service 0x180D, Char 0x2A37
// ─────────────────────────────────────────────────────
class HeartRateMonitor {
  constructor(onReading) {
    this.onReading = onReading;  // callback(bpm)
    this.bpm = 0;
    this._device = null;
    this._char = null;
    this._listener = null;
    this.connected = false;
    this.deviceName = '';
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth not supported. Use Chrome on Android, or Chrome/Edge on Windows with Bluetooth.'
      );
    }

    this._device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service'],
    });

    this.deviceName = this._device.name || 'Heart Rate Monitor';
    const server = await this._device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    this._char = await service.getCharacteristic('heart_rate_measurement');

    this._listener = (event) => {
      const value = event.target.value;
      // Byte 0: flags. Bit 0=0 → HR is uint8, Bit 0=1 → HR is uint16
      const flags = value.getUint8(0);
      const bpm = (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
      this.bpm = bpm;
      this.onReading(bpm);
    };

    this._char.addEventListener('characteristicvaluechanged', this._listener);
    await this._char.startNotifications();
    this.connected = true;

    this._device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.bpm = 0;
    });
  }

  async disconnect() {
    if (this._char && this._listener) {
      try { await this._char.stopNotifications(); } catch (_) {}
      this._char.removeEventListener('characteristicvaluechanged', this._listener);
    }
    if (this._device && this._device.gatt.connected) {
      this._device.gatt.disconnect();
    }
    this.connected = false;
  }
}

// ─────────────────────────────────────────────────────
// Sensor Manager — orchestrates all sensors
// ─────────────────────────────────────────────────────
const SensorManager = {
  steps: 0,
  calories: 0,
  distKm: 0,
  heartRate: 0,
  speedKmh: 0,
  isTracking: false,
  sessionStart: null,
  _weightKg: 70,
  _userWeight: 70,

  // Listeners map: { steps, calories, distance, heartRate, all }
  _listeners: {},

  stepCounter: null,
  gpsTracker: null,
  hrMonitor: null,

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },

  off(event, fn) {
    if (this._listeners[event])
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  },

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
    (this._listeners['all'] || []).forEach(fn => fn({ event, data }));
  },

  init(userWeightKg = 70) {
    this._weightKg = userWeightKg;

    this.stepCounter = new StepCounter((total) => {
      this.steps = total;
      this.calories = CalorieCalc.fromSteps(total, this._weightKg);
      this._emit('steps', total);
      this._emit('calories', this.calories);
    });

    this.gpsTracker = new GPSTracker(({ distKm, speedKmh }) => {
      this.distKm = distKm;
      this.speedKmh = speedKmh;
      // Recalculate calories from distance too (use whichever is larger)
      const calFromDist = CalorieCalc.fromDistance(distKm, this._weightKg);
      if (calFromDist > this.calories) {
        this.calories = calFromDist;
        this._emit('calories', this.calories);
      }
      this._emit('distance', { distKm, speedKmh });
    });

    this.hrMonitor = new HeartRateMonitor((bpm) => {
      this.heartRate = bpm;
      this._emit('heartRate', bpm);
    });
  },

  async startTracking(options = {}) {
    if (this.isTracking) return;

    const errors = [];

    // Start step counter
    if (options.steps !== false) {
      try {
        await this.stepCounter.start();
      } catch (err) {
        errors.push('Steps: ' + err.message);
      }
    }

    // Start GPS
    if (options.gps !== false) {
      try {
        await this.gpsTracker.start();
      } catch (err) {
        errors.push('GPS: ' + err.message);
      }
    }

    this.isTracking = true;
    this.sessionStart = new Date();
    this._emit('trackingStarted', { errors });
    return errors;
  },

  stopTracking() {
    if (this.stepCounter.active) this.stepCounter.stop();
    if (this.gpsTracker.active) this.gpsTracker.stop();
    this.isTracking = false;

    const session = {
      steps: this.steps,
      calories: this.calories,
      distKm: this.distKm,
      heartRate: this.heartRate,
      duration: this.sessionStart
        ? Math.round((Date.now() - this.sessionStart.getTime()) / 60000)
        : 0,
      date: new Date().toISOString().split('T')[0],
    };

    this._emit('trackingStopped', session);
    return session;
  },

  resetSession() {
    this.steps = 0;
    this.calories = 0;
    this.distKm = 0;
    this.heartRate = 0;
    if (this.stepCounter) this.stepCounter.reset();
    if (this.gpsTracker) this.gpsTracker.reset();
  },

  async connectHeartRate() {
    return this.hrMonitor.connect();
  },

  disconnectHeartRate() {
    return this.hrMonitor.disconnect();
  },

  getStatus() {
    return {
      stepSensor:  this.stepCounter?.active ? 'active' : 'inactive',
      gps:         this.gpsTracker?.active ? 'active' : 'inactive',
      heartRate:   this.hrMonitor?.connected ? 'connected' : 'disconnected',
      isTracking:  this.isTracking,
    };
  },

  /** Save current session data to localStorage under the current user */
  saveToStorage(userId) {
    const today = new Date().toISOString().split('T')[0];

    // Update/create today's activity record
    const key = 'fittrack_activity';
    const all = JSON.parse(localStorage.getItem(key) || '[]');
    const idx = all.findIndex(a => a.userId === userId && a.date === today);
    const record = {
      userId, date: today,
      steps: this.steps,
      calories: this.calories,
      distKm: this.distKm,
      heartRate: this.heartRate,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) all[idx] = record; else all.push(record);
    localStorage.setItem(key, JSON.stringify(all));

    // Also update goals with today's step count
    const goals = JSON.parse(localStorage.getItem('fittrack_goals') || '[]');
    const stepsGoal = goals.find(g => g.userId === userId && g.name.toLowerCase().includes('step'));
    if (stepsGoal) {
      stepsGoal.current = this.steps;
      localStorage.setItem('fittrack_goals', JSON.stringify(goals));
    }

    // Update calorie goal
    const calGoal = goals.find(g => g.userId === userId && g.name.toLowerCase().includes('calorie') && g.unit === 'kcal');
    if (calGoal) {
      calGoal.current = this.calories;
      localStorage.setItem('fittrack_goals', JSON.stringify(goals));
    }
  },

  /** Load today's saved activity record */
  loadFromStorage(userId) {
    const today = new Date().toISOString().split('T')[0];
    const all = JSON.parse(localStorage.getItem('fittrack_activity') || '[]');
    return all.find(a => a.userId === userId && a.date === today) || null;
  },

  /** Get 7-day history */
  getWeekHistory(userId) {
    const all = JSON.parse(localStorage.getItem('fittrack_activity') || '[]')
      .filter(a => a.userId === userId);
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      const rec = all.find(a => a.date === date) || { steps: 0, calories: 0, distKm: 0, heartRate: 0 };
      result.push({ date, ...rec });
    }
    return result;
  },
};

// Add STORAGE_KEY for activity
if (typeof STORAGE_KEYS !== 'undefined') {
  STORAGE_KEYS.ACTIVITY = 'fittrack_activity';
}
