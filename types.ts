// src/types.ts - Complete type definitions for browser-side correlator
export type Vendor = 'datadog' | 'logicmonitor' | 'k8s' | 'other';

export interface Alert {
  ts: number;                     // epoch ms, server time
  source: string;                 // source system
  vendor_event_id: string;        // unique event ID from vendor
  fingerprint: string;            // stable hash on title|labels
  status: 'firing' | 'resolved' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  kind: string;                   // alert type
  service?: string;
  component?: string;
  resource?: string;
  env?: string;
  region?: string;
  cluster?: string;
  ns?: string;                    // namespace
  pod?: string;
  host?: string;
  error_code?: string;
  tags?: Record<string, string | number | boolean>;
  
  // Derived keys on ingest
  entity_key?: string;            // service|component|resource
  deploy_key?: string;            // git sha or release
  net_key?: string;               // src_ip→dst_ip
  k8s_key?: string;               // cluster/ns/pod
}

export interface Episode {
  entity_key: string;
  fingerprint: string;
  vendorMix: Set<Vendor>;
  start: number;
  end: number;
  count: number;
  ids: string[];                  // vendor_event_id samples
  alerts: Alert[];                // optional, may be truncated by policy
  severity: string;               // highest severity in episode
}

export interface ChangeRef {
  type: 'deploy' | 'config' | 'infra' | 'unknown';
  key: string;                    // sha or change id
  ts: number;                     // change start
  entity_key?: string;            // affected entity
  description?: string;
}

export interface Situation {
  situation_id: string;
  window: { start: number; end: number };
  episodes: Episode[];
  related_alerts: Alert[];        // compact, may be sampled
  change_refs: ChangeRef[];
  blast_radius: { entities: number; services: number };
  primary_cause?: {
    entity: string;
    episodeIdx: number;
    confidence: number;           // 0..1
    lag_ms: number;               // 0..90_000 if accepted
  };
  score: number;                  // composite score
  next_actions?: string[];        // suggested actions
}

export interface GraphHints {
  // adjacency list of dependency edges entity->neighbors
  adj: Record<string, string[]>;
  // metadata for entities
  metadata: Record<string, {
    owner?: string;
    blast_radius?: number;
    dependencies?: string[];
    change_refs?: ChangeRef[];
  }>;
}

export interface DedupState {
  lastSeen: Map<string, number>;
  counts: Map<string, number>;
  flapCounts: Map<string, number>;
  lastToggle: Map<string, number>;
}

export interface EpisodeState {
  episodes: Map<string, Episode>;
  entityEpisodes: Map<string, string[]>; // entity_key -> episode keys
}

export interface CorrelationConfig {
  windowMs: number;               // sliding window span
  hopMs: number;                  // batch hop
  dedupTtlMs: number;             // collapse repeats
  episodeGapMs: number;           // new episode if gap > X
  maxLeadMs: number;              // causal test horizon
  maxSituationLifetime: number;   // auto-resolve after X
  quietThreshold: number;         // resolve if quiet for X
}

export interface PerformanceMetrics {
  processingTime: number;
  memoryUsage: number;
  throughput: number;             // alerts per second
  dedupRate: number;              // percentage of duplicates
  correlationAccuracy: number;    // percentage of correlated alerts
  situationCount: number;
  episodeCount: number;
}

export interface WorkerMessage {
  type: string;
  [key: string]: any;
}

export interface DedupMessage extends WorkerMessage {
  type: 'dedup';
  batch: Alert[];
  ttlMs: number;
  config: CorrelationConfig;
}

export interface ClusterMessage extends WorkerMessage {
  type: 'cluster';
  batch: Alert[];
  gapMs: number;
  windowMs: number;
  config: CorrelationConfig;
}

export interface ScoreMessage extends WorkerMessage {
  type: 'score';
  episodes: Episode[];
  alerts: Alert[];
  graphHints: GraphHints;
  maxLeadMs: number;
  windowMs: number;
  config: CorrelationConfig;
}

export interface WorkerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metrics?: PerformanceMetrics;
}
