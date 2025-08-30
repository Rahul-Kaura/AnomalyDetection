// dist/workers/dedup.worker.js - JavaScript version for immediate testing

// Worker state
const state = {
  lastSeen: new Map(),
  counts: new Map(),
  flapCounts: new Map(),
  lastToggle: new Map()
};

// Configuration
let config = {
  windowMs: 15 * 60_000,
  hopMs: 1_000,
  dedupTtlMs: 120_000,
  episodeGapMs: 120_000,
  maxLeadMs: 90_000,
  maxSituationLifetime: 90 * 60_000,
  quietThreshold: 15 * 60_000
};

// Generate stable fingerprint for alert
function generateFingerprint(alert) {
  const key = `${alert.fingerprint || alert.title || alert.kind}|${alert.severity}|${alert.entity_key || alert.service || alert.component || alert.resource || 'na'}`;
  return key.toLowerCase().replace(/[^a-z0-9_|]/g, '_');
}

// Generate dedup key
function generateDedupKey(alert) {
  const fp = generateFingerprint(alert);
  const ek = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
  return `${fp}|${ek}`;
}

// Update dedup state
function updateDedupState(alert, ttlMs) {
  const key = generateDedupKey(alert);
  const now = alert.ts;
  const last = state.lastSeen.get(key) || 0;
  const isDuplicate = (now - last) < ttlMs;
  
  if (isDuplicate) {
    const count = (state.counts.get(key) || 0) + 1;
    state.counts.set(key, count);
    
    const lastStatus = state.lastToggle.get(key);
    if (lastStatus && lastStatus !== alert.status) {
      const flapCount = (state.flapCounts.get(key) || 0) + 1;
      state.flapCounts.set(key, flapCount);
    }
    state.lastToggle.set(key, alert.status);
    
    return { isDuplicate: true, count };
  } else {
    state.lastSeen.set(key, now);
    state.counts.set(key, 1);
    state.lastToggle.set(key, alert.status);
    return { isDuplicate: false, count: 1 };
  }
}

// Apply rate limiting and flap penalties
function applyRateLimiting(alerts) {
  const now = Date.now();
  const rateLimitWindow = 60_000;
  const maxAlertsPerMinute = 100;
  
  const entityAlerts = new Map();
  
  for (const alert of alerts) {
    const entityKey = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
    if (!entityAlerts.has(entityKey)) {
      entityAlerts.set(entityKey, []);
    }
    entityAlerts.get(entityKey).push(alert);
  }
  
  const filteredAlerts = [];
  
  for (const [entityKey, entityAlertList] of entityAlerts) {
    entityAlertList.sort((a, b) => a.ts - b.ts);
    
    let alertsInWindow = 0;
    for (const alert of entityAlertList) {
      const timeDiff = now - alert.ts;
      
      if (timeDiff <= rateLimitWindow) {
        if (alertsInWindow < maxAlertsPerMinute) {
          filteredAlerts.push(alert);
          alertsInWindow++;
        }
      } else {
        filteredAlerts.push(alert);
      }
    }
  }
  
  return filteredAlerts;
}

// Garbage collection for old entries
function garbageCollect() {
  const now = Date.now();
  const maxAge = 10 * 60_000;
  
  for (const [key, timestamp] of state.lastSeen) {
    if (now - timestamp > maxAge) {
      state.lastSeen.delete(key);
      state.counts.delete(key);
      state.flapCounts.delete(key);
      state.lastToggle.delete(key);
    }
  }
}

// Main message handler
self.onmessage = (event) => {
  const message = event.data;
  
  if (message.type !== 'dedup') {
    postMessage({
      success: false,
      error: `Unknown message type: ${message.type}`
    });
    return;
  }
  
  try {
    if (message.config) {
      config = { ...config, ...message.config };
    }
    
    const { batch, ttlMs } = message;
    const now = Date.now();
    
    const processedAlerts = [];
    const duplicateStats = {
      total: batch.length,
      duplicates: 0,
      flaps: 0,
      rateLimited: 0
    };
    
    for (const alert of batch) {
      const { isDuplicate, count } = updateDedupState(alert, ttlMs);
      
      if (isDuplicate) {
        duplicateStats.duplicates++;
        
        const key = generateDedupKey(alert);
        const flapCount = state.flapCounts.get(key) || 0;
        if (flapCount > 3) {
          duplicateStats.flaps++;
          continue;
        }
      }
      
      processedAlerts.push(alert);
    }
    
    const rateLimitedAlerts = applyRateLimiting(processedAlerts);
    duplicateStats.rateLimited = processedAlerts.length - rateLimitedAlerts.length;
    
    garbageCollect();
    
    postMessage({
      success: true,
      data: rateLimitedAlerts,
      metrics: {
        processingTime: performance.now() - now,
        memoryUsage: 0,
        throughput: batch.length / (config.hopMs / 1000),
        dedupRate: duplicateStats.total > 0 ? (duplicateStats.duplicates / duplicateStats.total) * 100 : 0,
        correlationAccuracy: 0,
        situationCount: 0,
        episodeCount: 0
      }
    });
    
  } catch (error) {
    console.error('Dedup worker error:', error);
    postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Handle worker errors
self.onerror = (error) => {
  console.error('Dedup worker error:', error);
  postMessage({
    success: false,
    error: error.message || 'Worker error'
  });
};
