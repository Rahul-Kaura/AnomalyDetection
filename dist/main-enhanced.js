// Enhanced Browser Correlator with K8s Event-to-Alert Conversion
// Multi-source correlation: K8s, Datadog, LogicMonitor

// ===== CONFIGURATION =====
const CONFIG = {
    // K8s Event Threshold Rules
    k8sRules: [
        {
            name: "CrashLoopBackOff bursts",
            key: ["namespace", "involvedObject.name"],
            match: { reason: "BackOff", type: "Warning" },
            threshold: 5,
            severity: "high",
            window: 5 * 60 * 1000, // 5 minutes
            cooldown: 10 * 60 * 1000 // 10 minutes
        },
        {
            name: "ImagePull failures",
            key: ["namespace", "reason"],
            match: { reason: "Failed", messagePattern: "ImagePull" },
            threshold: 3,
            severity: "medium",
            window: 5 * 60 * 1000,
            cooldown: 10 * 60 * 1000
        },
        {
            name: "Node not ready",
            key: ["involvedObject.kind", "involvedObject.name"],
            match: { reason: "NodeNotReady" },
            threshold: 1,
            severity: "critical",
            window: 5 * 60 * 1000,
            cooldown: 15 * 60 * 1000
        },
        {
            name: "Excessive Pod Evictions",
            key: ["namespace", "reason"],
            match: { reason: "Evicted" },
            threshold: 10,
            severity: "medium",
            window: 10 * 60 * 1000,
            cooldown: 15 * 60 * 1000
        },
        {
            name: "ConfigMap Change Spike",
            key: ["namespace", "involvedObject.kind"],
            match: { reason: "Modified", involvedObjectKind: "ConfigMap" },
            threshold: 7,
            severity: "low",
            window: 15 * 60 * 1000,
            cooldown: 20 * 60 * 1000
        }
    ],
    
    // Correlation settings
    correlationWindow: 15 * 60 * 1000, // 15 minutes
    maxLeadTime: 90 * 1000, // 90 seconds
    dedupTTL: 120 * 1000, // 2 minutes
    
    // Test data generation
    testDataInterval: 2000, // 2 seconds
    maxTestAlerts: 1000
};

// ===== TYPES =====
class K8sEvent {
    constructor(data) {
        this.ts = new Date(data.ts).getTime();
        this.namespace = data.namespace || "";
        this.reason = data.reason;
        this.type = data.type;
        this.message = data.message;
        this.involvedObject = data.involvedObject || {};
        this.labels = data.labels || {};
        this.raw = data;
    }
    
    getKey(rule) {
        return rule.key.map(k => {
            if (k === "involvedObject.name") return this.involvedObject.name || "";
            if (k === "involvedObject.kind") return this.involvedObject.kind || "";
            return this[k] || "";
        }).join("|");
    }
    
    matches(rule) {
        for (const [key, value] of Object.entries(rule.match)) {
            if (key === "messagePattern") {
                if (!this.message.includes(value)) return false;
            } else if (key === "involvedObjectKind") {
                if (this.involvedObject.kind !== value) return false;
            } else if (this[key] !== value) {
                return false;
            }
        }
        return true;
    }
}

class Alert {
    constructor(source, data) {
        this.id = `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.source = source;
        this.ts = new Date(data.ts || Date.now()).getTime();
        this.status = data.status || 'firing';
        this.severity = data.severity || 'medium';
        this.title = data.title || data.alert || 'Unknown Alert';
        this.message = data.message || '';
        this.namespace = data.namespace || '';
        this.service = data.service || '';
        this.component = data.component || '';
        this.resource = data.resource || data.pod || data.node || '';
        this.env = data.env || 'prod';
        this.region = data.region || 'us-west1';
        this.cluster = data.cluster || 'gke-prod';
        this.pod = data.pod || '';
        this.node = data.node || '';
        this.error_code = data.error_code || '';
        this.tags = data.tags || {};
        this.count = data.count || 1;
        this.window = data.window || '';
        this.first_ts = data.first_ts || '';
        this.last_ts = data.last_ts || '';
        
        // Derived keys for correlation
        this.entity_key = this.service || this.component || this.resource || this.namespace || 'unknown';
        this.deploy_key = data.deploy_key || data.git_sha || '';
        this.net_key = data.net_key || '';
        this.k8s_key = this.cluster + '/' + this.namespace + '/' + this.pod;
        this.fingerprint = this.generateFingerprint();
    }
    
    generateFingerprint() {
        const key = `${this.title}|${this.entity_key}|${this.severity}|${this.source}`;
        return btoa(key).replace(/[^a-zA-Z0-9]/g, '').substr(0, 16);
    }
}

class Episode {
    constructor(alert) {
        this.entity_key = alert.entity_key;
        this.fingerprint = alert.fingerprint;
        this.source = alert.source;
        this.start = alert.ts;
        this.end = alert.ts;
        this.count = 1;
        this.alerts = [alert];
        this.severity = alert.severity;
        this.namespace = alert.namespace;
        this.service = alert.service;
    }
    
    addAlert(alert) {
        this.end = alert.ts;
        this.count++;
        if (this.alerts.length < 50) this.alerts.push(alert);
        if (alert.severity === 'critical' || 
            (this.severity !== 'critical' && alert.severity === 'high')) {
            this.severity = alert.severity;
        }
    }
    
    canJoin(other, maxTimeDiff = 5 * 60 * 1000) {
        if (Math.abs(this.end - other.start) > maxTimeDiff) return false;
        
        // Check for correlation keys
        if (this.deploy_key && this.deploy_key === other.deploy_key) return true;
        if (this.net_key && this.net_key === other.net_key) return true;
        if (this.entity_key === other.entity_key) return true;
        if (this.namespace && this.namespace === other.namespace) return true;
        
        return false;
    }
}

class Situation {
    constructor(episodes) {
        this.id = `S-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        this.episodes = episodes;
        this.start = Math.min(...episodes.map(e => e.start));
        this.end = Math.max(...episodes.map(e => e.end));
        this.sources = [...new Set(episodes.map(e => e.source))];
        this.entities = [...new Set(episodes.map(e => e.entity_key))];
        this.services = [...new Set(episodes.map(e => e.service).filter(Boolean))];
        this.namespaces = [...new Set(episodes.map(e => e.namespace).filter(Boolean))];
        this.severity = this.calculateSeverity();
        this.score = this.calculateScore();
        this.primary_cause = this.identifyPrimaryCause();
        this.blast_radius = {
            entities: this.entities.length,
            services: this.services.length,
            namespaces: this.namespaces.length
        };
    }
    
    calculateSeverity() {
        const severityOrder = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
        return this.episodes.reduce((max, ep) => {
            return severityOrder[ep.severity] > severityOrder[max] ? ep.severity : max;
        }, 'low');
    }
    
    calculateScore() {
        let score = 0;
        
        // Base score from severity
        const severityScores = { 'low': 0.25, 'medium': 0.5, 'high': 0.75, 'critical': 1.0 };
        score += severityScores[this.severity] * 0.3;
        
        // Multi-source bonus
        if (this.sources.length > 1) score += 0.2;
        
        // Blast radius bonus
        score += Math.min(this.blast_radius.entities * 0.1, 0.3);
        
        // Time span consideration
        const duration = this.end - this.start;
        if (duration < 5 * 60 * 1000) score += 0.2; // Recent
        else if (duration > 30 * 60 * 1000) score -= 0.1; // Stale
        
        return Math.min(Math.max(score, 0), 1);
    }
    
    identifyPrimaryCause() {
        // Find the earliest critical/high severity episode
        const sorted = [...this.episodes].sort((a, b) => a.start - b.start);
        const critical = sorted.find(e => e.severity === 'critical');
        const high = sorted.find(e => e.severity === 'high');
        
        const primary = critical || high || sorted[0];
        return {
            entity: primary.entity_key,
            source: primary.source,
            confidence: this.score,
            timestamp: primary.start
        };
    }
}

// ===== K8S EVENT PROCESSOR =====
class K8sEventProcessor {
    constructor() {
        this.ruleStates = new Map();
        this.cooldowns = new Map();
        this.generatedAlerts = [];
    }
    
    processEvent(eventData) {
        const event = new K8sEvent(eventData);
        
        for (const rule of CONFIG.k8sRules) {
            if (!event.matches(rule)) continue;
            
            const key = event.getKey(rule);
            const ruleKey = `${rule.name}|${key}`;
            
            // Initialize state for this rule+key combination
            if (!this.ruleStates.has(ruleKey)) {
                this.ruleStates.set(ruleKey, []);
            }
            
            const state = this.ruleStates.get(ruleKey);
            const now = event.ts;
            
            // Prune old events outside the window
            const cutoff = now - rule.window;
            while (state.length > 0 && state[0] < cutoff) {
                state.shift();
            }
            
            // Add current event
            state.push(now);
            
            // Check if threshold is met and not in cooldown
            if (state.length >= rule.threshold && !this.isInCooldown(ruleKey, now)) {
                const alert = this.createAlertFromRule(rule, key, state, event);
                this.generatedAlerts.push(alert);
                this.startCooldown(ruleKey, now, rule.cooldown);
            }
        }
        
        return this.generatedAlerts;
    }
    
    isInCooldown(ruleKey, now) {
        const cooldownEnd = this.cooldowns.get(ruleKey);
        return cooldownEnd && now < cooldownEnd;
    }
    
    startCooldown(ruleKey, now, cooldownMs) {
        this.cooldowns.set(ruleKey, now + cooldownMs);
    }
    
    createAlertFromRule(rule, key, state, event) {
        const keyParts = key.split('|');
        const alertData = {
            ts: new Date().toISOString(),
            alert: rule.name,
            severity: rule.severity,
            namespace: event.namespace,
            reason: event.reason,
            count: state.length,
            window: `${rule.window / 60000}m`,
            first_ts: new Date(state[0]).toISOString(),
            last_ts: new Date(state[state.length - 1]).toISOString(),
            message: `${rule.name}: ${state.length} events in ${rule.window / 60000} minutes`,
            source: 'k8s',
            status: 'firing',
            service: event.namespace,
            component: event.involvedObject.kind,
            resource: event.involvedObject.name,
            cluster: 'gke-prod',
            env: 'prod',
            region: 'us-west1',
            tags: { signal: 'k8s_event', rule: rule.name, key: key }
        };
        
        // Add key-specific fields
        if (rule.key.includes('involvedObject.name')) {
            alertData.pod = keyParts[rule.key.indexOf('involvedObject.name')];
        }
        if (rule.key.includes('involvedObject.kind')) {
            alertData.component = keyParts[rule.key.indexOf('involvedObject.kind')];
        }
        
        return new Alert('k8s', alertData);
    }
    
    getGeneratedAlerts() {
        return this.generatedAlerts;
    }
    
    clearGeneratedAlerts() {
        this.generatedAlerts = [];
    }
}

// ===== TEST DATA GENERATOR =====
class TestDataGenerator {
    constructor() {
        this.k8sProcessor = new K8sEventProcessor();
        this.alertCount = 0;
        this.lastK8sEventTime = Date.now() - 10 * 60 * 1000; // Start 10 minutes ago
    }
    
    generateK8sEvents() {
        const events = [];
        const now = Date.now();
        
        // Generate CrashLoopBackOff events
        for (let i = 0; i < 8; i++) {
            events.push({
                ts: new Date(this.lastK8sEventTime + i * 30000).toISOString(),
                namespace: "shop",
                reason: "BackOff",
                type: "Warning",
                message: "Back-off restarting failed container",
                involvedObject: { kind: "Pod", name: "cart-6c7b9f77cc-7sftn" },
                labels: { app: "cart", version: "v1.2.3" }
            });
        }
        
        // Generate ImagePull failures
        for (let i = 0; i < 5; i++) {
            events.push({
                ts: new Date(this.lastK8sEventTime + i * 45000).toISOString(),
                namespace: "payments",
                reason: "Failed",
                type: "Warning",
                message: `Failed to pull image index.docker.io/payments:v${1.1 + i * 0.1} ImagePull`,
                involvedObject: { kind: "Pod", name: `pay-${Math.random().toString(36).substr(2, 8)}` },
                labels: { app: "payments", tier: "backend" }
            });
        }
        
        // Generate Node not ready
        events.push({
            ts: new Date(this.lastK8sEventTime + 60000).toISOString(),
            namespace: "",
            reason: "NodeNotReady",
            type: "Warning",
            message: "Node node-3 is not ready",
            involvedObject: { kind: "Node", name: "node-3" },
            labels: { zone: "us-west1-a", instance: "gke-prod-node-3" }
        });
        
        // Generate Pod evictions
        for (let i = 0; i < 12; i++) {
            events.push({
                ts: new Date(this.lastK8sEventTime + i * 25000).toISOString(),
                namespace: "analytics",
                reason: "Evicted",
                type: "Warning",
                message: "Pod evicted due to resource pressure",
                involvedObject: { kind: "Pod", name: `analytics-${Math.random().toString(36).substr(2, 6)}` },
                labels: { app: "analytics", workload: "batch" }
            });
        }
        
        this.lastK8sEventTime = now;
        return events;
    }
    
    generateDatadogAlerts() {
        const alerts = [];
        const now = Date.now();
        
        // HTTP 5xx errors
        for (let i = 0; i < 3; i++) {
            alerts.push({
                ts: new Date(now - i * 30000).toISOString(),
                title: "HTTP 5xx spike detected",
                severity: "high",
                status: "firing",
                service: "checkout",
                component: "api",
                resource: "pod/ck-1",
                env: "prod",
                region: "us-west1",
                cluster: "gke-prod",
                namespace: "checkout",
                pod: "ck-1",
                tags: { route: "/pay", code: "500", metric: "http_requests_total" },
                message: "HTTP 5xx error rate exceeded threshold: 15%",
                source: "datadog"
            });
        }
        
        // High CPU usage
        for (let i = 0; i < 2; i++) {
            alerts.push({
                ts: new Date(now - i * 45000).toISOString(),
                title: "High CPU usage detected",
                severity: "medium",
                status: "firing",
                service: "payments",
                component: "processor",
                resource: "pod/pay-1",
                env: "prod",
                region: "us-west1",
                cluster: "gke-prod",
                namespace: "payments",
                pod: "pay-1",
                tags: { metric: "cpu_usage_percent", threshold: "85%" },
                message: "CPU usage exceeded 85% threshold",
                source: "datadog"
            });
        }
        
        // Memory pressure
        alerts.push({
            ts: new Date(now - 60000).toISOString(),
            title: "Memory pressure detected",
            severity: "high",
            status: "firing",
            service: "analytics",
            component: "batch-processor",
            resource: "pod/analytics-1",
            env: "prod",
            region: "us-west1",
            cluster: "gke-prod",
            namespace: "analytics",
            pod: "analytics-1",
            tags: { metric: "memory_usage_bytes", threshold: "90%" },
            message: "Memory usage exceeded 90% threshold",
            source: "datadog"
        });
        
        return alerts;
    }
    
    generateLogicMonitorAlerts() {
        const alerts = [];
        const now = Date.now();
        
        // Network latency
        for (let i = 0; i < 4; i++) {
            alerts.push({
                ts: new Date(now - i * 20000).toISOString(),
                title: "Network latency exceeded threshold",
                severity: "medium",
                status: "firing",
                service: "checkout",
                component: "network",
                resource: "network/edge-to-checkout",
                env: "prod",
                region: "us-west1",
                cluster: "gke-prod",
                namespace: "checkout",
                tags: { metric: "network_latency_ms", threshold: "100ms" },
                message: "Network latency to checkout service exceeded 100ms",
                source: "logicmonitor"
            });
        }
        
        // Disk space
        alerts.push({
            ts: new Date(now - 90000).toISOString(),
            title: "Disk space critical",
            severity: "critical",
            status: "firing",
            service: "storage",
            component: "persistent-volume",
            resource: "pv/storage-1",
            env: "prod",
            region: "us-west1",
            cluster: "gke-prod",
            namespace: "storage",
            tags: { metric: "disk_usage_percent", threshold: "95%" },
            message: "Disk usage exceeded 95% threshold",
            source: "logicmonitor"
        });
        
        // Service availability
        for (let i = 0; i < 2; i++) {
            alerts.push({
                ts: new Date(now - i * 35000).toISOString(),
                title: "Service availability degraded",
                severity: "high",
                status: "firing",
                service: "payments",
                component: "health-check",
                resource: "service/payments",
                env: "prod",
                region: "us-west1",
                cluster: "gke-prod",
                namespace: "payments",
                tags: { metric: "availability_percent", threshold: "99.9%" },
                message: "Service availability dropped below 99.9%",
                source: "logicmonitor"
            });
        }
        
        return alerts;
    }
    
    generateAllTestData() {
        const allAlerts = [];
        
        // Generate K8s events and convert to alerts
        const k8sEvents = this.generateK8sEvents();
        for (const event of k8sEvents) {
            const alerts = this.k8sProcessor.processEvent(event);
            allAlerts.push(...alerts);
        }
        
        // Generate Datadog alerts
        const datadogAlerts = this.generateDatadogAlerts();
        for (const alertData of datadogAlerts) {
            allAlerts.push(new Alert('datadog', alertData));
        }
        
        // Generate LogicMonitor alerts
        const logicMonitorAlerts = this.generateLogicMonitorAlerts();
        for (const alertData of logicMonitorAlerts) {
            allAlerts.push(new Alert('logicmonitor', alertData));
        }
        
        return allAlerts;
    }
}

// ===== CORRELATION ENGINE =====
class CorrelationEngine {
    constructor() {
        this.episodes = new Map();
        this.situations = [];
        this.dedupMap = new Map();
        this.lastCleanup = Date.now();
    }
    
    processAlerts(alerts) {
        // Deduplication
        const uniqueAlerts = this.deduplicateAlerts(alerts);
        
        // Episode building
        for (const alert of uniqueAlerts) {
            this.addToEpisode(alert);
        }
        
        // Situation building
        this.buildSituations();
        
        // Cleanup old data
        this.cleanup();
        
        return {
            episodes: Array.from(this.episodes.values()),
            situations: this.situations,
            processedAlerts: uniqueAlerts.length
        };
    }
    
    deduplicateAlerts(alerts) {
        const unique = [];
        const now = Date.now();
        
        for (const alert of alerts) {
            const key = `${alert.fingerprint}|${alert.entity_key}`;
            const lastSeen = this.dedupMap.get(key);
            
            if (!lastSeen || (now - lastSeen) > CONFIG.dedupTTL) {
                this.dedupMap.set(key, now);
                unique.push(alert);
            }
        }
        
        return unique;
    }
    
    addToEpisode(alert) {
        const key = `${alert.entity_key}|${alert.fingerprint}`;
        let episode = this.episodes.get(key);
        
        if (!episode) {
            episode = new Episode(alert);
            this.episodes.set(key, episode);
        } else {
            episode.addAlert(alert);
        }
    }
    
    buildSituations() {
        const episodeList = Array.from(this.episodes.values());
        const situations = [];
        const used = new Set();
        
        for (let i = 0; i < episodeList.length; i++) {
            if (used.has(episodeList[i])) continue;
            
            const group = [episodeList[i]];
            used.add(episodeList[i]);
            
            // Find related episodes
            for (let j = i + 1; j < episodeList.length; j++) {
                if (used.has(episodeList[j])) continue;
                
                if (this.areEpisodesRelated(episodeList[i], episodeList[j])) {
                    group.push(episodeList[j]);
                    used.add(episodeList[j]);
                }
            }
            
            if (group.length > 1) {
                situations.push(new Situation(group));
            }
        }
        
        this.situations = situations;
    }
    
    areEpisodesRelated(ep1, ep2) {
        // Time proximity
        if (Math.abs(ep1.end - ep2.start) > CONFIG.correlationWindow) return false;
        
        // Entity correlation
        if (ep1.entity_key === ep2.entity_key) return true;
        if (ep1.namespace && ep1.namespace === ep2.namespace) return true;
        
        // Service correlation
        if (ep1.service && ep1.service === ep2.service) return true;
        
        // Source diversity (bonus for multi-source correlation)
        if (ep1.source !== ep2.source) return true;
        
        return false;
    }
    
    cleanup() {
        const now = Date.now();
        const cutoff = now - CONFIG.correlationWindow * 2;
        
        // Clean up old episodes
        for (const [key, episode] of this.episodes.entries()) {
            if (episode.end < cutoff) {
                this.episodes.delete(key);
            }
        }
        
        // Clean up old dedup entries
        for (const [key, timestamp] of this.dedupMap.entries()) {
            if (now - timestamp > CONFIG.dedupTTL * 2) {
                this.dedupMap.delete(key);
            }
        }
        
        this.lastCleanup = now;
    }
}

// ===== MAIN APPLICATION =====
class EnhancedCorrelator {
    constructor() {
        this.testDataGenerator = new TestDataGenerator();
        this.correlationEngine = new CorrelationEngine();
        this.isRunning = false;
        this.intervalId = null;
        this.stats = {
            totalAlerts: 0,
            totalSituations: 0,
            k8sEvents: 0,
            datadogAlerts: 0,
            logicMonitorAlerts: 0,
            lastUpdate: Date.now()
        };
        
        this.initializeUI();
    }
    
    initializeUI() {
        // Create main container
        const container = document.createElement('div');
        container.className = 'enhanced-correlator';
        container.innerHTML = `
            <div class="header">
                <h1>🚨 Enhanced Browser Correlator</h1>
                <p>Multi-source alert correlation with K8s event-to-alert conversion</p>
            </div>
            
            <div class="controls">
                <button id="startBtn" class="btn btn-primary">Start Correlation</button>
                <button id="stopBtn" class="btn btn-secondary" disabled>Stop</button>
                <button id="generateBtn" class="btn btn-success">Generate Test Data</button>
                <button id="clearBtn" class="btn btn-warning">Clear All</button>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Total Alerts</h3>
                    <div id="totalAlerts" class="stat-value">0</div>
                </div>
                <div class="stat-card">
                    <h3>Active Situations</h3>
                    <div id="activeSituations" class="stat-value">0</div>
                </div>
                <div class="stat-card">
                    <h3>K8s Events</h3>
                    <div id="k8sEvents" class="stat-value">0</div>
                </div>
                <div class="stat-card">
                    <h3>Datadog Alerts</h3>
                    <div id="datadogAlerts" class="stat-value">0</div>
                </div>
                <div class="stat-card">
                    <h3>LogicMonitor Alerts</h3>
                    <div id="logicMonitorAlerts" class="stat-value">0</div>
                </div>
            </div>
            
            <div class="content">
                <div class="situations-panel">
                    <h2>Active Situations</h2>
                    <div id="situationsList" class="situations-list"></div>
                </div>
                
                <div class="alerts-panel">
                    <h2>Recent Alerts</h2>
                    <div id="alertsList" class="alerts-list"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(container);
        
        // Add event listeners
        document.getElementById('startBtn').addEventListener('click', () => this.start());
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());
        document.getElementById('generateBtn').addEventListener('click', () => this.generateTestData());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearAll());
        
        // Add styles
        this.addStyles();
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .enhanced-correlator {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 1400px;
                margin: 0 auto;
                padding: 20px;
                background: #f8fafc;
                min-height: 100vh;
            }
            
            .header {
                text-align: center;
                margin-bottom: 30px;
                padding: 30px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 16px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            }
            
            .header h1 {
                margin: 0 0 10px 0;
                font-size: 2.5rem;
                font-weight: 800;
            }
            
            .header p {
                margin: 0;
                font-size: 1.1rem;
                opacity: 0.9;
            }
            
            .controls {
                display: flex;
                gap: 15px;
                justify-content: center;
                margin-bottom: 30px;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1rem;
                cursor: pointer;
                transition: all 0.3s ease;
                min-width: 120px;
            }
            
            .btn-primary {
                background: #3b82f6;
                color: white;
            }
            
            .btn-primary:hover:not(:disabled) {
                background: #2563eb;
                transform: translateY(-2px);
            }
            
            .btn-secondary {
                background: #6b7280;
                color: white;
            }
            
            .btn-success {
                background: #10b981;
                color: white;
            }
            
            .btn-warning {
                background: #f59e0b;
                color: white;
            }
            
            .btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }
            
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            
            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                text-align: center;
                border: 1px solid #e5e7eb;
            }
            
            .stat-card h3 {
                margin: 0 0 10px 0;
                font-size: 0.9rem;
                color: #6b7280;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .stat-value {
                font-size: 2rem;
                font-weight: 800;
                color: #1f2937;
            }
            
            .content {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 30px;
            }
            
            .situations-panel, .alerts-panel {
                background: white;
                padding: 25px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                border: 1px solid #e5e7eb;
            }
            
            .situations-panel h2, .alerts-panel h2 {
                margin: 0 0 20px 0;
                color: #1f2937;
                font-size: 1.5rem;
                font-weight: 700;
            }
            
            .situations-list, .alerts-list {
                max-height: 500px;
                overflow-y: auto;
            }
            
            .situation-item, .alert-item {
                background: #f9fafb;
                padding: 15px;
                margin-bottom: 15px;
                border-radius: 8px;
                border-left: 4px solid #3b82f6;
            }
            
            .situation-item.critical { border-left-color: #dc2626; }
            .situation-item.high { border-left-color: #ea580c; }
            .situation-item.medium { border-left-color: #d97706; }
            .situation-item.low { border-left-color: #059669; }
            
            .situation-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .situation-title {
                font-weight: 700;
                color: #1f2937;
            }
            
            .situation-score {
                background: #3b82f6;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 0.8rem;
                font-weight: 600;
            }
            
            .situation-details {
                font-size: 0.9rem;
                color: #6b7280;
                line-height: 1.4;
            }
            
            .alert-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            
            .alert-title {
                font-weight: 600;
                color: #1f2937;
                font-size: 0.9rem;
            }
            
            .alert-severity {
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.7rem;
                font-weight: 600;
                text-transform: uppercase;
            }
            
            .alert-severity.critical { background: #fecaca; color: #991b1b; }
            .alert-severity.high { background: #fed7aa; color: #92400e; }
            .alert-severity.medium { background: #fef3c7; color: #92400e; }
            .alert-severity.low { background: #d1fae5; color: #065f46; }
            
            .alert-source {
                font-size: 0.8rem;
                color: #6b7280;
                margin-top: 5px;
            }
            
            @media (max-width: 1024px) {
                .content {
                    grid-template-columns: 1fr;
                }
            }
            
            @media (max-width: 768px) {
                .enhanced-correlator {
                    padding: 15px;
                }
                
                .header h1 {
                    font-size: 2rem;
                }
                
                .controls {
                    flex-direction: column;
                    align-items: center;
                }
                
                .btn {
                    width: 100%;
                    max-width: 300px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        
        this.intervalId = setInterval(() => {
            this.generateTestData();
        }, CONFIG.testDataInterval);
        
        console.log('Enhanced correlator started');
    }
    
    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        console.log('Enhanced correlator stopped');
    }
    
    generateTestData() {
        try {
            console.log('🚀 Starting generateTestData...');
            
            // Check if testDataGenerator exists
            if (!this.testDataGenerator) {
                console.error('❌ testDataGenerator not found!');
                return;
            }
            
            const alerts = this.testDataGenerator.generateAllTestData();
            console.log('📊 Generated alerts:', alerts);
            console.log('📊 Alert count:', alerts.length);
            
            // Check if correlationEngine exists
            if (!this.correlationEngine) {
                console.error('❌ correlationEngine not found!');
                return;
            }
            
            // Process through correlation engine
            const result = this.correlationEngine.processAlerts(alerts);
            console.log('🔗 Correlation result:', result);
            console.log('🔗 Result type:', typeof result);
            console.log('🔗 Result keys:', Object.keys(result || {}));
            
            // Safely access result properties
            const processedAlerts = result?.processedAlerts || 0;
            const situations = result?.situations || [];
            
            console.log('📊 Processed alerts:', processedAlerts);
            console.log('🎯 Situations:', situations);
            console.log('🎯 Situations type:', typeof situations);
            console.log('🎯 Situations length:', situations?.length);
            
            // Update stats
            this.stats.totalAlerts += processedAlerts;
            this.stats.totalSituations = situations.length;
            this.stats.k8sEvents += alerts.filter(a => a.source === 'k8s').length;
            this.stats.datadogAlerts += alerts.filter(a => a.source === 'datadog').length;
            this.stats.logicMonitorAlerts += alerts.filter(a => a.source === 'logicmonitor').length;
            this.stats.lastUpdate = Date.now();
            
            console.log('📈 Updated stats:', this.stats);
            
            // Update UI
            this.updateStats();
            this.updateSituations(situations);
            this.updateAlerts(alerts.slice(-20)); // Show last 20 alerts
            
            console.log('✅ generateTestData completed successfully');
        } catch (error) {
            console.error('❌ Error in generateTestData:', error);
            console.error('Stack trace:', error.stack);
            console.error('Error details:', {
                message: error.message,
                name: error.name,
                fileName: error.fileName,
                lineNumber: error.lineNumber
            });
        }
    }
    
    clearAll() {
        this.correlationEngine = new CorrelationEngine();
        this.stats = {
            totalAlerts: 0,
            totalSituations: 0,
            k8sEvents: 0,
            datadogAlerts: 0,
            logicMonitorAlerts: 0,
            lastUpdate: Date.now()
        };
        
        this.updateStats();
        this.updateSituations([]);
        this.updateAlerts([]);
        
        console.log('All data cleared');
    }
    
    updateStats() {
        document.getElementById('totalAlerts').textContent = this.stats.totalAlerts;
        document.getElementById('activeSituations').textContent = this.stats.totalSituations;
        document.getElementById('k8sEvents').textContent = this.stats.k8sEvents;
        document.getElementById('datadogAlerts').textContent = this.stats.datadogAlerts;
        document.getElementById('logicMonitorAlerts').textContent = this.stats.logicMonitorAlerts;
    }
    
    updateSituations(situations) {
        const container = document.getElementById('situationsList') || document.getElementById('k8s-situationsList');
        
        if (!container) {
            console.warn('No container found for situations');
            return;
        }
        
        if (!situations || situations.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center;">No active situations</p>';
            return;
        }
        
        container.innerHTML = situations.map(situation => {
            // Safely access properties with fallbacks
            const severity = situation.severity || 'medium';
            const score = situation.score || 0;
            const primaryCause = situation.primary_cause || {};
            const sources = situation.sources || [];
            const entities = situation.entities || [];
            const services = situation.services || [];
            const start = situation.start || Date.now();
            const end = situation.end || Date.now();
            
            return `
                <div class="situation-item ${severity}">
                    <div class="situation-header">
                        <div class="situation-title">${primaryCause.entity || 'Unknown Entity'}</div>
                        <div class="situation-score">${(score * 100).toFixed(0)}%</div>
                    </div>
                    <div class="situation-details">
                        <strong>Sources:</strong> ${sources.join(', ') || 'N/A'}<br>
                        <strong>Entities:</strong> ${entities.length || 0}<br>
                        <strong>Services:</strong> ${services.length || 0}<br>
                        <strong>Duration:</strong> ${Math.round((end - start) / 1000)}s<br>
                        <strong>Primary Cause:</strong> ${primaryCause.source || 'Unknown'} - ${primaryCause.entity || 'Unknown'}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    updateAlerts(alerts) {
        const container = document.getElementById('alertsList');
        
        if (!container) {
            console.warn('No container found for alerts');
            return;
        }
        
        if (!alerts || alerts.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center;">No recent alerts</p>';
            return;
        }
        
        container.innerHTML = alerts.map(alert => {
            // Safely access properties with fallbacks
            const title = alert.title || 'Unknown Alert';
            const severity = alert.severity || 'medium';
            const message = alert.message || title;
            const service = alert.service || 'N/A';
            const component = alert.component || 'N/A';
            const resource = alert.resource || 'N/A';
            const source = alert.source || 'Unknown';
            const timestamp = alert.ts ? new Date(alert.ts).toLocaleTimeString() : 'Unknown Time';
            
            return `
                <div class="alert-item">
                    <div class="alert-header">
                        <div class="alert-title">${title}</div>
                        <div class="alert-severity ${severity}">${severity}</div>
                    </div>
                    <div class="alert-details">
                        ${message}<br>
                        <strong>Service:</strong> ${service}<br>
                        <strong>Component:</strong> ${component}<br>
                        <strong>Resource:</strong> ${resource}
                    </div>
                    <div class="alert-source">
                        Source: ${source} | ${timestamp}
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ===== EXPOSE CLASSES GLOBALLY =====
window.EnhancedCorrelator = EnhancedCorrelator;
window.TestDataGenerator = TestDataGenerator;
window.CorrelationEngine = CorrelationEngine;
window.K8sEvent = K8sEvent;
window.Alert = Alert;
window.Episode = Episode;
window.Situation = Situation;

// ===== INITIALIZATION =====
function initializeEnhancedCorrelator() {
    console.log('🚀 Enhanced Browser Correlator Initializing...');
    
    // Initialize the enhanced correlator
    window.enhancedCorrelator = new EnhancedCorrelator();
    
    console.log('✅ Enhanced Browser Correlator Ready!');
    console.log('📊 Features:');
    console.log('  - K8s event-to-alert conversion with threshold rules');
    console.log('  - Multi-source correlation (K8s, Datadog, LogicMonitor)');
    console.log('  - Real-time situation building and scoring');
    console.log('  - Professional UI with live metrics');
    console.log('  - MTTR-focused correlation logic');
}

// Try to initialize on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEnhancedCorrelator);
} else {
    // DOM is already loaded, initialize immediately
    initializeEnhancedCorrelator();
}

// Expose initialization function globally for manual triggering
window.initializeEnhancedCorrelator = initializeEnhancedCorrelator;
