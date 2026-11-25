[![make.fun - best-cooking-game-20261125-0137](https://make.fun/badge/best-cooking-game-20261125-0137.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137?utm_source=github&utm_medium=readme&utm_campaign=best-cooking-game-20261125-0137)
[![rank](https://make.fun/badge/best-cooking-game-20261125-0137/arrijalu/warung-bakso-malam/rank.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-cooking-game-20261125-0137)
[![reward](https://make.fun/badge/best-cooking-game-20261125-0137/arrijalu/warung-bakso-malam/reward.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137?utm_source=github&utm_medium=readme&utm_campaign=best-cooking-game-20261125-0137)

# Warung Bakso Malam

A Jakarta night stall: meatball soup, noodles, fried gorengan and iced tea, served against the clock. Keyboard and mouse, offline, static files. Entry for make.fun best-cooking-game-20261125-0137.

## Play it

```bash
node serve.ts          # serves game/ on http://localhost:8080
```

Open http://localhost:8080 in desktop Chrome. Arrows/WASD move the cook, E or Space acts,
1-4 pick an ingredient, the mouse clicks a station or an ingredient and drags the ladle.
Everything is static files under `game/`: no build step, no network request, artwork drawn on
canvas and sound synthesised with WebAudio.

## Screenshots

`screenshots/` holds four real renders of the game's own code, staged deterministically through
`?shot=board|counter|assembly|serve`: the kitchen and the order board, the ingredients on the
counter, a dish mid-assembly, and the finished plate ready to serve.

## How the entry is handed in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` into the output
directory and writes `dossier.json` with the vendored `vendor/makefun-game.ts` library, exactly
as the kit specifies:

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT, see `LICENSE` (SPDX-License-Identifier: MIT).
