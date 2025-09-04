// src/workers/score.worker.ts - Situation building and scoring worker
import { Alert, Episode, Situation, GraphHints, ScoreMessage, WorkerResponse, CorrelationConfig } from '../types';

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

// Utility functions
function union<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set(a);
  for (const item of b) result.add(item);
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  
  const intersection = new Set([...a].filter(x => b.has(x)));
  const unionSize = a.size + b.size - intersection.size;
  return intersection.size / unionSize;
}

// Build situations by cross-joining episodes
function buildSituations(episodes: Episode[], alerts: Alert[], windowMs: number): Situation[] {
  if (episodes.length === 0) return [];
  
  // Sort episodes by start time
  episodes.sort((a, b) => a.start - b.start);
  
  // Union-find style clustering
  const parent = new Map<Episode, Episode>();
  const find = (x: Episode): Episode => {
    if (parent.get(x) === x || !parent.get(x)) {
      parent.set(x, x);
      return x;
    }
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  };
  
  const unite = (a: Episode, b: Episode) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  
  // Initialize parent map
  for (const episode of episodes) {
    parent.set(episode, episode);
  }
  
  // Join episodes that are joinable
  for (let i = 0; i < episodes.length; i++) {
    for (let j = i + 1; j < episodes.length; j++) {
      if (joinable(episodes[i], episodes[j])) {
        unite(episodes[i], episodes[j]);
      }
    }
  }
  
  // Group episodes by root
  const buckets = new Map<Episode, Episode[]>();
  for (const episode of episodes) {
    const root = find(episode);
    if (!buckets.has(root)) {
      buckets.set(root, []);
    }
    buckets.get(root)!.push(episode);
  }
  
  // Create situations from groups
  const situations: Situation[] = [];
  for (const group of buckets.values()) {
    if (group.length === 0) continue;
    
    const start = Math.min(...group.map(g => g.start));
    const end = Math.max(...group.map(g => g.end));
    
    // Get related alerts within the time window
    const related = alerts.filter(a => a.ts >= start && a.ts <= end);
    
    // Calculate blast radius
    const uniqueEntities = new Set(group.map(g => g.entity_key));
    const uniqueServices = new Set(group.map(g => g.alerts.map(a => a.service).filter(Boolean)).flat());
    
    const situation: Situation = {
      situation_id: `S-${start}-${end}-${group.length}`,
      window: { start, end },
      episodes: group,
      related_alerts: related.slice(0, 200), // Cap at 200 alerts
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

// Check if two episodes can be joined
function joinable(e1: Episode, e2: Episode): boolean {
  if (e1 === e2) return false;
  
  // Time overlap check
  const timeOverlap = !(e1.end < e2.start || e2.end < e1.start);
  if (!timeOverlap) return false;
  
  // Entity similarity check
  const entitySimilarity = e1.entity_key === e2.entity_key ? 1.0 : 0.0;
  
  // Fingerprint similarity check
  const fingerprintSimilarity = e1.fingerprint === e2.fingerprint ? 1.0 : 0.0;
  
  // Multi-vendor echo check
  const vendorOverlap = jaccard(new Set([...e1.vendorMix]), new Set([...e2.vendorMix]));
  
  // Join if any similarity is high enough
  return entitySimilarity > 0.8 || fingerprintSimilarity > 0.8 || vendorOverlap > 0.3;
}

// Lead-lag correlation analysis
function corrLeadLag(aTs: number[], bTs: number[], maxLeadMs: number): { lagMs: number; score: number } {
  if (aTs.length === 0 || bTs.length === 0) {
    return { lagMs: 0, score: 0 };
  }
  
  // Bucket timestamps to 1-second bins for speed
  const toBins = (ts: number[]) => {
    const bins = new Map<number, number>();
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
  
  // Compute cross-correlation for different lags
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

// Shortest path length in dependency graph
function shortestPathLen(adj: Record<string, string[]>, src: string, dst: string, limit: number = 4): number {
  if (src === dst) return 0;
  if (!adj[src] || !adj[dst]) return Infinity;
  
  const queue: [string, number][] = [[src, 0]];
  const seen = new Set<string>([src]);
  
  while (queue.length > 0) {
    const [current, distance] = queue.shift()!;
    
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

// Severity weight mapping
function severityWeight(severity: string): number {
  switch (severity) {
    case 'critical': return 1.0;
    case 'high': return 0.75;
    case 'medium': return 0.5;
    case 'low': return 0.25;
    default: return 0.25;
  }
}

// Score a situation
function scoreSituation(situation: Situation, graphHints: GraphHints, maxLeadMs: number): void {
  if (situation.episodes.length === 0) return;
  
  // Pick candidate cause as earliest episode
  const sortedEpisodes = [...situation.episodes].sort((a, b) => a.start - b.start);
  const cause = sortedEpisodes[0];
  const others = sortedEpisodes.slice(1);
  
  // Lead-lag correlation
  let bestLag = { lagMs: 0, score: 0 };
  for (const episode of others) {
    const causeTs = cause.alerts.map(a => a.ts);
    const effectTs = episode.alerts.map(a => a.ts);
    const lag = corrLeadLag(causeTs, effectTs, maxLeadMs);
    
    if (lag.score > bestLag.score) {
      bestLag = lag;
    }
  }
  
  // Graph path check
  let bestPath = Infinity;
  for (const episode of others) {
    const pathLen = shortestPathLen(graphHints.adj || {}, cause.entity_key, episode.entity_key, 4);
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
  const flapPenalty = 0; // Can be enhanced with toggle analysis
  const echoPenalty = Math.max(0, (situation.episodes.reduce((acc, ep) => acc + ep.vendorMix.length, 0) - situation.episodes.length) * 0.05);
  
  // Composite scoring
  const w1 = 0.35, w2 = 0.2, w3 = 0.2, w4 = 0.15, w5 = 0.15, w6 = 0.1, w7 = 0.05;
  const composite = w1 * changeProx + 
                   w2 * bestLag.score + 
                   w3 * pathScore + 
                   w4 * cardinality + 
                   w5 * severity - 
                   w6 * flapPenalty - 
                   w7 * echoPenalty;
  
  // Set primary cause and score
  situation.primary_cause = {
    entity: cause.entity_key,
    episodeIdx: situation.episodes.indexOf(cause),
    confidence: Math.min(1, composite),
    lag_ms: bestLag.lagMs
  };
  
  situation.score = composite;
  
  // Generate next actions based on cause
  situation.next_actions = generateNextActions(cause, situation);
}

// Generate next actions based on cause
function generateNextActions(cause: Episode, situation: Situation): string[] {
  const actions: string[] = [];
  
  // Add generic actions based on blast radius
  if (situation.blast_radius.entities > 5) {
    actions.push('Page oncall team - multiple services affected');
  }
  
  if (situation.blast_radius.services > 3) {
    actions.push('Check shared infrastructure components');
  }
  
  // Add specific actions based on entity type
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
  
  // Add severity-based actions
  const maxSeverity = Math.max(...situation.episodes.map(ep => severityWeight(ep.severity)));
  if (maxSeverity >= 0.75) {
    actions.push('Immediate escalation required');
  }
  
  return actions.slice(0, 5); // Limit to 5 actions
}

// Main message handler
self.onmessage = (event: MessageEvent) => {
  const message = event.data as ScoreMessage;
  
  if (message.type !== 'score') {
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
    
    const { episodes, alerts, graphHints, maxLeadMs, windowMs } = message;
    const startTime = performance.now();
    
    // Build situations
    const situations = buildSituations(episodes, alerts, windowMs);
    
    // Score each situation
    for (const situation of situations) {
      scoreSituation(situation, graphHints, maxLeadMs);
    }
    
    // Sort situations by score
    situations.sort((a, b) => b.score - a.score);
    
    // Post response
    postMessage({
      success: true,
      data: situations,
      metrics: {
        processingTime: performance.now() - startTime,
        memoryUsage: 0, // Will be updated by main thread
        throughput: 0,
        dedupRate: 0,
        correlationAccuracy: situations.length > 0 ? 
          (situations.reduce((sum, s) => sum + s.related_alerts.length, 0) / alerts.length) * 100 : 0,
        situationCount: situations.length,
        episodeCount: episodes.length
      }
    } as WorkerResponse);
    
  } catch (error) {
    console.error('Score worker error:', error);
    postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
};

// Handle worker errors
self.onerror = (error: ErrorEvent) => {
  console.error('Score worker error:', error);
  postMessage({
    success: false,
    error: error.message || 'Worker error'
  } as WorkerResponse);
};

// Handle unhandled rejections
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  console.error('Score worker unhandled rejection:', event.reason);
  postMessage({
    success: false,
    error: event.reason?.message || 'Unhandled rejection'
  } as WorkerResponse);
};
