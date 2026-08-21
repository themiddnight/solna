import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { loggingService } from "../shared/infrastructure/logging/LoggingService";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const shouldUseSSL =
  connectionString.includes("sslmode=require") ||
  process.env.PGSSLMODE === "require" ||
  process.env.POSTGRES_SSL === "true";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const pool = new pg.Pool({
  connectionString,
  max: process.env.NODE_ENV === "production" ? 20 : 5,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: shouldUseSSL
    ? { rejectUnauthorized: process.env.NODE_ENV === "production" }
    : undefined,
});

// Prevent unhandled pool errors from crashing the process
pool.on("error", (err) => {
  loggingService.logError(err, { context: "pgPool" });
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
