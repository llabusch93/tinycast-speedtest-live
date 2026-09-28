// npm test [-- dir]: checks parsing and gliding against a recorded CLI run and optionally
// writes the SVG states to [dir] for a visual check.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse, renderSvg, step, target } from "../src/dashboard.ts";

const lines = fs.readFileSync(path.join(import.meta.dirname, "sample.jsonl"), "utf8").trim().split("\n");
const at = (n: number) => parse(lines.slice(0, n).join("\n"));
const firstUpload = lines.findIndex((l) => l.includes('"type":"upload"'));

const states = {
  connecting: at(0),
  ping: at(3),
  download: at(40),
  upload: at(firstUpload + 60),
  done: parse(lines.join("\n") + "\n", 0),
  error: parse('{"type":"log","level":"error","message":"No servers available"}', 1),
};
assert.deepEqual(
  Object.fromEntries(Object.entries(states).map(([k, s]) => [k, s.phase])),
  { connecting: "connecting", ping: "ping", download: "download", upload: "upload", done: "done", error: "connecting" },
);
assert.equal(states.error.error, "No servers available");
assert.equal(states.done.error, null);
assert.match(states.done.result?.result?.url ?? "", /^https:\/\/www\.speedtest\.net\/result\//);
assert.ok(states.download.dl.length > 10 && states.upload.ul.length > 10);
// A half-written last line is no error while running, but it is once the process has exited.
assert.equal(parse(lines.slice(0, 40).join("\n") + '\n{"type":"downl').error, null);
assert.equal(parse("Unknown option", 2).error, "Unknown option");
assert.equal(parse("", 1).error, "speedtest exited with code 1");

// Gliding: a phase change takes the progress at once, the value glides, settles and then
// returns the same object so React skips the render.
const goal = target(states.upload);
let shown = step(target(states.download), goal);
assert.equal(shown.phase, "upload");
assert.equal(shown.p, goal.p);
assert.notEqual(shown.v, goal.v);
for (let i = 0; i < 200; i++) shown = step(shown, goal);
assert.equal(shown.v, goal.v);
assert.equal(step(shown, goal), shown);

const out = process.argv[2];
for (const [name, state] of Object.entries(states)) {
  const svg = renderSvg(state);
  assert.ok(!/NaN|undefined/.test(svg), `${name}: ${svg.match(/.{40}(NaN|undefined).{20}/)?.[0]}`);
  if (out) fs.writeFileSync(path.join(out, `${name}.svg`), svg);
}
console.log("ok");
