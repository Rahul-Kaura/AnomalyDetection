# 🚨 Enterprise Alert Correlation System

A sophisticated, enterprise-grade incident correlation and MTTR (Mean Time To Resolution) reduction platform that demonstrates advanced alert correlation, Kubernetes event threshold processing, and multi-source monitoring integration.

## 🌟 Features

### 🔗 **Multi-Source Alert Correlation**
- **Kubernetes Events** - Advanced threshold-based alerting with configurable rules
- **Datadog Alerts** - Infrastructure and application monitoring integration
- **LogicMonitor Alerts** - Business and infrastructure monitoring
- **Real-time Correlation** - Automatic situation building from related alerts

### ☸️ **Kubernetes Event Threshold Engine**
- **Configurable Rules** - Define thresholds per key, per window
- **Sliding Window Logic** - Time-based event aggregation
- **Cooldown Mechanism** - Suppress duplicate alerts
- **Smart Key Extraction** - Namespace, pod, node, and reason-based grouping

### 🎯 **Advanced Situations Management**
- **Automatic Correlation** - Groups related alerts into actionable situations
- **Severity Filtering** - Only high and critical alerts become active situations
- **Real-time Updates** - Dynamic situation building and resolution
- **Fix Button Integration** - One-click alert resolution

### 🎨 **Professional Enterprise UI**
- **Modern Design** - Clean, professional interface with smooth animations
- **Responsive Layout** - Works on all device sizes
- **Real-time Metrics** - Live dashboard with key performance indicators
- **Interactive Elements** - Hover effects, transitions, and visual feedback

## 🚀 Quick Start

### Prerequisites
- Python 3.7+ (for HTTP server)
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation & Running

1. **Clone the repository**
   ```bash
   git clone https://github.com/Rahul-Kaura/AnomalyDetection.git
   cd AnomalyDetection
   ```

2. **Start the demo server**
   ```bash
   python3 -m http.server 8000
   ```

3. **Open your browser**
   ```
   http://localhost:8000/demo-unified.html
   ```

## 🎮 How to Use

### **Generate Test Data**
- Click **"Generate Test Data"** to create sample alerts from Datadog and LogicMonitor
- Each click adds 12 new varied alerts (CPU, Memory, Network, Database, Security, etc.)
- Alerts accumulate - they don't replace previous ones

### **Test K8s Thresholds**
- Click **"Test K8s Thresholds"** to test the Kubernetes event threshold engine
- Generates sample K8s events that trigger threshold-based alerts
- Each click creates unique events to bypass cooldown mechanisms

### **Active Situations**
- **High and Critical** severity alerts automatically become active situations
- Situations group related alerts by error code and service
- Use the **"🔧 Fix Issue"** button to resolve alerts

### **Reset & Clear**
- **"Reset K8s Cooldowns"** - Clears threshold engine cooldowns for testing
- **"Clear All"** - Removes all alerts and resets the system

## 🏗️ Architecture

### **Frontend Technologies**
- **HTML5** - Semantic markup and structure
- **CSS3** - Modern styling with gradients, animations, and responsive design
- **Vanilla JavaScript** - No frameworks, pure ES6+ functionality
- **CSS Grid & Flexbox** - Modern layout systems

### **Core Components**

#### **K8s Threshold Engine**
```javascript
class K8sThresholdEngine {
    // Configurable rules with thresholds, windows, and cooldowns
    // Sliding window event processing
    // Smart key extraction and grouping
    // Cooldown management to prevent alert spam
}
```

#### **Alert Correlation Engine**
```javascript
// Groups alerts by error_code and service
// Creates actionable situations from related alerts
// Filters by severity (high/critical only)
// Real-time updates and metrics
```

#### **UI Components**
- **Metrics Dashboard** - Real-time KPIs and system status
- **Control Panel** - Interactive buttons for testing and management
- **Alerts Panel** - Comprehensive alert display with source badges
- **Situations Panel** - Correlated incident management

## 📊 Sample Data Types

### **Datadog Alerts**
- High CPU Usage
- Memory Leak Detection
- Network Latency Spikes
- Disk I/O Bottlenecks
- API Rate Limit Exceeded
- Load Balancer Health Check Failures

### **LogicMonitor Alerts**
- Database Connection Pool Exhaustion
- SSL Certificate Expiration
- Service Response Time Degradation
- Disk Space Critical
- Cache Hit Rate Drops
- Queue Processing Delays

### **Kubernetes Events**
- Pod CrashLoopBackOff Bursts
- ImagePull Failures
- Node Not Ready
- High Pod Evictions
- ConfigMap Change Spikes

## 🔧 Configuration

### **K8s Threshold Rules**
The system includes pre-configured rules for common Kubernetes issues:

```javascript
{
    name: "CrashLoopBackOff bursts",
    key: ["namespace", "involvedObject.name"],
    match: { "reason": "BackOff", "type": "Warning" },
    threshold: 5,
    severity: "high",
    window: 5 * 60 * 1000, // 5 minutes
    cooldown: 10 * 60 * 1000 // 10 minutes
}
```

### **Customization**
- Modify threshold values in `K8sThresholdEngine.loadThresholdRules()`
- Adjust cooldown periods for different alert types
- Add new rule patterns for specific use cases
- Customize severity levels and window sizes

## 📈 Metrics & Monitoring

### **Real-time Dashboard**
- **Total Alerts** - Cumulative count of all generated alerts
- **Active Situations** - Number of correlated incident groups
- **K8s Events** - Kubernetes threshold alerts count
- **Datadog Alerts** - Infrastructure monitoring alerts
- **LogicMonitor** - Business monitoring alerts
- **Processing Time** - Performance metrics

### **Alert Accumulation**
- Alerts accumulate with each button press
- No data loss between operations
- Persistent state during session
- Easy testing of correlation logic

## 🎨 UI Features

### **Visual Enhancements**
- **Smooth Animations** - Fade-in, slide, and hover effects
- **Source Badges** - Color-coded alert origins (K8s, Datadog, LogicMonitor)
- **Severity Indicators** - Visual severity levels with color coding
- **Responsive Design** - Adapts to different screen sizes
- **Professional Styling** - Enterprise-grade visual design

### **Interactive Elements**
- **Hover Effects** - Enhanced visual feedback
- **Click Actions** - Fix buttons, clear functions
- **Real-time Updates** - Live metric updates
- **Notification System** - Success, error, and info messages

## 🧪 Testing & Development

### **Demo Mode**
- **Self-contained** - No external dependencies required
- **Sample Data** - Realistic alert scenarios
- **Accumulation Testing** - Test correlation with large alert volumes
- **Threshold Testing** - Validate K8s event processing

### **Development Features**
- **Console Logging** - Comprehensive debugging information
- **Error Handling** - Graceful fallbacks and user feedback
- **Performance Monitoring** - Processing time metrics
- **State Management** - Centralized demo state

## 🔒 Security & Best Practices

### **Browser Security**
- **Local Development** - No external API calls
- **Client-side Processing** - All logic runs in browser
- **No Sensitive Data** - Sample data only, no production credentials

### **Code Quality**
- **ES6+ Standards** - Modern JavaScript practices
- **Modular Design** - Clean separation of concerns
- **Error Handling** - Comprehensive error management
- **Performance Optimized** - Efficient algorithms and data structures

## 🚀 Future Enhancements

### **Planned Features**
- **Real-time WebSocket** - Live alert streaming
- **External API Integration** - Connect to actual monitoring systems
- **Advanced Correlation** - Machine learning-based incident grouping
- **Mobile App** - Native mobile experience
- **Multi-tenant Support** - Team and organization management

### **Extensibility**
- **Plugin Architecture** - Custom alert source integration
- **Rule Engine** - Visual rule builder interface
- **Custom Dashboards** - Personalized metric views
- **API Endpoints** - RESTful integration points

## 🤝 Contributing

### **Getting Started**
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### **Development Setup**
```bash
# Clone and setup
git clone https://github.com/Rahul-Kaura/AnomalyDetection.git
cd AnomalyDetection

# Start development server
python3 -m http.server 8000

# Open in browser
open http://localhost:8000/demo-unified.html
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Kubernetes Community** - For event-driven architecture inspiration
- **Monitoring Tools** - Datadog and LogicMonitor for alert format examples
- **Modern Web Standards** - HTML5, CSS3, and ES6+ for powerful frontend capabilities

## 📞 Support

- **Issues** - Report bugs and feature requests on GitHub
- **Discussions** - Join community discussions
- **Documentation** - Check this README and inline code comments

---

**Built with ❤️ for the DevOps and SRE community**

*Transform your alert noise into actionable intelligence with the Enterprise Alert Correlation System.*
