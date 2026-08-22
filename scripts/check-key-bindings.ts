import { DEFAULT_PADS } from '../src/components/DrumPads.tsx';
import { KEYBOARD_NOTES } from '../src/components/SynthView.tsx';

let failures = 0;
const check = (cond: boolean, label: string) => {
  if (cond) {
    console.log('PASS', label);
  } else {
    console.error('FAIL', label);
    failures++;
  }
};

const drumCodes = DEFAULT_PADS.map((p) => p.shortcut);
const synthCodes = KEYBOARD_NOTES.map((k) => k.key);

check(new Set(drumCodes).size === drumCodes.length, `drum pads unique (${drumCodes.join(' ')})`);
check(new Set(synthCodes).size === synthCodes.length, `synth keys unique (${synthCodes.join(' ')})`);

const overlap = drumCodes.filter((c) => synthCodes.includes(c));
check(overlap.length === 0, `no drum/synth overlap (${overlap.join(', ') || 'none'})`);

const VALID_CODE = /^(Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal)$/;
const invalid = [...drumCodes, ...synthCodes].filter((c) => !VALID_CODE.test(c));
check(invalid.length === 0, `all codes valid KeyboardEvent.code (invalid: ${invalid.join(', ') || 'none'})`);

if (failures > 0) process.exit(1);
console.log('All key binding checks passed.');
