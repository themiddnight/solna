import type { Server } from "socket.io";

import { config } from "../../config/environment";
import type { NamespaceManager } from "../../shared/infrastructure/namespace/NamespaceManager";
import { PerformanceMonitoringService } from "../../shared/infrastructure/performance/PerformanceMonitoringService";
import { ConnectionHealthService } from "../../shared/infrastructure/resilience/ConnectionHealthService";
import { NamespaceCleanupService } from "../../shared/infrastructure/namespace/NamespaceCleanupService";
import { ConnectionOptimizationService } from "../../shared/infrastructure/performance/ConnectionOptimizationService";
import { roomSessionManager } from "../../domains/room-management/infrastructure/services/RoomSessionManager";

export interface MonitoringServices {
  performanceMonitoring: PerformanceMonitoringService;
  connectionHealth: ConnectionHealthService;
  namespaceCleanup: NamespaceCleanupService;
  connectionOptimization: ConnectionOptimizationService | null;
}

/** Performance/health monitoring services. Construction preserved from the original bootstrap. */
export function composeMonitoring(
  io: Server,
  namespaceManager: NamespaceManager
): MonitoringServices {
  // Initialize performance monitoring services
  const performanceMonitoring = PerformanceMonitoringService.getInstance(
    namespaceManager,
    roomSessionManager
  );
  // Wire the namespace getter so health checks can actually reach sockets:
  // without it the B1 guards in ConnectionHealthService skip every connection
  // and pings/recovery never run.
  const connectionHealth = ConnectionHealthService.getInstance(
    performanceMonitoring,
    (namespacePath) => namespaceManager.getNamespace(namespacePath) ?? null
  );
  const namespaceCleanup = NamespaceCleanupService.getInstance(
    namespaceManager,
    roomSessionManager,
    performanceMonitoring
  );

  // Only enable connection optimization in production - it interferes with development
  const connectionOptimization =
    config.nodeEnv === "production"
      ? ConnectionOptimizationService.getInstance(io, performanceMonitoring)
      : null;

  return {
    performanceMonitoring,
    connectionHealth,
    namespaceCleanup,
    connectionOptimization,
  };
}
