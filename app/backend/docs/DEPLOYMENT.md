# Deployment Guide

This document provides comprehensive deployment instructions for the murva backend, including Docker, Railway, and environment configuration.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Docker Deployment](#docker-deployment)
- [Railway Deployment](#railway-deployment)
- [Production Configuration](#production-configuration)

---

## Environment Variables

> **Legend**: Variables without defaults are **required**. Variables with `(default: X)` are optional.

### Core Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `development` |
| `BACKEND_URL` | Backend URL for OAuth callbacks | **Required** |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |

### Security & CORS

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | **Required** |
| `FRONTEND_URL` | Frontend URL for redirects and emails | `http://localhost:5173` |
| `CORS_ORIGIN` | Allowed CORS origins (comma-separated or `*`) | Falls back to `FRONTEND_URL` |

### SSL/TLS (Development)

| Variable | Description | Default |
|----------|-------------|---------|
| `SSL_ENABLED` | Enable HTTPS in development | `false` |
| `SSL_KEY_PATH` | Path to SSL private key | `.ssl/server.key` |
| `SSL_CERT_PATH` | Path to SSL certificate | `.ssl/server.crt` |

### Database (PostgreSQL)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | **Required** |

**Format**: `postgresql://user:password@host:port/database?schema=public`

### Authentication (Google OAuth)

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |

### Email (Resend)

| Variable | Description | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key for emails | — |
| `EMAIL_FROM_ADDRESS` | Sender email address (format: "Name <email@domain.com>") | — |

### AI Generation

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_ENABLED` | Enable AI music generation | `true` |
| `AI_PROVIDER` | Default AI provider (`openai`, `suno`, etc.) | `openai` |
| `AI_QUEUE_MAX_CONCURRENT` | Max concurrent AI jobs | `5` |
| `AI_QUEUE_MAX_SIZE` | Maximum queue size | `50` |
| `AI_DEFAULT_MODEL` | Default AI model | `gpt-4o-mini` |

### Redis (State Management - Required)

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `REDIS_PASSWORD` | Redis password | — |
| `REDIS_TLS_ENABLED` | Enable TLS for Redis connection | `false` |

**Redis High Availability (Optional - Future):**

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_SENTINELS` | Comma-separated Sentinel addresses | — |
| `REDIS_MASTER_NAME` | Sentinel master name | — |

**Example Sentinel Configuration:**
```bash
REDIS_SENTINELS=sentinel1.example.com:26379,sentinel2.example.com:26379,sentinel3.example.com:26379
REDIS_MASTER_NAME=mymaster
REDIS_PASSWORD=your-secure-password
```

**Note**: Redis is **required** for room state management. The application will not function properly without Redis.

**State TTL Configuration:**

| Variable | Description | Default |
|----------|-------------|---------|
| `ROOM_STATE_TTL` | Room state TTL (seconds) | `86400` (24h) |
| `PERFORM_STATE_TTL` | Perform room state TTL (seconds) | `86400` (24h) |
| `ARRANGE_STATE_TTL` | Arrange room state TTL (seconds) | `604800` (7 days) |

### Clustering & Scaling

| Variable | Description | Default |
|----------|-------------|---------|
| `CLUSTER_ENABLED` | Enable multi-process clustering | `false` |
| `CLUSTER_WORKERS` | Number of worker processes (`auto` = CPU count) | `auto` |

### Memory Pressure & Graceful Degradation

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORY_THRESHOLD_ELEVATED_PERCENT` | Elevated threshold (% of RAM) | `40` |
| `MEMORY_THRESHOLD_HIGH_PERCENT` | High threshold (% of RAM) | `55` |
| `MEMORY_THRESHOLD_CRITICAL_PERCENT` | Critical threshold (% of RAM) | `70` |
| `MEMORY_THRESHOLD_ELEVATED` | Elevated threshold (MB, overrides %) | — |
| `MEMORY_THRESHOLD_HIGH` | High threshold (MB, overrides %) | — |
| `MEMORY_THRESHOLD_CRITICAL` | Critical threshold (MB, overrides %) | — |

### Storage (Backblaze B2)

| Variable | Description | Default |
|----------|-------------|---------|
| `BUCKET_ENABLED` | Enable cloud storage | `false` |
| `BUCKET_ACCESS_KEY_ID` | B2 access key ID | — |
| `BUCKET_SECRET_ACCESS_KEY` | B2 secret key | — |
| `BUCKET_BUCKET_NAME` | B2 bucket name | — |
| `BUCKET_ENDPOINT` | B2 endpoint URL | — |
| `BUCKET_REGION` | B2 region | — |
| `BUCKET_PUBLIC_URL` | Public URL for stored files | — |

### File Storage Paths

| Variable | Description | Default |
|----------|-------------|---------|
| `RECORD_AUDIO_PATH` | Path for recorded audio | `./record-audio` |
| `RAILWAY_VOLUME_MOUNT_PATH` | Railway volume mount path | — |
| `AUDIO_STORAGE_PATH` | Audio regions storage | — |
| `PROJECT_STORAGE_PATH` | Project files storage | — |

### Analytics

| Variable | Description | Default |
|----------|-------------|---------|
| `ANALYTICS_URL` | Analytics backend URL | — |
| `ANALYTICS_API_KEY` | Analytics API key | — |

### Encryption

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_ENCRYPTION_SECRET` | Secret for AI key encryption | Falls back to `JWT_SECRET` |

### HLS Streaming

| Variable | Description | Default |
|----------|-------------|---------|
| `HLS_SEGMENT_DURATION` | HLS segment duration (seconds) | `2` |
| `HLS_PLAYLIST_LENGTH` | HLS playlist length | `6` |
| `AUDIO_BITRATE` | Audio bitrate (bps) | `128000` |
| `HLS_CLEANUP_INTERVAL` | Cleanup interval (ms) | `300000` |

> **Note**: Always store production secrets securely. Never commit `.env` files to source control.

---

## Docker Deployment

### Build Docker Image

```bash
bun run docker:build
```

This builds the Docker image using `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN bun install --production
COPY . .
RUN bun run build
EXPOSE 3001
CMD ["bun", "run", "start"]
```

### Run Docker Container

```bash
bun run docker:run
```

### Docker Compose

For development with Docker Compose:

```bash
bun run docker:dev
```

Example `docker-compose.yml`:

```yaml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@db:5432/jamband
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
  
  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=jamband
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## Railway Deployment

### Deploy to Railway

```bash
bun run railway:deploy
```

### View Logs

```bash
bun run railway:logs
```

### Check Status

```bash
bun run railway:status
```

### Railway Configuration

**Environment Variables on Railway:**

1. Set `DATABASE_URL` - Railway provides PostgreSQL addon
2. Set `REDIS_URL` - Railway provides Redis addon
3. Set all required variables from [Environment Variables](#environment-variables)
4. Configure `RAILWAY_VOLUME_MOUNT_PATH` if using persistent storage

**Volume Mounts:**

For persistent file storage (audio regions, projects):

```bash
# In Railway dashboard, add volume mount
/data -> RAILWAY_VOLUME_MOUNT_PATH

# Set environment variables
AUDIO_STORAGE_PATH=/data/audio
PROJECT_STORAGE_PATH=/data/projects
RECORD_AUDIO_PATH=/data/record-audio
```

---

## Production Configuration

### Recommended Production Settings

```bash
# Core
NODE_ENV=production
LOG_LEVEL=info

# Security
JWT_SECRET=<strong-random-secret>
CORS_ORIGIN=https://your-frontend.com

# Database & Redis
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
REDIS_TLS_ENABLED=true

# Clustering
CLUSTER_ENABLED=true
CLUSTER_WORKERS=auto

# Storage
BUCKET_ENABLED=true
BUCKET_ACCESS_KEY_ID=<b2-key>
BUCKET_SECRET_ACCESS_KEY=<b2-secret>
BUCKET_BUCKET_NAME=jamband-production
BUCKET_ENDPOINT=https://s3.us-west-002.backblazeb2.com
BUCKET_REGION=us-west-002
BUCKET_PUBLIC_URL=https://cdn.yourdomain.com

# Memory Management
MEMORY_THRESHOLD_ELEVATED_PERCENT=40
MEMORY_THRESHOLD_HIGH_PERCENT=55
MEMORY_THRESHOLD_CRITICAL_PERCENT=70

# AI (if enabled)
AI_ENABLED=true
AI_QUEUE_MAX_CONCURRENT=5
AI_QUEUE_MAX_SIZE=50
```

### Performance Optimization

**Node.js Flags:**

```bash
# In package.json "start:prod" script
node --max-old-space-size=4096 --expose-gc dist/index.js
```

**Recommended Resources:**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2GB | 4GB+ |
| CPU | 1 core | 2-4 cores |
| Storage | 10GB | 50GB+ |

### Health Checks

Railway/Docker health check endpoint:

```
GET /health
```

Returns `200 OK` with system status.

---

## Troubleshooting

### Docker Build Fails

- Ensure all dependencies are in `package.json`
- Check Node.js version compatibility
- Clear Docker build cache: `docker builder prune`

### Railway Deployment Issues

- Check environment variables are set correctly
- Review Railway logs: `bun run railway:logs`
- Ensure database migrations have run
- Verify Redis connection (check `REDIS_TLS_ENABLED`)

### Memory Issues

- Monitor with: `bun run start:dev:gc`
- Adjust memory thresholds
- Enable clustering: `CLUSTER_ENABLED=true`
- Consider upgrading server resources

---

See also:
- [Architecture Documentation](./ARCHITECTURE.md) - System architecture
- [Development Guide](./DEVELOPMENT.md) - Testing and development
- [Performance Guide](./PERFORMANCE.md) - Scalingและ optimization
