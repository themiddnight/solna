#!/usr/bin/env bun

/**
 * HTTPS WebRTC Test Runner
 * Comprehensive testing script for HTTPS WebRTC functionality
 */

import { HTTPSTestConfigFactory, HTTPSWebRTCTestHelper } from '../src/testing/HTTPSTestConfig';
import type { HTTPSTestEnvironment } from '../src/testing/HTTPSTestEnvironment';

interface TestResults {
  sslValidation: boolean;
  httpsEnvironment: boolean;
  webrtcConnection: boolean;
  concurrentConnections: boolean;
  performanceBenchmark: {
    httpsLatency: number;
    httpLatency: number;
    sslOverhead: number;
  };
  mkcertCompatibility: boolean;
  frontendCompatibility: boolean;
}

class HTTPSWebRTCTestRunner {
  private readonly results: TestResults = {
    sslValidation: false,
    httpsEnvironment: false,
    webrtcConnection: false,
    concurrentConnections: false,
    performanceBenchmark: {
      httpsLatency: 0,
      httpLatency: 0,
      sslOverhead: 0
    },
    mkcertCompatibility: false,
    frontendCompatibility: false
  };

  async runAllTests(): Promise<TestResults> {
    console.log('🔒 Starting HTTPS WebRTC Test Suite...\n');

    try {
      await this.testSSLValidation();
      await this.testHTTPSEnvironment();
      await this.testWebRTCConnection();
      await this.testConcurrentConnections();
      await this.testPerformanceBenchmark();
      await this.testMkcertCompatibility();
      await this.testFrontendCompatibility();

      this.printResults();
      return this.results;
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      throw error;
    }
  }

  private async testSSLValidation(): Promise<void> {
    console.log('📋 Testing SSL Certificate Validation...');
    
    try {
      const validation = await HTTPSTestConfigFactory.validateSSLConfig(
        '.ssl/server.crt',
        '.ssl/server.key'
      );

      if (validation.valid) {
        console.log('✅ SSL certificates are valid and readable');
        this.results.sslValidation = true;
      } else {
        console.log('❌ SSL certificate validation failed:', validation.error);
        console.log('   Details:', validation.details);
      }
    } catch (error) {
      console.log('❌ SSL validation error:', error);
    }
    console.log();
  }

  private async testHTTPSEnvironment(): Promise<void> {
    console.log('🌐 Testing HTTPS Test Environment...');
    
    let httpsEnv: HTTPSTestEnvironment | null = null;
    
    try {
      httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false,
        port: 0
      });

      await httpsEnv.initialize();
      
      const port = httpsEnv.getPort();
      const httpsUrl = httpsEnv.getHTTPSUrl();
      
      console.log(`✅ HTTPS environment initialized on port ${port}`);
      console.log(`   URL: ${httpsUrl}`);
      
      this.results.httpsEnvironment = true;
    } catch (error) {
      console.log('❌ HTTPS environment initialization failed:', error);
    } finally {
      if (httpsEnv) {
        await httpsEnv.cleanup();
      }
    }
    console.log();
  }

  private async testWebRTCConnection(): Promise<void> {
    console.log('🔗 Testing WebRTC Connection over HTTPS...');
    
    let httpsEnv: HTTPSTestEnvironment | null = null;
    
    try {
      httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false
      });
      await httpsEnv.initialize();

      const webrtcHelper = new HTTPSWebRTCTestHelper(httpsEnv);
      const { room } = await httpsEnv.createTestRoom('WebRTC Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      if (!users[0]?.socket || !users[1]?.socket) {
        throw new Error('Failed to create test users with sockets');
      }

      const result = await webrtcHelper.testWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );

      if (result.success) {
        console.log('✅ WebRTC connection established successfully');
        console.log(`   Total latency: ${result.latency}ms`);
        console.log(`   SSL handshake: ${result.sslHandshakeTime}ms`);
        console.log(`   WebRTC handshake: ${result.webrtcHandshakeTime}ms`);
        this.results.webrtcConnection = true;
      } else {
        console.log('❌ WebRTC connection failed:', result.error);
      }
    } catch (error) {
      console.log('❌ WebRTC connection test error:', error);
    } finally {
      if (httpsEnv) {
        await httpsEnv.cleanup();
      }
    }
    console.log();
  }

  private async testConcurrentConnections(): Promise<void> {
    console.log('👥 Testing Concurrent HTTPS WebRTC Connections...');
    
    let httpsEnv: HTTPSTestEnvironment | null = null;
    
    try {
      httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false
      });
      await httpsEnv.initialize();

      const webrtcHelper = new HTTPSWebRTCTestHelper(httpsEnv);
      const { room } = await httpsEnv.createTestRoom('Concurrent Test');

      const result = await webrtcHelper.testConcurrentConnections(4, room.id);

      console.log(`✅ Concurrent connections test completed`);
      console.log(`   Successful: ${result.successfulConnections}`);
      console.log(`   Failed: ${result.failedConnections}`);
      console.log(`   Average latency: ${result.averageLatency.toFixed(2)}ms`);
      console.log(`   Max latency: ${result.maxLatency}ms`);
      console.log(`   Min latency: ${result.minLatency}ms`);

      this.results.concurrentConnections = result.failedConnections === 0;
    } catch (error) {
      console.log('❌ Concurrent connections test error:', error);
    } finally {
      if (httpsEnv) {
        await httpsEnv.cleanup();
      }
    }
    console.log();
  }

  private async testPerformanceBenchmark(): Promise<void> {
    console.log('⚡ Running HTTPS vs HTTP Performance Benchmark...');
    
    let httpsEnv: HTTPSTestEnvironment | null = null;
    
    try {
      httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false
      });
      await httpsEnv.initialize();

      const webrtcHelper = new HTTPSWebRTCTestHelper(httpsEnv);
      const benchmark = await webrtcHelper.benchmarkHTTPSvsHTTP(5);

      console.log('📊 Performance Benchmark Results:');
      console.log(`   HTTPS average latency: ${benchmark.httpsResults.averageLatency.toFixed(2)}ms`);
      console.log(`   HTTPS success rate: ${(benchmark.httpsResults.successRate * 100).toFixed(1)}%`);
      console.log(`   HTTP average latency: ${benchmark.httpResults.averageLatency.toFixed(2)}ms`);
      console.log(`   HTTP success rate: ${(benchmark.httpResults.successRate * 100).toFixed(1)}%`);
      console.log(`   SSL overhead: ${benchmark.sslOverhead.toFixed(2)}ms`);
      console.log(`   Recommendation: ${benchmark.recommendation}`);

      this.results.performanceBenchmark = {
        httpsLatency: benchmark.httpsResults.averageLatency,
        httpLatency: benchmark.httpResults.averageLatency,
        sslOverhead: benchmark.sslOverhead
      };
    } catch (error) {
      console.log('❌ Performance benchmark error:', error);
    } finally {
      if (httpsEnv) {
        await httpsEnv.cleanup();
      }
    }
    console.log();
  }

  private async testMkcertCompatibility(): Promise<void> {
    console.log('🔐 Testing mkcert Compatibility...');
    
    let httpsEnv: HTTPSTestEnvironment | null = null;
    
    try {
      httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false
      });
      await httpsEnv.initialize();

      const compatibility = await httpsEnv.validateMkcertCompatibility();

      console.log(`   mkcert available: ${compatibility.mkcertAvailable ? '✅' : '❌'}`);
      console.log(`   Certificate valid: ${compatibility.certificateValid ? '✅' : '❌'}`);
      console.log(`   Browser compatible: ${compatibility.browserCompatible ? '✅' : '❌'}`);

      this.results.mkcertCompatibility = compatibility.certificateValid && compatibility.browserCompatible;
    } catch (error) {
      console.log('❌ mkcert compatibility test error:', error);
    } finally {
      if (httpsEnv) {
        await httpsEnv.cleanup();
      }
    }
    console.log();
  }

  private async testFrontendCompatibility(): Promise<void> {
    console.log('🎨 Testing Frontend Compatibility...');
    
    let frontendEnv: HTTPSTestEnvironment | null = null;
    
    try {
      frontendEnv = HTTPSTestConfigFactory.createFrontendCompatible({
        port: 3001
      });
      await frontendEnv.initialize();

      const config = HTTPSTestConfigFactory.getWebRTCTestConfig(frontendEnv.getHTTPSUrl());

      console.log('✅ Frontend-compatible HTTPS environment created');
      console.log(`   Backend URL: ${frontendEnv.getHTTPSUrl()}`);
      console.log(`   ICE servers: ${config.iceServers.length}`);
      console.log(`   Allow insecure: ${config.allowInsecure}`);
      console.log(`   Audio constraints: ${config.constraints.audio}`);
      console.log(`   Video constraints: ${config.constraints.video}`);

      this.results.frontendCompatibility = true;
    } catch (error) {
      console.log('❌ Frontend compatibility test error:', error);
    } finally {
      if (frontendEnv) {
        await frontendEnv.cleanup();
      }
    }
    console.log();
  }

  private printResults(): void {
    console.log('📋 Test Results Summary:');
    console.log('========================');
    console.log(`SSL Validation: ${this.results.sslValidation ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`HTTPS Environment: ${this.results.httpsEnvironment ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`WebRTC Connection: ${this.results.webrtcConnection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Concurrent Connections: ${this.results.concurrentConnections ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`mkcert Compatibility: ${this.results.mkcertCompatibility ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Frontend Compatibility: ${this.results.frontendCompatibility ? '✅ PASS' : '❌ FAIL'}`);
    console.log();
    console.log('Performance Metrics:');
    console.log(`  HTTPS Latency: ${this.results.performanceBenchmark.httpsLatency.toFixed(2)}ms`);
    console.log(`  HTTP Latency: ${this.results.performanceBenchmark.httpLatency.toFixed(2)}ms`);
    console.log(`  SSL Overhead: ${this.results.performanceBenchmark.sslOverhead.toFixed(2)}ms`);
    console.log();

    const passedTests = Object.values(this.results).filter(result => 
      typeof result === 'boolean' && result
    ).length;
    const totalTests = Object.keys(this.results).filter(key => 
      typeof this.results[key as keyof TestResults] === 'boolean'
    ).length;

    console.log(`Overall: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All HTTPS WebRTC tests passed!');
    } else {
      console.log('⚠️  Some tests failed. Check the logs above for details.');
    }
  }
}

// Run tests if this script is executed directly
if (import.meta.main) {
  const runner = new HTTPSWebRTCTestRunner();
  
  try {
    await runner.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

export { HTTPSWebRTCTestRunner };