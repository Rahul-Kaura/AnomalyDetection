/**
 * Browser-side Alert Correlator
 * Implements alert normalization, enrichment, and correlation logic
 */

class AlertCorrelator {
    constructor() {
        this.rawAlerts = [];
        this.correlatedAlerts = [];
        this.debugMode = false;
        this.debugLog = [];
    }

    /**
     * Generate sample alert data for testing
     */
    generateSampleAlerts(count = 25, timeRangeHours = 2) {
        const alertTypes = [
            'CPU_HIGH', 'MEMORY_HIGH', 'DISK_FULL', 'NETWORK_TIMEOUT',
            'SERVICE_DOWN', 'AUTH_FAILURE', 'PERMISSION_DENIED', 'CONNECTION_REFUSED'
        ];

        const services = ['web-server', 'database', 'cache', 'load-balancer', 'monitoring'];
        const hosts = ['server-01', 'server-02', 'server-03', 'server-04'];
        const users = ['admin', 'user1', 'user2', 'system'];

        const alerts = [];
        const now = Date.now();
        const timeRangeMs = timeRangeHours * 60 * 60 * 1000;
        
        // Generate alerts over the specified time range with some clustering
        for (let i = 0; i < count; i++) {
            const timestamp = now - Math.random() * timeRangeMs; // Random time in specified range
            const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
            const service = services[Math.floor(Math.random() * services.length)];
            const host = hosts[Math.floor(Math.random() * hosts.length)];
            const user = users[Math.floor(Math.random() * users.length)];
            
            // Create some correlation patterns
            let message, severity, details;
            
            if (alertType === 'CPU_HIGH') {
                message = `High CPU usage detected on ${host}`;
                severity = Math.random() > 0.7 ? 'high' : 'medium';
                details = {
                    cpu_usage: Math.floor(80 + Math.random() * 20),
                    threshold: 80,
                    service: service
                };
            } else if (alertType === 'MEMORY_HIGH') {
                message = `Memory usage exceeded threshold on ${host}`;
                severity = Math.random() > 0.6 ? 'high' : 'medium';
                details = {
                    memory_usage: Math.floor(85 + Math.random() * 15),
                    threshold: 85,
                    service: service
                };
            } else if (alertType === 'SERVICE_DOWN') {
                message = `${service} service is down on ${host}`;
                severity = 'high';
                details = {
                    service: service,
                    host: host,
                    last_seen: new Date(timestamp - 300000).toISOString()
                };
            } else if (alertType === 'AUTH_FAILURE') {
                message = `Authentication failure for user ${user} on ${host}`;
                severity = Math.random() > 0.8 ? 'high' : 'medium';
                details = {
                    user: user,
                    host: host,
                    service: service,
                    attempts: Math.floor(1 + Math.random() * 10)
                };
            } else {
                message = `${alertType} alert on ${host}`;
                severity = Math.random() > 0.5 ? 'medium' : 'low';
                details = {
                    service: service,
                    host: host
                };
            }

            const alert = {
                id: `alert_${Date.now()}_${i}`,
                timestamp: timestamp,
                type: 'Alert',
                severity: severity,
                message: message,
                service: service,
                host: host,
                user: user,
                details: details,
                source: 'monitoring-system',
                raw_data: {
                    alert_type: alertType,
                    generated_at: new Date(timestamp).toISOString()
                }
            };

            alerts.push(alert);
        }

        // Sort by timestamp
        alerts.sort((a, b) => a.timestamp - b.timestamp);
        
        this.logDebug('Generated sample alerts', { count: alerts.length, timeRange: timeRangeHours, alerts: alerts.slice(0, 3) });
        return alerts;
    }

    /**
     * Normalize and enrich alerts (ingest phase)
     */
    normalizeAndEnrich(alerts) {
        this.logDebug('Starting alert normalization and enrichment', { count: alerts.length });
        
        const normalizedAlerts = alerts.map(alert => {
            // Normalize timestamp
            const normalizedTimestamp = new Date(alert.timestamp).toISOString();
            
            // Enrich with additional metadata
            const enriched = {
                ...alert,
                normalized_timestamp: normalizedTimestamp,
                hour_of_day: new Date(alert.timestamp).getHours(),
                day_of_week: new Date(alert.timestamp).getDay(),
                is_business_hours: this.isBusinessHours(alert.timestamp),
                correlation_key: this.generateCorrelationKey(alert),
                enriched_at: new Date().toISOString()
            };

            // Add severity score for numerical comparison
            enriched.severity_score = this.getSeverityScore(alert.severity);
            
            // Add service category
            enriched.service_category = this.categorizeService(alert.service);
            
            return enriched;
        });

        this.logDebug('Alert normalization complete', { 
            normalized_count: normalizedAlerts.length,
            sample: normalizedAlerts[0]
        });

        return normalizedAlerts;
    }

    /**
     * Generate correlation key for alert grouping
     */
    generateCorrelationKey(alert) {
        const key = `${alert.service}_${alert.host}_${alert.type}`;
        return key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    }

    /**
     * Get numerical severity score
     */
    getSeverityScore(severity) {
        const scores = { 'low': 1, 'medium': 2, 'high': 3 };
        return scores[severity] || 1;
    }

    /**
     * Categorize service for grouping
     */
    categorizeService(service) {
        if (['web-server', 'load-balancer'].includes(service)) return 'frontend';
        if (['database', 'cache'].includes(service)) return 'backend';
        if (['monitoring'].includes(service)) return 'infrastructure';
        return 'other';
    }

    /**
     * Check if timestamp is during business hours
     */
    isBusinessHours(timestamp) {
        const date = new Date(timestamp);
        const hour = date.getHours();
        const day = date.getDay();
        return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
    }

    /**
     * Run correlation analysis on alerts
     */
    runCorrelation(alerts, timeWindowMinutes = 5, similarityThreshold = 0.7) {
        this.logDebug('Starting correlation analysis', { 
            timeWindow: timeWindowMinutes, 
            threshold: similarityThreshold,
            alertCount: alerts.length 
        });

        const timeWindowMs = timeWindowMinutes * 60 * 1000;
        const correlatedGroups = [];
        const processedAlerts = new Set();

        // Group alerts by time windows
        for (let i = 0; i < alerts.length; i++) {
            if (processedAlerts.has(alerts[i].id)) continue;

            const currentAlert = alerts[i];
            const timeGroup = [currentAlert];
            processedAlerts.add(currentAlert.id);

            // Find alerts within time window
            for (let j = i + 1; j < alerts.length; j++) {
                if (processedAlerts.has(alerts[j].id)) continue;
                
                const timeDiff = Math.abs(alerts[j].timestamp - currentAlert.timestamp);
                if (timeDiff <= timeWindowMs) {
                    timeGroup.push(alerts[j]);
                    processedAlerts.add(alerts[j].id);
                }
            }

            // If we have multiple alerts in time window, check for similarity
            if (timeGroup.length > 1) {
                const similarityGroups = this.groupBySimilarity(timeGroup, similarityThreshold);
                correlatedGroups.push(...similarityGroups);
            } else if (timeGroup.length === 1) {
                // Single alert becomes its own group
                correlatedGroups.push([timeGroup[0]]);
            }
        }

        this.logDebug('Correlation analysis complete', { 
            totalGroups: correlatedGroups.length,
            groups: correlatedGroups.map(g => ({ count: g.length, first: g[0].message }))
        });

        return correlatedGroups;
    }

    /**
     * Group alerts by similarity within a time window
     */
    groupBySimilarity(alerts, threshold) {
        const groups = [];
        const processed = new Set();

        for (let i = 0; i < alerts.length; i++) {
            if (processed.has(alerts[i].id)) continue;

            const group = [alerts[i]];
            processed.add(alerts[i].id);

            for (let j = i + 1; j < alerts.length; j++) {
                if (processed.has(alerts[j].id)) continue;

                const similarity = this.calculateSimilarity(alerts[i], alerts[j]);
                if (similarity >= threshold) {
                    group.push(alerts[j]);
                    processed.add(alerts[j].id);
                }
            }

            groups.push(group);
        }

        return groups;
    }

    /**
     * Calculate similarity between two alerts
     */
    calculateSimilarity(alert1, alert2) {
        let score = 0;
        let totalWeight = 0;

        // Service similarity (weight: 0.3)
        if (alert1.service === alert2.service) {
            score += 0.3;
        } else if (alert1.service_category === alert2.service_category) {
            score += 0.15;
        }
        totalWeight += 0.3;

        // Host similarity (weight: 0.25)
        if (alert1.host === alert2.host) {
            score += 0.25;
        }
        totalWeight += 0.25;

        // Message similarity (weight: 0.2)
        const messageSimilarity = this.calculateTextSimilarity(alert1.message, alert2.message);
        score += messageSimilarity * 0.2;
        totalWeight += 0.2;

        // Severity similarity (weight: 0.15)
        if (alert1.severity === alert2.severity) {
            score += 0.15;
        } else if (Math.abs(alert1.severity_score - alert2.severity_score) === 1) {
            score += 0.075;
        }
        totalWeight += 0.15;

        // Details similarity (weight: 0.1)
        const detailsSimilarity = this.calculateDetailsSimilarity(alert1.details, alert2.details);
        score += detailsSimilarity * 0.1;
        totalWeight += 0.1;

        return score / totalWeight;
    }

    /**
     * Calculate text similarity using simple word overlap
     */
    calculateTextSimilarity(text1, text2) {
        const words1 = text1.toLowerCase().split(/\s+/);
        const words2 = text2.toLowerCase().split(/\s+/);
        
        const commonWords = words1.filter(word => words2.includes(word));
        const totalWords = new Set([...words1, ...words2]);
        
        return commonWords.length / totalWords.size;
    }

    /**
     * Calculate similarity between alert details
     */
    calculateDetailsSimilarity(details1, details2) {
        const keys1 = Object.keys(details1);
        const keys2 = Object.keys(details2);
        
        const commonKeys = keys1.filter(key => keys2.includes(key));
        if (commonKeys.length === 0) return 0;
        
        let matchingValues = 0;
        commonKeys.forEach(key => {
            if (details1[key] === details2[key]) {
                matchingValues++;
            }
        });
        
        return matchingValues / commonKeys.length;
    }

    /**
     * Process alerts through the full pipeline
     */
    processAlerts(alerts, timeWindow, similarityThreshold, correlationMode = 'standard') {
        this.logDebug('Starting full alert processing pipeline', { 
            mode: correlationMode,
            timeWindow,
            similarityThreshold 
        });
        
        // Step 1: Normalize and enrich
        const normalizedAlerts = this.normalizeAndEnrich(alerts);
        
        // Step 2: Run correlation with mode-specific adjustments
        let adjustedThreshold = similarityThreshold;
        let adjustedTimeWindow = timeWindow;
        
        // Adjust parameters based on correlation mode
        switch (correlationMode) {
            case 'aggressive':
                adjustedThreshold = Math.max(0.1, similarityThreshold - 0.2);
                adjustedTimeWindow = Math.min(60, timeWindow + 5);
                this.logDebug('Aggressive mode: Lowered threshold, increased time window', {
                    originalThreshold: similarityThreshold,
                    adjustedThreshold,
                    originalTimeWindow: timeWindow,
                    adjustedTimeWindow
                });
                break;
            case 'conservative':
                adjustedThreshold = Math.min(1.0, similarityThreshold + 0.2);
                adjustedTimeWindow = Math.max(1, timeWindow - 2);
                this.logDebug('Conservative mode: Raised threshold, decreased time window', {
                    originalThreshold: similarityThreshold,
                    adjustedThreshold,
                    originalTimeWindow: timeWindow,
                    adjustedTimeWindow
                });
                break;
            default:
                this.logDebug('Standard mode: Using original parameters');
        }
        
        const correlatedGroups = this.runCorrelation(normalizedAlerts, adjustedTimeWindow, adjustedThreshold);
        
        // Step 3: Store results
        this.rawAlerts = normalizedAlerts;
        this.correlatedAlerts = correlatedGroups;
        
        this.logDebug('Alert processing pipeline complete', {
            rawCount: this.rawAlerts.length,
            correlatedCount: this.correlatedAlerts.length,
            mode: correlationMode,
            finalThreshold: adjustedThreshold,
            finalTimeWindow: adjustedTimeWindow
        });
        
        return {
            rawAlerts: this.rawAlerts,
            correlatedAlerts: this.correlatedAlerts,
            correlationMode,
            adjustedThreshold,
            adjustedTimeWindow
        };
    }

    /**
     * Debug logging
     */
    logDebug(message, data = null) {
        if (this.debugMode) {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                message,
                data
            };
            this.debugLog.push(logEntry);
            console.log(`[DEBUG ${timestamp}] ${message}`, data);
        }
    }

    /**
     * Toggle debug mode
     */
    toggleDebug() {
        this.debugMode = !this.debugMode;
        this.logDebug(`Debug mode ${this.debugMode ? 'enabled' : 'disabled'}`);
        return this.debugMode;
    }

    /**
     * Get debug information
     */
    getDebugInfo() {
        return {
            debugMode: this.debugMode,
            logCount: this.debugLog.length,
            recentLogs: this.debugLog.slice(-20),
            stats: {
                rawAlerts: this.rawAlerts.length,
                correlatedGroups: this.correlatedAlerts.length,
                totalCorrelatedAlerts: this.correlatedAlerts.reduce((sum, group) => sum + group.length, 0)
            }
        };
    }

    /**
     * Export data for debugging
     */
    exportData() {
        const exportData = {
            timestamp: new Date().toISOString(),
            rawAlerts: this.rawAlerts,
            correlatedAlerts: this.correlatedAlerts,
            debugInfo: this.getDebugInfo()
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `alert-correlator-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.logDebug('Data exported successfully');
    }

    /**
     * Clear all data
     */
    clearData() {
        this.rawAlerts = [];
        this.correlatedAlerts = [];
        this.debugLog = [];
        this.logDebug('All data cleared');
    }
}
