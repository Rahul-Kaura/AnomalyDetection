// src/main.js - JavaScript version for immediate testing
// This implements the complete browser-side correlator according to Notion specifications

// ---- Types and Interfaces ----
// (These would be TypeScript interfaces in the full implementation)

// ---- Configuration ----
const DEFAULT_CONFIG = {
  windowMs: 15 * 60_000,         // 15 minute sliding window
  hopMs: 1_000,                  // 1 second batch hop
  dedupTtlMs: 120_000,           // 2 minute dedup TTL
  episodeGapMs: 120_000,         // 2 minute episode gap
  maxLeadMs: 90_000,             // 90 second causal test horizon
  maxSituationLifetime: 90 * 60_000, // 90 minute situation lifetime
  quietThreshold: 15 * 60_000    // 15 minute quiet threshold
};

// ---- Utility Functions ----
function union(a, b) {
  const result = new Set(a);
  for (const item of b) result.add(item);
  return result;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  
  const intersection = new Set([...a].filter(x => b.has(x)));
  const unionSize = a.size + b.size - intersection.size;
  return intersection.size / unionSize;
}

function severityWeight(severity) {
  switch (severity) {
    case 'critical': return 1.0;
    case 'high': return 0.75;
    case 'medium': return 0.5;
    case 'low': return 0.25;
    default: return 0.25;
  }
}

// ---- Episode Clustering ----
class EpisodeClusterer {
  constructor() {
    this.episodes = new Map();
    this.entityEpisodes = new Map();
  }

  generateEpisodeKey(alert) {
    const entityKey = alert.entity_key || alert.service || alert.component || alert.resource || 'na';
    const fingerprint = alert.fingerprint || `${alert.title || alert.kind}|${alert.severity}`;
    return `${entityKey}|${fingerprint}`;
  }

  getOrCreateEpisode(alert) {
    const key = this.generateEpisodeKey(alert);
    let episode = this.episodes.get(key);
    
    if (!episode) {
      episode = {
        entity_key: alert.entity_key || alert.service || alert.component || alert.resource || 'na',
        fingerprint: alert.fingerprint || `${alert.title || alert.kind}|${alert.severity}`,
        vendorMix: new Set([alert.source || 'unknown']),
        start: alert.ts,
        end: alert.ts,
        count: 1,
        ids: [alert.vendor_event_id],
        alerts: [alert],
        severity: alert.severity
      };
      
      this.episodes.set(key, episode);
      
      if (!this.entityEpisodes.has(episode.entity_key)) {
        this.entityEpisodes.set(episode.entity_key, []);
      }
      this.entityEpisodes.get(episode.entity_key).push(key);
    }
    
    return episode;
  }

  updateEpisode(episode, alert, gapMs) {
    const timeDiff = alert.ts - episode.end;
    
    if (timeDiff > gapMs) {
      return false; // Start new episode
    }
    
    episode.end = alert.ts;
    episode.count += 1;
    episode.vendorMix.add(alert.source || 'unknown');
    
    if (severityWeight(alert.severity) > severityWeight(episode.severity)) {
      episode.severity = alert.severity;
    }
    
    if (!episode.ids.includes(alert.vendor_event_id)) {
      episode.ids.push(alert.vendor_event_id);
    }
    
    if (episode.alerts.length < 50) {
      episode.alerts.push(alert);
    }
    
    return true;
  }

  cleanupOldEpisodes(windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    for (const [key, episode] of this.episodes) {
      if (episode.end < cutoff) {
        this.episodes.delete(key);
        
        const entityKey = episode.entity_key;
        const entityEpisodeKeys = this.entityEpisodes.get(entityKey);
        if (entityEpisodeKeys) {
          const index = entityEpisodeKeys.indexOf(key);
          if (index > -1) {
            entityEpisodeKeys.splice(index, 1);
          }
          if (entityEpisodeKeys.length === 0) {
            this.entityEpisodes.delete(entityKey);
          }
        }
      }
    }
  }

  getEpisodesInWindow(windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    return Array.from(this.episodes.values())
      .filter(episode => episode.end >= cutoff)
      .sort((a, b) => a.start - b.start);
  }
}

// ---- Situation Builder ----
class SituationBuilder {
  constructor() {
    this.situations = new Map();
  }

  buildSituations(episodes, alerts, windowMs) {
    if (episodes.length === 0) return [];
    
    episodes.sort((a, b) => a.start - b.start);
    
    // Union-find style clustering
    const parent = new Map();
    const find = (x) => {
      if (parent.get(x) === x || !parent.get(x)) {
        parent.set(x, x);
        return x;
      }
      const root = find(parent.get(x));
      parent.set(x, root);
      return root;
    };
    
    const unite = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    
    for (const episode of episodes) {
      parent.set(episode, episode);
    }
    
    for (let i = 0; i < episodes.length; i++) {
      for (let j = i + 1; j < episodes.length; j++) {
        if (this.joinable(episodes[i], episodes[j])) {
          unite(episodes[i], episodes[j]);
        }
      }
    }
    
    const buckets = new Map();
    for (const episode of episodes) {
      const root = find(episode);
      if (!buckets.has(root)) {
        buckets.set(root, []);
      }
      buckets.get(root).push(episode);
    }
    
    const situations = [];
    for (const group of buckets.values()) {
      if (group.length === 0) continue;
      
      const start = Math.min(...group.map(g => g.start));
      const end = Math.max(...group.map(g => g.end));
      
      const related = alerts.filter(a => a.ts >= start && a.ts <= end);
      
      const uniqueEntities = new Set(group.map(g => g.entity_key));
      const uniqueServices = new Set(group.map(g => g.alerts.map(a => a.service).filter(Boolean)).flat());
      
      const situation = {
        situation_id: `S-${start}-${end}-${group.length}`,
        window: { start, end },
        episodes: group,
        related_alerts: related.slice(0, 200),
        change_refs: [],
        blast_radius: {
          entities: uniqueEntities.size,
          services: uniqueServices.size
        },
        score: 0
      };
      
      situations.push(situation);
    }
    
    return situations;
  }

  joinable(e1, e2) {
    if (e1 === e2) return false;
    
    const timeOverlap = !(e1.end < e2.start || e2.end < e1.start);
    if (!timeOverlap) return false;
    
    const entitySimilarity = e1.entity_key === e2.entity_key ? 1.0 : 0.0;
    const fingerprintSimilarity = e1.fingerprint === e2.fingerprint ? 1.0 : 0.0;
    const vendorOverlap = jaccard(new Set([...e1.vendorMix]), new Set([...e2.vendorMix]));
    
    return entitySimilarity > 0.8 || fingerprintSimilarity > 0.8 || vendorOverlap > 0.3;
  }
}

// ---- Situation Scorer ----
class SituationScorer {
  scoreSituation(situation, graphHints, maxLeadMs) {
    if (situation.episodes.length === 0) return;
    
    const sortedEpisodes = [...situation.episodes].sort((a, b) => a.start - b.start);
    const cause = sortedEpisodes[0];
    const others = sortedEpisodes.slice(1);
    
    // Lead-lag correlation
    let bestLag = { lagMs: 0, score: 0 };
    for (const episode of others) {
      const causeTs = cause.alerts.map(a => a.ts);
      const effectTs = episode.alerts.map(a => a.ts);
      const lag = this.corrLeadLag(causeTs, effectTs, maxLeadMs);
      
      if (lag.score > bestLag.score) {
        bestLag = lag;
      }
    }
    
    // Graph path check
    let bestPath = Infinity;
    for (const episode of others) {
      const pathLen = this.shortestPathLen(graphHints?.adj || {}, cause.entity_key, episode.entity_key, 4);
      if (pathLen < bestPath) bestPath = pathLen;
    }
    const pathScore = bestPath === Infinity ? 0 : 1 / (1 + bestPath);
    
    // Cardinality and severity
    const cardinality = Math.log(1 + situation.blast_radius.entities);
    const severity = Math.max(...situation.episodes.map(ep => severityWeight(ep.severity)));
    
    // Change proximity
    const firstTs = situation.window.start;
    const changeNear = situation.related_alerts.some(a => 
      a.deploy_key && Math.abs(a.ts - firstTs) <= 10 * 60_000
    );
    const changeProx = changeNear ? 1.0 : 0.2;
    
    // Flap and echo penalties
    const flapPenalty = 0;
    const echoPenalty = Math.max(0, (situation.episodes.reduce((acc, ep) => acc + ep.vendorMix.size, 0) - situation.episodes.length) * 0.05);
    
    // Composite scoring
    const w1 = 0.35, w2 = 0.2, w3 = 0.2, w4 = 0.15, w5 = 0.15, w6 = 0.1, w7 = 0.05;
    const composite = w1 * changeProx + 
                     w2 * bestLag.score + 
                     w3 * pathScore + 
                     w4 * cardinality + 
                     w5 * severity - 
                     w6 * flapPenalty - 
                     w7 * echoPenalty;
    
    situation.primary_cause = {
      entity: cause.entity_key,
      episodeIdx: situation.episodes.indexOf(cause),
      confidence: Math.min(1, composite),
      lag_ms: bestLag.lagMs
    };
    
    situation.score = composite;
    situation.next_actions = this.generateNextActions(cause, situation);
  }

  corrLeadLag(aTs, bTs, maxLeadMs) {
    if (aTs.length === 0 || bTs.length === 0) {
      return { lagMs: 0, score: 0 };
    }
    
    const toBins = (ts) => {
      const bins = new Map();
      for (const t of ts) {
        const bin = Math.floor(t / 1000);
        bins.set(bin, (bins.get(bin) || 0) + 1);
      }
      return bins;
    };
    
    const A = toBins(aTs);
    const B = toBins(bTs);
    
    let best = { lagMs: 0, score: 0 };
    const maxLagS = Math.floor(maxLeadMs / 1000);
    
    for (let lag = 0; lag <= maxLagS; lag++) {
      let numerator = 0;
      let denomA = 0;
      let denomB = 0;
      
      for (const [bin, aCount] of A) {
        const bCount = B.get(bin + lag) || 0;
        numerator += aCount * bCount;
        denomA += aCount * aCount;
        denomB += bCount * bCount;
      }
      
      if (denomA > 0 && denomB > 0) {
        const score = numerator / Math.sqrt(denomA * denomB);
        if (score > best.score) {
          best = { lagMs: lag * 1000, score };
        }
      }
    }
    
    return best;
  }

  shortestPathLen(adj, src, dst, limit = 4) {
    if (src === dst) return 0;
    if (!adj[src] || !adj[dst]) return Infinity;
    
    const queue = [[src, 0]];
    const seen = new Set([src]);
    
    while (queue.length > 0) {
      const [current, distance] = queue.shift();
      
      if (distance >= limit) continue;
      
      for (const neighbor of adj[current] || []) {
        if (seen.has(neighbor)) continue;
        
        if (neighbor === dst) return distance + 1;
        
        seen.add(neighbor);
        queue.push([neighbor, distance + 1]);
      }
    }
    
    return Infinity;
  }

  generateNextActions(cause, situation) {
    const actions = [];
    
    if (situation.blast_radius.entities > 5) {
      actions.push('Page oncall team - multiple services affected');
    }
    
    if (situation.blast_radius.services > 3) {
      actions.push('Check shared infrastructure components');
    }
    
    if (cause.entity_key.includes('database')) {
      actions.push('Check database connection pool and performance');
      actions.push('Verify database resource limits');
    }
    
    if (cause.entity_key.includes('api')) {
      actions.push('Check API rate limiting and quotas');
      actions.push('Verify upstream service health');
    }
    
    if (cause.entity_key.includes('cache')) {
      actions.push('Check cache hit rates and memory usage');
      actions.push('Verify cache cluster health');
    }
    
    const maxSeverity = Math.max(...situation.episodes.map(ep => severityWeight(ep.severity)));
    if (maxSeverity >= 0.75) {
      actions.push('Immediate escalation required');
    }
    
    return actions.slice(0, 5);
  }
}

// ---- Main Correlation Engine ----
class CorrelationEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.recent = [];
    this.situations = new Map();
    this.lastActivity = new Map();
    this.graphHints = { adj: {}, metadata: {} };
    this.performanceMetrics = {
      processingTime: 0,
      memoryUsage: 0,
      throughput: 0,
      dedupRate: 0,
      correlationAccuracy: 0,
      situationCount: 0,
      episodeCount: 0
    };
    
    this.episodeClusterer = new EpisodeClusterer();
    this.situationBuilder = new SituationBuilder();
    this.situationScorer = new SituationScorer();
    
    this.isRunning = false;
    this.processingInterval = null;
    this.performanceInterval = null;
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    this.processingInterval = setInterval(() => {
      this.processBatch();
    }, this.config.hopMs);

    this.performanceInterval = setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000);

    console.log('Correlation engine started');
  }

  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = null;
    }

    console.log('Correlation engine stopped');
  }

  addAlert(alert) {
    this.recent.push(alert);
    this.lastActivity.set(alert.entity_key || 'unknown', Date.now());
  }

  getBatch() {
    const batch = this.recent.splice(0, this.recent.length);
    this.performanceMetrics.throughput = batch.length / (this.config.hopMs / 1000);
    return batch;
  }

  async processBatch() {
    const startTime = performance.now();
    const batch = this.getBatch();
    
    if (batch.length === 0) return;

    try {
      // Step 1: Deduplication (simplified)
      const uniqAlerts = this.deduplicateAlerts(batch);
      
      // Step 2: Episode clustering
      const clusterResult = this.buildEpisodes(uniqAlerts);
      
      // Step 3: Situation building and scoring
      const situations = this.buildAndScoreSituations(clusterResult.episodes, clusterResult.alertsKept);
      
      // Update state
      this.updateSituations(situations);
      
      // Update performance metrics
      const processingTime = performance.now() - startTime;
      this.performanceMetrics.processingTime = processingTime;
      this.performanceMetrics.dedupRate = batch.length > 0 ? ((batch.length - uniqAlerts.length) / batch.length) * 100 : 0;
      this.performanceMetrics.correlationAccuracy = clusterResult.episodes.length > 0 ? 
        (clusterResult.alertsKept.length / uniqAlerts.length) * 100 : 0;
      this.performanceMetrics.episodeCount = clusterResult.episodes.length;
      
      // Emit situations for UI
      this.emitSituations(situations);

    } catch (error) {
      console.error('Error processing batch:', error);
    }
  }

  deduplicateAlerts(alerts) {
    const seen = new Map();
    const uniq = [];
    
    for (const alert of alerts) {
      const key = `${alert.fingerprint || alert.kind}|${alert.severity}|${alert.entity_key || alert.service || 'na'}`;
      const last = seen.get(key) || 0;
      
      if (alert.ts - last >= this.config.dedupTtlMs) {
        seen.set(key, alert.ts);
        uniq.push(alert);
      }
    }
    
    return uniq;
  }

  buildEpisodes(alerts) {
    const processedAlerts = [];
    
    for (const alert of alerts) {
      const episode = this.episodeClusterer.getOrCreateEpisode(alert);
      const wasUpdated = this.episodeClusterer.updateEpisode(episode, alert, this.config.episodeGapMs);
      
      if (wasUpdated) {
        processedAlerts.push(alert);
      } else {
        processedAlerts.push(alert);
      }
    }
    
    this.episodeClusterer.cleanupOldEpisodes(this.config.windowMs);
    const windowEpisodes = this.episodeClusterer.getEpisodesInWindow(this.config.windowMs);
    
    return {
      episodes: windowEpisodes.map(ep => ({
        ...ep,
        vendorMix: Array.from(ep.vendorMix)
      })),
      alertsKept: processedAlerts
    };
  }

  buildAndScoreSituations(episodes, alerts) {
    const situations = this.situationBuilder.buildSituations(episodes, alerts, this.config.windowMs);
    
    for (const situation of situations) {
      this.situationScorer.scoreSituation(situation, this.graphHints, this.config.maxLeadMs);
    }
    
    situations.sort((a, b) => b.score - a.score);
    return situations;
  }

  updateSituations(situations) {
    const now = Date.now();
    
    for (const situation of situations) {
      this.situations.set(situation.situation_id, situation);
      this.lastActivity.set(situation.situation_id, now);
    }

    for (const [id, situation] of this.situations) {
      if (now - situation.window.end > this.config.maxSituationLifetime) {
        this.situations.delete(id);
        this.lastActivity.delete(id);
      }
    }

    this.performanceMetrics.situationCount = this.situations.size;
  }

  updatePerformanceMetrics() {
    if ('memory' in performance) {
      const memory = performance.memory;
      this.performanceMetrics.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024);
    }
  }

  emitSituations(situations) {
    const event = new CustomEvent('situations-updated', {
      detail: {
        situations,
        metrics: this.getPerformanceMetrics(),
        timestamp: Date.now()
      }
    });
    window.dispatchEvent(event);
  }

  getSituations() {
    return Array.from(this.situations.values());
  }

  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  updateGraphHints(hints) {
    this.graphHints = hints;
  }
}

// ---- Main Application Class ----
export class BrowserCorrelator {
  constructor(config) {
    this.engine = new CorrelationEngine(config);
  }

  start(streamUrl, useWebSocket = true) {
    this.engine.start();
    console.log('Browser correlator started');
  }

  stop() {
    this.engine.stop();
    console.log('Browser correlator stopped');
  }

  addAlert(alert) {
    this.engine.addAlert(alert);
  }

  getSituations() {
    return this.engine.getSituations();
  }

  getPerformanceMetrics() {
    return this.engine.getPerformanceMetrics();
  }

  updateConfig(config) {
    this.engine.updateConfig(config);
  }

  updateGraphHints(hints) {
    this.engine.updateGraphHints(hints);
  }

  onSituationsUpdate(callback) {
    window.addEventListener('situations-updated', (event) => {
      callback(event.detail.situations, event.detail.metrics);
    });
  }

  onError(callback) {
    window.addEventListener('error', (event) => {
      callback(new Error(event.message));
    });
  }
}

// ---- Sample Data Generation ----
export function createSampleAlerts(count = 25, timeRangeHours = 2) {
  const alerts = [];
  const now = Date.now();
  const timeRangeMs = timeRangeHours * 60 * 60 * 1000;

  const services = ['checkout', 'payments', 'inventory', 'shipping', 'monitoring'];
  const components = ['api', 'database', 'cache', 'queue', 'worker'];
  const resources = ['pod/ck-1', 'pod/py-1', 'pod/in-1', 'pod/sh-1', 'pod/mon-1'];
  const sources = ['datadog', 'logicmonitor', 'k8s'];

  for (let i = 0; i < count; i++) {
    const timestamp = now - Math.random() * timeRangeMs;
    const service = services[Math.floor(Math.random() * services.length)];
    const component = components[Math.floor(Math.random() * components.length)];
    const resource = resources[Math.floor(Math.random() * resources.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const severity = Math.random() < 0.1 ? 'critical' : Math.random() < 0.3 ? 'high' : 'medium';

    const alert = {
      ts: timestamp,
      source: source,
      vendor_event_id: `${source}-${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: `fp-${service}-${component}-${severity}`,
      status: 'firing',
      severity: severity,
      kind: 'http_error',
      service,
      component,
      resource,
      env: 'prod',
      region: 'us-west1',
      cluster: 'gke-manifest',
      ns: service,
      pod: resource.split('/')[1],
      host: `node-${Math.floor(Math.random() * 5) + 1}`,
      error_code: '500',
      tags: { route: '/api/v1', code: '500', latency: Math.floor(100 + Math.random() * 900) },
      entity_key: `${service}|${component}`,
      deploy_key: Math.random() < 0.2 ? `sha-${Math.random().toString(36).slice(2, 8)}` : undefined,
      net_key: 'edge->api',
      k8s_key: `gke-manifest/${service}/${resource.split('/')[1]}`
    };

    alerts.push(alert);
  }

  alerts.sort((a, b) => a.ts - b.ts);
  return alerts;
}

// ---- Global Instance ----
export const correlator = new BrowserCorrelator();

// ---- Auto-start in development ----
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  setTimeout(() => {
    const sampleAlerts = createSampleAlerts(50, 4);
    sampleAlerts.forEach(alert => correlator.addAlert(alert));
    correlator.start();
  }, 1000);
}
