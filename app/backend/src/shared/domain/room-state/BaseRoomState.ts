export interface BaseRoomState {
  roomId: string;
  roomType: 'arrange' | 'perform';
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  lastUpdated: Date;
}
