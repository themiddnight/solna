/**
 * Main Entry Point with Cluster Support
 * 
 * This file is the main entry point for the application.
 * When clustering is enabled:
 * - Primary process forks workers and monitors them
 * - Worker processes run the actual application
 * 
 * When clustering is disabled:
 * - Runs the application directly in a single process
 */
import { startCluster } from './config/cluster';

// Start cluster if enabled
// If this returns true, we're the primary process and should not run the app
const isPrimary = startCluster();

if (!isPrimary) {
  // This is a worker process (or clustering is isDisabled)
  // Import and run the actual application
  require('./index');
}
