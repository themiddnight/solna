import type { AiNoteShape, NoteEditOp } from '@jam-band/shared';
import { InvalidAiResponseError } from '../errors/InvalidAiResponseError';

const MAX_OPS_PER_TURN = 256;

const clampPitch = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));
const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));
const clampStart = (v: number): number => Math.max(0, Number(v.toFixed(4)));
const clampDur = (v: number): number => Math.max(0.0625, Number(v.toFixed(4)));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanNote(raw: unknown): AiNoteShape | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.pitch) || !isNum(r.start) || !isNum(r.duration) || !isNum(r.velocity)) return null;
  return { pitch: clampPitch(r.pitch), start: clampStart(r.start), duration: clampDur(r.duration), velocity: clampVel(r.velocity) };
}

function cleanSet(raw: unknown): Partial<AiNoteShape> | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const set: Partial<AiNoteShape> = {};
  if (isNum(r.pitch)) set.pitch = clampPitch(r.pitch);
  if (isNum(r.start)) set.start = clampStart(r.start);
  if (isNum(r.duration)) set.duration = clampDur(r.duration);
  if (isNum(r.velocity)) set.velocity = clampVel(r.velocity);
  return Object.keys(set).length > 0 ? set : null;
}

export function extractValidOps(providerId: string, payload: unknown, existingCount: number): NoteEditOp[] {
  const candidate = Array.isArray(payload)
    ? payload
    : (payload != null && typeof payload === 'object' && 'ops' in payload
        ? (payload as Record<string, unknown>).ops
        : undefined);

  if (!Array.isArray(candidate)) {
    throw new InvalidAiResponseError(`${providerId} response did not include an ops array`);
  }

  const valid: NoteEditOp[] = [];
  const inRange = (t: unknown): t is number => isNum(t) && Number.isInteger(t) && t >= 0 && t < existingCount;

  for (const raw of candidate) {
    if (valid.length >= MAX_OPS_PER_TURN) break;
    if (raw == null || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (o.op === 'add') {
      const note = cleanNote(o.note);
      if (note) valid.push({ op: 'add', note });
    } else if (o.op === 'remove') {
      if (inRange(o.target)) valid.push({ op: 'remove', target: o.target });
    } else if (o.op === 'modify') {
      const set = cleanSet(o.set);
      if (inRange(o.target) && set) valid.push({ op: 'modify', target: o.target, set });
    }
  }
  return valid;
}
