export function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t);
  const ms = Math.floor((t - s) * 100);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}.${ms}`;
}
