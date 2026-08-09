import { opticsSweep, type OpticsDone, type OpticsJob } from "./mech";

/**
 * C3's focal-ratio sweep — what the chain's glass costs the image, traced.
 *
 * ~1.1 s at 17 points and `pupilSamples` 21, of which about half is the two
 * traced bisections. Keyed on the aperture, the total glass and the sampling: the
 * chain's other sliders move lengths, and a length does not change a cone angle,
 * so nothing about a spacer or a camera body belongs in this request.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<OpticsJob>) => void) | null;
  postMessage: (message: OpticsDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: opticsSweep(request) });
};
