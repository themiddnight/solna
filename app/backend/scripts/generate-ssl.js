#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sslDir = path.join(root, '.ssl');
const keyPath = path.join(sslDir, 'server.key');
const certPath = path.join(sslDir, 'server.crt');

function sh(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

function exists(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function quote(p) {
  return '"' + p.replace(/"/g, '\\"') + '"';
}

const force = process.argv.includes('--force') || process.argv.includes('-f');

console.log('\nGenerate self-signed SSL certificate for local development');
console.log('Output directory:', sslDir);

if (!exists('openssl version')) {
  console.error('\nError: OpenSSL not found on PATH. Please install OpenSSL and try again.');
  process.exit(2);
}

if (!fs.existsSync(sslDir)) {
  fs.mkdirSync(sslDir, { recursive: true });
  console.log('Created directory:', sslDir);
}

if (fs.existsSync(keyPath) || fs.existsSync(certPath)) {
  if (!force) {
    console.error('\nRefusing to overwrite existing files.');
    console.error('If you want to overwrite, re-run with --force or -f');
    console.error('\nExisting files:');
    if (fs.existsSync(keyPath)) console.error(' -', keyPath);
    if (fs.existsSync(certPath)) console.error(' -', certPath);
    process.exit(3);
  } else {
    console.log('Overwriting existing SSL files (force enabled)');
    try { fs.unlinkSync(keyPath); } catch (e) {}
    try { fs.unlinkSync(certPath); } catch (e) {}
  }
}

try {
  // Get the IP address from environment or use localhost as fallback
  const hostname = process.env.SSL_HOSTNAME || process.env.FRONTEND_URL?.replace(/^https?:\/\//, '').replace(/:\d+$/, '') || 'localhost';
  const subj = `/CN=${hostname}`;
  const cmd = `openssl req -x509 -nodes -newkey rsa:2048 -days 365 -keyout ${quote(keyPath)} -out ${quote(certPath)} -subj \"${subj}\"`;
  console.log('\nRunning OpenSSL to generate key and certificate...');
  console.log('Using hostname:', hostname);
  sh(cmd);

  // Tighten permissions on the key
  try { fs.chmodSync(keyPath, 0o600); } catch (e) {}

  console.log('\nGenerated files:');
  console.log(' -', keyPath);
  console.log(' -', certPath);
  console.log('\nYou can now run the backend in development with HTTPS enabled.');
  process.exit(0);
} catch (err) {
  console.error('\nFailed to generate SSL certificate:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
