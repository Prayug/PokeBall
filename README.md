# PokeBall

A browser game where you draft Pokémon (Gen 1 to 9, 578 of them) into a 22-position American football roster, set a depth chart, and then play the games yourself on a 3D field, or simulate a full season and playoffs against 7 AI teams.

Every football rating comes from real Pokémon data: base stats, types, height, weight and abilities. Type matchups change the one-on-one battles on each play.

## Play

Play it at **https://prayug.github.io/PokeBall/**, deployed from `main` on every push.

To play a local copy, download the 3D models once with `npm run models` (they are a release download, not in git), then open `dist/index.html` in a browser, keeping the `dist/models3d/` and `dist/sprites3d/` folders next to it: the 3D models load from there on demand, a few Pokémon at a time. Without the models every Pokémon uses its generated figure. There is no server and no network calls besides Google Fonts. Leagues save to the browser's local storage.

Games are played on a 3D field, Madden style: pick a play from the playbook, snap the ball, and control one Pokémon while the AI runs the other 21 using the same ratings and type matchups as the simulator.

| Key | What it does |
| --- | --- |
| `Space` | Snap the ball (pressed while players are still walking up, it hurries everyone to the line and snaps the moment they are set); juke when you carry it; go up for the ball while a pass is in the air to your receiver; dive to tackle on defense |
| `W A S D` or arrows | Move your player (leave them alone and your player runs on autopilot) |
| `Shift` | Sprint (a burst to 110% of top speed for about three seconds, then it recharges) |
| `1` to `5` | Throw to that receiver (the numbers float over their heads): tap for a touch pass, hold for a bullet, `Shift` with the number for a lob. Hold a direction as you throw to place the ball: up leads him, down brings it back to him, sideways puts it away from the defender. Control switches to the receiver while the ball is in the air; he runs to the ball on his own until you let go of the direction you threw with and press one again |
| `T` | Throw it away |
| `E` | Truck a tackler |
| `R` | Spin move |
| `Q` | On defense, switch to the player nearest the ball |
| `1` to `8`, `P`, `F` | Between plays, call the play with that key on the open page of the playbook (`←` `→` turn the page) |
| `←` `→` | Between plays, move between the call sheet's categories (Run, Short pass, Deep pass, Special teams) |
| `` ` `` | Debug view: position labels, collision circles, velocity and facing, assignment lines, remaining routes and the ball's flight on the field, plus a panel with the game state, camera shot, ball and every player's action, contact state, role, speed and target, the last events, the formation check and camera calibration sliders (also `?debug` in the URL or the menu) |
| `Z` | Between plays, cycle the formation (offense) or front (defense) for your call |
| `H` | Fold or unfold the call sheet |
| `X` | Between plays, open every play in the playbook at once (with each play's description), or go back to the single strip |
| `Esc` | Before the snap, take the call back and pick another; during a play, pause; closes the menu |
| `P` | Pause or resume the play (opening the menu during a play pauses it too) |
| `Y` | Between plays, replay the last play at half speed from the broadcast camera |
| `?` | Show the controls (they also show once at the start of your first game) |
| `C` | Cycle the camera: Gameplay, Tactical, Broadcast, Player focus |
| `M` | Open the game menu (coach mode, sim controls, camera, graphics, sound, weather, controls, replay, box score) |

Adding `?seed=4242` (any number) to the address makes the quick game repeatable: the same rosters, weather and coin toss, and the AI's formations and fronts follow from the seed, so the same calls give the same pre-snap picture in every camera.

The stadium fills the screen under a broadcast scoreboard (teams, score, possession, quarter, clock, down and distance, ball spot and a 40-second play clock that snaps the ball for you when it runs out). Between plays a compact call sheet rises from the bottom center: one strip of play cards for the current page of the playbook, so the formation stays visible above it. The offense has Run (Inside Zone, Outside Zone, Power O with the backside guard pulling, Counter, Toss Sweep, HB Dive, HB Draw), QB runs (Zone Read, QB Power, QB Draw, QB Sneak), Quick (Slants, Quick Out, Stick, Curl Flat, Mesh, HB Screen, WR Bubble), Intermediate (Curls, Smash, Dagger, Levels, Flood, Y-Cross, TE Seam), Shots (Four Verticals, Deep Post, PA Bootleg, PA Shot) and Special teams (Punt, Coffin Corner, Fake Punt, Field goal, Fake FG); the defense has Man (Cover 1, Cover 1 Robber, 2 Man Under, Press Man, Goal Line), Zone (Cover 2, Tampa 2, Cover 3, Cover 4, Prevent) and Pressure (Mike Blitz, LB Dogs, Double A Mug, Nickel Blitz, Fire Zone, Cover 0). Number keys count from 1 on each page. Each card leads with the play's art drawn from the real assignments (routes, run lane, blocks, zones, man coverage, rushers) with its shortcut key, then the play's name in large type, then a colored run or pass tag and the formation. A "Fits" tag marks the call that suits the down, and the sheet opens on that call's tab. A formation menu in the header picks another set (shotgun spread, trips, singleback, I-form or pistol on offense; 4-3, nickel or goal line on defense), `X` or "All plays" opens every tab at once with each play's description, and the sheet folds away when you pick. While it is up the camera frames the players in the space above it, so it never covers anyone. The last play's summary fades after a few seconds, the scoreboard flashes the team that scored, and touchdowns, sacks, interceptions and fumbles get a short banner. After the call both teams jog from where the last play ended into the formation, and the field shows the play art (bold routes, the run lane, blocks, pulling guards and the lead fullback on offense; zones, man matchups and rushers on defense, each a bright stroke on a dark edge), receiver numbers, the line of scrimmage in blue and the first-down line in yellow until the snap. A snap called before everyone is set is a hurry-up: they sprint to their spots and the ball is snapped within about a second. Before the snap every player stands on a team base, solid for the offense and dashed for the defense, the quarterback has a gold QB marker, and the ball carrier gets a football icon once the ball is snapped. The game clock runs while the ball is live, and between plays it runs off at the snap unless something stopped it (see **Clock, timeouts and the try** below). Everything else lives in the menu. On a phone or tablet the field shows a joystick and buttons. Punts and field goals are played on the field (see **Kicks** below); fakes, kickoffs, extra points, spikes and kneels are resolved instantly. Both use the kicker's and punter's own ratings (kick power and kick accuracy): a strong leg kicks more touchbacks, hits longer field goals and punts farther, and an accurate one makes more kicks and drops a coffin-corner punt closer to the goal line. The field goal card shows that kicker's odds from the spot. Every team drafts a kicker (K) and a punter (P), who have their own slots in the depth chart; a team without one uses whoever on its roster kicks best. "Sim drive", "Sim quarter" and "Sim to the end" still use the fast simulator, and coach mode lets the AI call every down except 3rd and 4th downs and the last two minutes. Without WebGL the game falls back to the original 2D field.

### How a play runs

The game runs through explicit states, and input only works in the one it belongs to: `PLAY_SELECTION` (the call sheet is up), `FORMATION_SETUP` and `PRE_SNAP` (both teams walk into the formation, the formation check runs, players settle into their stances; linemen breathe, check the front down the line and tense on each of the quarterback's calls), `SNAP` (the exchange under center or the shotgun snap), `LIVE_PLAY`, `PLAY_RESULT` (the whistle: a lower-third card with the result, the yards, who made the play and the next down, while the camera holds), `RESET_FORMATION` (players get up and walk back) and `NEXT_PLAY`.

The simulation (`src/live.js`) owns everything that is drawn. It steps at a fixed 60 Hz and the renderer interpolates between steps, so motion is smooth at any frame rate. Each player carries a position, velocity, facing, an action state (`IDLE`, `READY`, `SNAP_REACT`, `ACCEL`, `RUN`, `SPRINT`, `DECEL`, `TURN`, `BACKPEDAL`, `BLOCK`, `BLOCKED`, `SHED`, `THROW`, `HANDOFF`, `CATCH`, `REACH`, `CARRY`, `TACKLE`, `TACKLED`, `STUMBLE`, `DOWN`, `RECOVER`, `CELEBRATE`, `JUMP`), a block contact state and a target, and the animation reads them; it never guesses. Facing turns at a rate set by agility and weight.

- **Line play.** Pass blockers slide into a cup around the quarterback's drop spot, each matched to a rusher left to right, and meet him on its edge. Every block runs `APPROACHING`, `ENGAGED`, `PUSHING`, `SHEDDING`, `DISENGAGED`: mass drives the pair, and the defender gets off with a move that fits his build (big and strong bull rush, light and quick swim, the rest rip). Run blockers drive defenders away from the hole, down linemen fill their gaps until the ball declares, edge rushers keep contain, and blitzers find a lane through the pile. Linemen get their hands on any rusher who comes within arm's length, mirror him at full speed once he is close, and hold a pass block a couple of seconds before a shed is likely.
- **Passing.** The quarterback drops, works through the play's reads in order (a wide-open man off the read is taken early, a checkdown under pressure), winds up and releases from his hand. The ball flies a real arc, lofted for deep balls, and is resolved where it comes down: the catch, a defender playing it, or a deflection that bounces loose. Each receiver's throw icon is ringed green, amber or red for open, contested or covered. Throws come in three kinds: bullets (hard and flat through a closing window, a little harder to catch), touch passes (drilled short, lofted as they get longer) and lobs (high and soft over the underneath defenders); the AI passer picks one for the window, you pick with the key. On its way the ball can be tipped or picked by a linebacker sitting in the throwing lane or a rusher with his hands up, if it comes by low enough. Receivers work back to a ball placed away from them; an open receiver catches in stride and keeps running, one in traffic secures it first, and Space while the ball is in the air sends your receiver up to attack it at its high point. The target times his run to where the ball comes down and brakes under it instead of running past it. On a high ball or with a defender on him he goes up for it, and the nearest defender goes up to knock it away, each jump timed to peak as the ball arrives: a player in the air reaches a little farther, and a receiver high-pointing it over a defender holds on more often. `Space` jumps for the player you control (the receiver, or a defender near where it comes down).
- **Running.** The handoff is an exchange from hands to hands, a toss is pitched. Inside zone hits its gap, outside zone stretches to the edge and bounces back inside when it is set, Power O pulls the backside guard through the off-tackle hole, Counter jab-steps the back and the linebackers the wrong way first, the dive hits the A gap fast, and the draw shows pass (linebackers drop) before the handoff. On the quarterback's own runs the QB draw drops like a pass and then goes, QB Power pulls the guard with the back leading, and the Zone Read leaves the backside end unblocked: the quarterback reads him at the mesh and gives it if he stays home or pulls it and runs outside if he crashes on the back. On a called run the handoff happens on its own, whatever direction you are holding, and the stick takes over the ball carrier once he has it. An I-form fullback leads through the hole, receivers stalk-block the nearest man in coverage, blocks in front of the carrier hold, and the carrier reads the open seams between bodies. A tackled runner falls forward for a little more, depending on his strength and weight against the tackler's.
- **Defense.** Every call is data in `DEF_SCHEMES` (`src/live.js`): who rushes, who drops out of the front into a zone (the fire zone's end), the zone spots, man matchups and walked-up alignments, so a new coverage is a table entry.
- **Tackles.** Contact starts a half-second sequence: both bodies share momentum, a heavier carrier drags a smaller tackler, pursuers pull up around the pile, and the ball is spotted at forward progress. Sacks are the same sequence behind the line.
- **Kicks.** Punts and field goals are live plays (`src/live/kicks.js`). On a punt the long snapper fires it back fourteen yards, five linemen, two wings and a personal protector block, two gunners split wide race downfield with a man riding each, and the receiving team's fastest sure-handed back waits deep. The punter's leg sets the distance and hang time and his accuracy the spread; inside the opponent's 45 he pooches it inside the ten, and a Coffin Corner angles it out of bounds. The returner runs under it and returns it behind a wall, calls a fair catch when the coverage is on him, or lets it bounce, and a bouncing ball is downed by the first cover man to reach it or goes for a touchback. A field goal is snapped to a holder, the kicker steps into it and the ball flies at the posts; it is good with the same odds the kicker has from that spot. A rusher who gets free to the kick can block it. When the other team punts, you control the returner; when you punt, you take the cover man nearest where it comes down.
- **Pursuit.** The man with outside leverage keeps it, the rest come inside-out, and deep help stays over the top.

### Clock, timeouts and the try

The clock follows football's rules in every game, live or simulated, and AI teams play by the same ones (`src/engine.js`, checked by `test/clock.mjs`).

- **Between plays.** After a play that keeps the clock running, the next snap comes after a runoff set by the offense's tempo: about 7 to 13 seconds with no huddle (the players sprint to the line), 32 to 40 with a huddle, and the full play clock when bleeding it. The call sheet's Tempo menu picks it (Auto lets the AI choose: no huddle when you need points before the half or the game ends, bleeding it with a late lead). If the runoff is longer than what is left, the quarter ends before the snap.
- **What stops it.** An incompletion, a score, a change of possession, a timeout, the end of a quarter and the two-minute warning (2:00 of the 2nd and 4th quarters). Going out of bounds stops it only in the last two minutes of the first half and the last five of the second, as in the NFL; earlier the clock starts again when the ball is spotted. In the two-minute drill AI ball carriers head for the sideline and AI passers lean on sideline routes.
- **Timeouts.** Three per half (two in overtime), shown as marks beside each team on the scoreboard. `T` or the Timeout button on the call sheet calls one between plays: the runoff is saved and everyone gets a short breather. The AI calls its own: on offense when it needs points before the half or is behind late, on defense when it is behind late and the other team is running clock.
- **Spike and kneel.** The Clock tab of the call sheet has both. A spike stops a running clock for the cost of a down and a few seconds; a kneel loses a yard and keeps it running. The AI spikes in the two-minute drill once its timeouts are gone, and kneels out a win when the defense cannot stop the clock often enough to get the ball back.
- **The try.** After a touchdown the scoring team kicks the extra point (from 33 yards, with the kicker's own odds) or goes for two with any run or pass from the 2, played on the field like any snap; a two-point play does not count in anyone's stats. The AI goes for two late in the game when the usual chart says so (down 2, 5, 9, 10, 12 or 13, or up 1, 4, 5 or 12).
- **Kickoffs.** Your team picks Kick deep or Onside kick. An onside kick the other team expects (behind late) is recovered about one time in eight; a surprise one about half the time, better with an accurate kicker. The AI onside-kicks when it is behind by up to 16 in the last few minutes, and once in a long while as a surprise. In Auto mode the try and the kickoff are yours in the 4th quarter.

### Penalties

Officials call false starts, offside, holding (offensive and defensive) and pass interference (both ways) in every game, live or simulated (`src/penalties.js`, checked by `test/penalties.mjs`). Awareness decides who commits them: a Pokémon at 40 awareness draws about twice the flags of one at 70, and one at 100 about a third. On the live field the calls come from the contact itself: a blocker his rusher is beating grabs as the rusher gets off, a defender hangs on a receiver who is not the target, a trailing defender who gets to the catch point late interferes, a receiver pushes off in a contested catch. Road linemen false-start more (crowd noise). The fast simulator rolls the same fouls from awareness and the matchup.

- **Before the snap.** A false start or offside kills the play and is walked off on the spot; offside that reaches the line to gain is a first down.
- **During the play.** A yellow flag lands by the foul and the play runs to the whistle. Holding by the offense is 10 yards and offensive interference 10, both repeating the down; defensive holding is 5 yards and an automatic first down; defensive pass interference is a spot foul and an automatic first down (at the 1 if it happens in the end zone). Distance penalties stop at half the distance to the goal, and flags on both teams offset.
- **Accept or decline.** The referee announces the foul, the side, the player and what accepting means. When the foul was against your team, the call sheet shows Accept and Decline with what each leaves (for example "PAL 2nd & 16 at PAL 30" against "PAL 3rd & 1 at PAL 45"), with a Fits tag on the better one. The AI takes whichever leaves it better off. An accepted penalty wipes the play's stats; the box score counts penalties and yards per team. In Auto mode the choice is yours in the 4th quarter.

Three modes are in the menu: **Play** (you control the quarterback and then the ball carrier, or a defender), **Coach** (you call every play and watch the AI run it) and **Auto** (the AI calls and plays).

### Abilities and types

What a Pokémon's ability or type does during a snap lives in one table, `src/traits.js`, keyed by the moment it acts (throw accuracy, pressure, catch reach, interception chance, tackle odds, strip chance), so a new trait is one entry. When a trait, a type matchup or a size difference decides part of a play, the result card says so, tagged Type, Ability or Size. "Super effective" only shows when the type matchup actually changed the outcome: the contest is rolled with and without the type modifiers and noted only when they differ.

### The 3D field

The game is a real three.js scene in yards, with one coordinate system for the field, the players, the ball and the camera: a sky dome, sun and fill lights with soft shadows, ACES tone mapping, a striped field with numbers, hashes, two-point lines, end zones painted with team names and a Poké Ball at midfield, worn patches between the hashes, pylons, goalposts, sidelines with benches and a chain crew (the down marker shows the down, the stake marks the line to gain), a banner wall, stepped stands with seat rows, stairways and a club level with LED ribbons, an instanced crowd (thousands of fans with varied skin tones and shirts, mostly in their team's colors, a few empty seats) that bobs and cheers, light towers, and rain, hail, sun or sandstorm when the game has weather. The turf is a clean two-tone mow with bold yard lines and numbers, the midfield Poké Ball is a faded decal, and each half of the crowd wears its team's color. Sound is synthesized in the browser (no files): the crowd's murmur swells with big plays, and the snap, pads, catches, the whistle and a touchdown roar are all there; it starts on your first key press or click and can be turned off in the menu. The renderer lowers its resolution when frames run long and raises it when there is room (or pick High or Fast in the menu).

There are four cameras (`C` cycles them). **Gameplay**, the default, sits low behind the quarterback, who stands near the bottom center of the screen: before the snap it frames the box (the offensive line, the backs, the inside receivers and the defenders within about seven yards of the ball) by fitting their feet and heads inside a safe area of the screen, so the Pokémon are large and the wide receivers sit at the edges without the camera pulling back to midfield. Once the ball is snapped it widens a little, rises and pulls out to follow a deep throw, and then leads the ball carrier; it works the same from either end. **Tactical** is high above the line of scrimmage with readable position labels (QB, RB, WR, LT, MIKE, FS and so on), zoomed to the width of the formation, with the selected player, the routes and assignments, the line of scrimmage and the first-down line drawn on the field. **Broadcast** is the TV angle: above and outside the near sideline at a moderate diagonal toward the offense, tight on the formation before the snap, then panning with the play, widening for deep passes and tracking the ball and the carrier. **Player focus** follows close behind your player. The camera is kept inside the stadium and above the seats, never under the turf, and a state machine of shots (pre-snap, dropback, pass flight, catch, run, tackle, post-play) that frames the backfield and the line before the snap, rises for routes, follows the ball in the air, leads the ball carrier and closes in on the tackle. It moves on critically damped springs, so changes of shot never jerk, and rises over any Pokémon that would block the view. Distance, height, pitch and field of view for each setup can be tuned live in the debug view. 

### The Pokémon models

544 of the 578 Pokémon are real 3D models of the official game models, from the [Pokémon 3D API](https://github.com/Pokemon-3D-api/assets) asset collection, which gathers fan-extracted models from Sketchfab. They are not licensed: like the pixel sprites, they belong to Nintendo, Creatures Inc. and GAME FREAK inc., and this game uses them as a non-commercial fan project. The collection's own code is MIT licensed, and it credits the individual Sketchfab uploaders in its [Sketchfab collection](https://sketchfab.com/SudhanshuAmbastha/collections). About 90 of the models come with their game animations (idle, run, walk, attack, hit, faint, cheer), which the game plays. For the rest, and for animated models without a run, the game drives each model's own skeleton: legs stride with the Pokémon's speed (thighs swing, knees fold), arms or front legs swing against them, tails sway in a wave, wings flap, the spine twists and the head steadies, and rigs bound in a T-pose let their arms hang. About 180 models have no skeleton at all, and those (with any whose legs the rig can't find) bound as a whole body, one hop a step with a rock and a waddle, squashing as they land, and breathe while they stand. Root motion is taken out of the looping clips, so a model never slides ahead of its player and jumps back when its run loops. Every Pokémon is in one of four size classes from its height and weight (`src/body.js`): small (about 1.15 yards tall, a Pikachu), medium (1.6), large (2.15) and extra large (2.75, a Snorlax or a Groudon), so a big Pokémon really is big, with a little spread inside each class. Each class has its own collision capsule, so the simulation, the formations and the drawing agree on how much room a body takes. The model is measured once it loads (its feet, its height without the last few percent of antennae and spikes, and the core of its body apart from wings and tails) and scaled uniformly to its class height, shrunk if its core would spill past its capsule or its wings and tail past their allowance, never below 80% of the height. A few bodies the fit would draw as thin as a rope (Serperior) are drawn wider and deeper. Its measured footprint then goes back to the formation, which spaces players by what is actually drawn. Each model stands on its feet at the turf, faces downfield for its team, and casts a shadow tinted with its team color.

The other 34 (mostly Gen 8 and 9, which the collection does not have yet) use a generated figure: the Pokémon's pixel sprite inflated into a rounded, auto-rigged 3D body, painted with its front and back sprites. `build/build_models3d.mjs` downloads, converts and packs the models into `dist/models3d/`, so a Pokémon that gets a model in the collection gets it here on the next run.

The models are not in git, so they don't grow the clone each time one changes. They ship as `models3d.tar.gz` on a GitHub release, and `build/models3d.json` names the release this commit uses. After regenerating them, publish a new release and point the game at it:

```sh
node build/fetch_models3d.mjs --pack                                  # writes dist/models3d.tar.gz
gh release create models-v2 dist/models3d.tar.gz --title "3D models (models-v2)"
# then set "tag": "models-v2" in build/models3d.json and commit it with src/models3d.js
```

Animation is a state machine (`src/anim3d.js`) that picks each player's clip on a model and poses the generated figures' skeletons: idle, pre-snap stance (three-point on the line, the quarterback upright and ready, receivers and defensive backs in an athletic crouch, every defender facing the offense) with a little life on top: slow breathing, a slight sway, the quarterback scanning the defense and skill players bouncing on their toes now and then, smaller for linemen and drawn only on the model, so nobody's position changes, run and sprint with stride length from body size (a sprint leans further, reaches longer and pumps the arms, kicks up turf and widens the camera), turning leans, blocking, and layers for carrying the ball, the quarterback's ball by the ear, throwing, reaching for catches, jukes, spins, trucks, being stunned, diving tackles, falling the way the hit came from, getting back up and celebrating. Movement has a style per body type: fliers pitch and bank as they turn, floaters hover and bob, four-legged Pokémon gallop at a sprint, serpents slither and hoppers bound. Flying and levitating Pokémon hover above the turf, except winged Pokémon that stand on two legs (Charizard, Dragonite), which play on their feet. Players turn at a rate that depends on agility, so nobody snaps around or slides.

On top of that, every model gets football posture from its own skeleton (`poseLimbs` in `src/model3d.js`), without stretching the mesh: linemen sink into a three-point stance with a hand down and fire out low, push with their arms out and lean back when they are losing the block; the quarterback crouches under center, drops back with the ball cocked by his ear, turns his shoulders to the receiver he is reading and whips the arm through, and the ball leaves from his hand; backs and receivers lean into acceleration, carry the ball tucked and turn to it as it arrives; defensive backs sit in a backpedal. Models with no skeleton lean and twist as one piece. After the snap the field only shows the ball carrier's ring, your player and, on a pass, the receivers' throw icons; team markers under every player are an option in the menu, as is the name and position over your player.

### Formations and contact

Every play starts from a real formation set from the ball (`src/formations.js`): on offense shotgun spread, shotgun trips, singleback, I-form and pistol, each with its own quarterback depth, back alignment, tight end (inline, flexed or as the fullback) and receiver splits; on defense a 4-3, a nickel and a goal-line front, with the linemen in techniques shaded to the strength of the formation, corners over the outside receivers, linebackers and safeties at their depths. Shotgun snaps fly back to the quarterback. Players are spaced by their drawn footprints, so a Snorlax takes up more of the line than a Pikachu and no two bodies ever overlap. Linemen and tight ends are also fitted to their slot: a Pokémon whose body, wings or tail would be much wider or deeper than a lineman's lane is scaled down uniformly (never below 85%) so the line reads as five separate blockers with the defensive front a clear step across from them, instead of a few huge bodies hiding everyone behind them. The fit scales the drawn model and the footprint the formation spaces by; the collision capsule, weight and ratings stay those of the size class, so play balance is unchanged; the offense lines up just off the ball and the defense just across the neutral zone. Before every snap a formation check (`validateFormation` in `src/live.js`) confirms 11 on 11, seven on the line, the linemen in order with the center over the ball, the quarterback's depth, the back behind him, receivers split and not stacked, nobody offside or in the neutral zone, everyone inside the field and facing the right way, and no two bodies overlapping. During the play every body is a solid capsule: players steer around bodies in their path, blocks engage at body distance and square up over a few frames, a ball carrier slips past his own blockers, deep contact eases apart instead of popping, and tackles only happen on contact.

Ball carriers have three moves, each better in a different spot: a juke beats a tackler coming from the side, a spin beats one coming head-on, and a truck works when the carrier is stronger and heavier. AI carriers pick between them the same way.

## League mode

A league is eight teams: yours and seven AI teams, each with a coach style (Speed Kills, Trench Builder, Type Stacker or Best Available) that shapes how it drafts, calls plays and trades. The home screen sets the team name, the draft length (24 rounds fills the 22 starters plus a kicker and punter; 28 adds four bench Pokémon), a cap of four Pokémon of one primary type, whether legendaries are in the pool and an optional 60-second pick clock.

**Draft.** A snake draft in a random order. The board sorts and filters by type and rating and shows where each Pokémon fits your open slots; "Auto-draft the rest" hands your remaining picks to the AI. After the last pick, the grades screen scores every team's pass offense, run offense, pass rush, coverage and run defense against the league, from A+ to F.

**Trade offer.** One AI team may offer a one-for-one swap that improves both rosters by overall, shown with what your best lineup gains. It stands until your first game.

**Depth chart.** Tap a slot, then another slot or a bench Pokémon, to swap them; overalls update for the new position, and a Pokémon playing out of position shows where it is best. "Auto-arrange" builds the best lineup by overall.

**Season.** A seven-week round robin. Each week you play your game live on the 3D field or simulate it, and the rest of the league simulates. The season screen carries the standings (top four make the playoffs), league leaders, every result with its box score and scoring plays, and the league's history across seasons.

**Scouting report.** Before each game the season screen scouts your opponent: their lineup, offense, defense and kickers; your three best type edges and their three best; which weather setters will change the conditions; a one-line game plan with a pass or run lean; the opposing coach's habits; and your own injury list.

**Pre-snap board and tendencies.** During a game, between plays, the pre-snap board lists every one-on-one the play will be decided by (your line against their front, your receivers against their coverage) with its type effectiveness and a count of edges for each side. Under it, the opponent's tendencies build up as the game goes: how often they run on first down, pass on third, blitz on third and long, and their favorite calls on each side of the ball.

**Subs.** Tired starters come out at the start of a drive for a fresher bench Pokémon who would play better at that slot. The "Lineup and subs" tab shows each slot's energy and lets you make your own subs; a coach's sub stays in, and the auto-sub leaves that slot alone, until you send the starter back.

**Soreness.** Energy carries over between games. A Pokémon who finished a game worn out starts the next one sore, below full energy; the most exhausted (at most two a team) are out for a week when the bench can cover them, and a team with no bench plays them hurt. The depth chart and the scouting report tag who is sore and who is out.

**Playoffs and awards.** The top four seeds play semifinals (1 against 4 and 2 against 3, the higher seed at home), then a championship game; you can watch the rounds you are not in. When the season ends the champion screen shows your record and team star, the bracket and the awards: most valuable player, offensive and defensive player of the year, and from the second season on, rookie of the year. "Download recap" saves the season as text.

**Offseason and development.** Training camp rewards playing time: every 180 snaps a Pokémon played earns +2 to a rating its position uses, up to +8 a season and +16 over a career, and the growth carries into its overalls from then on. The offseason screen shows your camp report and the league's top developers.

**Cuts and the rookie draft.** Every team cuts four. The game suggests your four (the lowest keep-value), and you can pick your own; the AI teams' cuts are listed. Cut Pokémon go back into the pool, and a four-round snake rookie draft refills every roster, worst record picking first and the champion last. Then a new season starts with fresh standings, stats and health.

**Saves, export and import.** The league saves to the browser's local storage after every change, including a game in progress, and "Continue league" on the home screen picks it up. "Export save" (home and season screens) downloads the whole league as a JSON file; "Import a save" on the home screen loads one from a file or pasted text, replacing the league in that browser. Older saves are brought up to the current format when they load.

`test/league.mjs` plays this loop end to end and checks it (see Build).

## Ratings

Attributes come from base stats, height and weight, graded on a curve against the whole non-legendary pool: 60 is average, 80 is very good, 99 is the best in the league. There are 13: Speed, Acceleration, Agility, Strength, Blocking, Pass rush, Throwing, Accuracy, Catching, Coverage, Tackling, Awareness and Stamina. In the live game Speed sets top speed, Acceleration how fast a player gets there, Agility how sharply it cuts and turns, Awareness how quickly quarterbacks read and defenders react, and height and weight set body size, which decides spacing, blocking and tackling reach. Position overalls are graded the same way per position, centered on 50, so a 99 is the best at that spot, an 80 is a solid starter and a 50 is a backup. Legendaries, mythicals, Ultra Beasts and Paradox Pokémon are flagged as legendary (off by default; when on, there is no limit per team).

Ratings decide most games, not all of them. Each team rolls a form for the day (usually within 4% either way, from the game's seed, so a seed always replays the same), the home side gets a 1% edge (none at a neutral site), type matchups are worth 12% (20% for no effect) and the weather boosts or hurts its types by 12%. After halftime a team up by more than 14 eases off a little, so blowouts stay football scores. In the simulator a strong lineup (about 80 overall) beats a good one (about 74) about 8 times in 10, a good one beats an average one (about 68) about 7 in 10, and the home side wins about 56% of evenly matched games; a gap as wide as elite against average still almost never loses. The sizes live in `src/parity.js`. `test/tiers.mjs` measures this.

## Layout

| Path | What it holds |
| --- | --- |
| `src/engine.js` | Play-by-play simulation: line battles, coverage, completions, tackles, clock, scoring, AI play calling |
| `src/live.js` | Live plays: 22 Pokémon moving in real time with blocking, routes, man and zone coverage, throws, catches and tackles |
| `src/live/defense.js`, `src/live/passing.js` | The defensive calls (`DEF_SCHEMES`) with rush, coverage and pursuit; routes, the quarterback's reads, throws, the ball's flight and catches |
| `src/live/kicks.js` | Punts and field goals on the live field: the kicking units, the long snap, the kick from the specialist's ratings, coverage, fair catches, bounces, returns and the posts |
| `src/field3d.js` | The 3D stage: players, ball, play art, markers and effects, driven by the live play |
| `src/stadium3d.js` | Field, stands, crowd, lights and weather |
| `src/camera3d.js` | Gameplay, tactical, broadcast and player-focus cameras |
| `src/model3d.js`, `src/models3d.js` | Loading the real 3D models and their animation clips; the generated index of which Pokémon have one |
| `src/figure3d.js` | Generated figures from the pixel sprites, for Pokémon without a model |
| `src/anim3d.js` | The animation state machine |
| `src/body.js` | Size classes, collision capsules and model fitting from height and weight |
| `src/formations.js` | Offensive formations, defensive fronts, alignment and footprint spacing |
| `src/audio.js` | Synthesized crowd and game sounds |
| `src/playbook.js` | Play art for the call sheet |
| `src/league.js` | Snake draft, AI drafters, schedule, standings, playoffs, league leaders |
| `src/ratings.js` | Base stats to football attributes, the 22 slots, position overalls, auto depth chart |
| `src/types.js` | Type chart, type traits, weather and the curated abilities |
| `src/parity.js` | How far form, home field, types and weather can swing a game |
| `src/app.js`, `src/index.html` | The entry point (rendering and the click, key and form handlers) and the styles |
| `src/state.js`, `src/ui.js` | The shared UI state with save and preference storage; small view helpers such as `esc`, `sprite` and `teamBadge` |
| `src/screens/` | One module per screen: `home`, `draft` (and grades), `depth`, `season` (and box scores), `offseason`, `game`, the play-call sheet (`callsheet`) and the live 3D game loop and input (`live3d`) |
| `src/data.js`, `src/sprites.js`, `src/sprites3d.js` | Generated Pokémon data, menu sprites and the index of the animated sprite strips (do not edit by hand) |
| `dist/models3d/` | The 3D models, two Pokémon per file, loaded on demand (not in git: `npm run models` downloads them) |
| `build/fetch_models3d.mjs`, `build/models3d.json` | Downloads the models release into `dist/models3d/`, or packs it for a new release; which release to use |
| `.github/workflows/pages.yml` | Builds the page and deploys it with the models and sprites to GitHub Pages on every push to `main` |
| `build/build_models3d.mjs` | Downloads, converts and packs the 3D models (see its header for the npm packages it needs) |
| `dist/sprites3d/` | Front and back pixel sprites, three Pokémon per file, loaded on demand to paint the figures |
| `build/build_data.py` | Regenerates `data.js` from PokéAPI CSVs |
| `build/build_sprites3d.py` | Regenerates `sprites3d.js` and `sprites.js` from the PokeAPI pixel sprites |
| `build/build.sh` | Bundles `src/` into `dist/index.html` with esbuild |
| `test/balance.mjs` | Simulates games between AI-drafted teams and prints league averages |
| `test/live.mjs` | Plays full games where every run and pass is a live play on autopilot, and prints the same averages |
| `test/plays.mjs` | Plays the ten cases a game has to get right (inside and outside run, short and deep completion, incompletion, sack, tackle, touchdown, turnover, next down) through the live loop, then a sweep of every call against every defense, checking the formation, that nobody jumps or passes through anyone, that blockers are drawn blocking, the state sequence and the down, distance, possession, score and clock after |
| `test/scenarios.mjs` | Fifteen scenarios from fixed seeds (pre-snap formation, dropback, pocket protection, short pass, deep completion, incompletion, interception, inside run, outside run, sack, open-field tackle, touchdown, first-down conversion, turnover on downs, transition to the next play) and a sweep, checking every frame for valid action and contact states, ball continuity, facing turn rate, tackle sequences and forward-progress spots, then the rules' downs, possession and score; `--report file.json` writes the results |
| `test/browser.mjs` | Plays a few snaps of the built game in Chromium in Coach mode, recording a video and screenshots and checking the controls card, the game-flow states, the camera staying on the ball, the result card, the scoreboard, pause, and that a replay ends exactly where the play did |
| `test/kicks.mjs` | Plays punts and field goals on the live field and checks every one ends in an outcome the engine applies, the ball never jumps, punt distance, returns and short-field pooches are in range and the field goal make rate follows the kicker's odds |
| `test/formations.mjs` | Lines up every offensive formation against every front for eight teams at five spots on the field and runs the formation check on each (`--print` lists the positions) |
| `src/traits.js` | Abilities and types that act during a live snap |
| `test/top.mjs` | Lists the top Pokémon at each position |
| `test/league.mjs` | Plays a league the way the app does (draft, grades and the trade offer, a full season with soreness and subs, the playoffs and awards, the offseason, cuts and the rookie draft, then the next season) and checks every step, plus that an exported save plays on to the same results (exits 1 on failure) |
| `test/clock.mjs` | Checks the clock rules (runoff by tempo, what stops the clock, the two-minute warning, timeouts, spike and kneel, the try and onside kicks) in set situations, then plays seeded games with the rules checked after every snap (exits 1 on failure) |
| `test/tiers.mjs` | Plays teams from different tiers of the pool against each other to show how much ratings matter |

## Build

```sh
npm install                         # three.js
npm run models                      # the 3D models, into dist/models3d/
bash build/build.sh                 # uses npx esbuild@0.24.0, or set ESBUILD=/path/to/esbuild
node test/balance.mjs 10000         # balance check of the simulator
node test/live.mjs 20               # balance check of live plays
node test/plays.mjs                 # the ten complete plays plus a 160-play sweep (exits 1 on failure)
node test/scenarios.mjs             # the fifteen fixed-seed scenarios plus a strict sweep (exits 1 on failure)
node test/formations.mjs            # 600 formation and front pairings through the formation check
node test/league.mjs                # two seasons of league mode, draft to rookie draft (exits 1 on failure)
node test/browser.mjs out 3         # three snaps in a real browser: video, screenshots, results.json
node test/tiers.mjs 300             # how much ratings matter (add `live` for live plays)
```

To regenerate the Pokémon data, download the PokéAPI CSVs (`pokemon`, `pokemon_species`, `pokemon_species_names`, `pokemon_stats`, `pokemon_types`, `pokemon_abilities`, `ability_names`, `types`) from `PokeAPI/pokeapi` `data/v2/csv/` into a folder, then run:

```sh
python3 build/build_data.py <csv_dir> src
python3 build/build_sprites3d.py <gif_cache_dir> src dist   # downloads the GIFs it does not have yet
```

Gen 1–5 use the animated Black/White GIFs; later Pokémon use the static pixel PNGs.

CI (`.github/workflows/test.yml`) runs `plays.mjs`, `scenarios.mjs`, `formations.mjs`, `league.mjs` and `clock.mjs` on every pull request and on pushes to `main`.

## Balance

Last run over 4,000 simulated games: 23.4 points per team, 61.7% completions, 6.8 yards per pass attempt, 4.3 yards per carry, 4.6% sack rate and 3.4% interception rate.

Live plays with every Pokémon on autopilot (20 games) come out at about 23 points per team, 57% completions, 7.1 yards per attempt, 3.4 yards per carry, 4% interceptions and a low sack rate (about 1%): pass rushers now have to beat a real pocket and quarterbacks get the ball out on their reads and checkdowns. Deep defenders keep their cushion, pursuers keep leverage and long runs tire the carrier, so only a truly faster player breaks away.

Pokémon data comes from [PokéAPI](https://pokeapi.co); the pixel sprites come from [PokeAPI/sprites](https://github.com/PokeAPI/sprites). The 3D field uses [three.js](https://threejs.org). Pokémon is © Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project.
