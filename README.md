# PokeBall

A browser game where you draft Pokémon (Gen 1 to 9, 578 of them) into a 22-position American football roster, set a depth chart, and then play the games yourself on a 3D field, or simulate a full season and playoffs against 7 AI teams.

Every football rating comes from real Pokémon data: base stats, types, height, weight and abilities. Type matchups change the one-on-one battles on each play.

## Play

Open `dist/index.html` in a browser, keeping the `dist/sprites3d/` folder next to it: the back views of the Pokémon load from there on demand, a few Pokémon at a time. There is no server and no network calls besides Google Fonts. Leagues save to the browser's local storage.

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
| `Esc` | Before the snap, take the call back and pick another; closes the menu |
| `C` | Cycle the camera: Broadcast, Sideline, Behind the QB, Tactical |
| `M` | Open the game menu (coach mode, sim controls, camera, graphics, weather, controls, box score) |

The stadium fills the screen under a broadcast scoreboard (teams, score, possession, quarter, clock, down and distance, ball spot and a 40-second play clock that snaps the ball for you when it runs out). Between plays a compact call sheet slides up from the bottom: plays grouped by formation and run or pass, each card with its play art drawn from the real assignments (routes, run lane, blocks, zones, man coverage, rushers), its shortcut key, and a "Fits" tag on the call that suits the down. After the call both teams jog from where the last play ended into the formation, and the field shows the play art, receiver numbers, the line of scrimmage in blue and the first-down line in yellow until the snap. Everything else lives in the menu. On a phone or tablet the field shows a joystick and buttons. Punts, field goals and kickoffs are resolved instantly. "Sim drive", "Sim quarter" and "Sim to the end" still use the fast simulator, and coach mode lets the AI call every down except 3rd and 4th downs and the last two minutes. Without WebGL the game falls back to the original 2D field.

### The 3D field

The game is a real three.js scene in yards, with one coordinate system for the field, the players, the ball and the camera: a sky dome, sun and fill lights with soft shadows, ACES tone mapping, a striped field with numbers, hashes, two-point lines, end zones painted with team names and a Poké Ball at midfield, pylons, goalposts, sidelines with benches, a banner wall, three-deck stands with an instanced crowd that bobs and cheers, light towers, and rain, hail, sun or sandstorm when the game has weather. The renderer lowers its resolution when frames run long and raises it when there is room (or pick High or Fast in the menu).

The camera works like a TV broadcast: behind the offense and above it, eased toward the ball, pulling back on deep passes and lifting itself over anyone in its way. Sideline, Behind the QB and Tactical are the other views.

### The Pokémon figures

No licensed 3D Pokémon models are available to this project, so every Pokémon is a **generated placeholder figure**, built in the browser from its official pixel sprite: the silhouette is inflated into a rounded 3D body (thicker in the middle, thinner at the edges), painted with the front sprite on the front and the back sprite on the back, auto-rigged with hips, chest, head, arms and legs, and scaled to the Pokémon's real height and weight. They are not Game Freak models and are not meant to look like them; they are a stand-in so every one of the 578 Pokémon has a 3D body with feet on the turf, shadows and a skeleton. `src/figure3d.js` has a `MODEL_INDEX` hook where licensed GLB/glTF models can be dropped in per species later, and the animation system drives the same named bones.

Animation is a state machine over that skeleton (`src/anim3d.js`): idle, pre-snap stance (three-point on the line), run and sprint with stride length from body size, turning leans, blocking, and layers for carrying the ball, the quarterback's ball by the ear, throwing, reaching for catches, jukes, spins, trucks, being stunned, diving tackles, falling the way the hit came from, getting back up and celebrating. Flying and levitating Pokémon hover above the turf. Players turn at a rate that depends on agility, so nobody snaps around or slides.

### Formations and contact

Every play starts from a formation set from the ball: singleback with the quarterback under center and the back behind it, or shotgun with the quarterback five yards back and the back beside him (shotgun snaps fly back to the quarterback). Linemen are spaced by their body size, so a Snorlax takes up more of the line than a Pikachu, and nobody spawns on top of anyone. During the play bodies push each other apart, blocks engage at body distance and tackles reach from body edge to body edge.

Ball carriers have three moves, each better in a different spot: a juke beats a tackler coming from the side, a spin beats one coming head-on, and a truck works when the carrier is stronger and heavier. AI carriers pick between them the same way.

## Ratings

Attributes come from base stats, height and weight, graded on a curve against the whole non-legendary pool: 60 is average, 80 is very good, 99 is the best in the league. There are 13: Speed, Acceleration, Agility, Strength, Blocking, Pass rush, Throwing, Accuracy, Catching, Coverage, Tackling, Awareness and Stamina. In the live game Speed sets top speed, Acceleration how fast a player gets there, Agility how sharply it cuts and turns, Awareness how quickly quarterbacks read and defenders react, and height and weight set body size, which decides spacing, blocking and tackling reach. Position overalls are graded the same way per position, centered on 50, so a 99 is the best at that spot, an 80 is a solid starter and a 50 is a backup. Legendaries, mythicals, Ultra Beasts and Paradox Pokémon are flagged as legendary (off by default, one per team).

Ratings decide games: in the live game a strong lineup (about 80 overall) beats a good one (about 74) roughly 9 times in 10, and the simulator is similar. `test/tiers.mjs` measures this.

## Layout

| Path | What it holds |
| --- | --- |
| `src/engine.js` | Play-by-play simulation: line battles, coverage, completions, tackles, clock, scoring, AI play calling |
| `src/live.js` | Live plays: 22 Pokémon moving in real time with blocking, routes, man and zone coverage, throws, catches and tackles |
| `src/field3d.js` | The 3D stage: players, ball, play art, markers and effects, driven by the live play |
| `src/stadium3d.js` | Field, stands, crowd, lights and weather |
| `src/camera3d.js` | Broadcast, sideline, behind-the-QB and tactical cameras |
| `src/figure3d.js` | Generated placeholder figures from the pixel sprites, auto-rigged, and the GLB model hook |
| `src/anim3d.js` | The animation state machine |
| `src/body.js` | Body size from height and weight |
| `src/playbook.js` | Play art for the call sheet |
| `src/league.js` | Snake draft, AI drafters, schedule, standings, playoffs, league leaders |
| `src/ratings.js` | Base stats to football attributes, the 22 slots, position overalls, auto depth chart |
| `src/types.js` | Type chart, type traits, weather and the curated abilities |
| `src/app.js`, `src/index.html` | The screens and styles |
| `src/data.js`, `src/sprites.js`, `src/sprites3d.js` | Generated Pokémon data, menu sprites and the index of the animated sprite strips (do not edit by hand) |
| `dist/sprites3d/` | Front and back pixel sprites, three Pokémon per file, loaded on demand to paint the figures |
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
