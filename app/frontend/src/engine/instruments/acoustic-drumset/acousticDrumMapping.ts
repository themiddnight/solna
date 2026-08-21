import { noteNameToMidiPitch } from "@/shared/utils/generalMidiPercussion";

import type { AcousticDrumPiece } from "./types";

export const mapGmNoteToAcousticDrumPiece = (
  note: string | number,
): AcousticDrumPiece | null => {
  const gmNote =
    typeof note === "number" ? note : noteNameToMidiPitch(String(note));

  switch (gmNote) {
    case 35:
    case 36:
      return "kick";
    case 37:
    case 38:
    case 40:
      return "snare";
    case 39:
      return "clap";
    case 42:
    case 44:
      return "hihatClosed";
    case 46:
      return "hihatOpen";
    case 41:
    case 43:
    case 45:
      return "tomLow";
    case 47:
    case 48:
      return "tomMid";
    case 50:
      return "tomHigh";
    case 49:
    case 52:
    case 55:
    case 57:
      return "crash";
    case 51:
    case 53:
    case 59:
      return "ride";
    case 54:
      return "tambourine";
    case 56:
      return "cowbell";
    default:
      return null;
  }
};

export const getRepresentativeGmNoteForPiece = (
  piece: AcousticDrumPiece,
): number => {
  switch (piece) {
    case "kick":
      return 36;
    case "snare":
      return 38;
    case "clap":
      return 39;
    case "hihatClosed":
      return 42;
    case "hihatOpen":
      return 46;
    case "tomLow":
      return 45;
    case "tomMid":
      return 47;
    case "tomHigh":
      return 50;
    case "crash":
      return 49;
    case "ride":
      return 51;
    case "tambourine":
      return 54;
    case "cowbell":
      return 56;
  }
};
