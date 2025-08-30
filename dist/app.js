/**
 * Main Application for Browser-side Correlator
 * Handles UI interactions and integrates with the correlator engine
 */

class CorrelatorApp {
    constructor() {
        this.correlator = new AlertCorrelator();
        this.filteredAlerts = [];
        this.performanceMetrics = {
            startTime: 0,
            endTime: 0,
            processingSpeed: 0,
            memoryUsage: 0,
            correlationAccuracy: 0
        };
        this.previousStats = {
            alerts: 0,
            groups: 0,
            processingTime: 0,
            efficiency: 0
        };
        this.initializeEventListeners();
        this.updateUI();
        this.startPerformanceMonitoring();
    }

    /**
     * Initialize event listeners for UI controls
     */
    initializeEventListeners() {
        // Alert generation controls
        document.getElementById('generateAlerts').addEventListener('click', () => {
            this.generateSampleAlerts();
        });

        document.getElementById('clearAlerts').addEventListener('click', () => {
            this.clearAllData();
        });

        // Correlation controls
        document.getElementById('runCorrelation').addEventListener('click', () => {
            this.runCorrelation();
        });

        // Debug controls
        document.getElementById('toggleDebug').addEventListener('click', () => {
            this.toggleDebugMode();
        });

        document.getElementById('exportData').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('clearDebug').addEventListener('click', () => {
            this.clearDebugLogs();
        });

        // Filter and search controls
        document.getElementById('searchAlerts').addEventListener('input', (e) => {
            this.filterAlerts();
        });

        document.getElementById('severityFilter').addEventListener('change', () => {
            this.filterAlerts();
        });

        document.getElementById('serviceFilter').addEventListener('change', () => {
            this.filterAlerts();
        });

        document.getElementById('clearFilters').addEventListener('click', () => {
            this.clearFilters();
        });

        // Panel action buttons
        document.getElementById('exportRawAlerts').addEventListener('click', () => {
            this.exportRawAlerts();
        });

        document.getElementById('exportCorrelated').addEventListener('click', () => {
            this.exportCorrelatedAlerts();
        });

        document.getElementById('refreshRawAlerts').addEventListener('click', () => {
            this.refreshRawAlerts();
        });

        document.getElementById('refreshCorrelated').addEventListener('click', () => {
            this.refreshCorrelatedAlerts();
        });
    }

    /**
     * Generate sample alerts and display them
     */
    generateSampleAlerts() {
        try {
            const alertCount = parseInt(document.getElementById('alertCount').value) || 25;
            const timeRange = parseInt(document.getElementById('timeRange').value) || 2;
            
            const alerts = this.correlator.generateSampleAlerts(alertCount, timeRange);
            this.correlator.rawAlerts = alerts;
            this.filteredAlerts = [...alerts];
            this.updateUI();
            
            // Show success message
            this.showNotification(`Generated ${alerts.length} sample alerts over ${timeRange} hours!`, 'success');
            
            // Auto-run correlation if we have alerts
            if (alerts.length > 0) {
                setTimeout(() => this.runCorrelation(), 1000);
            }
        } catch (error) {
            console.error('Error generating alerts:', error);
            this.showNotification('Error generating alerts: ' + error.message, 'error');
        }
    }

    /**
     * Run correlation analysis
     */
    runCorrelation() {
        if (this.correlator.rawAlerts.length === 0) {
            this.showNotification('No alerts to correlate. Generate some alerts first.', 'warning');
            return;
        }

        try {
            const timeWindow = parseInt(document.getElementById('timeWindow').value);
            const similarityThreshold = parseFloat(document.getElementById('similarityThreshold').value);
            const correlationMode = document.getElementById('correlationMode').value;

            // Validate inputs
            if (isNaN(timeWindow) || timeWindow < 1 || timeWindow > 60) {
                this.showNotification('Invalid time window. Must be between 1-60 minutes.', 'error');
                return;
            }

            if (isNaN(similarityThreshold) || similarityThreshold < 0.1 || similarityThreshold > 1.0) {
                this.showNotification('Invalid similarity threshold. Must be between 0.1-1.0.', 'error');
                return;
            }

            // Show processing indicator
            this.showNotification('Running correlation analysis...', 'info');
            this.setLoadingState(true);

            // Start performance monitoring
            this.performanceMetrics.startTime = performance.now();

            // Process alerts
            const result = this.correlator.processAlerts(
                this.correlator.rawAlerts,
                timeWindow,
                similarityThreshold,
                correlationMode
            );

            // End performance monitoring
            this.performanceMetrics.endTime = performance.now();
            this.calculatePerformanceMetrics();

            // Update UI
            this.updateUI();
            this.setLoadingState(false);
            
            // Show results
            const totalCorrelated = result.correlatedAlerts.reduce((sum, group) => sum + group.length, 0);
            this.showNotification(
                `Correlation complete! ${result.correlatedAlerts.length} groups created from ${totalCorrelated} alerts in ${this.performanceMetrics.endTime - this.performanceMetrics.startTime}ms.`,
                'success'
            );

        } catch (error) {
            console.error('Error running correlation:', error);
            this.showNotification('Error running correlation: ' + error.message, 'error');
            this.setLoadingState(false);
        }
    }

    /**
     * Filter alerts based on search and filter criteria
     */
    filterAlerts() {
        const searchTerm = document.getElementById('searchAlerts').value.toLowerCase();
        const severityFilter = document.getElementById('severityFilter').value;
        const serviceFilter = document.getElementById('serviceFilter').value;

        this.filteredAlerts = this.correlator.rawAlerts.filter(alert => {
            // Search term filter
            const matchesSearch = !searchTerm || 
                alert.message.toLowerCase().includes(searchTerm) ||
                alert.service.toLowerCase().includes(searchTerm) ||
                alert.host.toLowerCase().includes(searchTerm);

            // Severity filter
            const matchesSeverity = !severityFilter || alert.severity === severityFilter;

            // Service filter
            const matchesService = !serviceFilter || alert.service === serviceFilter;

            return matchesSearch && matchesSeverity && matchesService;
        });

        this.updateFilteredAlerts();
    }

    /**
     * Clear all filters
     */
    clearFilters() {
        document.getElementById('searchAlerts').value = '';
        document.getElementById('severityFilter').value = '';
        document.getElementById('serviceFilter').value = '';
        this.filteredAlerts = [...this.correlator.rawAlerts];
        this.updateFilteredAlerts();
        this.showNotification('All filters cleared', 'info');
    }

    /**
     * Update filtered alerts display
     */
    updateFilteredAlerts() {
        const container = document.getElementById('rawAlerts');
        
        if (this.filteredAlerts.length === 0) {
            container.innerHTML = '<div class="no-data">No alerts match the current filters.</div>';
            return;
        }

        container.innerHTML = this.filteredAlerts.map(alert => this.createAlertHTML(alert, false)).join('');
    }

    /**
     * Calculate performance metrics
     */
    calculatePerformanceMetrics() {
        const processingTime = this.performanceMetrics.endTime - this.performanceMetrics.startTime;
        const alertCount = this.correlator.rawAlerts.length;
        
        this.performanceMetrics.processingSpeed = alertCount / (processingTime / 1000);
        this.performanceMetrics.memoryUsage = this.getMemoryUsage();
        this.performanceMetrics.correlationAccuracy = this.calculateCorrelationAccuracy();
        
        this.updatePerformanceMetrics();
    }

    /**
     * Get memory usage (approximate)
     */
    getMemoryUsage() {
        if (performance.memory) {
            return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        }
        return Math.round(this.correlator.rawAlerts.length * 0.1); // Rough estimate
    }

    /**
     * Calculate correlation accuracy
     */
    calculateCorrelationAccuracy() {
        if (this.correlator.correlatedAlerts.length === 0) return 0;
        
        const totalAlerts = this.correlator.rawAlerts.length;
        const correlatedAlerts = this.correlator.correlatedAlerts.reduce((sum, group) => sum + group.length, 0);
        
        return Math.round((correlatedAlerts / totalAlerts) * 100);
    }

    /**
     * Update performance metrics display
     */
    updatePerformanceMetrics() {
        document.getElementById('memoryUsage').textContent = `${this.performanceMetrics.memoryUsage} MB`;
        document.getElementById('processingSpeed').textContent = `${this.performanceMetrics.processingSpeed.toFixed(1)} alerts/sec`;
        document.getElementById('correlationAccuracy').textContent = `${this.performanceMetrics.correlationAccuracy}%`;

        // Update progress bars
        const memoryBar = document.getElementById('memoryBar');
        const speedBar = document.getElementById('speedBar');
        const accuracyBar = document.getElementById('accuracyBar');

        memoryBar.style.width = `${Math.min(this.performanceMetrics.memoryUsage / 10, 100)}%`;
        speedBar.style.width = `${Math.min(this.performanceMetrics.processingSpeed / 100, 100)}%`;
        accuracyBar.style.width = `${this.performanceMetrics.correlationAccuracy}%`;
    }

    /**
     * Start performance monitoring
     */
    startPerformanceMonitoring() {
        setInterval(() => {
            if (this.correlator.rawAlerts.length > 0) {
                this.performanceMetrics.memoryUsage = this.getMemoryUsage();
                this.updatePerformanceMetrics();
            }
        }, 5000);
    }

    /**
     * Set loading state
     */
    setLoadingState(loading) {
        const button = document.getElementById('runCorrelation');
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        } else {
            button.classList.remove('loading');
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-play"></i> Run Correlation';
        }
    }

    /**
     * Toggle debug mode
     */
    toggleDebugMode() {
        const debugMode = this.correlator.toggleDebug();
        const button = document.getElementById('toggleDebug');
        
        if (debugMode) {
            button.innerHTML = '<i class="fas fa-toggle-off"></i> Disable Debug Mode';
            button.classList.remove('btn-info');
            button.classList.add('btn-warning');
            this.showNotification('Debug mode enabled', 'info');
        } else {
            button.innerHTML = '<i class="fas fa-toggle-on"></i> Toggle Debug Mode';
            button.classList.remove('btn-warning');
            button.classList.add('btn-info');
            this.showNotification('Debug mode disabled', 'info');
        }
        
        this.updateDebugInfo();
    }

    /**
     * Clear debug logs
     */
    clearDebugLogs() {
        this.correlator.debugLog = [];
        this.updateDebugInfo();
        this.showNotification('Debug logs cleared', 'info');
    }

    /**
     * Export raw alerts
     */
    exportRawAlerts() {
        if (this.correlator.rawAlerts.length === 0) {
            this.showNotification('No alerts to export', 'warning');
            return;
        }
        
        this.exportData('raw-alerts', this.correlator.rawAlerts);
    }

    /**
     * Export correlated alerts
     */
    exportCorrelatedAlerts() {
        if (this.correlator.correlatedAlerts.length === 0) {
            this.showNotification('No correlated alerts to export', 'warning');
            return;
        }
        
        this.exportData('correlated-alerts', this.correlator.correlatedAlerts);
    }

    /**
     * Export data for debugging
     */
    exportData(type = 'full', data = null) {
        try {
            let exportData;
            
            if (type === 'raw-alerts') {
                exportData = {
                    type: 'Raw Alerts Export',
                    timestamp: new Date().toISOString(),
                    count: data.length,
                    alerts: data
                };
            } else if (type === 'correlated-alerts') {
                exportData = {
                    type: 'Correlated Alerts Export',
                    timestamp: new Date().toISOString(),
                    count: data.length,
                    groups: data
                };
            } else {
                exportData = {
                    type: 'Full Data Export',
                    timestamp: new Date().toISOString(),
                    rawAlerts: this.correlator.rawAlerts,
                    correlatedAlerts: this.correlator.correlatedAlerts,
                    debugInfo: this.correlator.getDebugInfo(),
                    performanceMetrics: this.performanceMetrics
                };
            }
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `alert-correlator-${type}-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.logDebug('Data exported successfully', { type, count: data ? data.length : 'full' });
            this.showNotification(`${type === 'full' ? 'All data' : type} exported successfully!`, 'success');
            
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showNotification('Error exporting data: ' + error.message, 'error');
        }
    }

    /**
     * Refresh raw alerts
     */
    refreshRawAlerts() {
        this.filterAlerts();
        this.showNotification('Raw alerts refreshed', 'info');
    }

    /**
     * Refresh correlated alerts
     */
    refreshCorrelatedAlerts() {
        this.updateCorrelatedAlerts();
        this.showNotification('Correlated alerts refreshed', 'info');
    }

    /**
     * Clear all data
     */
    clearAllData() {
        this.correlator.clearData();
        this.filteredAlerts = [];
        this.performanceMetrics = {
            startTime: 0,
            endTime: 0,
            processingSpeed: 0,
            memoryUsage: 0,
            correlationAccuracy: 0
        };
        this.updateUI();
        this.showNotification('All data cleared', 'info');
    }

    /**
     * Update the UI with current data
     */
    updateUI() {
        this.updateRawAlerts();
        this.updateCorrelatedAlerts();
        this.updateCounts();
        this.updateDebugInfo();
        this.updateStatistics();
        this.updatePerformanceMetrics();
    }

    /**
     * Update raw alerts display
     */
    updateRawAlerts() {
        if (this.filteredAlerts.length > 0) {
            this.updateFilteredAlerts();
        } else {
            const container = document.getElementById('rawAlerts');
            const alerts = this.correlator.rawAlerts;

            if (alerts.length === 0) {
                container.innerHTML = '<div class="no-data">No alerts generated yet. Click "Generate Sample Alerts" to get started.</div>';
                return;
            }

            container.innerHTML = alerts.map(alert => this.createAlertHTML(alert, false)).join('');
        }
    }

    /**
     * Update correlated alerts display
     */
    updateCorrelatedAlerts() {
        const container = document.getElementById('correlatedAlerts');
        const groups = this.correlator.correlatedAlerts;

        if (groups.length === 0) {
            container.innerHTML = '<div class="no-data">No correlation results yet. Run correlation analysis to see results.</div>';
            return;
        }

        container.innerHTML = groups.map((group, index) => {
            if (group.length === 1) {
                return this.createAlertHTML(group[0], false);
            } else {
                return this.createCorrelatedGroupHTML(group, index);
            }
        }).join('');
    }

    /**
     * Create HTML for a single alert
     */
    createAlertHTML(alert, isCorrelated = false) {
        const time = new Date(alert.timestamp).toLocaleString();
        const severityClass = `severity-${alert.severity}`;
        
        let detailsHTML = '';
        if (alert.details) {
            detailsHTML = Object.entries(alert.details)
                .map(([key, value]) => `<span>${key}: ${value}</span>`)
                .join('');
        }

        return `
            <div class="alert-item ${isCorrelated ? 'correlated' : ''}">
                <div class="alert-header">
                    <span class="alert-severity ${severityClass}">${alert.severity}</span>
                    <span class="alert-time">${time}</span>
                </div>
                <div class="alert-message">${alert.message}</div>
                <div class="alert-details">
                    <span>Service: ${alert.service}</span>
                    <span>Host: ${alert.host}</span>
                    ${detailsHTML}
                </div>
            </div>
        `;
    }

    /**
     * Create HTML for a correlated group
     */
    createCorrelatedGroupHTML(group, index) {
        const groupHeader = `
            <div class="group-header">
                Correlated Group ${index + 1} (${group.length} alerts)
            </div>
        `;

        const alertsHTML = group.map(alert => this.createAlertHTML(alert, true)).join('');

        return `
            <div class="correlated-group">
                ${groupHeader}
                ${alertsHTML}
            </div>
        `;
    }

    /**
     * Update count displays
     */
    updateCounts() {
        const rawCount = this.correlator.rawAlerts.length;
        const correlatedCount = this.correlator.correlatedAlerts.length;
        
        document.getElementById('rawAlertCount').textContent = rawCount;
        document.getElementById('correlatedCount').textContent = correlatedCount;
        
        // Update footer statistics
        document.getElementById('totalAlerts').textContent = rawCount;
        document.getElementById('correlationGroups').textContent = correlatedCount;
    }

    /**
     * Update statistics dashboard
     */
    updateStatistics() {
        const currentStats = {
            alerts: this.correlator.rawAlerts.length,
            groups: this.correlator.correlatedAlerts.length,
            processingTime: this.performanceMetrics.endTime - this.performanceMetrics.startTime,
            efficiency: this.calculateCorrelationAccuracy()
        };

        // Update main stats
        document.getElementById('totalAlertsStat').textContent = currentStats.alerts;
        document.getElementById('totalGroupsStat').textContent = currentStats.groups;
        document.getElementById('processingTime').textContent = `${Math.round(currentStats.processingTime)}ms`;
        document.getElementById('efficiencyRate').textContent = `${currentStats.efficiency}%`;

        // Calculate changes
        const alertChange = this.calculateChange(this.previousStats.alerts, currentStats.alerts);
        const groupChange = this.calculateChange(this.previousStats.groups, currentStats.groups);
        const timeChange = this.calculateChange(this.previousStats.processingTime, currentStats.processingTime);
        const efficiencyChange = this.calculateChange(this.previousStats.efficiency, currentStats.efficiency);

        // Update change indicators
        this.updateChangeIndicator('alertChange', alertChange);
        this.updateChangeIndicator('groupChange', groupChange);
        this.updateChangeIndicator('timeChange', timeChange);
        this.updateChangeIndicator('efficiencyChange', efficiencyChange);

        // Store current stats for next comparison
        this.previousStats = { ...currentStats };
    }

    /**
     * Calculate percentage change
     */
    calculateChange(previous, current) {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
    }

    /**
     * Update change indicator
     */
    updateChangeIndicator(elementId, change) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = `${change >= 0 ? '+' : ''}${change}%`;
            element.setAttribute('data-change', change);
            
            if (change > 0) {
                element.style.background = 'var(--success-color)';
            } else if (change < 0) {
                element.style.background = 'var(--error-color)';
            } else {
                element.style.background = 'var(--secondary-color)';
            }
        }
    }

    /**
     * Update debug information display
     */
    updateDebugInfo() {
        const container = document.getElementById('debugInfo');
        const debugInfo = this.correlator.getDebugInfo();

        if (!debugInfo.debugMode) {
            container.innerHTML = '<div class="no-data">Debug mode is disabled. Enable it to see detailed information.</div>';
            return;
        }

        const debugHTML = `
Debug Mode: ${debugInfo.debugMode ? 'ENABLED' : 'DISABLED'}
Log Count: ${debugInfo.logCount}
Raw Alerts: ${debugInfo.stats.rawAlerts}
Correlated Groups: ${debugInfo.stats.correlatedGroups}
Total Correlated Alerts: ${debugInfo.stats.totalCorrelatedAlerts}

Performance Metrics:
- Processing Time: ${Math.round(this.performanceMetrics.endTime - this.performanceMetrics.startTime)}ms
- Memory Usage: ${this.performanceMetrics.memoryUsage} MB
- Processing Speed: ${this.performanceMetrics.processingSpeed.toFixed(1)} alerts/sec
- Correlation Accuracy: ${this.performanceMetrics.correlationAccuracy}%

Recent Debug Logs:
${debugInfo.recentLogs.map(log => `[${log.timestamp}] ${log.message}`).join('\n')}
        `;

        container.textContent = debugHTML;
    }

    /**
     * Show notification message
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 18px 24px;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            z-index: 1000;
            animation: slideIn 0.4s ease-out;
            max-width: 400px;
            box-shadow: var(--shadow-xl);
            backdrop-filter: blur(10px);
        `;

        // Set background color based on type
        const colors = {
            success: 'var(--success-color)',
            error: 'var(--error-color)',
            warning: 'var(--warning-color)',
            info: 'var(--info-color)'
        };
        notification.style.background = colors[type] || colors.info;

        // Add to page
        document.body.appendChild(notification);

        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.4s ease-in';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 400);
        }, 5000);
    }

    /**
     * Get notification icon based on type
     */
    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * Log debug information
     */
    logDebug(message, data = null) {
        if (this.correlator.debugMode) {
            this.correlator.logDebug(message, data);
        }
    }
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .no-data {
        text-align: center;
        color: var(--text-muted);
        font-style: italic;
        padding: 60px 20px;
        background: var(--bg-tertiary);
        border-radius: 12px;
        border: 2px dashed var(--border-color);
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .notification-content i {
        font-size: 16px;
    }
`;
document.head.appendChild(style);

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.correlatorApp = new CorrelatorApp();
    
    // Add some helpful console messages
    console.log('🚨 Browser-side Correlator initialized!');
    console.log('Use window.correlatorApp to access the application instance');
    console.log('Use window.correlatorApp.correlator to access the correlator engine');
});
