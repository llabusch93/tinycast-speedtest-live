<div align="center">

<img src="extensions/speedtest-live/assets/icon.png" width="96" alt="">

# Speedtest Live for Tinycast

**Ping, download and upload in real time, with a gauge, history curves and a smooth display.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/dashboard-dark.png">
  <img src="docs/dashboard-light.png" alt="Dashboard with a gauge on the left and tiles for ping, download and upload on the right">
</picture>

</div>

## Why

[Tinycast](https://github.com/abue-ammar/tinycast) runs Raycast extensions natively, but it only hands
over the output of `child_process.spawn` once the process has exited. Speedtest extensions therefore
show nothing for half a minute and then only the final result.

Speedtest Live works around that: the Ookla CLI writes its samples to a file, the extension reads it
ten times per second and draws the dashboard from it. The needle, the numbers and the curves glide to
every new sample instead of jumping.

## Features

- **Gauge** with the speedtest.net scale from 0 to 1000 Mbps for the running phase
- **Tiles** for ping, download and upload; the active phase is highlighted
- **History curves** that grow with the test progress and double as progress bars
- **Details** on jitter, packet loss and loaded latency
- **Server, location and provider** below the dashboard, with a hint when you are on a VPN
- **Last result** as the command subtitle in the launcher
- Light and dark appearance

## Requirements

- [Tinycast](https://github.com/abue-ammar/tinycast), tested with 0.11.3
- The extension takes care of the Ookla Speedtest CLI: if it is installed via Homebrew
  (`brew install teamookla/speedtest/speedtest`), that one is used. Otherwise the extension downloads
  Ookla CLI 1.2.0 from `install.speedtest.net` on first launch and verifies it against a pinned
  SHA256 checksum.
- Only for installing from a registry: Node.js and a package manager (pnpm, Bun, Yarn or npm).
  Tinycast builds the extension from source in that case.

## Installation

### From the Tinycast settings

1. Open **Settings → Extensions → Install**.
2. Under **Registries**, add the repository `llabusch93/tinycast-speedtest-live`.
3. Under **Search Registries**, search for “speedtest” and install **Speedtest Live**.

### From a release

Download `speedtest-live.zip` from the [releases](https://github.com/llabusch93/tinycast-speedtest-live/releases)
and unzip it. Then choose **Settings → Extensions → Install → Add from folder** in Tinycast and pick the
unzipped `speedtest-live` folder. No Node.js required.

### From source

```bash
git clone https://github.com/llabusch93/tinycast-speedtest-live.git
cd tinycast-speedtest-live/extensions/speedtest-live
npm install
npm run build
```

Then choose **Settings → Extensions → Install → Add from folder** in Tinycast and pick
`extensions/speedtest-live/dist`.

## Usage

Open **Speedtest** in the launcher; the test starts right away.

| Key | Action |
| --- | --- |
| <kbd>↩</kbd> or <kbd>⌘</kbd> <kbd>R</kbd> | Restart the test |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>C</kbd> | Copy the result as text |
| <kbd>⌘</kbd> <kbd>K</kbd> | More actions, e.g. open the result on speedtest.net |
| <kbd>esc</kbd> | Close; a running test is stopped |

## How it works

- The Ookla CLI runs with `--format=jsonl --progress=yes` and writes about nine samples per second to
  a file in the extension's support folder. The file is deleted after the run.
- The dashboard is an SVG in a single grid tile. Unlike a markdown image, a grid tile in Tinycast
  keeps its last image until the next one is ready, so nothing flickers between frames.
- The display is redrawn about 15 times per second and glides to the latest sample with a time
  constant of about 150 ms. Set the frame rate with `FRAME_MS` in
  [`src/dashboard.ts`](extensions/speedtest-live/src/dashboard.ts).
- The SVG uses no blur filter: the gauge glow is made of two faint, wide strokes, which is about four
  times cheaper to draw.

## Development

```bash
cd extensions/speedtest-live
npm install
npm test         # checks parsing and gliding against a recorded test run
npm run build    # builds into dist/
```

`npm test -- <dir>` also writes the SVG states (connecting, ping, download, upload, done, error) to the
given folder.

## Notes

- The extension passes `--accept-license --accept-gdpr` to the Ookla CLI. By running a test you accept
  Ookla's [license](https://www.speedtest.net/about/eula) and [privacy policy](https://www.speedtest.net/about/privacy).
- Not an official product of Ookla, Raycast or Tinycast. Speedtest® is a trademark of Ookla.

## License

[MIT](LICENSE)
