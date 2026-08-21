import { buildAiEditSystemMessage } from '../buildAiEditSystemMessage';

describe('buildAiEditSystemMessage', () => {
  const notes = [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }];

  it('documents the ops schema and includes indexed notes', () => {
    const msg = buildAiEditSystemMessage({ bpm: 120 }, notes);
    expect(msg).toContain('"ops"');
    expect(msg).toContain('"op": "modify"');
    expect(msg).toContain('"index": 0');
    expect(msg).not.toContain('```');
  });

  it('includes the drum map when context is a drum track', () => {
    const msg = buildAiEditSystemMessage({ instrument: { category: 'drum_beat', name: 'kit' } }, notes);
    expect(msg).toContain('General MIDI Drum Mapping');
  });
});
