---
name: webrtc-voice
description: WebRTC voice chat — Full Mesh P2P architecture, signaling flow (offer/answer/ICE), cross-browser compatibility (Chrome/Firefox/Safari/iOS), latency measurement, voice effect chain, HLS broadcasting. Read before any voice/WebRTC work.
---

# WebRTC Voice Skill

Read every time before touching: voice chat, WebRTC, P2P connections, ICE, signaling, HLS, latency display, or audience stream.

**Event doc:** `docs/WS_CONTRACT.md` → Section 5 (Voice Communication)
**Architecture:** `app/frontend/docs/ARCHITECTURE.md` → Audio Architecture
**Cross-browser detail:** `docs/WEBRTC_BROWSER_COMPAT.md`
**Capability Profile (browser detection structure):** `docs/WEBRTC_CAPABILITY_PROFILE.md`

---

## Architecture Overview

```
Full Mesh P2P Voice Chat:

  User A ←──── direct P2P ────→ User B
     ↕                              ↕
  User C ←──── direct P2P ────→ User D

Server = signaling relay only (no audio processing)
```

- **Full Mesh**: Every peer connects directly to each other — N users = N×(N-1)/2 connections
- **Server role**: relay signaling (offer/answer/ICE candidates) via Socket.IO only.
- **Audio flow**: direct between browsers, not through the server → minimal latency.
- **Voice AudioContext**: separate from instrument AudioContext — sampleRate follows `optimalSampleRate` from `getWebRTCCapabilities()` (44100 on iOS/Safari, 48000 elsewhere), `"interactive"` latency hint.
- **Voice input ownership**: each room page mounts one `VoiceRuntimeProvider`; responsive sidebars, mobile strips, and drawers render `VoiceInputView` variants against that shared runtime. Do not put `useAudioStream()` or `getUserMedia()` ownership inside layout-specific controls.

---

## Key Files

| File | Responsibility |
|---|---|
| `app/frontend/src/features/audio/services/WebRTCVoiceService.ts` | Core P2P service — peer lifecycle, ICE, DataChannel, latency measurement |
| `app/frontend/src/features/audio/services/VoicePresenceManager.ts` | Presence lifecycle owner — announce/re-announce/leave, JOIN_VOICE debounce, identity-swap rejoin arming, disconnect grace period |
| `app/frontend/src/features/audio/hooks/useWebRTCVoice.ts` | React hook wrapping service — subscribes to state |
| `app/frontend/src/features/audio/hooks/useRoomWebRTC.ts` | Shared hook for Perform + Arrange rooms |
| `app/frontend/src/features/audio/components/VoiceInput/VoiceRuntimeProvider.tsx` | Room-level voice input runtime provider — owns microphone stream, analyser, mute/gain/settings state |
| `app/frontend/src/features/audio/components/VoiceInput/index.tsx` | `VoiceInputView` presentation controls — compact/full UI only, must render inside `VoiceRuntimeProvider` |
| `app/frontend/src/features/audio/types/voice.ts` | TypeScript interfaces: `RTCPeerEntry`, `RTCPeerMap`, `VoiceUser`, `UseWebRTCVoiceProps`, `UseWebRTCVoiceReturn` |
| `app/frontend/src/shared/webrtc/webrtcCapabilities.ts` | Browser capability singleton — single source of truth for all UA detection |
| `app/frontend/src/features/audio/utils/rtcStatsUtils.ts` | RTCStats helpers — `extractRTTFromStats`, `deriveIsConnected`, `extractJitterBufferSnapshot`/`computeJitterBufferMs`, `extractConnectionPath`, `extractNetworkJitterMs` |
| `app/frontend/src/features/audio/utils/latencyStats.ts` | Median smoothing + `recordRttSample` + `analyzeNetworkStalls` (stall detection) |
| `app/frontend/src/features/audio/utils/meshAggregation.ts` | Per-peer measurements → one value per metric (average vs worst-peer rules) |
| `app/frontend/src/features/audio/utils/voiceReceiveTuning.ts` | Receive-path latency tuning (DEV-257) — Opus SDP munging + `jitterBufferTarget` |
| `app/frontend/src/features/audio/utils/ultraLowLatencyOptimizer.ts` | Audio element optimizations + thin wrapper over webrtcCapabilities |
| `app/backend/src/domains/real-time-communication/` | Signaling forwarding handler (relay only) |
| `docs/WS_CONTRACT.md` → Section 5 | Full signaling event reference |
| `docs/WEBRTC_BROWSER_COMPAT.md` | Cross-browser compatibility reference |

---

## Perfect Negotiation Pattern (PNP)

Implemented in `WebRTCVoiceService.ts` since May 2026. Replaces the old manual offer/answer flow.

### Architecture

```
setupPeerConnection()                           handleVoiceOffer()
  (offerer side)                                   (answerer side)
       │                                                  │
       ├── createPeerConnection(id, isOfferer:true)       ├── createPeerConnection(id, isOfferer:false)
       │   ├── createDataChannel("rtt-measurement")       │   └── ondatachannel → DC negotiation
       │   ├── addTrack(localStream)                      │
       │   └── onnegotiationneeded → macrotask            │
       │                                                  │
       ├── peers[id] = { ..., isPolite }                  ├── peers[id] = { ..., isPolite }
       │       │                                          │       │
       │       ▼ (macrotask)                              │       ▼
       │   onnegotiationneeded:                           │   Offer collision detection:
       │   setLocalDescription()  ← no-arg                │   isMakingOffer || signalingState ≠ "stable"
       │   emit VOICE_OFFER                               │       │
       │                                                  │       ├── impolite → ignore, ours wins
       └──────────────────────────────────────────────────┼── impolite peer's offer arrives
                                                          │       │
                                                          │       ▼ (polite only)
                                                          │   Clear pending ICE candidates
                                                          │   setRemoteDescription(offer)  ← implicit rollback
                                                          │   createAnswer() + setLocalDescription()
                                                          │   addTrack()  ← deferred from createPeerConnection
                                                          │   emit VOICE_ANSWER
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `onnegotiationneeded` replaces manual `createOffer()` | Browser knows best when renegotiation is needed — avoids stale SDP |
| No-arg `setLocalDescription()` for offerer | Browser auto-picks offer type; supported Chrome 80+, Firefox 75+, Safari 14+ |
| Explicit `createAnswer()` + `setLocalDescription(answer)` for answerer | No-arg form incomplete in some Playwright WebKit builds |
| `addTrack` deferred for answerer | Avoids redundant `onnegotiationneeded` after initial offer/answer exchange |
| `isPolite` = `userId.localeCompare(targetUserId) < 0` | Lexicographic — deterministic across peers; mirrors `shouldInitiate` |
| `isMakingOffer` guard in `onnegotiationneeded` | Prevents double-emission; protects collision detection |
| `isSettingRemoteAnswerPending` flag | Suppresses spurious ICE errors during async answer application |
| `desc.type !== "offer"` guard after auth await | Prevents emitting stale "answer" as VOICE_OFFER after PNP rollback |

### Collision Resolution Flow

```
Both peers call setupPeerConnection() simultaneously
  → Both fire onnegotiationneeded (macrotask)
  → Both create offers → VOICE_OFFER sent

Polite peer (lexicographically smaller userId):
  1. Receives impolite peer's offer while isMakingOffer = true
  2. Detects collision → isPolite = true → does NOT ignore
  3. Clears pending ICE candidates
  4. setRemoteDescription(impoliteOffer) → implicit rollback (W3C spec)
  5. createAnswer() + setLocalDescription(answer) → emits VOICE_ANSWER
  6. Adds local tracks (deferred from createPeerConnection) → triggers legitimate onnegotiationneeded

Impolite peer:
  1. Receives polite peer's offer while isMakingOffer = true
  2. Detects collision → isPolite = false → IGNORES incoming offer
  3. Our own offer wins — polite peer's answer arrives shortly
  4. setRemoteDescription(answer) → stable
  5. ICE/DTLS handshake completes → ontrack → peer.isConnected = true
```

### ICE Candidate Defensive Guard

`onicecandidate` handler applies two defensive measures before emitting:

1. **Serialization**: Calls `event.candidate.toJSON()` to normalize the candidate to a plain `RTCIceCandidateInit` object — some Playwright browsers (Firefox fake-media) produce non-standard candidate shapes.
2. **Empty-string guard**: Skips emission when `init.candidate` is empty/missing — W3C allows empty-string as end-of-candidates signal, but the backend passes it through without benefit.

### Firefox ↔ WebKit Known Limitations

| Issue | Cause | Fixable in JS? |
|-------|-------|---------------|
| `Unknown ufrag` ICE errors | Candidates arrive after PNP renegotiation changes ICE credentials — browser ignores automatically | ❌ Browser-level |
| RTP header extension remap failure | Firefox assigns different extmap IDs than WebKit; Firefox doesn't support remapping | ❌ SDP incompatibility |
| End-of-candidates as empty string | Playwright fake-media emits `candidate: ""` instead of `null` | ✅ Guarded in onicecandidate |

These cause FF↔WK E2E tests to occasionally need retries, but do not affect real users (real Firefox + real WebKit negotiate fine over STUN/TURN).

---

## Signaling Flow

```
User A joins room (voice enabled)
  │
  ├── Receives MESH_PARTICIPANTS from server
  │     → setupPeerConnection() for each peer where shouldInitiate = true
  │     → Creates RTCPeerConnection + DataChannel + addTrack(localStream)
  │     → peers[id] set synchronously
  │     → onnegotiationneeded fires (macrotask): setLocalDescription() → emit VOICE_OFFER
  │
  ├── Receives VOICE_OFFER from remote peer ( User B )
  │     → handleVoiceOffer: collision detection → polite/impolite resolution
  │     → setRemoteDescription(offer) [implicit rollback if collision]
  │     → createAnswer() + setLocalDescription(answer) → emit VOICE_ANSWER
  │
  └── Exchange ICE candidates (trickle)
        A → Server → B: voice_ice_candidate { candidate: RTCIceCandidateInit, targetUserId }
        B → Server → A: voice_ice_candidate { candidate: RTCIceCandidateInit, targetUserId }
```

**MESH_PARTICIPANTS carries `selfRegistered`** — `false` means the server dropped us (stale prune / lost JOIN_VOICE race); the client re-announces JOIN_VOICE automatically (check precedes the DEV-267 version gate).

**Offer creation is automatic** — `onnegotiationneeded` fires after `addTrack()` when the browser detects negotiation is needed. No manual `createOffer()` calls.

**Socket Events (WebRTC Signaling):**

```typescript
// Client → Server → Target (forward only — server does not process payload)
webrtc:offer         → { offer: RTCSessionDescriptionInit, targetUserId: string }
webrtc:answer        → { answer: RTCSessionDescriptionInit, targetUserId: string }
webrtc:ice_candidate → { candidate: RTCIceCandidateInit, targetUserId: string }

// Voice state
perform:voice_state_changed → { userId, isMuted: boolean, isActive: boolean }
```

> ⚠️ **Server is a pure forwarder** — forwards payload directly to targetUserId without touching the content.

---

## Latency Measurement Architecture (Service-Owned)

Latency is computed **inside `WebRTCVoiceService`** and exposed via `getState()`.
**Do NOT** try to wire `RTCPeerConnection` objects to React hooks for measurement — it has timing race conditions with Safari.

```
Measurement Priority:
  1. DataChannel ping/pong (primary — most browsers, lowest overhead)
       peer.dataChannel.send({ type: "ping", timestamp: Date.now() })
       → pong received → rtt = Date.now() - timestamp → peer.latency = rtt

  2. RTCStats candidate-pair (fallback — Safari/iOS where DataChannel may not open)
       peerConnection.getStats() → candidate-pair → currentRoundTripTime (seconds)
       convert: ms = rtt < 1 ? rtt * 1000 : rtt

  3. remote-inbound-rtp (secondary fallback — Chrome/Firefox RTCP RTT)
       report.type === "remote-inbound-rtp" → report.roundTripTime

  → Average across all connected peers → getState().meshLatency
  → isLatencyActive = meshLatency !== null
```

**Spike smoothing + unified cadence (2026-07-17):** every raw RTT sample (pong handler + both RTCStats paths) feeds a per-peer rolling window; `peer.latency` is the window **median** via `pushLatencySample()` (`utils/latencyStats.ts`) — an isolated sample landing on an event-loop stall can never become the displayed latency. Same for socket ping: `usePingMeasurement.currentPing` is the median of its history window (mean was replaced). ALL latency readouts (socket ping, quality monitoring/RTT/jitter, browser audio output poll) sample on the single `LATENCY_DISPLAY_INTERVAL_MS` (5s, `features/audio/constants/intervals.ts`) so displays move in lockstep — new latency surfaces must reuse this constant and median smoothing, not raw last-sample values.

**React state flow:**
```
WebRTCVoiceService.notify()
  → getState() computes meshLatency + connectedPeersCount
  → useWebRTCVoice useState(serviceMeshLatency, isLatencyActive)
  → useRoomWebRTC returns meshLatency: serviceMeshLatency, rtcLatencyActive: isLatencyActive
  → VoiceInput props → RTCLatencyDisplay
```

**`measureRTT(userId)` is called by `startQualityMonitoring()` interval** — ensure quality monitoring starts when first peer connects.

---

## Connected Peer Detection (Cross-Browser)

Safari/iOS `connectionState` often stays at `"connecting"` even when audio is flowing. Use `peer.isConnected` (maintained by service handlers) which is updated by `deriveIsConnected()` from `rtcStatsUtils.ts`:

```typescript
// In onconnectionstatechange / oniceconnectionstatechange — via deriveIsConnected():
peer.isConnected = deriveIsConnected(
  peer.isConnected,
  peer.connection.connectionState,
  peer.connection.iceConnectionState,
);
// deriveIsConnected returns true when currentIsConnected OR connectionState="connected"
// OR iceConnectionState="connected"|"completed" — once true, never reverts.

// In ontrack — most reliable signal that connection is live (fires even on Safari
// before connectionState reaches "connected"):
if (!peer.isConnected) {
  peer.isConnected = true;
  peer.lastHealthCheck = Date.now();
  this.notify(); // triggers React state update
}
```

**Use `peer.isConnected` in `getState()`, NOT `p.connection.connectionState === "connected"`.**

---

## Cross-Browser Compatibility Summary

### Connection State Differences

| Browser | `connectionState` behavior | `iceConnectionState` behavior |
|---------|--------------------------|-------------------------------|
| Chrome | Reliable — transitions to "connected" when ready | Reliable |
| Firefox | Reliable | Reliable |
| Safari macOS | Usually correct | Usually correct |
| Safari iOS | **Often stays at "connecting"** even when audio flows | More reliable — often reaches "completed" |

**Workaround:** Use `ontrack` as the definitive "connected" signal. When a remote track arrives, the connection is live by definition.

### RTCStats RTT Field Availability

| Field | Chrome | Firefox | Safari | iOS Safari |
|-------|--------|---------|--------|------------|
| `candidate-pair.currentRoundTripTime` | ✅ (seconds) | ✅ (seconds) | ❌ | ❌ |
| `candidate-pair.nominated` | ✅ | ✅ | ✅ | ✅ |
| `candidate-pair.selected` | Legacy only | ❌ | Sometimes | Sometimes |
| `candidate-pair.writable` | ✅ | ❌ | ✅ | ✅ |
| `candidate-pair.state === "succeeded"` | ✅ | ✅ | Partial | Partial |
| `remote-inbound-rtp.roundTripTime` | ✅ | ✅ | ❌ | ❌ |
| DataChannel ping/pong | ✅ | ✅ | ✅ (if open) | ⚠️ May not open |

**Correct approach to find active candidate pair:**
```typescript
// Spec-compliant: use RTCTransportStats.selectedCandidatePairId
// Practical fallback (what works across browsers):
const isActive =
  r.state === "succeeded" ||    // Chrome, Firefox
  r.nominated === true ||        // All browsers
  r.writable === true ||         // Chrome, Safari (not Firefox)
  r.selected === true;           // Legacy fallback
```

**RTT value is in SECONDS in standard spec** (`currentRoundTripTime < 1.0` = LAN latency):
```typescript
const ms = rtt < 1 ? Math.round(rtt * 1000) : Math.round(rtt); // handle both seconds and ms
```

### DataChannel on Safari/iOS

- `ondatachannel` may not fire on the answering side on iOS Safari
- **Must create DataChannel BEFORE calling `createOffer()`** for it to be negotiated in SDP
- The offerer creates the channel (already done in `createPeerConnection`)
- If DataChannel doesn't open → fallback to RTCStats for RTT (see measureRTTFromStats)

### AudioContext on Safari/iOS

- `AudioContext.resume()` **must be called synchronously** inside a user gesture handler
- If called inside `async` function, `setTimeout`, or after a state change → iOS ignores it silently (state remains "suspended" but promise resolves)
- Current fix: headphone warning modal forces user interaction before enabling voice

### Firefox mDNS ICE Candidates

- Firefox obfuscates local IPs with random `.local` hostnames (e.g., `a1b2c3d4-xxxx.local`)
- On the same LAN: usually resolves automatically via mDNS multicast
- Cross-network or via TURN relay: transparent (TURN relay bypasses local IP exposure entirely)
- **No code change needed** — works automatically if STUN/TURN is properly configured

### iCloud Private Relay (iOS 15+)

- Can interfere with WebRTC P2P connections on iOS
- P2P may fail silently — audio never starts
- Workaround: ensure TURN server is available as relay fallback
- Users can disable in Settings → Apple ID → iCloud → Private Relay for testing

---

## Voice Effect Chain

Voice has a separate effect chain (does not pass through instrument master bus):

```
MediaStream (microphone)
  → Voice Effect Chain (optional: noise gate, compression, etc.)
    → Direct output → Remote peer (via WebRTC)
```

The **send** path bypasses the master bus — straight out for minimum latency.

### Receive Path — Getting Remote Voice Into the Graph (DEV-324)

Two calls, at two different moments, and mixing them up is what broke this once already:

| Call | When | Does |
|---|---|---|
| `PeerConnectionManager.registerVoiceChannel(userId, username, el)` | peer setup (offerer + answerer) | creates the mixer channel, registers the `<audio>` element for the degraded path. The only point that knows the username. |
| `PeerConnectionManager.attachRemoteVoiceStream(userId, stream)` | `ontrack` | `createMediaStreamSource(stream)` → `routeVoiceToChannel`. Returns whether it took. |

**Never `createMediaElementSource`.** On an `<audio>` element backed by a `MediaStream` it
yields silence — measured 0 RMS against 0.7061 for `createMediaStreamSource` on the same
signal. That was the wiring until DEV-324, so remote voice reached the speakers straight from
the element and never entered the graph: the per-user fader, the channel meters and every
downstream consumer were reading a signal that was not there, while the fader's own
round-trip tests passed the whole time (FAILURE_PATTERNS Pattern 12 is the same shape).

The `<audio>` element is **kept and kept playing** — it is the sink that keeps the receive
pipeline pulling — but `muted = true` once routing succeeds, so the voice is heard once
(through the graph) rather than twice. `attachRemoteVoiceStream` is idempotent per peer:
`ontrack` re-fires on renegotiation, and a second source would stack a duplicate copy of that
peer's voice on the same gain node, which no fader can undo.

**WebKit/iOS keeps the element path.** `caps.supportsRemoteStreamWebAudio` is false there:
Safari 15+ is believed to handle remote-stream `MediaStreamSource`, but iOS shares one audio
session (DEV-274) where a regression means silence rather than quietness, and there is no
automated coverage for it. The cost is the >unity boost only. Re-test on a device before
flipping it.

### Per-Peer Voice Monitor Mix

Each remote peer's voice level is a **personal monitor control** — never synced, no socket
event. `UserVolumeSlider variant="voice"` (`features/rooms/shared/components/`, rendered on
the Perform stage member card **and** in the Arrange sidebar member list) writes
`setVoiceVolume` / reads `getVoiceVolume`. Both are **dB** on the -60..+12 mix-fader range
since DEV-324 — the same unit as the instrument fader, which is a separate control on a
separate node (`voiceGain` bypasses the channel's `Tone.Channel` volume/pan stage, so the two
sliders never interact).

Levels persist in **sessionStorage** (`rooms/shared/stores/userVolumeStore.ts`): a refresh
keeps your mix, a new session does not inherit a stale fader from a different lineup.
`VoiceVolumeController` holds a level set before the peer's channel exists — the ordinary case
on a session restore, since a member appears in the list well before their track lands — and
opens the new gain at it rather than at unity.

Where the branch **lands** is per room (`setVoiceRouting`, DEV-325): Perform `"mix"` (the master
sum, upstream of the master tap, so voice is in the recording/HLS — BR-14), Arrange `"direct"`
(the post-tap stage, heard but never printed into a mixdown or export). Both are on the **master
bus** — the branch deliberately does not pass through the speaking peer's channel, whose output
node feeds the meters that drive the avatar's instrument glow. Speaking is indicated by the amber
border (the websocket speaking signal, DEV-270), not by the glow. See the `dsp-audio` skill.

Degraded fallback: if the stream never reached the graph (WebKit, or a failed route), the
remote voice plays via the raw `<audio data-webrtc-user>` element. The voice feature registers
its elements with the engine via `registerVoiceAudioElement(userId, el)` (and unregisters on
peer cleanup) — the engine never queries the DOM for them (TR-38). There the fader drives
`el.volume`, which caps at 1.0, so the boost half of the range is unreachable.

---

## AudioContext Separation

```typescript
// VERY IMPORTANT — contexts must be separate
const { optimalSampleRate } = getWebRTCCapabilities(); // 44100 on iOS/Safari, 48000 elsewhere
const instrumentsContext = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
const voiceContext       = new AudioContext({ latencyHint: "interactive", sampleRate: optimalSampleRate });

// Do not use the same context — they will compete for resources.
// Voice sampleRate follows optimalSampleRate from capabilities (iOS/Safari = 44100).
```

---

## HLS Broadcasting (Audience)

Completely separate from WebRTC voice chat:

```
Room Owner microphone + instruments
  → HLS Encoder (server-side)
    → HLS Stream URL
      → Audience browser (HLS.js player)
```

**TR-13:** Audience uses HLS only — no WebRTC peer connection.

```typescript
// Owner events — full contract: WS_CONTRACT §9 (Perform Broadcast Events)
perform:toggle_broadcast      → { } // Owner toggles HLS encoding (§9.1)
perform:broadcast_audio_chunk → { chunk } // HLS audio chunk, base64, ~1 MB cap (§9.2)

// Server → Audience
broadcast_state_changed       → { isBroadcasting, playlistUrl } // global room broadcast toggle (no perform: prefix; emitted on toggle success/stop)
broadcast_error               → { message, code? } // broadcast failure

// Member-status broadcast flag — WS_CONTRACT §2.1.6, NOT the HLS toggle
perform:member_broadcast_state_change  → { isActive } // Client → Server (member broadcast vs practice/local-only)
perform:member_broadcast_state_changed → { userId, username, isActive } // Server → room (incl. sender)
```

---

## Local Dev Setup for WebRTC Testing

WebRTC requires HTTPS when testing on real devices (non-localhost). Steps to enable:

1. **Set `SSL_ENABLED=true`** in `app/backend/.env`
2. **Switch URLs to `https://`** — update `BACKEND_URL` and `FRONTEND_URL` in both `.env` files to use the `<ip>` variant with `https://`
3. **Run with host flag**: `bun run dev --host`
4. **Trust the certificate** on each device manually (browser will show warning — proceed anyway or add to trusted certs)
5. **iOS Safari**: Go to Settings → Safari → Advanced → Experimental Features → check WebRTC is enabled

> Keep `SSL_ENABLED=false` (localhost URLs) for all non-WebRTC work — SSL adds friction with no benefit otherwise.
> See `CLAUDE.md` → Environment & Infrastructure → SSL / HTTPS for full context.

---

## Debug Scenarios

### ICE Connection Failed
```
Common causes:
1. Symmetric NAT — Requires TURN server.
2. ICE candidate sent before remote description set → Must wait for setRemoteDescription first.
3. Firewall blocks UDP → Fallback to TCP TURN.
4. iCloud Private Relay (iOS) — Try disabling it.

Check:
- iceConnectionState in RTCPeerConnection
- iceGatheringState
- Console log of candidate type (host/srflx/relay)
- Safari Web Inspector via USB for iOS debugging
```

### Audio Flows But Peer Count Shows 0 / Latency Not Displaying
```
Cause: Safari iOS connectionState stays at "connecting" even when audio flows.
       RTCPeerConnection.connectionState is not a reliable "connected" signal on Safari.

Fix: Use peer.isConnected (maintained by service) — checks iceConnectionState + ontrack.
     ontrack event is the most reliable cross-browser "connected" signal.
     
Latency pipeline: peer.latency (DataChannel) → getState().meshLatency → React state → UI
     If DataChannel not open → measureRTTFromStats() reads RTCStats automatically.
```

### Voice Not Audible After Reconnect
```
Common causes:
1. Peer connection didn't re-negotiate after rejoin.
2. MediaStream tracks were stopped and not restarted.
3. AudioContext was suspended (browser policy).

Fix: Ensure rejoin flow performs complete re-signaling.
     AudioContext must resume() after a user gesture (synchronously on iOS).
     Check audioElement.play() was called after ontrack.
```

### One-way Audio (One person hears the other, but not vice versa)
```
Cause: incomplete offer/answer or missing ICE candidates.
Fix: Check RTCPeerConnection.getSenders() and getReceivers().
     Check SDP for a=sendrecv or a=sendonly.
     Ensure localStream tracks are added with addTrack() before createOffer().
```

### DataChannel Not Opening (Safari/iOS)
```
Cause: DataChannel created after createOffer() — not negotiated in SDP.
Fix: createDataChannel() MUST be called before createOffer().
     If still fails: measureRTTFromStats() fallback will activate automatically.
```

### Firefox ↔ Chrome Peer Count Shows 0
```
Cause: Firefox ICE candidates use mDNS hostnames (xxx.local) instead of real IPs.
       Chrome may fail to resolve mDNS on some network configs.
Fix: On LAN — usually resolves automatically.
     Cross-network — TURN server relay bypasses this entirely.
     No code change needed.
```

---

## Clean Mode — getUserMedia Constraint Design

Clean mode disables all automatic hardware processing (echo cancellation, noise suppression, auto gain, voice isolation) to give musicians maximum control and lowest latency, at the cost of requiring headphones to prevent echo.

**The constraint builder lives in `app/frontend/src/engine/audio/cleanInput.ts` (`buildInputConstraints`), not in `useAudioStream.ts`.** It is the one builder every microphone request goes through across all seven call sites (voice, Arrange recording, Arrange input, three mono probes, and `shared/hooks/useVoiceRecorder.ts` via an injected `buildAudioConstraints` prop built in `useVoiceToMidiRecording.ts`) and reads flags from `getWebRTCCapabilities()` — no inline UA checks anywhere downstream. Arrange and the mono probes pass `cleanMode: true` unconditionally; voice (`useAudioStream.ts`) is the only call site with a user-facing toggle.

| What clean mode disables | Mechanism |
|---|---|
| echo cancellation, noise suppression | Standard W3C constraints — but WebKit exposes only `echoCancellation`; `noiseSuppression`/`autoGainControl` are unimplemented there, so `echoCancellation: false` is WebKit's sole master switch |
| `autoGainControl` | **Forced `false`** — manual gain slider takes over |
| `voiceIsolation` | Gated directly on `getSupportedConstraints().voiceIsolation` inside `buildInputConstraints`, at the point of use — true on Chromium only (it is a Chromium constraint, not a WebKit one — an earlier UA-guessed flag had this backwards). `caps.supportsVoiceIsolation` exists and is correctly feature-detected but is **not** what gates this — it currently has no production consumer, only tests read it |
| `goog*` constraints | `caps.supportsGoogConstraints` — Desktop Chrome only |
| `latency` hint | `caps.cleanModeLatencyHint` vs `caps.normalModeLatencyHint` |

Full constraint matrix + the `acquireCleanInput`/`CleanInputReport` verification step (why an accepted request isn't proof of compliance unless it was `exact`): `docs/WEBRTC_CAPABILITY_PROFILE.md` → Clean Mode section.

**DSP effects are NOT bypassed in clean mode.** Effects (reverb, compression) are intentional sound design applied at source and transmitted pre-processed. Moving them to remote peers would require every peer to apply N tracks of effects simultaneously — O(N²) CPU load.

---

## Receive-Path Latency Tuning (DEV-257)

The default WebRTC pipeline leaves two large latency chunks untuned: the NetEq
adaptive jitter buffer (~40–80ms) and Opus 20ms packetization. `voiceReceiveTuning.ts`
tunes the packetization side — all voice peers are musicians by definition (TR-13: audience = HLS).

| Lever | Where wired | Effect |
|---|---|---|
| `mungeSessionDescription(desc)` | Both VOICE_OFFER emit sites + VOICE_ANSWER emit | Opus fmtp `minptime=10;useinbandfec=1` + `a=ptime:10` — declarative receive prefs the remote encoder honors: 10ms packets + FEC. Smaller packets also let NetEq's adaptive target settle lower (~2–3 packets ≈ 20–30ms). Same munge also names an explicit bitrate — `maxaveragebitrate=64000;maxplaybackrate=48000` (`VOICE_OPUS_MAX_AVERAGE_BITRATE`/`VOICE_OPUS_MAX_PLAYBACK_RATE` in `voiceReceiveTuning.ts`) — replacing the browser's ~32kbps mono default; an already-negotiated value is left untouched, only a gap is filled in. Added to both the fmtp-rewrite path and the insert-a-full-fmtp path. Still emit-copy only. |
| `extractJitterBufferSnapshot`/`computeJitterBufferMs` | `VoiceMonitoringManager` (both polling paths) | `peer.jitterBufferMs` (windowed avg) → `getState().jitterBufferMs` → latency breakdown UI |

**Rules:**
- **Munge ONLY the emitted signaling copy — never `localDescription`.** Munging the local description would desync the Perfect Negotiation state machine.
- **Never use `audioReceiver.playoutDelayHint`** — it has no effect on audio delay (only the video receiver variant delays both).
- **Never set `jitterBufferTarget` to *reduce* latency** — Chrome implements it as NetEq's *base minimum* delay (floor): effective target = max(adaptive, value), so it can only add latency. DEV-257 initially set 40ms under the "hints downward" misreading and removed it once the floor semantics were confirmed (w3c/webrtc-extensions#199 — a `jitterBufferMaximumDelay` cap is only a proposal). Unset = floor 0 = fully adaptive = lowest possible. Only legitimate use: deliberately raising the floor for a stability-over-latency mode. A regression test guards ontrack against re-adding it.
- **Every RTT sample goes through `recordRttSample(peer, ms)`** — never push to `latencySamples` directly. It feeds the display median AND the longer stall window from the same sample; bypassing it silently disables stall detection for that path.
- **Diagnostics are not stages.** `connectionPath` / `networkJitterMs` / `networkStall` explain the breakdown; they must never enter `computeLatencyBreakdown`'s sum. They travel as one `VoiceConnectionDiagnostics` object through room → runtime → popup.
- **Mesh aggregation differs per metric** (`meshAggregation.ts`): latency-like values **average**; `connectionPath` and `networkStall` take the **worst peer** — one relayed or stalling peer is what the session actually feels, an average would describe nobody.
- **Warning copy is action-first and platform-gated.** The ⓘ popup shows what to DO by default (wired headphones / turn off AirDrop+Handoff / Windows audio enhancements); the diagnosis sits behind the single "Show details" toggle. Platform branches read `caps.isMacOS` / `caps.isWindows` — never inline UA checks.

### Reading a bloated jitter buffer (field-proven, 2026-07-17)

The buffer is a symptom; these separate the causes. Real case: LAN-direct host↔host, RTT median 4ms, RTP jitter 4ms — yet NetEq pinned its target at 180ms because **macOS AWDL** (AirDrop/AirPlay) caused 70–160ms stalls every ~20–60s. All-wired floor is ~30ms (2–3 packets × ptime:10).

| Reading | Means |
|---|---|
| High raw `networkJitterMs` | Path is genuinely uneven — network problem |
| **Low raw jitter + big buffer** | Periodic stalls. `analyzeNetworkStalls` catches these; **the median-smoothed ping cannot** ("pretty ping, bloated buffer") |
| `connectionPath === "internet"` on one LAN | CGNAT/hairpin detour — traffic leaves and returns |

Debugging a dump: `jitterBufferMinimumDelay === jitterBufferTargetDelay` ⇒ no external floor is set, the target is network-driven. NetEq lowers its target slowly — **reconnect voice after changing network conditions** or the old value lingers.

- The headline latency is the full mouth-to-ear estimate: `computeLatencyBreakdown()` in `features/audio/utils/latencyBreakdown.ts` sums input driver + RTT/2 + jitter buffer + audio output (skipping unreported parts — e.g. input driver on Safari, jitter buffer before the first stats window; Safari DOES report `jitterBufferDelay` stats — what it lacks is the `jitterBufferTarget` setter, real-device confirmed 2026-07-17). Both `RTCLatencyDisplay` (headline + short tooltip) and the `VoiceInfo` ⓘ popup (per-stage rows with descriptions) MUST derive from this helper — never re-sum manually. Color/status thresholds in `RTCLatencyDisplay` are calibrated to this mouth-to-ear scale (<30 excellent … ≥150 very poor); changing the formula requires rescaling them together.
- Measurement decision gate for the raw-transport spike lives in `docs/WEBRTC_HYBRID_TRANSPORT_SPIKE.md`.

---

## JOIN_VOICE Cascade Bug — Prevention

**Root cause:** React 18 StrictMode and layout transitions can cause `addLocalStream` to be called twice within milliseconds. This emits JOIN_VOICE twice, triggering `USER_JOINED_VOICE` twice on all remote peers. The second event destroys an in-progress peer connection before it reaches `isConnected=true`.

**Two-layer defense:**

### Layer 1 — JOIN_VOICE debounce (in `VoicePresenceManager.announcePresence`)

```typescript
private lastJoinVoiceEmitMs = 0;
private readonly JOIN_VOICE_DEBOUNCE_MS = 3000;

// Inside announcePresence():
const now = Date.now();
if (now - this.lastJoinVoiceEmitMs < this.JOIN_VOICE_DEBOUNCE_MS) {
  return; // suppress duplicate within 3s window
}
this.lastJoinVoiceEmitMs = now;
```

`lastJoinVoiceEmitMs` resets to `0` via `presence.resetJoinDebounce()`, called from `WebRTCVoiceService.removeLocalStream()`, so intentional disconnect → reconnect is never suppressed.

### Layer 2 — in-progress peer guard (in `handleUserJoinedVoice` and `handleNewMeshPeer`)

```typescript
const isPeerActive =
  peer.isConnected ||
  peer.connection.signalingState !== "stable" ||   // negotiation in flight
  peer.connection.iceConnectionState === "checking" || // ICE still running
  peer.connection.connectionState === "connecting";    // not yet connected

if (isPeerActive) return; // never destroy an active or in-progress peer
// Only stale/failed peers (signalingState="stable" + not connected) are cleaned up.
```

---

## React StrictMode — Service Subscription Lifecycle

React 18 StrictMode simulates `mount → (cleanup → re-run effects)` **without re-rendering**. The render body `if (!serviceRef.current)` is NOT re-evaluated during the simulated remount.

**The bug:** effect cleanup destroys the service and sets `serviceRef = null`. When the effect re-runs, `serviceRef.current` is null and the subscription is never established → `listenerCount = 0` → React never receives state updates.

**The fix in `useWebRTCVoice.ts`:**

```typescript
// latestPropsRef: updated synchronously on every render, safe to read in [] effects
const latestPropsRef = useRef(initialProps);
latestPropsRef.current = currentProps; // always current

useEffect(() => {
  // Recreate service after StrictMode cleanup if ref is null
  if (!serviceRef.current) {
    serviceRef.current = new WebRTCVoiceService(latestPropsRef.current);
  }
  const service = serviceRef.current;
  const unsubscribe = service.subscribe(/* setState... */);

  return () => {
    unsubscribe();
    service.destroy();
    if (serviceRef.current === service) serviceRef.current = null;
  };
}, []);
```

**Why `latestPropsRef` matters:** The effect has `[]` deps (intentional — only run on mount/unmount). `latestPropsRef.current` gives it access to always-current props without stale closure issues. The `updateProps` effect (with proper deps) runs immediately after and corrects any drift.

---

## Cautions

- **DO NOT process WebRTC payload on the server** — server is a relay only (forward by targetUserId).
- **Voice context must ALWAYS be separate from instrument context** — do not mix.
- **Audience has NO WebRTC** — TR-13 enforces not sending offers to audience peers.
- **Mesh scaling** — 8 users = 28 connections; consider connection overhead if increasing max users.
- **Do NOT read RTCPeerConnection.connectionState directly for "connected" check** — use `peer.isConnected` from service.
- **Do NOT wire peerConnections Map to React for latency** — use `getState().meshLatency` from service directly.
- **createDataChannel() must be called before createOffer()** — otherwise ondatachannel never fires on Safari.
- **AudioContext.resume() must be synchronous on iOS Safari** — async calls are silently ignored.
- **Do NOT add inline `navigator.userAgent` checks** anywhere outside `webrtcCapabilities.ts` — add a flag to `WebRTCCapabilities` first.
- **Do NOT bypass DSP effects chain in clean mode** — apply at source, not remotely. See Clean Mode section above.
- **REQUEST_MESH_CONNECTIONS doubles as the voice keep-alive** (server bumps `lastHeartbeat`) and **VOICE_HEARTBEAT is sent even with zero peers** — do NOT re-add a "skip when no peers" gate to `sendHeartbeat` or a `hasActiveTrack` gate around the monitoring loop starts in `addLocalStream`/`rejoinVoiceMesh`; muted/solo sessions rely on them.
