import { existsSync } from 'fs';

export interface HTTPSTestEnvironmentOptions {
  enableLogging?: boolean;
  port?: number;
}

export interface HTTPSTestRoom {
  id: string;
  name: string;
}

export interface HTTPSTestSocket {
  id: string;
  emit: (event: string, ...args: unknown[]) => boolean;
}

export interface HTTPSTestUser {
  userId: string;
  roomId: string;
  socket: HTTPSTestSocket;
}

export interface MkcertCompatibilityResult {
  mkcertAvailable: boolean;
  certificateValid: boolean;
  browserCompatible: boolean;
}

export class HTTPSTestEnvironment {
  private isInitialized = false;
  private readonly port: number;

  constructor(private readonly options: HTTPSTestEnvironmentOptions = {}) {
    this.port = options.port != null && options.port > 0 ? options.port : 3001;
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async cleanup(): Promise<void> {
    this.isInitialized = false;
  }

  async createTestRoom(name: string): Promise<{ room: HTTPSTestRoom }> {
    return {
      room: {
        id: `room_${name.toLowerCase().replace(/\s+/g, '_')}`,
        name,
      },
    };
  }

  async addTestUsersToRoom(roomId: string, count: number): Promise<HTTPSTestUser[]> {
    return Array.from({ length: count }, (_, index) => ({
      userId: `test_user_${index + 1}`,
      roomId,
      socket: {
        id: `socket_${roomId}_${index + 1}`,
        emit: () => true,
      },
    }));
  }

  getPort(): number {
    return this.port;
  }

  getHTTPSUrl(): string {
    return `https://localhost:${this.port}`;
  }

  async validateMkcertCompatibility(): Promise<MkcertCompatibilityResult> {
    const hasCert = existsSync('.ssl/server.crt');
    return {
      mkcertAvailable: hasCert,
      certificateValid: hasCert,
      browserCompatible: hasCert,
    };
  }
}
