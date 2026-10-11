# PokeBall

A browser game where you draft Pokémon (Gen 1 to 4) into a 22-position American football roster, set a depth chart, and call plays or simulate a full season and playoffs against 7 AI teams.

Every football rating comes from real Pokémon data: base stats, types, height, weight and abilities. Type matchups change the one-on-one battles on each play.

## Play

Open `dist/index.html` in a browser. It is one self-contained file with no server and no network calls besides Google Fonts. Leagues save to the browser's local storage.

## Layout

| Path | What it holds |
| --- | --- |
| `src/engine.js` | Play-by-play simulation: line battles, coverage, completions, tackles, clock, scoring, AI play calling |
| `src/league.js` | Snake draft, AI drafters, schedule, standings, playoffs, league leaders |
| `src/ratings.js` | Base stats to football attributes, the 22 slots, position overalls, auto depth chart |
| `src/types.js` | Type chart, type traits, weather and the curated abilities |
| `src/app.js`, `src/index.html` | The screens and styles |
| `src/data.js`, `src/sprites.js` | Generated Pokémon data and sprites (do not edit by hand) |
| `build/build_data.py` | Regenerates `data.js` and `sprites.js` from PokéAPI CSVs and sprites |
| `build/build.sh` | Bundles `src/` into `dist/index.html` with esbuild |
| `test/balance.mjs` | Simulates games between AI-drafted teams and prints league averages |
| `test/top.mjs` | Lists the top Pokémon at each position |

## Build

```sh
bash build/build.sh                 # uses npx esbuild@0.24.0, or set ESBUILD=/path/to/esbuild
node test/balance.mjs 10000         # balance check
```

To regenerate the Pokémon data, download the PokéAPI CSVs (`pokemon`, `pokemon_species`, `pokemon_species_names`, `pokemon_stats`, `pokemon_types`, `pokemon_abilities`, `ability_names`, `types`) from `PokeAPI/pokeapi` `data/v2/csv/` into a folder, then run:

```sh
python3 build/build_data.py <csv_dir> <sprite_cache_dir> src
```

## Balance

Last run over 8,750 simulated games: 23.4 points per team, 64.9% completions, 7.5 yards per pass attempt, 4.2 yards per carry, 7.3% sack rate and 2.8% interception rate.

Pokémon data and sprites come from [PokéAPI](https://pokeapi.co). Pokémon is © Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project.
