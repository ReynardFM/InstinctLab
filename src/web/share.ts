// Run links: everything needed to rebuild a run to the exact same moment, in the part of the address
// after "#". Same seed + same rules + same number of steps = the same world, in any browser (dmath.ts).
//   #s=42&r=food:80,poison:0.5&at=13500&b=<brain>
// s = seed text, r = rules that differ from the defaults, at = steps taken since the run started,
// b = the saved brain every creature started from (hall of fame), exact to the last bit.
import { DEFAULT_RULES, type Rules } from "../engine/world.ts";

export interface RunLink {
  seed: string;
  rules: Rules;
  steps: number;
  start: number[] | null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // URL-safe base64

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("bad brain data in the link");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return new Uint8Array(bytes);
}

// A brain as 8 bytes per weight (little-endian doubles), so it comes back bit for bit.
export function brainToText(genome: number[]): string {
  const view = new DataView(new ArrayBuffer(genome.length * 8));
  genome.forEach((x, i) => view.setFloat64(i * 8, x, true));
  return toBase64(new Uint8Array(view.buffer));
}

export function brainFromText(text: string): number[] {
  const bytes = fromBase64(text);
  if (bytes.length % 8 !== 0) throw new Error("bad brain data in the link");
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 8 }, (_, i) => view.getFloat64(i * 8, true));
}

export function encodeLink(link: RunLink): string {
  const changed = (Object.keys(DEFAULT_RULES) as (keyof Rules)[])
    .filter((k) => link.rules[k] !== DEFAULT_RULES[k])
    .map((k) => `${k}:${link.rules[k]}`);
  const parts = [`s=${encodeURIComponent(link.seed)}`];
  if (changed.length) parts.push(`r=${changed.join(",")}`);
  parts.push(`at=${link.steps}`);
  if (link.start) parts.push(`b=${brainToText(link.start)}`);
  return `#${parts.join("&")}`;
}

// Reads a link (with or without the leading "#"). Unknown rules are ignored (links from other versions);
// returns null when there is no run in it.
export function decodeLink(hash: string): RunLink | null {
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, "").split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (!params.has("s")) return null;
  const rules: Rules = { ...DEFAULT_RULES };
  for (const pair of (params.get("r") ?? "").split(",")) {
    const [k, v] = pair.split(":");
    if (k in DEFAULT_RULES && v !== undefined && Number.isFinite(Number(v))) rules[k as keyof Rules] = Number(v);
  }
  const steps = Math.max(0, Math.floor(Number(params.get("at") ?? 0)) || 0);
  const b = params.get("b");
  return { seed: decodeURIComponent(params.get("s")!), rules, steps, start: b ? brainFromText(b) : null };
}
