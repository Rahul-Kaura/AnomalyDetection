// src/main.ts - Main orchestrator for browser-side correlator
import { 
  Alert, 
  Episode, 
  Situation, 
  GraphHints, 
  CorrelationConfig, 
  PerformanceMetrics,
  WorkerResponse 
} from './types';

// ---- Configuration ----
const DEFAULT_CONFIG: CorrelationConfig = {
  windowMs: 15 * 60_000,         // 15 minute sliding window
  hopMs: 1_000,                  // 1 second batch hop
  dedupTtlMs: 120_000,           // 2 minute dedup TTL
  episodeGapMs: 120_000,         // 2 minute episode gap
  maxLeadMs: 90_000,             // 90 second causal test horizon
  maxSituationLifetime: 90 * 60_000, // 90 minute situation lifetime
  quietThreshold: 15 * 60_000    // 15 minute quiet threshold
};

// ---- State Management ----
class CorrelationState {
  private recent: Alert[] = [];
  private situations: Map<string, Situation> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private config: CorrelationConfig;
  private graphHints: GraphHints = { adj: {}, metadata: {} };
  private performanceMetrics: PerformanceMetrics = {
    processingTime: 0,
    memoryUsage: 0,
    throughput: 0,
    dedupRate: 0,
    correlationAccuracy: 0,
    situationCount: 0,
    episodeCount: 0
  };

  constructor(config: Partial<CorrelationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  addAlert(alert: Alert): void {
    this.recent.push(alert);
    this.lastActivity.set(alert.entity_key || 'unknown', Date.now());
  }

  getBatch(): Alert[] {
    const now = Date.now();
    const cutoff = now - this.config.hopMs;
    const batch = this.recent.splice(0, this.recent.length);
    
    // Update throughput
    this.performanceMetrics.throughput = batch.length / (this.config.hopMs / 1000);
    
    return batch;
  }

  updateSituations(situations: Situation[]): void {
    const now = Date.now();
    
    // Update existing situations
    for (const situation of situations) {
      this.situations.set(situation.situation_id, situation);
      this.lastActivity.set(situation.situation_id, now);
    }

    // Clean up old situations
    for (const [id, situation] of this.situations) {
      if (now - situation.window.end > this.config.maxSituationLifetime) {
        this.situations.delete(id);
        this.lastActivity.delete(id);
      }
    }

    this.performanceMetrics.situationCount = this.situations.size;
  }

  getSituations(): Situation[] {
    return Array.from(this.situations.values());
  }

  updateGraphHints(hints: GraphHints): void {
    this.graphHints = hints;
  }

  updatePerformanceMetrics(metrics: Partial<PerformanceMetrics>): void {
    this.performanceMetrics = { ...this.performanceMetrics, ...metrics };
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  getConfig(): CorrelationConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<CorrelationConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ---- Web Worker Management ----
class WorkerManager {
  private workers: Map<string, Worker> = new Map();
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor() {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    // Initialize dedup worker
    const dedupWorker = new Worker(new URL('./workers/dedup.worker.ts', import.meta.url), { type: 'module' });
    dedupWorker.onmessage = this.handleWorkerMessage.bind(this, 'dedup');
    this.workers.set('dedup', dedupWorker);

    // Initialize cluster worker
    const clusterWorker = new Worker(new URL('./workers/cluster.worker.ts', import.meta.url), { type: 'module' });
    clusterWorker.onmessage = this.handleWorkerMessage.bind(this, 'cluster');
    this.workers.set('cluster', clusterWorker);

    // Initialize score worker
    const scoreWorker = new Worker(new URL('./workers/score.worker.ts', import.meta.url), { type: 'module' });
    scoreWorker.onmessage = this.handleWorkerMessage.bind(this, 'score');
    this.workers.set('score', scoreWorker);
  }

  private handleWorkerMessage(workerType: string, event: MessageEvent): void {
    const handler = this.messageHandlers.get(workerType);
    if (handler) {
      handler(event.data);
    }
  }

  postMessage<T>(workerType: string, message: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = this.workers.get(workerType);
      if (!worker) {
        reject(new Error(`Worker ${workerType} not found`));
        return;
      }

      const messageId = `${workerType}_${Date.now()}_${Math.random()}`;
      const handler = (data: WorkerResponse<T>) => {
        if (data.success) {
          resolve(data.data!);
        } else {
          reject(new Error(data.error || 'Worker error'));
        }
        this.messageHandlers.delete(messageId);
      };

      this.messageHandlers.set(messageId, handler);
      worker.postMessage({ ...message, messageId });
    });
  }

  terminate(): void {
    for (const worker of this.workers.values()) {
      worker.terminate();
    }
    this.workers.clear();
    this.messageHandlers.clear();
  }
}

// ---- Main Correlation Engine ----
class CorrelationEngine {
  private state: CorrelationState;
  private workers: WorkerManager;
  private isRunning: boolean = false;
  private processingInterval?: number;
  private performanceInterval?: number;

  constructor(config?: Partial<CorrelationConfig>) {
    this.state = new CorrelationState(config);
    this.workers = new WorkerManager();
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Start processing loop
    this.processingInterval = window.setInterval(() => {
      this.processBatch();
    }, this.state.getConfig().hopMs);

    // Start performance monitoring
    this.performanceInterval = window.setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000);

    console.log('Correlation engine started');
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = undefined;
    }

    this.workers.terminate();
    console.log('Correlation engine stopped');
  }

  private async processBatch(): Promise<void> {
    const startTime = performance.now();
    const batch = this.state.getBatch();
    
    if (batch.length === 0) return;

    try {
      // Step 1: Deduplication
      const uniqAlerts = await this.workers.postMessage<Alert[]>('dedup', {
        type: 'dedup',
        batch,
        ttlMs: this.state.getConfig().dedupTtlMs,
        config: this.state.getConfig()
      });

      // Step 2: Episode clustering
      const clusterResult = await this.workers.postMessage<{ episodes: Episode[]; alertsKept: Alert[] }>('cluster', {
        type: 'cluster',
        batch: uniqAlerts,
        gapMs: this.state.getConfig().episodeGapMs,
        windowMs: this.state.getConfig().windowMs,
        config: this.state.getConfig()
      });

      // Step 3: Situation building and scoring
      const situations = await this.workers.postMessage<Situation[]>('score', {
        type: 'score',
        episodes: clusterResult.episodes,
        alerts: clusterResult.alertsKept,
        graphHints: this.state.graphHints,
        maxLeadMs: this.state.getConfig().maxLeadMs,
        windowMs: this.state.getConfig().windowMs,
        config: this.state.getConfig()
      });

      // Update state
      this.state.updateSituations(situations);
      
      // Update performance metrics
      const processingTime = performance.now() - startTime;
      this.state.updatePerformanceMetrics({
        processingTime,
        dedupRate: batch.length > 0 ? ((batch.length - uniqAlerts.length) / batch.length) * 100 : 0,
        correlationAccuracy: clusterResult.episodes.length > 0 ? 
          (clusterResult.alertsKept.length / uniqAlerts.length) * 100 : 0,
        episodeCount: clusterResult.episodes.length
      });

      // Emit situations for UI
      this.emitSituations(situations);

    } catch (error) {
      console.error('Error processing batch:', error);
    }
  }

  private updatePerformanceMetrics(): void {
    // Update memory usage
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.state.updatePerformanceMetrics({
        memoryUsage: Math.round(memory.usedJSHeapSize / 1024 / 1024)
      });
    }
  }

  private emitSituations(situations: Situation[]): void {
    // Dispatch custom event for UI consumption
    const event = new CustomEvent('situations-updated', {
      detail: {
        situations,
        metrics: this.state.getPerformanceMetrics(),
        timestamp: Date.now()
      }
    });
    window.dispatchEvent(event);
  }

  // Public API
  addAlert(alert: Alert): void {
    this.state.addAlert(alert);
  }

  getSituations(): Situation[] {
    return this.state.getSituations();
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return this.state.getPerformanceMetrics();
  }

  updateConfig(config: Partial<CorrelationConfig>): void {
    this.state.updateConfig(config);
  }

  updateGraphHints(hints: GraphHints): void {
    this.state.updateGraphHints(hints);
  }
}

// ---- WebSocket/SSE Integration ----
class AlertStream {
  private ws?: WebSocket;
  private eventSource?: EventSource;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;

  constructor(
    private url: string,
    private onAlert: (alert: Alert) => void,
    private useWebSocket: boolean = true
  ) {}

  connect(): void {
    if (this.useWebSocket) {
      this.connectWebSocket();
    } else {
      this.connectEventSource();
    }
  }

  private connectWebSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const alert = JSON.parse(event.data) as Alert;
          this.onAlert(alert);
        } catch (error) {
          console.error('Error parsing alert:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private connectEventSource(): void {
    try {
      this.eventSource = new EventSource(this.url);
      
      this.eventSource.onopen = () => {
        console.log('EventSource connected');
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const alert = JSON.parse(event.data) as Alert;
          this.onAlert(alert);
        } catch (error) {
          console.error('Error parsing alert:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        this.eventSource?.close();
        this.scheduleReconnect();
      };

    } catch (error) {
      console.error('Error creating EventSource:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
  }
}

// ---- Main Application Class ----
export class BrowserCorrelator {
  private engine: CorrelationEngine;
  private stream?: AlertStream;
  private config: CorrelationConfig;

  constructor(config?: Partial<CorrelationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.engine = new CorrelationEngine(this.config);
  }

  start(streamUrl?: string, useWebSocket: boolean = true): void {
    // Start correlation engine
    this.engine.start();

    // Start alert stream if URL provided
    if (streamUrl) {
      this.stream = new AlertStream(streamUrl, (alert) => {
        this.engine.addAlert(alert);
      }, useWebSocket);
      this.stream.connect();
    }

    console.log('Browser correlator started');
  }

  stop(): void {
    if (this.stream) {
      this.stream.disconnect();
    }
    this.engine.stop();
    console.log('Browser correlator stopped');
  }

  // Public API
  addAlert(alert: Alert): void {
    this.engine.addAlert(alert);
  }

  getSituations(): Situation[] {
    return this.engine.getSituations();
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return this.engine.getPerformanceMetrics();
  }

  updateConfig(config: Partial<CorrelationConfig>): void {
    this.engine.updateConfig(config);
  }

  updateGraphHints(hints: GraphHints): void {
    this.engine.updateGraphHints(hints);
  }

  // Event listeners for UI
  onSituationsUpdate(callback: (situations: Situation[], metrics: PerformanceMetrics) => void): void {
    window.addEventListener('situations-updated', (event: any) => {
      callback(event.detail.situations, event.detail.metrics);
    });
  }

  onError(callback: (error: Error) => void): void {
    window.addEventListener('error', (event) => {
      callback(new Error(event.message));
    });
  }
}

// ---- Development/Testing Support ----
export function createSampleAlerts(count: number = 25, timeRangeHours: number = 2): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();
  const timeRangeMs = timeRangeHours * 60 * 60 * 1000;

  const services = ['checkout', 'payments', 'inventory', 'shipping', 'monitoring'];
  const components = ['api', 'database', 'cache', 'queue', 'worker'];
  const resources = ['pod/ck-1', 'pod/py-1', 'pod/in-1', 'pod/sh-1', 'pod/mon-1'];
  const vendors: Array<'datadog' | 'logicmonitor' | 'k8s'> = ['datadog', 'logicmonitor', 'k8s'];

  for (let i = 0; i < count; i++) {
    const timestamp = now - Math.random() * timeRangeMs;
    const service = services[Math.floor(Math.random() * services.length)];
    const component = components[Math.floor(Math.random() * components.length)];
    const resource = resources[Math.floor(Math.random() * resources.length)];
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const severity = Math.random() < 0.1 ? 'critical' : Math.random() < 0.3 ? 'high' : 'medium';

    const alert: Alert = {
      ts: timestamp,
      source: 'monitoring-system',
      vendor_event_id: `${vendor}-${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: `fp-${service}-${component}-${severity}`,
      status: 'firing',
      severity: severity as any,
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

  // Sort by timestamp
  alerts.sort((a, b) => a.ts - b.ts);
  return alerts;
}

// ---- Global Instance ----
export const correlator = new BrowserCorrelator();

// ---- Auto-start in development ----
if (import.meta.env?.DEV) {
  // Start with sample data
  setTimeout(() => {
    const sampleAlerts = createSampleAlerts(50, 4);
    sampleAlerts.forEach(alert => correlator.addAlert(alert));
    correlator.start();
  }, 1000);
}
