import { closeRedisConnections } from "../config/redis";
import { getWorkerId } from "../config/cluster";
import type { ApprovalWorkflowHandler } from "../domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler";
import type { LobbyIntegrationService } from "../domains/lobby-management/infrastructure/LobbyIntegrationService";
import type { EventSystemInitializer } from "../shared/infrastructure/events/EventSystemInitializer";
import { loggingService } from "../shared/infrastructure/logging/LoggingService";
import type { NamespaceManager } from "../shared/infrastructure/namespace/NamespaceManager";
import { namespaceGracePeriodManager } from "../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import type { NamespaceCleanupService } from "../shared/infrastructure/namespace/NamespaceCleanupService";
import type { ConnectionOptimizationService } from "../shared/infrastructure/performance/ConnectionOptimizationService";
import type { PerformanceMonitoringService } from "../shared/infrastructure/performance/PerformanceMonitoringService";
import type { ConnectionHealthService } from "../shared/infrastructure/resilience/ConnectionHealthService";
import { systemPressureService } from "../shared/infrastructure/resilience/SystemPressureService";
import type { AppServer } from "./server";

export interface GracefulShutdownDependencies {
  server: AppServer;
  performanceMonitoring: PerformanceMonitoringService;
  connectionHealth: ConnectionHealthService;
  namespaceCleanup: NamespaceCleanupService;
  connectionOptimization: ConnectionOptimizationService | null;
  lobbyIntegrationService: LobbyIntegrationService;
  namespaceManager: NamespaceManager;
  approvalWorkflowHandler: ApprovalWorkflowHandler;
  eventSystemInitializer: EventSystemInitializer;
}

export function registerGracefulShutdown(
  dependencies: GracefulShutdownDependencies
): void {
  const gracefulShutdown = (signal: string) => {
    loggingService.logInfo(`Received ${signal}, starting graceful shutdown`);

    dependencies.server.close(() => {
      loggingService.logInfo("HTTP server closed");

      dependencies.performanceMonitoring.shutdown();
      dependencies.connectionHealth.shutdown();
      dependencies.namespaceCleanup.shutdown();
      if (dependencies.connectionOptimization) {
        dependencies.connectionOptimization.shutdown();
      }
      dependencies.lobbyIntegrationService.shutdown();

      dependencies.namespaceManager.shutdown();
      namespaceGracePeriodManager.shutdown();

      dependencies.approvalWorkflowHandler.getApprovalSessionManager().cleanup();

      systemPressureService.shutdown();

      dependencies.eventSystemInitializer.cleanup();

      closeRedisConnections()
        .then(() => {
          loggingService.logInfo("Graceful shutdown complete", { workerId: getWorkerId() });
          loggingService.shutdown();
          process.exit(0);
        })
        .catch(() => {
          loggingService.logInfo("Graceful shutdown complete (Redis cleanup hasFailed)", { workerId: getWorkerId() });
          loggingService.shutdown();
          process.exit(0);
        });
    });

    setTimeout(() => {
      loggingService.logError(new Error("Forced shutdown after timeout"));
      process.exit(1);
    }, 30000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
