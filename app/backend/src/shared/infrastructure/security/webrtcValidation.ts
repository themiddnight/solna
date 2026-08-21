import type { Socket } from 'socket.io';

// WebRTC security validation
export interface WebRTCValidationResult {
  isValid: boolean;
  error?: string;
}

// Validate RTCSessionDescriptionInit (offer/answer)
export const validateSessionDescription = (sdp: unknown): WebRTCValidationResult => {
  if (sdp == null || typeof sdp !== 'object') {
    return { isValid: false, error: 'Invalid session description format' };
  }

  const sdpObj = sdp as { type: string; sdp: string };

  // Check for required fields
  if (sdpObj.type !== 'offer' && sdpObj.type !== 'answer') {
    return { isValid: false, error: 'Invalid session description type' };
  }

  if (sdpObj.sdp === '' || typeof sdpObj.sdp !== 'string') {
    return { isValid: false, error: 'Missing or invalid SDP content' };
  }

  // Validate SDP content length (prevent extremely long SDPs)
  if (sdpObj.sdp.length > 10000) {
    return { isValid: false, error: 'SDP content too long' };
  }

  // Basic SDP content validation
  const sdpContent = sdpObj.sdp.toLowerCase();
  
  // Check for potentially malicious content
  const suspiciousPatterns = [
    'javascript:',
    'data:',
    'vbscript:',
    '<script',
    'onload=',
    'onerror='
  ];

  for (const pattern of suspiciousPatterns) {
    if (sdpContent.includes(pattern)) {
      return { isValid: false, error: 'Suspicious content detected in SDP' };
    }
  }

  return { isValid: true };
};

// Validate RTCIceCandidateInit
export const validateIceCandidate = (candidate: unknown): WebRTCValidationResult => {
  if (candidate == null || typeof candidate !== 'object') {
    return { isValid: false, error: 'Invalid ICE candidate format' };
  }

  const candidateObj = candidate as { candidate: string };

  // Check for required fields
  // candidate.candidate (the SDP string) may be an empty string per W3C spec —
  // this signals end-of-candidates. Only reject if the field is missing or not a string.
  if (!('candidate' in candidate) || typeof candidateObj.candidate !== 'string') {
    return { isValid: false, error: 'Missing or invalid candidate field' };
  }

  // Validate candidate string length
  if (candidateObj.candidate.length > 1000) {
    return { isValid: false, error: 'ICE candidate string too long' };
  }

  // Basic candidate string validation
  const candidateStr = candidateObj.candidate.toLowerCase();
  
  // Check for potentially malicious content
  const suspiciousPatterns = [
    'javascript:',
    'data:',
    'vbscript:',
    '<script',
    'onload=',
    'onerror='
  ];

  for (const pattern of suspiciousPatterns) {
    if (candidateStr.includes(pattern)) {
      return { isValid: false, error: 'Suspicious content detected in ICE candidate' };
    }
  }

  return { isValid: true };
};

// Validate WebRTC connection request
export const validateWebRTCConnection = (
  socket: Socket, 
  targetUserId: string, 
  roomId: string
): WebRTCValidationResult => {
  const socketData = socket.data as Record<string, unknown> | undefined;

  // Check if user is authenticated
  if (socketData == null || socketData.userId == null) {
    return { isValid: false, error: 'User not authenticated' };
  }

  // Check if user is in the specified room
  if (socketData.roomId == null || socketData.roomId !== roomId) {
    return { isValid: false, error: 'User not in specified room' };
  }

  // Check if target user is different from sender
  if (socketData.userId === targetUserId) {
    return { isValid: false, error: 'Cannot establish connection with self' };
  }

  // Validate user IDs (basic format check)
  if (targetUserId === '' || typeof targetUserId !== 'string' || targetUserId.length > 100) {
    return { isValid: false, error: 'Invalid target user ID' };
  }

  if (roomId === '' || typeof roomId !== 'string' || roomId.length > 100) {
    return { isValid: false, error: 'Invalid room ID' };
  }

  return { isValid: true };
};

// Validate WebRTC media constraints (if any are wasSent)
export const validateMediaConstraints = (constraints: unknown): WebRTCValidationResult => {
  if (constraints == null || typeof constraints !== 'object') {
    return { isValid: false, error: 'Invalid media constraints format' };
  }

  const constraintsObj = constraints as { audio?: unknown; video?: unknown };

  // Check for audio/video constraints
  if (constraintsObj.audio != null && typeof constraintsObj.audio !== 'boolean' && typeof constraintsObj.audio !== 'object') {
    return { isValid: false, error: 'Invalid audio constraints' };
  }

  if (constraintsObj.video != null && typeof constraintsObj.video !== 'boolean' && typeof constraintsObj.video !== 'object') {
    return { isValid: false, error: 'Invalid video constraints' };
  }

  // Validate constraint object depth (prevent deeply nested objects)
  const maxDepth = 3;
  const checkDepth = (obj: unknown, depth: number = 0): boolean => {
    if (depth > maxDepth) return false;
    if (typeof obj !== 'object' || obj === null) return true;
    
    const objRecord = obj as Record<string, unknown>;
    for (const key in objRecord) {
      if (!checkDepth(objRecord[key], depth + 1)) return false;
    }
    return true;
  };

  if (!checkDepth(constraints)) {
    return { isValid: false, error: 'Media constraints too deeply nested' };
  }

  return { isValid: true };
};

// Comprehensive WebRTC validation for all connection types
export const validateWebRTCRequest = (
  socket: Socket,
  eventType: 'offer' | 'answer' | 'ice-candidate',
  data: unknown
): WebRTCValidationResult => {
  // Basic connection validation
  const webRTCData = data as { targetUserId: string; roomId: string; offer?: unknown; answer?: unknown; candidate?: unknown };
  const connectionValidation = validateWebRTCConnection(
    socket, 
    webRTCData.targetUserId, 
    webRTCData.roomId
  );
  
  if (!connectionValidation.isValid) {
    return connectionValidation;
  }

  // Event-specific validation
  switch (eventType) {
    case 'offer':
      return validateSessionDescription(webRTCData.offer);
    
    case 'answer':
      return validateSessionDescription(webRTCData.answer);
    
    case 'ice-candidate':
      return validateIceCandidate(webRTCData.candidate);
    
    default:
      return { isValid: false, error: 'Unknown WebRTC event type' };
  }
};
