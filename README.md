# PokeBall

A browser game where you draft Pokémon (Gen 1 to 4) into a 22-position American football roster, set a depth chart, and then play the games yourself on a 3D field, or simulate a full season and playoffs against 7 AI teams.

Every football rating comes from real Pokémon data: base stats, types, height, weight and abilities. Type matchups change the one-on-one battles on each play.

## Play

Open `dist/index.html` in a browser. It is one self-contained file with no server and no network calls besides Google Fonts. Leagues save to the browser's local storage.

Games are played on a 3D field, Madden style: pick a play from the playbook, snap the ball, and control one Pokémon while the AI runs the other 21 using the same ratings and type matchups as the simulator.

| Key | What it does |
| --- | --- |
| `Space` | Snap the ball; juke when you carry it; dive to tackle on defense |
| `W A S D` or arrows | Move your player (leave them alone and your player runs on autopilot) |
| `Shift` | Sprint |
| `1` to `5` | Throw to that receiver (the numbers float over their heads) |
| `T` | Throw it away |
| `E` | Truck a tackler |
| `Q` | On defense, switch to the player nearest the ball |

On a phone or tablet the field shows a joystick and buttons. Punts, field goals and kickoffs are resolved instantly. "Sim drive", "Sim quarter" and "Sim to the end" still use the fast simulator, and coach mode lets the AI call every down except 3rd and 4th downs and the last two minutes. Without WebGL the game falls back to the original 2D field.

The Pokémon are the animated 3D-model sprites from Pokémon Showdown (front and back views), so a player shows its back while running away from the camera and its front while coming toward it.

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
| `src/data.js`, `src/sprites.js`, `src/sprites3d.js` | Generated Pokémon data, menu sprites and animated 3D sprite strips (do not edit by hand) |
| `build/build_data.py` | Regenerates `data.js` from PokéAPI CSVs |
| `build/build_sprites3d.py` | Regenerates `sprites3d.js` and `sprites.js` from the Showdown 3D sprites |
| `build/build.sh` | Bundles `src/` into `dist/index.html` with esbuild |
| `test/balance.mjs` | Simulates games between AI-drafted teams and prints league averages |
| `test/live.mjs` | Plays full games where every run and pass is a live play on autopilot, and prints the same averages |
| `test/top.mjs` | Lists the top Pokémon at each position |

## Build

```sh
npm install                         # three.js
bash build/build.sh                 # uses npx esbuild@0.24.0, or set ESBUILD=/path/to/esbuild
node test/balance.mjs 10000         # balance check of the simulator
node test/live.mjs 20               # balance check of live plays
```

To regenerate the Pokémon data, download the PokéAPI CSVs (`pokemon`, `pokemon_species`, `pokemon_species_names`, `pokemon_stats`, `pokemon_types`, `pokemon_abilities`, `ability_names`, `types`) from `PokeAPI/pokeapi` `data/v2/csv/` into a folder, then run:

```sh
python3 build/build_data.py <csv_dir> <sprite_cache_dir> src
python3 build/build_sprites3d.py <gif_cache_dir> src   # downloads the GIFs it does not have yet
```

`build_data.py` also rewrites `sprites.js` with the older flat sprites, so run `build_sprites3d.py` after it.

## Balance

Last run over 8,750 simulated games: 23.4 points per team, 64.9% completions, 7.5 yards per pass attempt, 4.2 yards per carry, 7.3% sack rate and 2.8% interception rate.

Live plays with every Pokémon on autopilot run a bit hotter (about 30 points per team, 57% completions, 9 yards per attempt, 4.2 yards per carry, 3% sacks), mostly from deep balls that turn into long touchdowns.

Pokémon data comes from [PokéAPI](https://pokeapi.co); the animated 3D sprites are Pokémon Showdown's, as mirrored in [PokeAPI/sprites](https://github.com/PokeAPI/sprites). The 3D field uses [three.js](https://threejs.org). Pokémon is © Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project.
