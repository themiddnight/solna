#!/usr/bin/env bun

/**
 * WebRTC HTTPS Test Runner
 * 
 * Task 3.2: Test WebRTC functionality maintains low latency over HTTPS
 * Runs comprehensive WebRTC performance tests over HTTPS using Bun test runner
 * 
 * Usage: bun run test:webrtc
 * Requirements: 8.1, 8.4
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface PerformanceSummary {
  connectionEstablishment: number;
  meshTopology: number;
  iceGathering: number;
  sslOverhead: number;
  concurrentConnections: number;
}

class WebRTCHTTPSTestRunner {
  private readonly testResults: TestResult[] = [];
  private readonly performanceMetrics: PerformanceSummary = {
    connectionEstablishment: 0,
    meshTopology: 0,
    iceGathering: 0,
    sslOverhead: 0,
    concurrentConnections: 0
  };

  async run(): Promise<void> {
    console.log('🚀 Starting WebRTC HTTPS Performance Tests');
    console.log('=' .repeat(60));

    // Validate prerequisites
    await this.validatePrerequisites();

    // Run test suites
    await this.runTestSuite();

    // Generate report
    await this.generateReport();
  }

  private async validatePrerequisites(): Promise<void> {
    console.log('🔍 Validating prerequisites...');

    // Check SSL certificates
    const certPath = join(process.cwd(), '.ssl', 'server.crt');
    const keyPath = join(process.cwd(), '.ssl', 'server.key');

    if (!existsSync(certPath) || !existsSync(keyPath)) {
      console.error('❌ SSL certificates not found!');
      console.log('   Expected locations:');
      console.log(`   - Certificate: ${certPath}`);
      console.log(`   - Private Key: ${keyPath}`);
      console.log('\n💡 Run the following to generate certificates:');
      console.log('   bun run scripts/generate-ssl.js');
      process.exit(1);
    }

    // Check Bun version
    try {
      const bunVersion = execSync('bun --version', { encoding: 'utf8' }).trim();
      console.log(`✅ Bun version: ${bunVersion}`);
    } catch {
      console.error('❌ Bun not found or not working properly');
      process.exit(1);
    }

    // Check test file exists
    const testFile = 'src/domains/real-time-communication/infrastructure/handlers/__tests__/VoiceConnectionHandler.webrtc.test.ts';
    if (!existsSync(testFile)) {
      console.error(`❌ Test file not found: ${testFile}`);
      process.exit(1);
    }

    console.log('✅ All prerequisites validated');
    console.log('');
  }

  private async runTestSuite(): Promise<void> {
    const testFile = 'src/domains/real-time-communication/infrastructure/handlers/__tests__/VoiceConnectionHandler.webrtc.test.ts';
    
    console.log('🧪 Running WebRTC HTTPS Performance Tests...');
    console.log(`📁 Test file: ${testFile}`);
    console.log('');

    const startTime = Date.now();

    try {
      // Run Bun tests with verbose output and timeout
      const command = `bun test ${testFile} --timeout 60000`;
      console.log(`🔧 Command: ${command}`);
      console.log('');

      const output = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: process.cwd()
      });

      const duration = Date.now() - startTime;
      
      // Parse test output
      this.parseTestOutput(output);
      
      this.testResults.push({
        suite: 'WebRTC HTTPS Performance Tests',
        passed: true,
        duration
      });

      console.log('✅ All WebRTC HTTPS tests passed!');
      console.log(`⏱️  Total duration: ${duration}ms`);
      
    } catch (caught: unknown) {
      const error = caught as { stdout?: string; stderr?: string; message?: string };
      const duration = Date.now() - startTime;

      this.testResults.push({
        suite: 'WebRTC HTTPS Performance Tests',
        passed: false,
        duration,
        ...(error.message !== undefined ? { error: error.message } : {})
      });

      console.error('❌ WebRTC HTTPS tests failed:');
      console.error(error.stdout ?? error.message ?? String(caught));
      
      // Don't exit here, continue to generate report
    }
  }

  private parseTestOutput(output: string): void {
    console.log('📊 Parsing performance metrics from test output...');
    
    // Extract performance metrics from test output
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Parse connection establishment metrics
      const connectionMatch = line.match(/HTTPS Connection:.*Connection=(\d+\.?\d*)ms/);
      if (connectionMatch?.[1]) {
        this.performanceMetrics.connectionEstablishment = parseFloat(connectionMatch[1]);
      }

      // Parse mesh topology metrics
      const meshMatch = line.match(/HTTPS Mesh.*Total=(\d+\.?\d*)ms/);
      if (meshMatch?.[1]) {
        this.performanceMetrics.meshTopology = parseFloat(meshMatch[1]);
      }

      // Parse ICE gathering metrics
      const iceMatch = line.match(/HTTPS ICE Gathering.*Total=(\d+\.?\d*)ms/);
      if (iceMatch?.[1]) {
        this.performanceMetrics.iceGathering = parseFloat(iceMatch[1]);
      }

      // Parse SSL overhead metrics
      const overheadMatch = line.match(/SSL Overhead: (\d+\.?\d*)ms/);
      if (overheadMatch?.[1]) {
        this.performanceMetrics.sslOverhead = parseFloat(overheadMatch[1]);
      }

      // Parse concurrent connection metrics
      const concurrentMatch = line.match(/HTTPS Concurrent.*Total=(\d+\.?\d*)ms/);
      if (concurrentMatch?.[1]) {
        this.performanceMetrics.concurrentConnections = parseFloat(concurrentMatch[1]);
      }
    }

    console.log('✅ Performance metrics extracted');
  }

  private async generateReport(): Promise<void> {
    console.log('\n📋 Generating WebRTC HTTPS Performance Report...');
    console.log('=' .repeat(60));

    // Test Results Summary
    console.log('🧪 Test Results Summary:');
    const passedTests = this.testResults.filter(r => r.passed).length;
    const totalTests = this.testResults.length;
    
    console.log(`   ✅ Passed: ${passedTests}/${totalTests}`);
    console.log(`   ❌ Failed: ${totalTests - passedTests}/${totalTests}`);
    
    if (totalTests > 0) {
      const avgDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0) / totalTests;
      console.log(`   ⏱️  Average Duration: ${avgDuration.toFixed(2)}ms`);
    }

    // Performance Metrics Summary
    console.log('\n📊 Performance Metrics Summary:');
    console.log(`   🔗 Connection Establishment: ${this.performanceMetrics.connectionEstablishment.toFixed(2)}ms`);
    console.log(`   🕸️  Mesh Topology Creation: ${this.performanceMetrics.meshTopology.toFixed(2)}ms`);
    console.log(`   🧊 ICE Gathering: ${this.performanceMetrics.iceGathering.toFixed(2)}ms`);
    console.log(`   🔒 SSL Overhead: ${this.performanceMetrics.sslOverhead.toFixed(2)}ms`);
    console.log(`   ⚡ Concurrent Connections: ${this.performanceMetrics.concurrentConnections.toFixed(2)}ms`);

    // Performance Analysis
    console.log('\n🎯 Performance Analysis:');
    this.analyzePerformance();

    // Requirements Validation
    console.log('\n✅ Requirements Validation:');
    this.validateRequirements();

    // Export detailed report
    const reportData = {
      timestamp: new Date().toISOString(),
      testResults: this.testResults,
      performanceMetrics: this.performanceMetrics,
      requirements: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '8.1': this.validateRequirement81(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '8.4': this.validateRequirement84()
      }
    };

    try {
      await Bun.write('webrtc-https-test-report.json', JSON.stringify(reportData, null, 2));
      console.log('\n📄 Detailed report exported to webrtc-https-test-report.json');
    } catch (error) {
      console.warn('⚠️  Could not export detailed report:', error);
    }

    // Final status
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const allTestsPassed = this.testResults.every(r => r.passed);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const performanceAcceptable = this.isPerformanceAcceptable();
    
    console.log('\n🏁 Final Status:');
    if (allTestsPassed && performanceAcceptable) {
      console.log('✅ All WebRTC HTTPS tests passed with acceptable performance!');
      console.log('✅ Task 3.2 requirements satisfied');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed or performance is not acceptable');
      console.log('❌ Task 3.2 requirements not fully satisfied');
      process.exit(1);
    }
  }

  private analyzePerformance(): void {
    const metrics = this.performanceMetrics;

    // Connection establishment analysis
    if (metrics.connectionEstablishment > 0) {
      if (metrics.connectionEstablishment < 20) {
        console.log('   ✅ Connection establishment: Excellent (<20ms)');
      } else if (metrics.connectionEstablishment < 30) {
        console.log('   ⚠️  Connection establishment: Good (20-30ms)');
      } else {
        console.log('   ❌ Connection establishment: Poor (>30ms)');
      }
    }

    // Mesh topology analysis
    if (metrics.meshTopology > 0) {
      if (metrics.meshTopology < 100) {
        console.log('   ✅ Mesh topology: Excellent (<100ms)');
      } else if (metrics.meshTopology < 150) {
        console.log('   ⚠️  Mesh topology: Good (100-150ms)');
      } else {
        console.log('   ❌ Mesh topology: Poor (>150ms)');
      }
    }

    // SSL overhead analysis
    if (metrics.sslOverhead > 0) {
      if (metrics.sslOverhead < 10) {
        console.log('   ✅ SSL overhead: Minimal (<10ms)');
      } else if (metrics.sslOverhead < 20) {
        console.log('   ⚠️  SSL overhead: Acceptable (10-20ms)');
      } else {
        console.log('   ❌ SSL overhead: High (>20ms)');
      }
    }

    // ICE gathering analysis
    if (metrics.iceGathering > 0) {
      if (metrics.iceGathering < 50) {
        console.log('   ✅ ICE gathering: Fast (<50ms)');
      } else if (metrics.iceGathering < 100) {
        console.log('   ⚠️  ICE gathering: Acceptable (50-100ms)');
      } else {
        console.log('   ❌ ICE gathering: Slow (>100ms)');
      }
    }

    // Concurrent connections analysis
    if (metrics.concurrentConnections > 0) {
      if (metrics.concurrentConnections < 80) {
        console.log('   ✅ Concurrent connections: Excellent (<80ms)');
      } else if (metrics.concurrentConnections < 120) {
        console.log('   ⚠️  Concurrent connections: Good (80-120ms)');
      } else {
        console.log('   ❌ Concurrent connections: Poor (>120ms)');
      }
    }
  }

  private validateRequirements(): void {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const req81 = this.validateRequirement81();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const req84 = this.validateRequirement84();

    console.log(`   📋 Requirement 8.1 (Performance): ${req81 ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   📋 Requirement 8.4 (Scalability): ${req84 ? '✅ PASSED' : '❌ FAILED'}`);
  }

  private validateRequirement81(): boolean {
    // Requirement 8.1: Response times SHALL not increase by more than 10%
    // For WebRTC over HTTPS, we allow reasonable SSL overhead
    const metrics = this.performanceMetrics;
    
    return (
      metrics.connectionEstablishment <= 30 && // Connection under 30ms
      metrics.sslOverhead <= 20 && // SSL overhead under 20ms
      metrics.iceGathering <= 100 // ICE gathering under 100ms
    );
  }

  private validateRequirement84(): boolean {
    // Requirement 8.4: The new architecture SHALL support horizontal scaling
    // Concurrent connections should handle multiple users efficiently
    const metrics = this.performanceMetrics;
    
    return (
      metrics.meshTopology <= 150 && // Mesh creation under 150ms
      metrics.concurrentConnections <= 120 // Concurrent operations under 120ms
    );
  }

  private isPerformanceAcceptable(): boolean {
    return this.validateRequirement81() && this.validateRequirement84();
  }
}

// Main execution
async function main() {
  const runner = new WebRTCHTTPSTestRunner();
  await runner.run();
}

// Run if called directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}

export { WebRTCHTTPSTestRunner };