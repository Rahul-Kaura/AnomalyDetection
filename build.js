#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

console.log('🚨 Enhanced Browser Correlator - Build Status Check...');

// Check if dist directory exists
if (!fs.existsSync('dist')) {
    console.log('❌ dist/ directory not found!');
    process.exit(1);
}

// Check key files
const requiredFiles = [
    'index.html',
    'demo.html', 
    'demo-enhanced.html',
    'demo-k8s-enhanced.html',
    'main-enhanced.js',
    'main-simple.js',
    'main.js',
    'correlator.js',
    'app.js',
    'styles.css'
];

console.log('📁 Checking required files...');
let allFilesExist = true;

requiredFiles.forEach(file => {
    const filePath = `dist/${file}`;
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file} - MISSING!`);
        allFilesExist = false;
    }
});

if (allFilesExist) {
    console.log('\n🎉 All files are ready!');
    console.log('🌐 Serve with: python3 -m http.server 8000');
    console.log('\n🚀 Available demos:');
    console.log('  - http://localhost:8000/ (Landing page)');
    console.log('  - http://localhost:8000/demo-k8s-enhanced.html (K8s Enhanced Correlator) ⭐');
    console.log('  - http://localhost:8000/demo-enhanced.html (Advanced Correlator)');
    console.log('  - http://localhost:8000/demo.html (Basic Demo)');
    console.log('\n🎯 K8s Enhanced Correlator features:');
    console.log('  - Threshold-based K8s event-to-alert conversion');
    console.log('  - Multi-source correlation (K8s, Datadog, LogicMonitor)');
    console.log('  - MTTR-focused situation building');
    console.log('  - Professional UI with real-time metrics');
    console.log('\n📚 Documentation:');
    console.log('  - README.md (General overview)');
    console.log('  - README-K8S.md (K8s specific features)');
} else {
    console.log('\n❌ Some files are missing. Please check the build process.');
    process.exit(1);
}
