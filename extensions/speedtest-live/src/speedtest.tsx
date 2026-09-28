// Tinycast liefert die Ausgabe von spawn() erst nach Prozessende. Deshalb schreibt die
// Ookla-CLI ihre JSON-Zeilen in eine Datei; die Ansicht liest sie alle 100 ms und lässt die
// Anzeige zu den neuen Messwerten gleiten.
// Gezeichnet wird in einer Grid-Kachel: Deren Bild behält in Tinycast 0.11 sein letztes Frame,
// bis das nächste dekodiert ist. Ein Markdown-Bild würde bei jedem Wechsel kurz leer blinken.
import { Action, ActionPanel, Grid, Icon, environment, updateCommandMetadata } from "@raycast/api";
import { Buffer } from "buffer";
import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { useEffect, useRef, useState } from "react";
import { promisify } from "util";
import { FRAME_MS, PHASES, State, caption, mbps, parse, renderSvg, speed, step, summary, target } from "./dashboard";

const CLI_PATHS = ["/opt/homebrew/bin/speedtest", "/usr/local/bin/speedtest"];
const OOKLA_URL = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-universal.tgz";
const OOKLA_SHA256 = "c9f8192149ebc88f8699998cecab1ce144144045907ece6f53cf50877f4de66f";
const POLL_MS = 100;
// Tinycast nimmt jedes Seitenverhältnis; Raycasts Typ kennt nur eine feste Auswahl.
const ASPECT_RATIO = "5/2" as Grid.AspectRatio;

// Eine installierte CLI hat Vorrang; sonst lädt die Erweiterung die Ookla-CLI einmalig in
// ihren Support-Ordner, geprüft gegen die Prüfsumme.
async function ookla() {
  const installed = CLI_PATHS.find((p) => fs.existsSync(p));
  if (installed) return installed;
  const dir = path.join(environment.supportPath, "cli");
  const bin = path.join(dir, "speedtest");
  if (fs.existsSync(bin)) return bin;
  const response = await fetch(OOKLA_URL);
  if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== OOKLA_SHA256) throw new Error("Prüfsumme stimmt nicht");
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, "ookla.tgz");
  fs.writeFileSync(archive, data);
  await promisify(execFile)("/usr/bin/tar", ["-xzf", archive, "-C", dir, "speedtest"]);
  fs.rmSync(archive, { force: true });
  fs.chmodSync(bin, 0o755);
  return bin;
}

// Startet eine Messung und meldet jeden neu gelesenen Stand; gibt das Aufräumen zurück.
function measure(cli: string, onState: (state: State) => void) {
  // Schließt Tinycast die Palette mitten im Lauf, entfällt das Aufräumen unten; Reste gehen hier.
  for (const name of fs.readdirSync(environment.supportPath)) {
    if (name.startsWith("run-")) fs.rmSync(path.join(environment.supportPath, name), { force: true });
  }
  // Eigene Datei je Lauf: Ein abgebrochener Vorgänger schreibt sonst in die neue hinein.
  const file = path.join(environment.supportPath, `run-${Date.now()}.jsonl`);
  fs.writeFileSync(file, "");
  let seen = -1;
  const read = (exitCode?: number) => {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      // Datei schon aufgeräumt.
    }
    if (text.length === seen && exitCode === undefined) return;
    seen = text.length;
    onState(parse(text, exitCode));
  };
  const child = spawn("/bin/sh", [
    "-c",
    'exec "$0" --accept-license --accept-gdpr --format=jsonl --progress=yes >"$1" 2>&1',
    cli,
    file,
  ]);
  const timer = setInterval(read, POLL_MS);
  child.on("close", (code) => {
    clearInterval(timer);
    read(code ?? 1);
    fs.rmSync(file, { force: true });
  });
  return () => {
    clearInterval(timer);
    child.kill();
    fs.rmSync(file, { force: true });
  };
}

export default function Command() {
  const [run, setRun] = useState(0);
  const [state, setState] = useState(() => parse(""));
  const [shown, setShown] = useState(() => target(state));
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    setState(parse(""));
    fs.mkdirSync(environment.supportPath, { recursive: true });
    ookla()
      .then((cli) => {
        if (alive) stop = measure(cli, (next) => alive && setState(next));
      })
      .catch((error: Error) => alive && setState({ ...parse(""), error: `Ookla-CLI: ${error.message}` }));
    return () => {
      alive = false;
      stop();
    };
  }, [run]);

  useEffect(() => {
    const timer = setInterval(() => setShown((prev) => step(prev, target(latest.current))), FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.result) {
      const { download, upload } = state.result;
      updateCommandMetadata({ subtitle: `↓ ${speed(mbps(download.bandwidth))}  ↑ ${speed(mbps(upload.bandwidth))} Mbit/s` });
    }
  }, [state.result]);

  const running = !state.result && !state.error;
  const current = state.phase === "ping" ? state.ping : state.phase === "download" ? state.download : state.upload;
  const progress = current?.progress ?? 0;
  const title = state.error
    ? "Speedtest · Fehler"
    : state.result
      ? "Speedtest · Fertig"
      : state.phase === "connecting"
        ? "Speedtest · Verbinde …"
        : `Speedtest · ${PHASES[state.phase === "done" ? "download" : state.phase].label} ${Math.round(progress * 100)} %`;
  const url = state.result?.result?.url;

  return (
    <Grid
      columns={1}
      aspectRatio={ASPECT_RATIO}
      filtering={false}
      isLoading={running}
      navigationTitle={title}
      searchBarPlaceholder="Speedtest"
    >
      <Grid.Item
        id="speedtest"
        content={`data:image/svg+xml;base64,${Buffer.from(renderSvg(state, shown)).toString("base64")}`}
        title={caption(state)}
        actions={
          <ActionPanel>
            <Action
              title={running ? "Neu starten" : "Erneut testen"}
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={() => setRun((n) => n + 1)}
            />
            {url && <Action.OpenInBrowser title="Ergebnis auf speedtest.net öffnen" url={url} />}
            {state.result && (
              <Action.CopyToClipboard
                title="Ergebnis kopieren"
                content={summary(state.result)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            )}
          </ActionPanel>
        }
      />
    </Grid>
  );
}
