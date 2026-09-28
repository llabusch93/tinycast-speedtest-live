// Reads the Ookla CLI output and draws the dashboard as SVG. No dependencies, so `npm test`
// can run this file directly with Node.

export const FRAME_MS = 66;
// Share of the remaining distance per frame, derived from a fixed time constant: the display
// glides to each new sample in about 150 ms regardless of FRAME_MS.
const EASE = 1 - Math.exp(-FRAME_MS / 130);
const TICKS = [0, 5, 10, 25, 50, 100, 250, 500, 1000];

export const PHASES = {
  ping: { label: "Ping", from: "#FDE047", to: "#F97316" },
  download: { label: "Download", from: "#22D3EE", to: "#3B82F6" },
  upload: { label: "Upload", from: "#F0ABFC", to: "#8B5CF6" },
};
type Key = keyof typeof PHASES;

// Tinycast replaces these names in the SVG with the text colours of the current theme.
const TEXT = "raycast-primary-text";
const MUTED = "raycast-secondary-text";
// CoreSVG always draws text in Helvetica Regular; a stroke is the only way to get bold.
const FONT = "Helvetica Neue, Helvetica, sans-serif";
const bold = (size: number) => `stroke="${TEXT}" stroke-width="${(size / 27).toFixed(2)}" stroke-linejoin="round"`;

type Sample = [progress: number, mbps: number];
interface Transfer {
  bandwidth: number;
  progress?: number;
  latency?: { iqm?: number };
}
interface Ping {
  latency: number;
  jitter: number;
  progress?: number;
}
interface Start {
  isp?: string;
  server: { name: string; location: string; country: string };
  interface?: { isVpn?: boolean };
}
interface Result extends Start {
  ping: Ping;
  download: Transfer;
  upload: Transfer;
  packetLoss?: number;
  result?: { url?: string };
}
export type Phase = "connecting" | Key | "done";
export interface State {
  phase: Phase;
  start: Start | null;
  ping: Ping | null;
  download: Transfer | null;
  upload: Transfer | null;
  dl: Sample[];
  ul: Sample[];
  result: Result | null;
  error: string | null;
}
export interface Shown {
  phase: Phase;
  v: number;
  p: number;
}

export const mbps = (bytesPerSecond: number) => (bytesPerSecond * 8) / 1e6;
const num = (value: number, digits: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const speed = (value: number) => num(value, value >= 100 ? 0 : 1);
export const ms = (value: number) => num(value, value >= 10 ? 0 : 1);

// Rebuilds the whole state from the file on every read; a half-written last line is skipped
// and read in full next time.
export function parse(text: string, exitCode?: number): State {
  const s: State = {
    phase: "connecting",
    start: null,
    ping: null,
    download: null,
    upload: null,
    dl: [],
    ul: [],
    result: null,
    error: null,
  };
  let lastText = "";
  for (const line of text.split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      if (line.trim()) lastText = line.trim();
      continue;
    }
    if (!e || typeof e !== "object") continue;
    if (e.type === "testStart") Object.assign(s, { phase: "ping", start: e });
    else if (e.type === "ping") s.ping = e.ping;
    else if (e.type === "download") {
      Object.assign(s, { phase: "download", download: e.download });
      s.dl.push([e.download.progress, mbps(e.download.bandwidth)]);
    } else if (e.type === "upload") {
      Object.assign(s, { phase: "upload", upload: e.upload });
      s.ul.push([e.upload.progress, mbps(e.upload.bandwidth)]);
    } else if (e.type === "result")
      Object.assign(s, { phase: "done", result: e, ping: e.ping, download: e.download, upload: e.upload });
    else if (e.type === "log" && e.level === "error") s.error = e.message;
  }
  if (exitCode != null && !s.result) s.error = s.error || lastText || `speedtest exited with code ${exitCode}`;
  return s;
}

const transfer = (s: State, phase: Phase) => (phase === "download" ? s.download : phase === "upload" ? s.upload : null);

// Where the display glides to: current bandwidth and progress of the running phase.
export function target(s: State): Shown {
  if (s.result) return { phase: "done", v: mbps(s.result.download.bandwidth), p: 1 };
  const data = transfer(s, s.phase);
  return data ? { phase: s.phase, v: mbps(data.bandwidth), p: data.progress ?? 0 } : { phase: s.phase, v: 0, p: 0 };
}

// One frame: glides a bit further; on a phase change only the progress jumps, so the new
// curve starts on the left. Returns `shown` unchanged once settled, so React skips the render.
export function step(shown: Shown | null, t: Shown): Shown {
  if (!shown) return t;
  const samePhase = shown.phase === t.phase;
  const v = shown.v + (t.v - shown.v) * EASE;
  const p = samePhase ? shown.p + (t.p - shown.p) * EASE : t.p;
  if (samePhase && Math.abs(t.v - v) < 0.005 && Math.abs(t.p - p) < 0.0005) {
    return shown.v === t.v && shown.p === t.p ? shown : t;
  }
  return { phase: t.phase, v, p };
}

const START = 150;
const SWEEP = 240;
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy + r * Math.sin((deg * Math.PI) / 180),
];
const xy = ([x, y]: [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
const arc = (cx: number, cy: number, r: number, from: number, to: number) =>
  `M${xy(polar(cx, cy, r, from))}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${xy(polar(cx, cy, r, to))}`;

// Every tick gets the same spacing, like on speedtest.net.
function scale(value: number) {
  for (let i = 1; i < TICKS.length; i++) {
    if (value <= TICKS[i]) return (i - 1 + (value - TICKS[i - 1]) / (TICKS[i] - TICKS[i - 1])) / (TICKS.length - 1);
  }
  return 1;
}

const W = 900;
const H = 360;
const G = { cx: 200, cy: 221, r: 165 };

function gauge(s: State, shown: Shown) {
  const { cx, cy, r } = G;
  const key = s.phase === "done" ? "download" : s.phase;
  const data = transfer(s, key);
  let label = "Connecting";
  let value = "…";
  let unit = "";
  let fraction = 0;
  if (s.error) [label, value] = ["Error", "!"];
  else if (key === "ping" && s.ping) [label, value, unit] = ["Ping", ms(s.ping.latency), "ms"];
  else if (data && key !== "connecting" && key !== "ping")
    [label, value, unit, fraction] = [PHASES[key].label, speed(shown.v), "Mbps", scale(shown.v)];
  const end = START + SWEEP * fraction;
  const valueArc = arc(cx, cy, r, START, end);
  const ticks = TICKS.map((tick, i) => {
    const [x, y] = polar(cx, cy, r - 36, START + (SWEEP * i) / (TICKS.length - 1));
    return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="13" fill="${MUTED}">${tick}</text>`;
  });
  const [kx, ky] = polar(cx, cy, r, end);
  // Glow from two wide, faint strokes: a blur filter costs CoreSVG four times as much per frame.
  const stroke = (width: number, extra = "") =>
    `<path d="${valueArc}" fill="none" stroke="url(#g-${key})" stroke-width="${width}" stroke-linecap="round"${extra}/>`;
  return `
  <path d="${arc(cx, cy, r, START, START + SWEEP)}" fill="none" stroke="${MUTED}" stroke-opacity=".16" stroke-width="18" stroke-linecap="round"/>
  ${fraction > 0.002 ? `${stroke(34, ' opacity=".12"')}${stroke(26, ' opacity=".2"')}${stroke(18)}<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="6" fill="#fff"/>` : ""}
  ${ticks.join("")}
  <text x="${cx}" y="${cy - 44}" text-anchor="middle" font-size="14" letter-spacing="2" fill="${MUTED}">${label.toUpperCase()}</text>
  <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="72" fill="${TEXT}" ${value === "…" ? "" : bold(72)}>${value}</text>
  <text x="${cx}" y="${cy + 56}" text-anchor="middle" font-size="16" fill="${MUTED}">${unit}</text>`;
}

// The curve grows to the right with the progress and doubles as the progress bar.
function chart(samples: Sample[], x: number, y: number, w: number, hgt: number, key: Key) {
  const max = Math.max(...samples.map(([, v]) => v)) * 1.15 || 1;
  const points = samples.map(([p, v]) => `${(x + w * p).toFixed(1)},${(y + hgt - (hgt * v) / max).toFixed(1)}`);
  const front = (x + w * samples[samples.length - 1][0]).toFixed(1);
  return `<path d="M${x},${y + hgt}L${points.join("L")}L${front},${y + hgt}Z" fill="url(#a-${key})"/>
  <path d="M${points.join("L")}" fill="none" stroke="${PHASES[key].to}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function tile(s: State, shown: Shown, key: Key, x: number, y: number, w: number, hgt: number) {
  const active = s.phase === key && !s.error;
  const live = active && key !== "ping";
  const data = key === "ping" ? s.ping : transfer(s, key);
  let value = "—";
  let sub = key === "ping" ? "ms" : "Mbps";
  if (s.ping && key === "ping") {
    value = ms(s.ping.latency);
    sub += ` · jitter ${ms(s.ping.jitter)} ms`;
    if (s.result?.packetLoss != null) sub += ` · loss ${num(s.result.packetLoss, 0)} %`;
  } else if (data && "bandwidth" in data) {
    value = speed(live ? shown.v : mbps(data.bandwidth));
    if (data.latency?.iqm != null) sub += ` · latency ${ms(data.latency.iqm)} ms`;
  }
  // Real samples up to the gliding progress, plus the gliding point as the tip.
  let samples = key === "download" ? s.dl : key === "upload" ? s.ul : [];
  if (live) samples = [...samples.filter(([p]) => p <= shown.p), [shown.p, shown.v]];
  const cx = x + 200;
  const cw = w - 220;
  const cy = y + 16;
  const ch = hgt - 32;
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="16" fill="${MUTED}" fill-opacity=".07" stroke="${active ? `url(#b-${key})` : MUTED}" stroke-opacity="${active ? 1 : 0.14}" stroke-width="${active ? 2 : 1}"/>
  <circle cx="${x + 24}" cy="${y + 27}" r="5" fill="url(#b-${key})"/>
  <text x="${x + 37}" y="${y + 32}" font-size="15" letter-spacing="1.5" fill="${MUTED}">${PHASES[key].label.toUpperCase()}</text>
  <text x="${x + 20}" y="${y + 74}" font-size="40" ${data ? `fill="${TEXT}" ${bold(40)}` : `fill="${MUTED}"`}>${value}</text>
  <text x="${x + 20}" y="${y + 95}" font-size="14" fill="${MUTED}">${sub}</text>
  ${key === "ping" ? "" : `<line x1="${cx}" y1="${cy + ch}" x2="${cx + cw}" y2="${cy + ch}" stroke="${MUTED}" stroke-opacity=".2"/>`}
  ${samples.length > 1 ? chart(samples, cx, cy, cw, ch, key) : ""}`;
}

export function renderSvg(s: State, shown: Shown = target(s)) {
  const defs = Object.entries(PHASES).map(
    ([key, p]) => `
    <linearGradient id="g-${key}" gradientUnits="userSpaceOnUse" x1="${G.cx - G.r}" y1="0" x2="${G.cx + G.r}" y2="0"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient>
    <linearGradient id="b-${key}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient>
    <linearGradient id="a-${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.to}" stop-opacity=".5"/><stop offset="1" stop-color="${p.to}" stop-opacity="0"/></linearGradient>`,
  );
  const keys: Key[] = ["ping", "download", "upload"];
  const tiles = keys.map((key, i) => tile(s, shown, key, 400, 10 + i * 118, 489, 104));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>${defs.join("")}</defs>${gauge(s, shown)}${tiles.join("")}
</svg>`;
}

export function caption(s: State) {
  if (s.error) return s.error;
  const info = s.result || s.start;
  if (!info) return "Finding the best server …";
  const { server, isp } = info;
  const vpn = info.interface?.isVpn ? "via VPN" : null;
  return [server.name, `${server.location}, ${server.country}`, isp, vpn].filter(Boolean).join(" · ");
}

export function summary(result: Result) {
  return [
    `Download ${speed(mbps(result.download.bandwidth))} Mbps`,
    `Upload ${speed(mbps(result.upload.bandwidth))} Mbps`,
    `Ping ${ms(result.ping.latency)} ms`,
    `${result.server.name} (${result.server.location})`,
    result.result?.url,
  ]
    .filter(Boolean)
    .join(" · ");
}
