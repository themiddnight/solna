import type { BandMember, User, EffectChainType, EffectChainState } from "../../../../types";
import type { RoomRepository } from "../../../room-management/infrastructure/repositories/RoomRepository";

export class EffectChainService {
  private readonly EFFECT_CHAIN_TYPES: EffectChainType[] = [
    'virtual_instrument',
    'audio_voice_input'
  ];

  constructor(private readonly roomRepository: RoomRepository) { }

  getDefaultEffectChains(): Record<EffectChainType, EffectChainState> {
    return this.EFFECT_CHAIN_TYPES.reduce((acc, type) => {
      acc[type] = {
        type,
        effects: []
      };
      return acc;
    }, {} as Record<EffectChainType, EffectChainState>);
  }

  ensureUserEffectChains(user: User): void {
    if (user.role === 'audience') return;

    // Narrowed to BandMember since role is not 'audience'
    const bandMember = user as BandMember;

    if (!bandMember.effectChains) {
      bandMember.effectChains = this.getDefaultEffectChains();
      return;
    }

    this.EFFECT_CHAIN_TYPES.forEach((type) => {
      if (!(type in bandMember.effectChains!)) {
        bandMember.effectChains![type] = {
          type,
          effects: []
        };
      }
    });
  }

  async updateUserEffectChains(
    roomId: string,
    userId: string,
    chains: Record<EffectChainType, EffectChainState>
  ): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    const user = room.bandMembers.get(userId);
    if (!user) return false;

    const sanitizedChains = this.getDefaultEffectChains();
    this.EFFECT_CHAIN_TYPES.forEach((type) => {
      const incoming = chains[type];
      sanitizedChains[type] = {
        type: incoming.type,
        effects: incoming.effects.map((effect) => ({
          ...effect,
          parameters: effect.parameters.map((param) => ({ ...param }))
        }))
      };
    });

    user.effectChains = sanitizedChains;

    // Invalidate cache to propagate updated state
    await this.roomRepository.saveRoom(room);
    await this.roomRepository.invalidateRoomCache(roomId);
    return true;
  }
}
