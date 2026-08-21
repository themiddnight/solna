import { createChromiumOutputRouter } from "./chromiumOutputRouter";
import type {
  OutputOption,
  OutputRouter,
  OutputSinkListener,
  Unsubscribe,
} from "./types";

export type { OutputOption, OutputRouter, OutputSinkListener, Unsubscribe };

const detectSetSinkIdSupport = (): boolean =>
  typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

let router: OutputRouter | null = null;

/** Process-wide OutputRouter. One instance so the chosen sink survives context rebuilds. */
export const getOutputRouter = (): OutputRouter => {
  router ??= createChromiumOutputRouter(detectSetSinkIdSupport);
  return router;
};
