// npm test [-- ordner]: prüft Parsen und Gleiten an einem echten CLI-Lauf und schreibt
// optional die SVG-Zwischenstände in [ordner], um sie anzusehen.
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
  error: parse('{"type":"log","level":"error","message":"Keine Server erreichbar"}', 1),
};
assert.deepEqual(
  Object.fromEntries(Object.entries(states).map(([k, s]) => [k, s.phase])),
  { connecting: "connecting", ping: "ping", download: "download", upload: "upload", done: "done", error: "connecting" },
);
assert.equal(states.error.error, "Keine Server erreichbar");
assert.equal(states.done.error, null);
assert.match(states.done.result?.result?.url ?? "", /^https:\/\/www\.speedtest\.net\/result\//);
assert.ok(states.download.dl.length > 10 && states.upload.ul.length > 10);
// Eine halb geschriebene letzte Zeile ist während des Laufs kein Fehler, nach Prozessende schon.
assert.equal(parse(lines.slice(0, 40).join("\n") + '\n{"type":"downl').error, null);
assert.equal(parse("Unbekannte Option", 2).error, "Unbekannte Option");
assert.equal(parse("", 1).error, "speedtest endete mit Code 1");

// Gleiten: Phasenwechsel übernimmt den Fortschritt sofort, der Wert gleitet, rastet ein und
// liefert dann dasselbe Objekt, damit React nicht neu rendert.
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
