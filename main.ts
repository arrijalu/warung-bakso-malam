// Warung Bakso Malam — night stall cooking simulation game where players prepare
// and serve traditional Indonesian meatball soup (bakso), noodles, fried snacks,
// and iced tea to hungry night-market customers against the clock.
//
// Four screenshot scenes:
//   1. 1-board.jpg — Order board and night stall exterior overview
//   2. 2-counter.jpg — Food preparation and ingredient counter station
//   3. 3-assembly.jpg — Bowl assembly station combining broth, noodles, and meatballs
//   4. 4-serve.jpg — Serving station and customer satisfaction feedback
//
// Build entrypoint (Node 22, standard library only): copies game/ and screenshots/
// to MAKEFUN_OUTPUT_DIR (default /output) and writes dossier.json using buildDossier.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, readGameTree } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const indexHtmlPath = join(here, 'game', 'index.html');
if (!existsSync(indexHtmlPath)) {
  console.error('Error: game/index.html is missing. Warung Bakso Malam build aborted.');
  process.exit(1);
}

const srcDir = join(here, 'game', 'src');
if (!existsSync(srcDir)) {
  console.error('Error: game/src directory is missing.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });

mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

const tree = readGameTree(join(out, 'game'));
const screenshotsCount = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).filter((f) => !f.startsWith('.')).length
  : 0;

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(
  `Warung Bakso Malam build complete: shipped game (${tree.count} entries, ${tree.totalBytes} bytes) and ${screenshotsCount} screenshots to ${out}, wrote dossier.json.`
);
