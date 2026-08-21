import express, { type Express } from "express";
import helmet from "helmet";
import passport from "passport";
import multer from "multer";

import { createRoutes } from "../routes";
import { createPerformanceRoutes } from "../routes/performance";
import { compressionMiddleware } from "../middleware/compression";
import { corsDebugMiddleware, corsMiddleware } from "../middleware/cors";
import {
  errorMonitor,
  performanceMonitor,
  requestMonitor,
} from "../middleware/monitoring";
import { apiLimiter } from "../middleware/rateLimit";
import {
  requestLogger,
  sanitizeInput,
  securityHeaders,
} from "../middleware/security";
import type { ProjectController } from "../domains/arrange-room/infrastructure/controllers/ProjectController";
import type { AudioRegionController } from "../domains/arrange-room/infrastructure/controllers/AudioRegionController";
import type { RoomController } from "../domains/room-management/infrastructure/controllers/RoomController";
import type { RoomLifecycleHandler } from "../domains/room-management/infrastructure/handlers";
import type { ConnectionOptimizationService } from "../shared/infrastructure/performance/ConnectionOptimizationService";
import type { PerformanceMonitoringService } from "../shared/infrastructure/performance/PerformanceMonitoringService";
import type { ConnectionHealthService } from "../shared/infrastructure/resilience/ConnectionHealthService";
import type { NamespaceCleanupService } from "../shared/infrastructure/namespace/NamespaceCleanupService";
import { config } from "../config/environment";
import { loggingService } from "../shared/infrastructure/logging/LoggingService";

export interface HttpLayerDependencies {
  roomController: RoomController;
  roomLifecycleHandler: RoomLifecycleHandler;
  audioRegionController: AudioRegionController;
  projectController: ProjectController;
  performanceMonitoring: PerformanceMonitoringService;
  connectionHealth: ConnectionHealthService;
  namespaceCleanup: NamespaceCleanupService;
  connectionOptimization: ConnectionOptimizationService | null;
}

export function configureHttpLayer(
  app: Express,
  dependencies: HttpLayerDependencies
): void {
  // Trust the first proxy for accurate client IP behind Railway load balancer
  app.set('trust proxy', 1);

  // Helmet with dev-friendly defaults: disable HSTS and CSP in development
  app.use(helmet(
    config.nodeEnv === 'production'
      ? {}
      : { hsts: false, contentSecurityPolicy: false }
  ));
  app.use(securityHeaders);

  app.use(compressionMiddleware);

  app.use(requestMonitor);
  app.use(performanceMonitor);

  app.use(requestLogger);
  app.use(corsDebugMiddleware);
  app.use(corsMiddleware);

  app.use("/api", apiLimiter);

  app.use(passport.initialize());

  app.use(
    "/api/projects",
    express.json({
      limit: "50mb",
      strict: true,
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  app.use((req, res, next) => {
    const contentType = req.get("Content-Type") || "";
    if (contentType.includes("multipart/form-data")) {
      return next();
    }
    express.json({
      limit: "1mb",
      strict: true,
      verify: (jsonReq, _jsonRes, buf) => {
        (jsonReq as typeof jsonReq & { rawBody?: Buffer }).rawBody = buf;
      },
    })(req, res, next);
  });

  app.use(
    express.urlencoded({
      extended: true,
      limit: "100kb",
    })
  );

  app.use(sanitizeInput);

  app.use(
    "/api",
    createRoutes(
      dependencies.roomController,
      dependencies.roomLifecycleHandler,
      dependencies.audioRegionController,
      dependencies.projectController
    )
  );

  if (dependencies.connectionOptimization) {
    app.use(
      "/api/performance",
      createPerformanceRoutes(
        dependencies.performanceMonitoring,
        dependencies.connectionHealth,
        dependencies.namespaceCleanup,
        dependencies.connectionOptimization
      )
    );
  }

  app.use(errorMonitor);

  // Global error handler (must be last middleware)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Handle Multer file upload errors (e.g., file too large, wrong type)
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: err.message });
      return;
    }
    if (err.message.includes('Invalid file type')) {
      res.status(415).json({ error: err.message });
      return;
    }

    loggingService.logError(err, { context: 'GlobalErrorHandler' });
    res.status(500).json({
      error: config.nodeEnv === 'development' ? err.message : 'Internal server error',
    });
  });
}
