/** Parse a tiny subset of ISO 8601 durations (PT48H, P1D, PT15M). */

export function parseISODuration(duration: string): number {
  // Returns milliseconds.
  const m = duration.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!m) throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  const [, y, mo, w, d, h, mi, s] = m;
  let ms = 0;
  ms += (parseInt(y || '0', 10)) * 365 * 24 * 60 * 60 * 1000;
  ms += (parseInt(mo || '0', 10)) * 30 * 24 * 60 * 60 * 1000;
  ms += (parseInt(w || '0', 10)) * 7 * 24 * 60 * 60 * 1000;
  ms += (parseInt(d || '0', 10)) * 24 * 60 * 60 * 1000;
  ms += (parseInt(h || '0', 10)) * 60 * 60 * 1000;
  ms += (parseInt(mi || '0', 10)) * 60 * 1000;
  ms += (parseInt(s || '0', 10)) * 1000;
  return ms;
}
