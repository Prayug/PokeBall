# PokeBall

A browser game where you draft Pokémon (Gen 1 to 9, 578 of them) into a 22-position American football roster, set a depth chart, and then play the games yourself on a 3D field, or simulate a full season and playoffs against 7 AI teams.

Every football rating comes from real Pokémon data: base stats, types, height, weight and abilities. Type matchups change the one-on-one battles on each play.

## Play

Open `dist/index.html` in a browser, keeping the `dist/sprites3d/` folder next to it: the animated sprites load from there on demand, a few Pokémon at a time. There is no server and no network calls besides Google Fonts. Leagues save to the browser's local storage.

Games are played on a 3D field, Madden style: pick a play from the playbook, snap the ball, and control one Pokémon while the AI runs the other 21 using the same ratings and type matchups as the simulator.

| Key | What it does |
| --- | --- |
| `Space` | Snap the ball; juke when you carry it; dive to tackle on defense |
| `W A S D` or arrows | Move your player (leave them alone and your player runs on autopilot) |
| `Shift` | Sprint |
| `1` to `5` | Throw to that receiver (the numbers float over their heads) |
| `T` | Throw it away |
| `E` | Truck a tackler |
| `R` | Spin move |
| `Q` | On defense, switch to the player nearest the ball |
| `1` to `8`, `0`, `-`, `P`, `F` | Between plays, call the play with that key on its card |

The 3D game fills the screen under the scoreboard, with the play caller docked on the near turf: grouped play cards (one marked "Fits this down") between plays, a Snap button once you are lined up, and nothing while the ball is live. On a phone or tablet the field shows a joystick and buttons. Punts, field goals and kickoffs are resolved instantly. "Sim drive", "Sim quarter" and "Sim to the end" (under Skip) still use the fast simulator, and coach mode lets the AI call every down except 3rd and 4th downs and the last two minutes. Without WebGL the game falls back to the original 2D field.

The Pokémon are the animated Black/White pixel sprites (front and back views), drawn crisp at their native pixel size for a Mode 7 look, so a player shows its back while running away from the camera and its front while coming toward it. Pokémon from Gen 6 on have no Black/White animation and use their single-frame pixel sprite with a stronger bob. Sprites stand on upright planes that turn to the camera, stay hidden until their image has loaded, play their idle loop in place and step through it with distance covered when moving. On top of that, every player is posed from what it is doing: running strides that lean into cuts, the ball tucked by the carrier or up by the quarterback's ear, wind-up and release on throws, reaching and securing catches, jukes and spins with afterimages, lowered-shoulder trucks that bowl tacklers over, blocking shoves, diving and wrap-up tackles that leave the carrier lying on the turf, a crouch on the snap, a laced football that spirals in flight, dazed stars, and a touchdown celebration. Each sprite has a team-colored outline.

Ball carriers have three moves, each better in a different spot: a juke beats a tackler coming from the side, a spin beats one coming head-on, and a truck works when the carrier is stronger and heavier. AI carriers pick between them the same way.

## Ratings

Attributes come from base stats, height and weight, graded on a curve against the whole non-legendary pool: 60 is average, 80 is very good, 99 is the best in the league. Position overalls are graded the same way per position, centered on 50, so a 99 is the best at that spot, an 80 is a solid starter and a 50 is a backup. Legendaries, mythicals, Ultra Beasts and Paradox Pokémon are flagged as legendary (off by default, one per team).

Ratings decide games: in the live game a strong lineup (about 80 overall) beats a good one (about 74) roughly 9 times in 10, and the simulator is similar. `test/tiers.mjs` measures this.

## Layout

| Path | What it holds |
| --- | --- |
| `src/engine.js` | Play-by-play simulation: line battles, coverage, completions, tackles, clock, scoring, AI play calling |
| `src/live.js` | Live plays: 22 Pokémon moving in real time with blocking, routes, man and zone coverage, throws, catches and tackles |
| `src/field3d.js` | The three.js stadium: field, animated sprite billboards, camera, ball and markers |
| `src/league.js` | Snake draft, AI drafters, schedule, standings, playoffs, league leaders |
| `src/ratings.js` | Base stats to football attributes, the 22 slots, position overalls, auto depth chart |
| `src/types.js` | Type chart, type traits, weather and the curated abilities |
| `src/app.js`, `src/index.html` | The screens and styles |
| `src/data.js`, `src/sprites.js`, `src/sprites3d.js` | Generated Pokémon data, menu sprites and the index of the animated sprite strips (do not edit by hand) |
| `dist/sprites3d/` | The animated sprite strips, three Pokémon per file, loaded on demand |
| `build/build_data.py` | Regenerates `data.js` from PokéAPI CSVs |
| `build/build_sprites3d.py` | Regenerates `sprites3d.js` and `sprites.js` from the PokeAPI pixel sprites |
| `build/build.sh` | Bundles `src/` into `dist/index.html` with esbuild |
| `test/balance.mjs` | Simulates games between AI-drafted teams and prints league averages |
| `test/live.mjs` | Plays full games where every run and pass is a live play on autopilot, and prints the same averages |
| `test/top.mjs` | Lists the top Pokémon at each position |
| `test/tiers.mjs` | Plays teams from different tiers of the pool against each other to show how much ratings matter |

## Build

```sh
npm install                         # three.js
bash build/build.sh                 # uses npx esbuild@0.24.0, or set ESBUILD=/path/to/esbuild
node test/balance.mjs 10000         # balance check of the simulator
node test/live.mjs 20               # balance check of live plays
node test/tiers.mjs 300             # how much ratings matter (add `live` for live plays)
```

To regenerate the Pokémon data, download the PokéAPI CSVs (`pokemon`, `pokemon_species`, `pokemon_species_names`, `pokemon_stats`, `pokemon_types`, `pokemon_abilities`, `ability_names`, `types`) from `PokeAPI/pokeapi` `data/v2/csv/` into a folder, then run:

```sh
python3 build/build_data.py <csv_dir> src
python3 build/build_sprites3d.py <gif_cache_dir> src dist   # downloads the GIFs it does not have yet
```

Gen 1–5 use the animated Black/White GIFs; later Pokémon use the static pixel PNGs.

## Balance

Last run over 4,000 simulated games: 23.4 points per team, 61.7% completions, 6.8 yards per pass attempt, 4.3 yards per carry, 4.6% sack rate and 3.4% interception rate.

Live plays with every Pokémon on autopilot now land in the same range (about 24 points per team, 61% completions, 6.9 yards per attempt, 3.7 yards per carry, 4.7% sacks). Deep defenders keep their cushion, pursuers close on the ball and long runs tire the carrier, so only a truly faster player breaks away.

Pokémon data comes from [PokéAPI](https://pokeapi.co); the pixel sprites come from [PokeAPI/sprites](https://github.com/PokeAPI/sprites). The 3D field uses [three.js](https://threejs.org). Pokémon is © Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project.
