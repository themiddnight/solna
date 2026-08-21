# Performance & Scaling Guide

This document covers performance optimization, scaling strategies, and resource management for the murva backend.

## Table of Contents

- [Worker Threads](#worker-threads)
- [AI Request Queue](#ai-request-queue)
- [Multi-Process Clustering](#multi-process-clustering)
- [Performance Benchmarks](#performance-benchmarks)
- [Memory Pressure Detection](#memory-pressure-detection)
- [Graceful Degradation](#graceful-degradation)
- [Resource Limits](#resource-limits)

---

## Worker Threads

For CPU-intensive tasks (audio compression, AI generation), the backend uses **worker threads** to prevent blocking the event loop:

### Audio Compression Worker

**Implementation:**
- **Worker Pool**: `src/services/WorkerPoolService.ts` manages a pool of workers
- **Audio Compression**: `src/workers/audioCompressionWorker.ts` handles FFmpeg encoding
- **Impact**: Zero event loop blocking, stable Socket.IO latency

**Configuration:**

```typescript
// Worker pool automatically scales based on CPU cores
const workerPool = new WorkerPoolService({
  maxWorkers: os.cpus().length,
  taskTimeout: 30000
});
```

**Usage:**

```typescript
// Offload FFmpeg compression to worker
const compressed Audio = await workerPool.compressAudio({
  inputPath: '/path/to/audio.wav',
  outputPath: '/path/to/output.opus',
  bitrate: '128k'
});
```

**Benefits:**
- ✅ Non-blocking audio processing
- ✅ Maintains real-time WebSocket performance
- ✅ Automatic worker lifecycle management
- ✅ Error isolation (worker crashes don't affect main thread)

---

## AI Request Queue

Global concurrency control for AI generation requests:

### Queue Configuration

- **Max Concurrent Jobs**: 5 (configurable via `AI_QUEUE_MAX_CONCURRENT`)
- **Max Queue Size**: 50 requests (configurable via `AI_QUEUE_MAX_SIZE`)
- **Priority Scheduling**: Higher priority jobs processed first

### Environment Variables

```bash
AI_ENABLED=true
AI_QUEUE_MAX_CONCURRENT=5
AI_QUEUE_MAX_SIZE=50
AI_PROVIDER=openai
AI_DEFAULT_MODEL=gpt-4o-mini
```

### Queue Management

```typescript
// Submit AI generation job
const jobId = await aiJobQueue.submit({
  prompt: 'Generate upbeat electronic music',
  duration: 30,
  priority: 'normal' // or 'high', 'low'
});

// Check job status
const status = await aiJobQueue.getStatus(jobId);
// Returns: { status: 'queued' | 'processing' | 'completed' | 'failed', position: number }
```

### API Endpoints

```bash
# Submit AI generation request
POST /api/ai/generate

# Get queue statistics
GET /api/ai/queue/stats

# Get job status with queue position
GET /api/ai/queue/status?jobId=<jobId>
```

**Benefits:**
- ✅ Prevents API rate limit exhaustion
- ✅ Fair resource allocation
- ✅ Predictable system load
- ✅ Queue position visibility for users

---

## Multi-Process Clustering

Production scaling with Node.js cluster module:

### How It Works

- **Multiple Workers**: Utilize all CPU cores
- **Crash Recovery**: Automatic worker restart on crash
- **Redis Adapter**: Socket.IO synchronization across processes
- **Load Balancing**: Round-robin request distribution

### Configuration

```bash
# Enable clustering
CLUSTER_ENABLED=true
CLUSTER_WORKERS=auto  # or specific number (e.g., 4)

# Redis required for clustering
REDIS_URL=redis://localhost:6379
```

### Production Start

```bash
# Production with clustering
CLUSTER_ENABLED=true bun run start:prod
```

### Architecture

```
┌────────────────────────────────────────┐
│          Load Balancer (OS)            │
└────────────────┬───────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│Worker1│   │Worker2│   │Worker3│  ← Process Pool
└───┬───┘   └───┬───┘   └───┬───┘
    │           │           │
    └───────────┼───────────┘
                │
         ┌──────▼──────┐
         │ Redis Pub/Sub│  ← Socket.IO Adapter
         └─────────────┘
```

**Configuration Options:**

| Variable | Description | Default |
|----------|-------------|---------|
| `CLUSTER_ENABLED` | Enable clustering | `false` |
| `CLUSTER_WORKERS` | Worker count (`auto` = CPU count) | `auto` |
| `CLUSTER_RESTART_ON_CRASH` | Auto-restart crashed workers | `true` |
| `CLUSTER_MAX_RESTARTS` | Max restarts before stopping | `10` |
| `CLUSTER_RESTART_WINDOW` | Restart window (ms) | `60000` |

---

## Performance Benchmarks

### Single Process vs Clustered

| Configuration | CPU Utilization | Concurrent Connections | Latency (p95) |
|---------------|-----------------|------------------------|---------------|
| Single Process | 25% | ~500-1000 | <50ms |
| Clustered (4 cores) | 100% | ~2000-4000 | <50ms |

### Load Testing Results

```bash
# Run load tests
bun run test:load

# Results (100 concurrent users):
# - Average latency: 35ms
# - p95 latency: 48ms
# - p99 latency: 65ms
# - Throughput: ~2000 msg/sec
```

### Optimization Tips

1. **Enable clustering** for production (4+ cores)
2. **Use Redis** for state persistence and pub/sub
3. **Enable worker threads** for CPU-intensive tasks
4. **Monitor memory** and adjust thresholds
5. **Implement caching** for frequently accessed data

---

## Memory Pressure Detection

Automatic system health monitoring with `SystemPressureService`. Thresholds are **dynamically calculated** based on total system RAM:

### Pressure Levels

| Pressure Level | Default % of RAM | Actions |
|----------------|------------------|---------|
| Normal | <40% | All features enabled |
| Elevated | 40-55% | Reduced logging |
| High | 55-70% | **AI generation disabled** |
| Critical | >70% | Cache cleared, new rooms blocked |

### Example: 8GB RAM Server

| Level | Threshold | Actions |
|-------|-----------|---------|
| Elevated | ~3200 MB | Reduce logging verbosity |
| High | ~4400 MB | Disable AI, warn users |
| Critical | ~5600 MB | Clear cache, block new rooms, force GC |

### Configuration

**Option 1: Percentages (Recommended)**

```bash
MEMORY_THRESHOLD_ELEVATED_PERCENT=40
MEMORY_THRESHOLD_HIGH_PERCENT=55
MEMORY_THRESHOLD_CRITICAL_PERCENT=70
```

**Option 2: Absolute Values (MB)**

```bash
# Overrides percentage-based thresholds
MEMORY_THRESHOLD_ELEVATED=3000
MEMORY_THRESHOLD_HIGH=4500
MEMORY_THRESHOLD_CRITICAL=6000
```

### Monitoring

```bash
# View memory usage in logs
bun run start:dev:gc

# Production monitoring
tail -f logs/app.log | grep "Memory"
```

---

## Graceful Degradation

When system is under memory pressure, non-essential features are automatically disabled:

### Feature Degradation Matrix

| Pressure Level | AI Generation | New Rooms | Cache | Garbage Collection |
|----------------|---------------|-----------|-------|--------------------|
| Normal | ✅ Enabled | ✅ Allowed | ✅ Active | Regular schedule |
| Elevated | ✅ Enabled | ✅ Allowed | ✅ Active | More frequent |
| High | ❌ Disabled | ⚠️ Limited | ⚠️ Reduced | Forced every 5min |
| Critical | ❌ Disabled | ❌ Blocked | ❌ Cleared | Forced immediately |

### Automatic Actions

**Elevated (40-55% RAM):**
- Reduce log verbosity
- Increase GC frequency
- Clear old cache entries

**High (55-70% RAM):**
- Disable AI generation
- Reduce cache size by 50%
- Force garbage collection every 5 minutes
- Send warning to admins

**Critical (>70% RAM):**
- Block new room creation
- Clear all caches
- Force immediate garbage collection
- Alert admins immediately
- Consider restarting workers

---

## Resource Limits

To prevent memory exhaustion, the following limits are enforced:

| Resource | Limit | Service | Configurable |
|----------|-------|---------|--------------|
| Tracks per arrange room | 64 | `ArrangeRoomStateService` | ❌ |
| Cache keys | 10,000 | `CacheService` | ✅ |
| AI concurrent jobs | 5 | `AiJobQueueService` | ✅ |
| AI queue size | 50 | `AiJobQueueService` | ✅ |
| WebSocket connections | 1,000 | Socket.IO | ✅ |
| Max room size | 50 users | `RoomLifecycleService` | ✅ |

### Configuration

```bash
# WebSocket limits
MAX_CONCURRENT_CONNECTIONS=1000
CONNECTION_TIMEOUT=30000
HEARTBEAT_INTERVAL=30000

# AI limits
AI_QUEUE_MAX_CONCURRENT=5
AI_QUEUE_MAX_SIZE=50

# Cache limits
CACHE_MAX_KEYS=10000
CACHE_TTL=3600
```

### Monitoring Limits

```typescript
// Check current resource usage
GET /api/system/stats

// Response:
{
  "memory": { "used": 2048, "total": 8192, "percent": 25 },
  "connections": { "active": 450, "max": 1000 },
  "aiQueue": { "pending": 3, "processing": 2, "max": 5 },
  "rooms": { "active": 25, "totalUsers": 180 }
}
```

---

## Performance Best Practices

### 1. Enable Clustering (Production)

```bash
CLUSTER_ENABLED=true
CLUSTER_WORKERS=auto
REDIS_URL=redis://localhost:6379
```

### 2. Use Worker Threads

- Offload CPU-intensive tasks (audio compression, AI)
- Prevents event loop blocking
- Maintains real-time performance

### 3. Configure Memory Thresholds

- Set appropriate thresholds for your server size
- Test under load to find optimal values
- Monitor and adjust based on usage patterns

### 4. Implement Caching

- Cache frequently accessed data
- Set appropriate TTLs
- Clear cache under memory pressure

### 5. Monitor Performance

```bash
# Development monitoring
bun run start:dev:gc

# Load testing
bun run test:load

# Production monitoring
# - Use APM tools (New Relic, Datadog)
# - Monitor system metrics
# - Set up alerts for thresholds
```

---

See also:
- [Architecture Documentation](./ARCHITECTURE.md) - System design
- [Deployment Guide](./DEPLOYMENT.md) - Production configuration
- [Development Guide](./DEVELOPMENT.md) - Testing and debugging
