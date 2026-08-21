import type { SetupAudioBusCommand, AddEffectCommand, UpdateAudioRoutingCommand, UpdateSynthParamsCommand } from '../application/AudioProcessingService';
import { AudioProcessingService } from '../application/AudioProcessingService';
import type { EventBus } from '../../../shared/domain/events/EventBus';

jest.mock('../../../shared/domain/events/EventBus', () => ({
  EventBus: jest.fn(),
}));

describe('AudioProcessingService', () => {
  let service: AudioProcessingService;
  let mockEventBus: jest.Mocked<EventBus>;

  beforeEach(() => {
    mockEventBus = {
      publish: jest.fn(),
    } as unknown as jest.Mocked<EventBus>;

    service = new AudioProcessingService(mockEventBus);
  });

  describe('setupAudioBus', () => {
    it('should setup audio bus successfully', async () => {
      const command: SetupAudioBusCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        instrumentType: 'guitar',
      };

      const result = await service.setupAudioBus(command);

      expect(result).toHaveProperty('audioBusId');
      expect(result.audioBusId).toContain('audiobus_');
      expect(result.audioBusId).toContain('user-123');
      expect(result.audioBusId).toContain('room-456');
    });

    it('should handle missing instrument type', async () => {
      const command: SetupAudioBusCommand = {
        userId: 'user-123',
        roomId: 'room-456',
      };

      const result = await service.setupAudioBus(command);

      expect(result).toHaveProperty('audioBusId');
    });

    it('should throw error for invalid userId', async () => {
      const command: SetupAudioBusCommand = {
        userId: '',
        roomId: 'room-456',
      };

      await expect(service.setupAudioBus(command)).rejects.toThrow();
    });

    it('should throw error for invalid roomId', async () => {
      const command: SetupAudioBusCommand = {
        userId: 'user-123',
        roomId: '',
      };

      await expect(service.setupAudioBus(command)).rejects.toThrow();
    });
  });

  describe('addEffect', () => {
    it('should add valid effect successfully', async () => {
      const command: AddEffectCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        effectType: 'reverb',
        effectParams: { roomSize: 0.5 },
      };

      await service.addEffect(command);
      // Should complete without throwing
    });

    it('should support all valid effect types', async () => {
      const validEffects = ['reverb', 'delay', 'compressor', 'filter', 'distortion'];

      for (const effectType of validEffects) {
        const command: AddEffectCommand = {
          userId: 'user-123',
          roomId: 'room-456',
          effectType,
        };

        await service.addEffect(command);
        // Should complete without throwing
      }
    });

    it('should throw error for invalid effect type', async () => {
      const command: AddEffectCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        effectType: 'invalid-effect',
      };

      await expect(service.addEffect(command)).rejects.toThrow('Invalid effect type');
    });

    it('should handle effect without params', async () => {
      const command: AddEffectCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        effectType: 'reverb',
      };

      await service.addEffect(command);
      // Should complete without throwing
    });
  });

  describe('updateAudioRouting', () => {
    it('should update audio routing successfully', async () => {
      const command: UpdateAudioRoutingCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        inputSource: 'microphone',
        outputDestination: 'master',
      };

      await service.updateAudioRouting(command);
      // Should complete without throwing
    });

    it('should throw error for invalid userId', async () => {
      const command: UpdateAudioRoutingCommand = {
        userId: '',
        roomId: 'room-456',
        inputSource: 'microphone',
        outputDestination: 'master',
      };

      await expect(service.updateAudioRouting(command)).rejects.toThrow();
    });
  });

  describe('updateSynthParams', () => {
    it('should update synth params successfully', async () => {
      const command: UpdateSynthParamsCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        params: {
          oscillatorType: 'sine',
          attack: 0.1,
          release: 0.5,
        },
      };

      await service.updateSynthParams(command);
      // Should complete without throwing
    });

    it('should throw error for empty params', async () => {
      const command: UpdateSynthParamsCommand = {
        userId: 'user-123',
        roomId: 'room-456',
        params: {},
      };

      await expect(service.updateSynthParams(command)).rejects.toThrow('Synth parameters cannot be empty');
    });

    it('should throw error for invalid userId', async () => {
      const command: UpdateSynthParamsCommand = {
        userId: '',
        roomId: 'room-456',
        params: {},
      };

      await expect(service.updateSynthParams(command)).rejects.toThrow();
    });
  });
});
