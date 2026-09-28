// Tinycast liefert die Ausgabe von spawn() erst nach Prozessende. Deshalb schreibt die
// Ookla-CLI ihre JSON-Zeilen in eine Datei; die Ansicht liest sie alle 100 ms und lässt die
// Anzeige zu den neuen Messwerten gleiten.
// Gezeichnet wird in einer Grid-Kachel: Deren Bild behält in Tinycast 0.11 sein letztes Frame,
// bis das nächste dekodiert ist. Ein Markdown-Bild würde bei jedem Wechsel kurz leer blinken.
import { Action, ActionPanel, Detail, Grid, Icon, environment, updateCommandMetadata } from "@raycast/api";
import { Buffer } from "buffer";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { useEffect, useRef, useState } from "react";
import { FRAME_MS, PHASES, caption, mbps, parse, renderSvg, speed, step, summary, target } from "./dashboard";

const CLI_PATHS = ["/opt/homebrew/bin/speedtest", "/usr/local/bin/speedtest"];
const POLL_MS = 100;
// Tinycast nimmt jedes Seitenverhältnis; Raycasts Typ kennt nur eine feste Auswahl.
const ASPECT_RATIO = "5/2" as Grid.AspectRatio;

export default function Command() {
  const [cli] = useState(() => CLI_PATHS.find((p) => fs.existsSync(p)));
  const [run, setRun] = useState(0);
  const [state, setState] = useState(() => parse(""));
  const [shown, setShown] = useState(() => target(state));
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!cli) return;
    fs.mkdirSync(environment.supportPath, { recursive: true });
    // Eigene Datei je Lauf: Ein abgebrochener Vorgänger schreibt sonst in die neue hinein.
    const file = path.join(environment.supportPath, `run-${Date.now()}.jsonl`);
    fs.writeFileSync(file, "");
    let alive = true;
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
      if (alive) setState(parse(text, exitCode));
    };
    setState(parse(""));
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
      alive = false;
      clearInterval(timer);
      child.kill();
      fs.rmSync(file, { force: true });
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

  if (!cli) {
    return (
      <Detail
        navigationTitle="Speedtest"
        markdown={"# Ookla-CLI fehlt\n\nInstallieren mit:\n\n```\nbrew install teamookla/speedtest/speedtest\n```"}
      />
    );
  }

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
