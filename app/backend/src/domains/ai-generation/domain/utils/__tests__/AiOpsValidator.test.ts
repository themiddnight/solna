import { extractValidOps } from '../AiOpsValidator';
import { InvalidAiResponseError } from '../../errors/InvalidAiResponseError';

describe('extractValidOps', () => {
  it('keeps valid ops and clamps numeric fields', () => {
    const ops = extractValidOps('openai', {
      ops: [
        { op: 'add', note: { pitch: 200, start: -1, duration: 0, velocity: 999 } },
        { op: 'modify', target: 0, set: { duration: 0.25 } },
        { op: 'remove', target: 1 },
      ],
    }, 2);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({ op: 'add', note: { pitch: 127, start: 0, duration: 0.0625, velocity: 127 } });
  });

  it('drops ops whose target is out of range', () => {
    const ops = extractValidOps('gemini', { ops: [{ op: 'remove', target: 5 }, { op: 'remove', target: 0 }] }, 1);
    expect(ops).toEqual([{ op: 'remove', target: 0 }]);
  });

  it('drops malformed ops without throwing', () => {
    const ops = extractValidOps('openai', { ops: [{ op: 'nope' }, { target: 0 }, { op: 'modify', target: 0, set: { pitch: 60 } }] }, 1);
    expect(ops).toEqual([{ op: 'modify', target: 0, set: { pitch: 60 } }]);
  });

  it('throws when ops is entirely absent', () => {
    expect(() => extractValidOps('openai', { notes: [] }, 1)).toThrow(InvalidAiResponseError);
  });

  it('caps ops at MAX_OPS_PER_TURN (256)', () => {
    const ops = Array.from({ length: 300 }, () => ({
      op: 'add' as const,
      note: { pitch: 60, start: 0, duration: 1, velocity: 100 },
    }));
    const result = extractValidOps('openai', { ops }, 1);
    expect(result).toHaveLength(256);
  });
});
