// src/workers/dedup.worker.ts - Deduplication worker
import { Alert, DedupMessage, WorkerResponse, DedupState, CorrelationConfig } from '../types';

// Worker state
const state: DedupState = {
  lastSeen: new Map<string, number>(),
  counts: new Map<string, number>(),
  flapCounts: new Map<string, number>(),
  lastToggle: new Map<string, number>()
};

// Configuration
let config: CorrelationConfig = {
  windowMs: 15 * 60_000,
  hopMs: 1_000,
  dedupTtlMs: 120_000,
  episodeGapMs: 120_000,
  maxLeadMs: 90_000,
  maxSituationLifetime: 90 * 60_000,
  quietThreshold: 15 * 60_000
};

// Generate stable fingerprint for alert
function generateFingerprint(alert: Alert): string {
  const key = `${alert.fingerprint || alert.title}|${alert.severity}|${alert.entity_key || alert.service || alert.component || alert.resource || 'na'}`;
  return key.toLowerCase().replace(/[^a-z0-9_|]/g, '_');
}

// Generate dedup key
function generateDedupKey(alert: Alert): string {
  const fp = generateFingerprint(alert);
  const ek = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
  return `${fp}|${ek}`;
}

// Check if alert is a duplicate
function isDuplicate(alert: Alert, ttlMs: number): boolean {
  const key = generateDedupKey(alert);
  const now = alert.ts;
  const last = state.lastSeen.get(key) || 0;
  
  return (now - last) < ttlMs;
}

// Update dedup state
function updateDedupState(alert: Alert, ttlMs: number): { isDuplicate: boolean; count: number } {
  const key = generateDedupKey(alert);
  const now = alert.ts;
  const last = state.lastSeen.get(key) || 0;
  const isDuplicate = (now - last) < ttlMs;
  
  if (isDuplicate) {
    // Increment count for duplicate
    const count = (state.counts.get(key) || 0) + 1;
    state.counts.set(key, count);
    
    // Check for flap (status toggle)
    const lastStatus = state.lastToggle.get(key);
    if (lastStatus && lastStatus !== alert.status) {
      const flapCount = (state.flapCounts.get(key) || 0) + 1;
      state.flapCounts.set(key, flapCount);
    }
    state.lastToggle.set(key, alert.status);
    
    return { isDuplicate: true, count };
  } else {
    // New alert
    state.lastSeen.set(key, now);
    state.counts.set(key, 1);
    state.lastToggle.set(key, alert.status);
    return { isDuplicate: false, count: 1 };
  }
}

// Apply rate limiting and flap penalties
function applyRateLimiting(alerts: Alert[]): Alert[] {
  const now = Date.now();
  const rateLimitWindow = 60_000; // 1 minute
  const maxAlertsPerMinute = 100;
  
  // Group alerts by entity_key and time window
  const entityAlerts = new Map<string, Alert[]>();
  
  for (const alert of alerts) {
    const entityKey = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
    if (!entityAlerts.has(entityKey)) {
      entityAlerts.set(entityKey, []);
    }
    entityAlerts.get(entityKey)!.push(alert);
  }
  
  const filteredAlerts: Alert[] = [];
  
  for (const [entityKey, entityAlertList] of entityAlerts) {
    // Sort by timestamp
    entityAlertList.sort((a, b) => a.ts - b.ts);
    
    // Apply rate limiting per entity
    let alertsInWindow = 0;
    for (const alert of entityAlertList) {
      const timeDiff = now - alert.ts;
      
      if (timeDiff <= rateLimitWindow) {
        if (alertsInWindow < maxAlertsPerMinute) {
          filteredAlerts.push(alert);
          alertsInWindow++;
        }
        // Drop excess alerts in rate limit window
      } else {
        // Outside rate limit window, include
        filteredAlerts.push(alert);
      }
    }
  }
  
  return filteredAlerts;
}

// Garbage collection for old entries
function garbageCollect(): void {
  const now = Date.now();
  const maxAge = 10 * 60_000; // 10 minutes
  
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
self.onmessage = (event: MessageEvent) => {
  const message = event.data as DedupMessage;
  
  if (message.type !== 'dedup') {
    postMessage({
      success: false,
      error: `Unknown message type: ${message.type}`
    } as WorkerResponse);
    return;
  }
  
  try {
    // Update config if provided
    if (message.config) {
      config = { ...config, ...message.config };
    }
    
    const { batch, ttlMs } = message;
    const now = Date.now();
    
    // Process alerts
    const processedAlerts: Alert[] = [];
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
        
        // Check if this is a flap (multiple status changes)
        const key = generateDedupKey(alert);
        const flapCount = state.flapCounts.get(key) || 0;
        if (flapCount > 3) {
          duplicateStats.flaps++;
          // Down-weight flapping alerts by skipping them
          continue;
        }
      }
      
      processedAlerts.push(alert);
    }
    
    // Apply rate limiting
    const rateLimitedAlerts = applyRateLimiting(processedAlerts);
    duplicateStats.rateLimited = processedAlerts.length - rateLimitedAlerts.length;
    
    // Garbage collection
    garbageCollect();
    
    // Post response
    postMessage({
      success: true,
      data: rateLimitedAlerts,
      metrics: {
        processingTime: performance.now() - now,
        memoryUsage: 0, // Will be updated by main thread
        throughput: batch.length / (config.hopMs / 1000),
        dedupRate: duplicateStats.total > 0 ? (duplicateStats.duplicates / duplicateStats.total) * 100 : 0,
        correlationAccuracy: 0,
        situationCount: 0,
        episodeCount: 0
      }
    } as WorkerResponse);
    
  } catch (error) {
    console.error('Dedup worker error:', error);
    postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
};

// Handle worker errors
self.onerror = (error: ErrorEvent) => {
  console.error('Dedup worker error:', error);
  postMessage({
    success: false,
    error: error.message || 'Worker error'
  } as WorkerResponse);
};

// Handle unhandled rejections
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  console.error('Dedup worker unhandled rejection:', event.reason);
  postMessage({
    success: false,
    error: event.reason?.message || 'Unhandled rejection'
  } as WorkerResponse);
};
