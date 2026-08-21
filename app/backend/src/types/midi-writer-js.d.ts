declare module 'midi-writer-js' {
  class NoteEvent {
    constructor(options: {
      pitch: (string | number)[];
      duration: string;
      velocity?: number;
      startTick?: number;
      channel?: number;
    });
  }

  class Track {
    setTempo(tempo: number, tick?: number): void;
    addEvent(event: NoteEvent | NoteEvent[], callback?: (event: { tick: number }, track: Track) => void): Track;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class Writer {
    constructor(tracks: Track[]);
    buildFile(): Uint8Array;
  }

  const MidiWriter: {
    Track: typeof Track;
    NoteEvent: typeof NoteEvent;
    Writer: typeof Writer;
  };

  export default MidiWriter;
}
