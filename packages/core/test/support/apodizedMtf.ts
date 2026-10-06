/**
 * § 2m — a radially apodized pupil's diffraction-limited MTF, with no FFT grid.
 *
 * OTF(ν) = ∫∫ A(|r − ν|)·A(|r + ν|) dA / ∫ A² dA over two unit discs whose
 * centres are 2ν apart (ν in units of the cutoff), integrated by Gauss–Legendre
 * over the lens-shaped overlap. A uniform A reproduces
 * (2/π)(arccos ν − ν√(1 − ν²)) to 1e-15, which is the rule's own control.
 */
export function apodizedMtf(amplitude: (r: number) => number, nu: number, rule = { x: 200, y: 64 }): number {
  return overlap(amplitude, nu, rule.x, rule.y) / energy(amplitude);
}

/**
 * The exit-layout amplitude of a paraboloid at focal ratio F, on axis: its rays
 * leave at sin u′ = (h/f)/(1 + h²/4f²), so the exit coordinate of an aim
 * radius a is e = a(1 + q)/(1 + q·a²) with q = 1/16F², and with a uniform
 * source |P|² = 1/|∂e/∂a| (§ 2j). Brightest at the rim, where it is (1 + q)/(1 − q).
 */
export function paraboloidExitAmplitude(focalRatio: number): (e: number) => number {
  const q = 1 / (16 * focalRatio * focalRatio);
  return (e) => {
    if (e <= 1e-12) return 1 / (1 + q);
    const a = (1 + q - Math.sqrt((1 + q) ** 2 - 4 * q * e * e)) / (2 * q * e);
    const slope = ((1 + q) * (1 - q * a * a)) / (1 + q * a * a) ** 2;
    return 1 / Math.sqrt((e / a) * slope);
  };
}

/** The quadrant x ∈ [0, 1 − ν], y ∈ [0, √(1 − (x + ν)²)], ×4; x = (1 − ν)(1 − t²) clusters nodes at the root. */
function overlap(amplitude: (r: number) => number, nu: number, nx: number, ny: number): number {
  const gx = gaussLegendreUnit(nx);
  const gy = gaussLegendreUnit(ny);
  let s = 0;
  for (let i = 0; i < nx; i++) {
    const t = gx.x[i]!;
    const x = (1 - nu) * (1 - t * t);
    const h = Math.sqrt(Math.max(0, 1 - (x + nu) ** 2));
    let inner = 0;
    for (let j = 0; j < ny; j++) {
      const y = h * gy.x[j]!;
      inner += gy.w[j]! * amplitude(Math.hypot(x - nu, y)) * amplitude(Math.hypot(x + nu, y));
    }
    s += gx.w[i]! * (1 - nu) * 2 * t * h * inner;
  }
  return 4 * s;
}

function energy(amplitude: (r: number) => number): number {
  const g = gaussLegendreUnit(400);
  let s = 0;
  for (let i = 0; i < g.x.length; i++) s += g.w[i]! * 2 * Math.PI * g.x[i]! * amplitude(g.x[i]!) ** 2;
  return s;
}

function gaussLegendreUnit(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 1;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push((1 - z) / 2);
    w.push(1 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}
