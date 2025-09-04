// src/workers/cluster.worker.ts - Episode clustering worker
import { Alert, Episode, ClusterMessage, WorkerResponse, CorrelationConfig } from '../types';

// Worker state
const episodes = new Map<string, Episode>();
const entityEpisodes = new Map<string, string[]>(); // entity_key -> episode keys

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

// Generate episode key
function generateEpisodeKey(alert: Alert): string {
  const entityKey = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
  const fingerprint = alert.fingerprint || `${alert.title}|${alert.severity}`;
  return `${entityKey}|${fingerprint}`;
}

// Get or create episode
function getOrCreateEpisode(alert: Alert): Episode {
  const key = generateEpisodeKey(alert);
  let episode = episodes.get(key);
  
  if (!episode) {
    episode = {
      entity_key: alert.entity_key || alert.service || alert.component || alert.resource || 'na',
      fingerprint: alert.fingerprint || `${alert.title}|${alert.severity}`,
      vendorMix: new Set([alert.source as any]),
      start: alert.ts,
      end: alert.ts,
      count: 1,
      ids: [alert.vendor_event_id],
      alerts: [alert],
      severity: alert.severity
    };
    
    episodes.set(key, episode);
    
    // Update entity episodes index
    if (!entityEpisodes.has(episode.entity_key)) {
      entityEpisodes.set(episode.entity_key, []);
    }
    entityEpisodes.get(episode.entity_key)!.push(key);
  }
  
  return episode;
}

// Update episode with new alert
function updateEpisode(episode: Episode, alert: Alert, gapMs: number): boolean {
  const timeDiff = alert.ts - episode.end;
  
  // Check if gap exceeds threshold
  if (timeDiff > gapMs) {
    // Start new episode
    return false;
  }
  
  // Update existing episode
  episode.end = alert.ts;
  episode.count += 1;
  episode.vendorMix.add(alert.source as any);
  
  // Update severity if higher
  if (getSeverityWeight(alert.severity) > getSeverityWeight(episode.severity)) {
    episode.severity = alert.severity;
  }
  
  // Add alert ID if not already present
  if (!episode.ids.includes(alert.vendor_event_id)) {
    episode.ids.push(alert.vendor_event_id);
  }
  
  // Add alert to episode (with size limit)
  if (episode.alerts.length < 50) {
    episode.alerts.push(alert);
  }
  
  return true;
}

// Get severity weight for comparison
function getSeverityWeight(severity: string): number {
  switch (severity) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
}

// Clean up old episodes
function cleanupOldEpisodes(windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  for (const [key, episode] of episodes) {
    if (episode.end < cutoff) {
      episodes.delete(key);
      
      // Remove from entity episodes index
      const entityKey = episode.entity_key;
      const entityEpisodeKeys = entityEpisodes.get(entityKey);
      if (entityEpisodeKeys) {
        const index = entityEpisodeKeys.indexOf(key);
        if (index > -1) {
          entityEpisodeKeys.splice(index, 1);
        }
        if (entityEpisodeKeys.length === 0) {
          entityEpisodes.delete(entityKey);
        }
      }
    }
  }
}

// Get episodes within time window
function getEpisodesInWindow(windowMs: number): Episode[] {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  return Array.from(episodes.values())
    .filter(episode => episode.end >= cutoff)
    .sort((a, b) => a.start - b.start);
}

// Apply burst clustering (DBSCAN-style in 1D time)
function applyBurstClustering(alerts: Alert[], gapMs: number): Alert[] {
  if (alerts.length === 0) return alerts;
  
  // Sort alerts by timestamp
  const sortedAlerts = [...alerts].sort((a, b) => a.ts - b.ts);
  const clusteredAlerts: Alert[] = [];
  
  let currentCluster: Alert[] = [];
  
  for (let i = 0; i < sortedAlerts.length; i++) {
    const current = sortedAlerts[i];
    
    if (currentCluster.length === 0) {
      currentCluster.push(current);
    } else {
      const lastInCluster = currentCluster[currentCluster.length - 1];
      const timeDiff = current.ts - lastInCluster.ts;
      
      if (timeDiff <= gapMs) {
        // Add to current cluster
        currentCluster.push(current);
      } else {
        // End current cluster and start new one
        if (currentCluster.length > 1) {
          // This is a burst, keep all alerts
          clusteredAlerts.push(...currentCluster);
        } else {
          // Single alert, keep it
          clusteredAlerts.push(...currentCluster);
        }
        
        currentCluster = [current];
      }
    }
  }
  
  // Handle last cluster
  if (currentCluster.length > 0) {
    if (currentCluster.length > 1) {
      clusteredAlerts.push(...currentCluster);
    } else {
      clusteredAlerts.push(...currentCluster);
    }
  }
  
  return clusteredAlerts;
}

// Main message handler
self.onmessage = (event: MessageEvent) => {
  const message = event.data as ClusterMessage;
  
  if (message.type !== 'cluster') {
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
    
    const { batch, gapMs, windowMs } = message;
    const startTime = performance.now();
    
    // Apply burst clustering first
    const burstClusteredAlerts = applyBurstClustering(batch, gapMs);
    
    // Process alerts into episodes
    const processedAlerts: Alert[] = [];
    
    for (const alert of burstClusteredAlerts) {
      const episode = getOrCreateEpisode(alert);
      const wasUpdated = updateEpisode(episode, alert, gapMs);
      
      if (wasUpdated) {
        processedAlerts.push(alert);
      } else {
        // New episode started, add alert to new episode
        processedAlerts.push(alert);
      }
    }
    
    // Clean up old episodes
    cleanupOldEpisodes(windowMs);
    
    // Get episodes in current window
    const windowEpisodes = getEpisodesInWindow(windowMs);
    
    // Prepare response data
    const responseEpisodes = windowEpisodes.map(episode => ({
      ...episode,
      vendorMix: Array.from(episode.vendorMix)
    }));
    
    // Post response
    postMessage({
      success: true,
      data: {
        episodes: responseEpisodes,
        alertsKept: processedAlerts
      },
      metrics: {
        processingTime: performance.now() - startTime,
        memoryUsage: 0, // Will be updated by main thread
        throughput: batch.length / (config.hopMs / 1000),
        dedupRate: 0,
        correlationAccuracy: processedAlerts.length > 0 ? (processedAlerts.length / batch.length) * 100 : 0,
        situationCount: 0,
        episodeCount: windowEpisodes.length
      }
    } as WorkerResponse);
    
  } catch (error) {
    console.error('Cluster worker error:', error);
    postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
};

// Handle worker errors
self.onerror = (error: ErrorEvent) => {
  console.error('Cluster worker error:', error);
  postMessage({
    success: false,
    error: error.message || 'Worker error'
  } as WorkerResponse);
};

// Handle unhandled rejections
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  console.error('Cluster worker unhandled rejection:', event.reason);
  postMessage({
    success: false,
    error: event.reason?.message || 'Unhandled rejection'
  } as WorkerResponse);
};
