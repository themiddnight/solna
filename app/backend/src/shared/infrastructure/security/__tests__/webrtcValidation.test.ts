import type { Socket } from 'socket.io';
import {
  validateIceCandidate,
  validateMediaConstraints,
  validateSessionDescription,
  validateWebRTCConnection,
  validateWebRTCRequest,
} from '../webrtcValidation';

// Confined cast: the validators only read `socket.data`, so a plain object is
// sufficient — no socket.io internals are fabricated. Mirrors the makeSocket
// helper pattern in src/shared/infrastructure/socket/__tests__/socketSession.test.ts.
const makeSocket = (data: Record<string, unknown> | undefined) => ({ data } as unknown as Socket);

describe('webrtcValidation', () => {
  describe('validateSessionDescription (SDP offer/answer)', () => {
    it.each(['<script>alert(1)</script>', 'javascript:alert(1)', 'onerror=alert(1)'])(
      'rejects an offer containing %s',
      (snippet) => {
        const result = validateSessionDescription({ type: 'offer', sdp: `v=0\r\n${snippet}\r\n` });
        expect(result).toEqual({ isValid: false, error: 'Suspicious content detected in SDP' });
      }
    );

    it('rejects an SDP longer than 10,000 characters', () => {
      const result = validateSessionDescription({ type: 'offer', sdp: 'a'.repeat(10001) });
      expect(result).toEqual({ isValid: false, error: 'SDP content too long' });
    });

    it('accepts a well-formed offer', () => {
      const result = validateSessionDescription({
        type: 'offer',
        sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n',
      });
      expect(result).toEqual({ isValid: true });
    });

    it.each([null, undefined, 'not-an-object', 42])('rejects a non-object SDP payload: %p', (payload) => {
      expect(validateSessionDescription(payload)).toEqual({
        isValid: false,
        error: 'Invalid session description format',
      });
    });

    it('rejects a type that is neither offer nor answer', () => {
      expect(validateSessionDescription({ type: 'pranswer', sdp: 'v=0' })).toEqual({
        isValid: false,
        error: 'Invalid session description type',
      });
    });

    it('rejects an empty SDP string', () => {
      expect(validateSessionDescription({ type: 'offer', sdp: '' })).toEqual({
        isValid: false,
        error: 'Missing or invalid SDP content',
      });
    });

    it('rejects a non-string SDP field', () => {
      // A numerically-typed sdp field is a malformed wire payload the
      // validator must reject; typed unknown so no cast is needed.
      const malformed: unknown = { type: 'offer', sdp: 123 };
      expect(validateSessionDescription(malformed)).toEqual({
        isValid: false,
        error: 'Missing or invalid SDP content',
      });
    });
  });

  describe('validateIceCandidate', () => {
    it('allows an empty-string candidate (W3C end-of-candidates)', () => {
      // Regression trap: per the W3C spec the `candidate` field may be an
      // empty string to signal end-of-candidates — rejecting it would break
      // legitimate RTCPeerConnection teardown. Only a missing/non-string
      // field is invalid.
      expect(validateIceCandidate({ candidate: '' })).toEqual({ isValid: true });
    });

    it('rejects a missing candidate field', () => {
      expect(validateIceCandidate({})).toEqual({
        isValid: false,
        error: 'Missing or invalid candidate field',
      });
    });

    it('rejects a non-object candidate payload', () => {
      expect(validateIceCandidate(null)).toEqual({
        isValid: false,
        error: 'Invalid ICE candidate format',
      });
    });

    it('rejects a candidate string longer than 1,000 characters', () => {
      expect(validateIceCandidate({ candidate: 'a'.repeat(1001) })).toEqual({
        isValid: false,
        error: 'ICE candidate string too long',
      });
    });

    it('rejects a candidate carrying suspicious content', () => {
      expect(validateIceCandidate({ candidate: 'candidate:0 1 UDP 1 127.0.0.1 9 javascript:alert(1)' })).toEqual({
        isValid: false,
        error: 'Suspicious content detected in ICE candidate',
      });
    });
  });

  describe('validateWebRTCConnection', () => {
    it('rejects when the sender targets themselves', () => {
      const socket = makeSocket({ userId: 'user-1', roomId: 'room-1' });
      const result = validateWebRTCConnection(socket, 'user-1', 'room-1');
      expect(result).toEqual({ isValid: false, error: 'Cannot establish connection with self' });
    });

    it('rejects when the sender is not in the target room', () => {
      const socket = makeSocket({ userId: 'user-1', roomId: 'room-2' });
      const result = validateWebRTCConnection(socket, 'user-2', 'room-1');
      expect(result).toEqual({ isValid: false, error: 'User not in specified room' });
    });

    it('rejects when socket.data is missing (unauthenticated)', () => {
      const socket = makeSocket(undefined);
      const result = validateWebRTCConnection(socket, 'user-2', 'room-1');
      expect(result).toEqual({ isValid: false, error: 'User not authenticated' });
    });

    it('rejects when socket.data.userId is missing', () => {
      const socket = makeSocket({ roomId: 'room-1' });
      const result = validateWebRTCConnection(socket, 'user-2', 'room-1');
      expect(result).toEqual({ isValid: false, error: 'User not authenticated' });
    });

    it('accepts a valid cross-user, same-room request', () => {
      const socket = makeSocket({ userId: 'user-1', roomId: 'room-1' });
      expect(validateWebRTCConnection(socket, 'user-2', 'room-1')).toEqual({ isValid: true });
    });

    it.each(['', 'x'.repeat(101)])('rejects an invalid target user ID: %j', (targetUserId) => {
      const socket = makeSocket({ userId: 'user-1', roomId: 'room-1' });
      expect(validateWebRTCConnection(socket, targetUserId, 'room-1')).toEqual({
        isValid: false,
        error: 'Invalid target user ID',
      });
    });

    it.each(['', 'x'.repeat(101)])('rejects an invalid room ID: %j', (roomId) => {
      // The socket's data.roomId must EQUAL the invalid target roomId — the
      // "not in specified room" check runs before the room-ID format check.
      const socket = makeSocket({ userId: 'user-1', roomId });
      expect(validateWebRTCConnection(socket, 'user-2', roomId)).toEqual({
        isValid: false,
        error: 'Invalid room ID',
      });
    });
  });

  describe('validateMediaConstraints', () => {
    it('rejects constraints nested deeper than the allowed depth', () => {
      const result = validateMediaConstraints({ video: { a: { b: { c: { d: true } } } } });
      expect(result).toEqual({ isValid: false, error: 'Media constraints too deeply nested' });
    });

    it('accepts constraints within the allowed depth', () => {
      expect(validateMediaConstraints({ video: { a: { b: true } } })).toEqual({ isValid: true });
    });

    it('rejects a non-object constraints payload', () => {
      expect(validateMediaConstraints(null)).toEqual({
        isValid: false,
        error: 'Invalid media constraints format',
      });
    });

    it('rejects a non-boolean/non-object audio constraint', () => {
      expect(validateMediaConstraints({ audio: 'yes' })).toEqual({
        isValid: false,
        error: 'Invalid audio constraints',
      });
    });

    it('rejects a non-boolean/non-object video constraint', () => {
      expect(validateMediaConstraints({ video: 'yes' })).toEqual({
        isValid: false,
        error: 'Invalid video constraints',
      });
    });
  });

  describe('validateWebRTCRequest (wire-level composite)', () => {
    const socket = makeSocket({ userId: 'user-1', roomId: 'room-1' });

    it('rejects an offer carrying a script tag end-to-end', () => {
      const result = validateWebRTCRequest(socket, 'offer', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        offer: { type: 'offer', sdp: 'v=0\r\n<script>\r\n' },
      });
      expect(result).toEqual({ isValid: false, error: 'Suspicious content detected in SDP' });
    });

    it('accepts a valid offer end-to-end', () => {
      const result = validateWebRTCRequest(socket, 'offer', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        offer: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n' },
      });
      expect(result).toEqual({ isValid: true });
    });

    it('accepts an empty-string end-of-candidates signal end-to-end', () => {
      const result = validateWebRTCRequest(socket, 'ice-candidate', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        candidate: { candidate: '' },
      });
      expect(result).toEqual({ isValid: true });
    });

    it('validates the answer payload for an answer event', () => {
      const result = validateWebRTCRequest(socket, 'answer', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        answer: { type: 'answer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n' },
      });
      expect(result).toEqual({ isValid: true });
    });

    it('rejects a tampered answer payload end-to-end', () => {
      const result = validateWebRTCRequest(socket, 'answer', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        answer: { type: 'answer', sdp: 'v=0\r\n<script>\r\n' },
      });
      expect(result).toEqual({ isValid: false, error: 'Suspicious content detected in SDP' });
    });

    it('short-circuits on connection-validation failure (unauthenticated socket)', () => {
      const unauthenticated = makeSocket(undefined);
      const result = validateWebRTCRequest(unauthenticated, 'offer', {
        targetUserId: 'user-2',
        roomId: 'room-1',
        offer: { type: 'offer', sdp: 'v=0' },
      });
      // The connection check runs before event-specific validation — the
      // tampered offer never gets inspected.
      expect(result).toEqual({ isValid: false, error: 'User not authenticated' });
    });

    it('rejects an unknown WebRTC event type', () => {
      // Confined cast: 'webrtc' is not a member of the event-type union — this
      // exercises the switch default branch (defense in depth for future
      // callers passing an unlisted event type).
      const result = validateWebRTCRequest(socket, 'webrtc' as never, {
        targetUserId: 'user-2',
        roomId: 'room-1',
      });
      expect(result).toEqual({ isValid: false, error: 'Unknown WebRTC event type' });
    });
  });
});
