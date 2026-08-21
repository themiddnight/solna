#!/usr/bin/env bun

/**
 * HTTPS Setup Validation Script
 * Simple validation of HTTPS configuration for WebRTC testing
 */

import { HTTPSTestConfigFactory } from '../src/testing/HTTPSTestConfig';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  component: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: unknown;
}

class HTTPSSetupValidator {
  private readonly results: ValidationResult[] = [];

  async validateAll(): Promise<ValidationResult[]> {
    console.log('🔍 Validating HTTPS Setup for WebRTC Testing...\n');

    await this.validateSSLCertificates();
    await this.validateHTTPSEnvironment();
    await this.validateFrontendConfiguration();
    await this.validateMkcertCompatibility();
    await this.validateTestConfiguration();

    this.printResults();
    return this.results;
  }

  private async validateSSLCertificates(): Promise<void> {
    console.log('📋 Validating SSL Certificates...');

    const certPath = join(process.cwd(), '.ssl', 'server.crt');
    const keyPath = join(process.cwd(), '.ssl', 'server.key');

    try {
      const validation = await HTTPSTestConfigFactory.validateSSLConfig(certPath, keyPath);

      if (validation.valid) {
        this.results.push({
          component: 'SSL Certificates',
          status: 'PASS',
          message: 'SSL certificates are valid and readable',
          details: validation.details
        });
      } else {
        this.results.push({
          component: 'SSL Certificates',
          status: 'FAIL',
          message: validation.error || 'SSL certificate validation failed',
          details: validation.details
        });
      }
    } catch (error) {
      this.results.push({
        component: 'SSL Certificates',
        status: 'FAIL',
        message: `SSL validation error: ${String(error)}`,
      });
    }
  }

  private async validateHTTPSEnvironment(): Promise<void> {
    console.log('🌐 Validating HTTPS Test Environment...');

    try {
      const httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false,
        port: 0
      });

      await httpsEnv.initialize();
      
      const port = httpsEnv.getPort();
      const httpsUrl = httpsEnv.getHTTPSUrl();

      if (port && httpsUrl.startsWith('https://')) {
        this.results.push({
          component: 'HTTPS Environment',
          status: 'PASS',
          message: `HTTPS environment initialized successfully`,
          details: { port, httpsUrl }
        });
      } else {
        this.results.push({
          component: 'HTTPS Environment',
          status: 'FAIL',
          message: 'HTTPS environment initialization failed'
        });
      }

      await httpsEnv.cleanup();
    } catch (error) {
      this.results.push({
        component: 'HTTPS Environment',
        status: 'FAIL',
        message: `HTTPS environment error: ${String(error)}`
      });
    }
  }

  private async validateFrontendConfiguration(): Promise<void> {
    console.log('🎨 Validating Frontend Configuration...');

    try {
      // Check Vite config
      const viteConfigPath = join(process.cwd(), '..', 'jam-band-fe', 'vite.config.ts');
      if (existsSync(viteConfigPath)) {
        const viteConfig = readFileSync(viteConfigPath, 'utf-8');
        
        if (viteConfig.includes('mkcert()')) {
          this.results.push({
            component: 'Frontend Vite Config',
            status: 'PASS',
            message: 'Vite mkcert plugin is configured'
          });
        } else {
          this.results.push({
            component: 'Frontend Vite Config',
            status: 'WARN',
            message: 'mkcert plugin not found in Vite config'
          });
        }
      } else {
        this.results.push({
          component: 'Frontend Vite Config',
          status: 'WARN',
          message: 'Vite config file not found'
        });
      }

      // Check Vitest config
      const vitestConfigPath = join(process.cwd(), '..', 'jam-band-fe', 'vitest.config.ts');
      if (existsSync(vitestConfigPath)) {
        const vitestConfig = readFileSync(vitestConfigPath, 'utf-8');
        
        if (vitestConfig.includes('https-setup.ts')) {
          this.results.push({
            component: 'Frontend Test Config',
            status: 'PASS',
            message: 'HTTPS test setup is configured in Vitest'
          });
        } else {
          this.results.push({
            component: 'Frontend Test Config',
            status: 'WARN',
            message: 'HTTPS test setup not found in Vitest config'
          });
        }
      }

      // Test frontend-compatible environment
      const frontendEnv = HTTPSTestConfigFactory.createFrontendCompatible({
        port: 3001
      });

      await frontendEnv.initialize();
      
      if (frontendEnv.getPort() === 3001) {
        this.results.push({
          component: 'Frontend Compatibility',
          status: 'PASS',
          message: 'Frontend-compatible HTTPS environment works'
        });
      }

      await frontendEnv.cleanup();
    } catch (error) {
      this.results.push({
        component: 'Frontend Configuration',
        status: 'FAIL',
        message: `Frontend validation error: ${String(error)}`
      });
    }
  }

  private async validateMkcertCompatibility(): Promise<void> {
    console.log('🔐 Validating mkcert Compatibility...');

    try {
      const httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        enableLogging: false
      });
      await httpsEnv.initialize();

      const compatibility = await httpsEnv.validateMkcertCompatibility();

      if (compatibility.certificateValid && compatibility.browserCompatible) {
        this.results.push({
          component: 'mkcert Compatibility',
          status: 'PASS',
          message: 'Certificates are browser-compatible',
          details: compatibility
        });
      } else {
        this.results.push({
          component: 'mkcert Compatibility',
          status: 'WARN',
          message: 'Certificate compatibility issues detected',
          details: compatibility
        });
      }

      await httpsEnv.cleanup();
    } catch (error) {
      this.results.push({
        component: 'mkcert Compatibility',
        status: 'FAIL',
        message: `mkcert validation error: ${String(error)}`
      });
    }
  }

  private async validateTestConfiguration(): Promise<void> {
    console.log('🧪 Validating Test Configuration...');

    try {
      // Check backend test scripts
      const packageJsonPath = join(process.cwd(), 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { scripts?: Record<string, string> };
        
        if (packageJson.scripts?.['test:https'] != null) {
          this.results.push({
            component: 'Backend Test Scripts',
            status: 'PASS',
            message: 'HTTPS test scripts are configured'
          });
        } else {
          this.results.push({
            component: 'Backend Test Scripts',
            status: 'WARN',
            message: 'HTTPS test scripts not found'
          });
        }
      }

      // Check frontend test scripts
      const fePackageJsonPath = join(process.cwd(), '..', 'jam-band-fe', 'package.json');
      if (existsSync(fePackageJsonPath)) {
        const fePackageJson = JSON.parse(readFileSync(fePackageJsonPath, 'utf-8')) as { scripts?: Record<string, string> };
        
        if (fePackageJson.scripts?.['test:https'] != null) {
          this.results.push({
            component: 'Frontend Test Scripts',
            status: 'PASS',
            message: 'Frontend HTTPS test scripts are configured'
          });
        } else {
          this.results.push({
            component: 'Frontend Test Scripts',
            status: 'WARN',
            message: 'Frontend HTTPS test scripts not found'
          });
        }
      }

      // Validate WebRTC test configuration
      const config = HTTPSTestConfigFactory.getWebRTCTestConfig('https://localhost:3001');
      
      if (config.iceServers.length > 0 && config.allowInsecure) {
        this.results.push({
          component: 'WebRTC Test Config',
          status: 'PASS',
          message: 'WebRTC configuration is properly set up for HTTPS testing',
          details: {
            iceServers: config.iceServers.length,
            allowInsecure: config.allowInsecure,
            audioConstraints: config.constraints.audio
          }
        });
      } else {
        this.results.push({
          component: 'WebRTC Test Config',
          status: 'FAIL',
          message: 'WebRTC configuration is incomplete'
        });
      }
    } catch (error) {
      this.results.push({
        component: 'Test Configuration',
        status: 'FAIL',
        message: `Test configuration validation error: ${String(error)}`
      });
    }
  }

  private printResults(): void {
    console.log('\n📋 HTTPS Setup Validation Results:');
    console.log('=====================================');

    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;

    for (const result of this.results) {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
      console.log(`${icon} ${result.component}: ${result.message}`);
      
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }

      switch (result.status) {
        case 'PASS': passCount++; break;
        case 'WARN': warnCount++; break;
        case 'FAIL': failCount++; break;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Passed: ${passCount}`);
    console.log(`   ⚠️  Warnings: ${warnCount}`);
    console.log(`   ❌ Failed: ${failCount}`);

    if (failCount === 0) {
      console.log('\n🎉 HTTPS setup is ready for WebRTC testing!');
      
      if (warnCount > 0) {
        console.log('⚠️  Some warnings were found, but they may not affect core functionality.');
      }
    } else {
      console.log('\n⚠️  Some critical issues were found. Please address the failed components.');
    }

    console.log('\n📝 Next Steps:');
    console.log('   1. Run backend HTTPS tests: bun run test:https');
    console.log('   2. Run frontend HTTPS tests: cd ../jam-band-fe && bun run test:https');
    console.log('   3. Start development with HTTPS: bun dev (backend) and bun dev (frontend)');
  }
}

// Run validation if this script is executed directly
if (import.meta.main) {
  const validator = new HTTPSSetupValidator();
  
  try {
    const results = await validator.validateAll();
    const failCount = results.filter(r => r.status === 'FAIL').length;
    process.exit(failCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

export { HTTPSSetupValidator };