import { buildAiSystemMessage } from '../buildAiSystemMessage';

describe('buildAiSystemMessage — generation range (DEV-46)', () => {
  it('states the requested length in bars when one is given', () => {
    const message = buildAiSystemMessage({ bpm: 120 }, 8);

    expect(message).toContain('8 bars');
  });

  it('says nothing about length when no range is given', () => {
    const message = buildAiSystemMessage({ bpm: 120 });

    expect(message).not.toContain('bars');
  });
});
