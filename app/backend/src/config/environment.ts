import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables based on NODE_ENV
// In Railway, environment variables are injected directly, so we only load local files in development
if (process.env.NODE_ENV !== 'production') {
  // Try .env.local first, then fall back to .env
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  const envPath = path.resolve(process.cwd(), '.env');

  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// Validate critical environment variables early to fail fast with a clear message
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production');
}
if (!process.env.PERFORMANCE_API_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('PERFORMANCE_API_KEY environment variable is required in production');
}
// Cryptographic secrets must be present and strong in production (no hardcoded fallbacks).
if (process.env.NODE_ENV === 'production') {
  const MIN_SECRET_LENGTH = 32;
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  if (!process.env.AI_ENCRYPTION_SECRET) {
    throw new Error('AI_ENCRYPTION_SECRET environment variable is required in production');
  }
  if (process.env.AI_ENCRYPTION_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`AI_ENCRYPTION_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
}

const resolvePath = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

const volumePath =
  resolvePath(process.env.RECORD_AUDIO_PATH) ||
  resolvePath(process.env.RAILWAY_VOLUME_MOUNT_PATH);
const recordingsDir = volumePath || path.join(process.cwd(), 'record-audio');

export const config = {
  // Server configuration
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`,

  // SSL configuration
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    keyPath: process.env.SSL_KEY_PATH || '.ssl/server.key',
    certPath: process.env.SSL_CERT_PATH || '.ssl/server.crt',
  },

  // CORS configuration
  cors: {
    // Primary frontend URL (singular) - used for emails and redirects
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    // Allowed CORS origins (comma-separated or '*')
    // Falls back to FRONTEND_URL if CORS_ORIGIN is not set
    allowedOrigins: (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(url => url.trim()),
    // Development fallbacks for local development
    developmentOrigins: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'],
    credentials: process.env.CORS_CREDENTIALS === 'true',
    origin: process.env.CORS_ORIGIN,
  },

  // Auth configuration
  auth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  // Email configuration
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'murva <noreply@themiddnight.dev>',
  },


  // WebRTC configuration
  webrtc: {
    enabled: process.env.WEBRTC_ENABLED === 'true',
    requireHttps: process.env.WEBRTC_REQUIRE_HTTPS === 'true',
    rateLimits: {
      offer: parseInt(process.env.VOICE_OFFER_RATE_LIMIT || '60'),
      answer: parseInt(process.env.VOICE_ANSWER_RATE_LIMIT || '60'),
      ice: parseInt(process.env.VOICE_ICE_RATE_LIMIT || '200'),
    },
  },


  // Linear integration
  linear: {
    apiKey: process.env.LINEAR_API_KEY,
    // Developer team — bug reports from users
    devTeamId: process.env.LINEAR_DEV_TEAM_ID,
    // Business team — feature requests from users
    bizTeamId: process.env.LINEAR_BIZ_TEAM_ID,
  },

  // Railway configuration
  railway: {
    url: process.env.RAILWAY_URL,
    service: process.env.RAILWAY_SERVICE,
  },

  // Database configuration (if needed in future)
  database: {
    url: process.env.DATABASE_URL,
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET,
    // Required and length-validated in production above. The literal fallback is unreachable
    // in production (the assertion throws first) and exists only for local dev convenience.
    encryptionSecret: process.env.AI_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'dev-encryption-fallback-not-for-production',
    accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '1h',
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
    guestTokenExpiresIn: process.env.GUEST_TOKEN_EXPIRES_IN || '12h',
    emailVerificationExpiresHours: parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS || '24'),
    passwordResetExpiresHours: parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS || '1'),
  },

  // HLS configuration
  hls: {
    segmentDuration: parseInt(process.env.HLS_SEGMENT_DURATION || '2'),
    playlistLength: parseInt(process.env.HLS_PLAYLIST_LENGTH || '6'),
    audioBitrate: parseInt(process.env.AUDIO_BITRATE || '128000'),
    cleanupInterval: parseInt(process.env.HLS_CLEANUP_INTERVAL || '300000'),
  },

  // Cluster configuration
  cluster: {
    enabled: process.env.CLUSTER_ENABLED === 'true',
    workers: parseInt(process.env.CLUSTER_WORKERS || '0'), // 0 means use CPU count
    restartOnCrash: process.env.CLUSTER_RESTART_ON_CRASH !== 'false',
    maxRestarts: parseInt(process.env.CLUSTER_MAX_RESTARTS || '10'),
    restartWindow: parseInt(process.env.CLUSTER_RESTART_WINDOW || '60000'),
  },

  // Redis retry configuration.
  // NOTE: retryAttempts was removed — the reconnect strategy uses unlimited retries
  // with exponential backoff bounded by maxRetryDelay.
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000'),
    maxRetryDelay: parseInt(process.env.REDIS_MAX_RETRY_DELAY || '30000'),
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Profiling toggles (DEV-178) — off by default; enable during load tests only.
  profiling: {
    // Emit per-phase timing for the socket connect/join hot path.
    joinPath: process.env.PROFILE_JOIN_PATH === 'true',
  },

  // Performance configuration
  performance: {
    // Performance tuning options
    maxConcurrentConnections: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '1000'),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'),
    disableSynthRateLimit: process.env.DISABLE_SYNTH_RATE_LIMIT === 'true', // Disable rate limiting for synth params
    disableVoiceRateLimit: process.env.DISABLE_VOICE_RATE_LIMIT === 'true', // Disable rate limiting for voice events
    // API key guarding the /api/performance admin endpoints. Required in production
    // (fail-fast asserted above); undefined in dev unless explicitly set.
    apiKey: process.env.PERFORMANCE_API_KEY,
  },

  // System Pressure / Resilience
  resilience: {
    memory: {
      elevatedPercent: parseFloat(process.env.MEMORY_THRESHOLD_ELEVATED_PERCENT || '40'),
      highPercent: parseFloat(process.env.MEMORY_THRESHOLD_HIGH_PERCENT || '55'),
      criticalPercent: parseFloat(process.env.MEMORY_THRESHOLD_CRITICAL_PERCENT || '70'),
      elevated: process.env.MEMORY_THRESHOLD_ELEVATED ? parseInt(process.env.MEMORY_THRESHOLD_ELEVATED) : undefined,
      high: process.env.MEMORY_THRESHOLD_HIGH ? parseInt(process.env.MEMORY_THRESHOLD_HIGH) : undefined,
      critical: process.env.MEMORY_THRESHOLD_CRITICAL ? parseInt(process.env.MEMORY_THRESHOLD_CRITICAL) : undefined,
    }
  },

  storage: {
    recordAudioPath: process.env.RECORD_AUDIO_PATH || './record-audio',
    recordingsDir,
    tempDir: path.join(process.cwd(), 'tmp', 'recordings'),
    publicBaseUrl: process.env.AUDIO_PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`,
    bucketStorage: {
      enabled: process.env.BUCKET_ENABLED === 'true',
      accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
      secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
      bucketName: process.env.BUCKET_BUCKET_NAME,
      endpoint: process.env.BUCKET_ENDPOINT,
      region: process.env.BUCKET_REGION,
      publicUrl: process.env.BUCKET_PUBLIC_URL,
    },
  },
} as const;

export type Config = typeof config; 