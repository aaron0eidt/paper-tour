/** Deterministic tileable noise, generated once per renderer; no external image. */
export function createNoiseTexture(size = 128): Uint8Array {
  const pixels = new Uint8Array(size * size);
  const hash = (x: number, y: number, period: number) => {
    let value = Math.imul((x % period) + 1, 374761393) ^ Math.imul((y % period) + 17, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let weights = 0;
      for (let octave = 0; octave < 4; octave++) {
        const period = 4 << octave;
        const px = x / size * period;
        const py = y / size * period;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const weight = 1 / (1 << octave);
        sum += mix(
          mix(hash(ix, iy, period), hash(ix + 1, iy, period), smooth(px - ix)),
          mix(hash(ix, iy + 1, period), hash(ix + 1, iy + 1, period), smooth(px - ix)),
          smooth(py - iy),
        ) * weight;
        weights += weight;
      }
      pixels[y * size + x] = Math.round(sum / weights * 255);
    }
  }
  return pixels;
}
