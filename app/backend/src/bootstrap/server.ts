import type { Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "https";
import fs from "fs";
import path from "path";

import { config } from "../config/environment";
import { loggingService } from "../shared/infrastructure/logging/LoggingService";

export type AppServer = HttpServer | HttpsServer;

export function createHttpServer(app: Express): AppServer {
  if (config.nodeEnv === "development" && config.ssl.enabled) {
    try {
      const keyPath = path.join(process.cwd(), config.ssl.keyPath);
      const certPath = path.join(process.cwd(), config.ssl.certPath);

      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const server = createHttpsServer(
          {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
          },
          app
        );
        loggingService.logInfo(
          "Development: Using HTTPS with self-signed certificates"
        );
        return server;
      }

      throw new Error("SSL certificates not found");
    } catch (error) {
      loggingService.logError(error as Error, { context: "SSL setup" });
      loggingService.logInfo("SSL certificates not isFound, falling back to HTTP");
      loggingService.logInfo("WebRTC may not work properly in development");
      return createServer(app);
    }
  }

  const server = createServer(app);
  if (config.nodeEnv === "production") {
    loggingService.logInfo("Production: Using HTTP (SSL handled by Railway)");
  } else {
    loggingService.logInfo("Development: Using HTTP mode");
  }

  return server;
}
