# Obsolete Mobile Monument Valley Pivot Plan

> For Hermes: use the mobile-browser-game-adaptation and writing-plans skills if this plan is later executed.

Goal: turn the mobile repo from a touch-enabled side-scrolling escape game into a portrait-friendly architectural puzzle game with calmer pacing, tap-first movement, and one strong impossible-geometry mechanic.

Architecture: keep the existing Three.js orthographic renderer, HUD shell, cutscene framework, and touch-first mobile presentation, but replace continuous free movement + hazard traversal with node-based navigation across compact diorama chapters. Introduce a small level graph model, one structure-state puzzle system, and camera framing that treats each stage as a centered sculpture instead of a long scrolling course.

Tech stack: Vite, Three.js, vanilla JS, current mobile shell in `index.html`/`styles.css`, game state in `src/game.js`, content in `src/levels.js`, renderer in `src/renderer.js`, viewport helper tests in `tests/mobile-viewport.test.js`.

Current repo facts this plan is based on:
- `src/main.js` already supports touch buttons and a forced mobile mode via `?mobile=1`.
- `src/game.js` is still built around continuous keyboard-style movement, rectangular collisions, conveyors, crushers, health/integrity, and interact-range triggers.
- `src/levels.js` already has a 13-level structure, but the levels are still mostly variants of the original side-scrolling obstacle grammar.
- `src/renderer.js` already uses an orthographic camera and portrait-aware `handleResize()`, which is the best foundation for Monument Valley-like staging.

Non-goals for this pass:
- Do not attempt true 3D projection sorcery across the whole game.
- Do not rewrite the asset pipeline.
- Do not build a full navmesh/pathfinding system.
- Do not keep crushers/conveyors and also add Monument Valley mechanics in the same chapters; that will muddy the feel.

Design target:
- “Monument Valley inside the dream architecture of a discarded laptop.”
- Calm, tactile, contemplative.
- Each level is a small, legible sculpture.
- The puzzle is understanding or changing the path, not dexterity.
- The player should mostly tap a destination or activate a structure, then watch the machine walk.

---

## Milestone 1: Define the new game grammar before touching gameplay code

### Task 1: Freeze the design pillars in a repo note
Objective: write down the exact rules for what the mobile pivot is and is not.

Files:
- Create: `docs/design/monument-valley-mobile-pillars.md`

Steps:
1. Create a one-page note with five pillars:
   - tap-to-move, not precision movement
   - compact portrait dioramas, not long obstacle courses
   - one structure puzzle per stage
   - quiet poetry, not constant banter
   - visual readability over junk density
2. Add an explicit “do not add” list:
   - conveyors
   - crusher timing gates
   - health attrition as primary challenge
   - sprawling horizontal walks
3. Add 3 reference adjectives for all later work:
   - sacred
   - mechanical
   - melancholy

Verification:
- File exists and is short enough to be used as a style guardrail.

Commit:
- `git add docs/design/monument-valley-mobile-pillars.md && git commit -m "docs: define monument valley mobile design pillars"`

### Task 2: Pick one impossible-architecture mechanic for the first vertical slice
Objective: avoid scope explosion by choosing a single signature interaction.

Files:
- Modify: `docs/design/monument-valley-mobile-pillars.md`

Recommended choice:
- rotating tower bridge

Why this one first:
- easiest to express with your current renderer
- easiest to represent in level data as state toggles
- easiest to explain on mobile with one tap target
- gives a strong Monument Valley feeling without needing projection math

Mechanic rules:
- a tower or bridge has 2-4 discrete orientations
- each orientation enables a different set of path links
- player taps the rotator, structure animates, path graph updates
- player then taps the newly reachable node

Verification:
- The note names one mechanic as the vertical-slice mechanic and explicitly defers the others.

Commit:
- `git add docs/design/monument-valley-mobile-pillars.md && git commit -m "docs: choose rotating bridge as first impossible mechanic"`

---

## Milestone 2: Replace free movement with graph movement

### Task 3: Add a dedicated level graph module
Objective: separate puzzle-path data from old rectangle/hazard logic.

Files:
- Create: `src/level-graph.js`
- Create: `tests/level-graph.test.js`

Data shape to introduce:
```js
export function buildGraph(level) {
  return {
    nodes: level.nodes || [],
    edges: (level.edges || []).filter((edge) => edge.enabled !== false),
  };
}

export function getReachableNeighbors(level, nodeId, state) {
  return (level.edges || [])
    .filter((edge) => edge.from === nodeId && edgeEnabled(edge, state))
    .map((edge) => edge.to);
}

function edgeEnabled(edge, state) {
  if (!edge.requires) return true;
  return state[edge.requires] === true;
}
```

Initial tests:
- graph returns neighbors for a normal edge
- conditional edge is hidden when structure state is false
- conditional edge appears when structure state is true

Verification:
- `npm test`
- new graph tests pass

Commit:
- `git add src/level-graph.js tests/level-graph.test.js && git commit -m "feat: add level graph helpers for node movement"`

### Task 4: Add node-based player state alongside the old player object
Objective: prepare `src/game.js` for auto-walk movement.

Files:
- Modify: `src/game.js`

Changes:
- add `this.pathState` in the constructor/reset path:
```js
this.pathState = {
  currentNodeId: null,
  targetNodeId: null,
  path: [],
  moveProgress: 0,
  isAutoMoving: false,
};
```
- when loading an act, initialize from `this.act.startNodeId`
- set `player.x`/`player.y` from the active node instead of the old free-start rectangle when node data exists

Important rule:
- do not delete old free movement yet; gate the new logic behind `this.act.navigationMode === "graph"`

Verification:
- old levels still boot
- graph levels can spawn from node coordinates

Commit:
- `git add src/game.js && git commit -m "feat: add graph navigation state"`

### Task 5: Implement tap-to-select destination nodes
Objective: make mobile feel like Monument Valley instead of a D-pad platformer.

Files:
- Modify: `src/main.js`
- Modify: `src/game.js`
- Modify: `src/renderer.js`

Implementation shape:
1. In `src/main.js`, listen for pointer taps on the scene canvas.
2. Convert the pointer to a world-space hit via a small renderer helper.
3. Ask the game for the tapped node or interactable.
4. If it is a reachable node, enqueue auto-movement.
5. If it is a rotator/interactor, trigger that instead.

New methods to add:
- `renderer.getWorldPointFromClient(clientX, clientY)`
- `game.handleSceneTap(worldPoint)`
- `game.findTappedNode(worldPoint)`
- `game.beginAutoMove(targetNodeId)`

Verification:
- in a graph-enabled level, tapping a connected node causes the player to walk there automatically
- touch D-pad can remain temporarily for fallback, but the main path should no longer depend on it

Commit:
- `git add src/main.js src/game.js src/renderer.js && git commit -m "feat: add tap to move for graph levels"`

### Task 6: Animate node-to-node walking
Objective: preserve character life while removing dexterity pressure.

Files:
- Modify: `src/game.js`

Implementation shape:
```js
updateGraphMovement(delta) {
  if (!this.pathState.isAutoMoving || !this.pathState.path.length) return;
  const nextNode = this.getNodeById(this.pathState.path[0]);
  const dx = nextNode.x - this.player.x;
  const dy = nextNode.y - this.player.y;
  const distance = Math.hypot(dx, dy);
  const step = this.graphMoveSpeed * delta;

  if (distance <= step) {
    this.player.x = nextNode.x;
    this.player.y = nextNode.y;
    this.pathState.currentNodeId = nextNode.id;
    this.pathState.path.shift();
    this.pathState.isAutoMoving = this.pathState.path.length > 0;
    return;
  }

  this.player.x += (dx / distance) * step;
  this.player.y += (dy / distance) * step;
}
```

Notes:
- keep facing updates based on move direction
- keep footstep audio, but soften it
- ignore collision rectangles on graph levels

Verification:
- player lands exactly on node centers
- no overshoot or jitter
- auto-move stops cleanly when it reaches the target

Commit:
- `git add src/game.js && git commit -m "feat: animate graph node movement"`

---

## Milestone 3: Add the first structure puzzle system

### Task 7: Introduce structure state in level data
Objective: allow a level to change which paths are valid.

Files:
- Modify: `src/levels.js`
- Modify: `src/game.js`

Data shape to add to levels:
```js
structureStates: {
  bridgeA: "north"
},
interactors: [
  {
    id: "bridgeA-rotator",
    x: 480,
    y: 620,
    target: "bridgeA",
    cycle: ["north", "east", "south", "west"],
  }
]
```

Game state shape:
```js
this.structureState = {};
```

On level load:
- deep-clone `act.structureStates` into `this.structureState`

Verification:
- graph level loads with default structure state
- interaction can mutate structure state without touching legacy levels

Commit:
- `git add src/levels.js src/game.js && git commit -m "feat: add structure state for puzzle chapters"`

### Task 8: Make edges depend on structure orientation
Objective: let rotating structures reveal or remove paths.

Files:
- Modify: `src/level-graph.js`
- Modify: `tests/level-graph.test.js`

Recommended edge format:
```js
{
  from: "entry",
  to: "bridge-north",
  requiresState: { bridgeA: "north" }
}
```

Update edge evaluation:
```js
function edgeEnabled(edge, state) {
  if (!edge.requiresState) return true;
  return Object.entries(edge.requiresState).every(([key, value]) => state[key] === value);
}
```

Verification:
- tests cover at least two orientations
- only the correct edge set is reachable per orientation

Commit:
- `git add src/level-graph.js tests/level-graph.test.js && git commit -m "feat: gate graph edges by structure orientation"`

### Task 9: Add a rotator interaction flow
Objective: tapping a rotator should perform the game’s signature “architectural motion” beat.

Files:
- Modify: `src/game.js`
- Modify: `src/renderer.js`

Game-side behavior:
- if tapped object is an interactor, call `cycleStructureState(id)`
- briefly lock player input while the structure animates
- set a short banner like `PATH REALIGNED`
- nudge camera focus toward the moving structure

Renderer-side behavior:
- animate the relevant bridge/tower mesh between discrete angles
- avoid instant snapping
- duration target: 0.45 to 0.8 seconds
- use an ease-in-out curve

Verification:
- tapping the rotator visibly changes the structure
- reachable path changes after the animation
- player can then tap the new node and continue

Commit:
- `git add src/game.js src/renderer.js && git commit -m "feat: add rotating structure interactions"`

---

## Milestone 4: Build one real Monument Valley-style chapter

### Task 10: Create a new compact chapter instead of modifying all 13 levels at once
Objective: prove the new grammar in one vertical slice.

Files:
- Modify: `src/levels.js`

Recommendation:
- replace or temporarily repurpose one mobile level, preferably `battery-garden` or `modem-relay`, because those are conceptually quieter than the crusher sequence

New chapter brief:
- chapter name: `Signal Stair`
- one screen tall, portrait-centered
- start node at the bottom
- goal node near a modem shrine at the top
- one rotating bridge in the middle
- 6 to 8 nodes max
- 1 rotator max
- 0 hazards
- 0 conveyors

Suggested level shape:
```js
{
  id: "signal-stair",
  navigationMode: "graph",
  world: { width: 900, height: 1400 },
  startNodeId: "entry",
  nodes: [
    { id: "entry", x: 450, y: 1180, kind: "path" },
    { id: "lowerLanding", x: 450, y: 980, kind: "path" },
    { id: "bridgeNorth", x: 450, y: 760, kind: "path" },
    { id: "bridgeEast", x: 620, y: 760, kind: "path" },
    { id: "goal", x: 450, y: 300, kind: "goal" }
  ],
  edges: [
    { from: "entry", to: "lowerLanding" },
    { from: "lowerLanding", to: "bridgeNorth", requiresState: { bridgeA: "north" } },
    { from: "lowerLanding", to: "bridgeEast", requiresState: { bridgeA: "east" } }
  ]
}
```

Verification:
- level reads clearly in one screenful
- one interaction creates one “aha”
- it can be completed one-handed on mobile

Commit:
- `git add src/levels.js && git commit -m "feat: add signal stair monument-style chapter"`

### Task 11: Rewrite the chapter copy to be quieter and more symbolic
Objective: support the new tone.

Files:
- Modify: `src/levels.js`
- Modify: `index.html`

Copy direction:
- shorter lines
- fewer jokes per interaction
- more poetic descriptions
- treat tech as ritual architecture

Example replacements:
- “Find the floppy disk.” -> “Find the memory that still opens doors.”
- “Use the gate console.” -> “Touch the spindle and let the path turn.”
- “Prove you still work.” -> “Answer the machine in its own language.”

Verification:
- no level-critical message takes more than two short lines
- the game sounds more hushed than snarky in the new chapter

Commit:
- `git add src/levels.js index.html && git commit -m "feat: shift mobile chapter copy toward dream architecture tone"`

---

## Milestone 5: Reframe the renderer around sculpture and readability

### Task 12: Add node markers and path readability helpers
Objective: make tap targets obvious without clutter.

Files:
- Modify: `src/renderer.js`

Add visuals for graph levels:
- subtle floor pips for nodes
- softly glowing connection strips for active edges
- brighter destination halo for the goal node
- muted/hidden edges for currently inactive routes

Rules:
- active path color: pale cyan or warm ivory
- inactive path color: dark desaturated slate
- no loud arcade outlines

Verification:
- player can tell where they may move before tapping
- active vs inactive routes are readable on mobile at arm’s length

Commit:
- `git add src/renderer.js && git commit -m "feat: render node and path readability helpers"`

### Task 13: Reduce junk density in graph chapters
Objective: shift the visual style from scrap clutter to curated dream architecture.

Files:
- Modify: `src/renderer.js`
- Modify: `src/levels.js`

Changes:
- for graph chapters, skip most `scatter_scrap` dressing
- use a few large iconic forms instead:
  - keyboard causeway
  - CRT shrine
  - floppy pedestal
  - modem spire
- add more negative space around the path silhouette

Verification:
- screenshot of the chapter reads as a single composed puzzle object
- interactables and traversable routes are visually dominant

Commit:
- `git add src/renderer.js src/levels.js && git commit -m "feat: simplify graph chapter dressing for stronger silhouettes"`

### Task 14: Add chapter-specific camera anchors for portrait composition
Objective: stop the camera from merely following the player; make it frame the puzzle.

Files:
- Modify: `src/levels.js`
- Modify: `src/game.js`
- Modify: `src/renderer.js`

Data to add:
```js
cameraRig: {
  mode: "anchored",
  focus: { x: 450, y: 700 },
  followStrength: 0.18,
  deadZone: 90
}
```

Behavior:
- graph chapters should use a mostly fixed camera centered on the sculpture
- slight drift toward the player is okay
- structure interactions may temporarily pan to the rotator or goal

Verification:
- the player rarely forces large camera moves in graph chapters
- the stage feels like a framed object, not a scrolling map

Commit:
- `git add src/levels.js src/game.js src/renderer.js && git commit -m "feat: add anchored camera rigs for puzzle chapters"`

---

## Milestone 6: Remove systems that fight the new feel

### Task 15: Disable integrity damage and hazards on graph chapters
Objective: eliminate tension sources that undermine contemplation.

Files:
- Modify: `src/game.js`

Rules:
- if `navigationMode === "graph"`, skip:
  - `updateHazards()`
  - conveyor push logic
  - damage/integrity loss as a fail loop
- battery meter can remain in HUD for now, but it should become symbolic later if it no longer represents health

Verification:
- graph chapter cannot fail from timing or collision damage
- challenge comes only from path understanding

Commit:
- `git add src/game.js && git commit -m "feat: disable hazard pressure in puzzle chapters"`

### Task 16: Demote the on-screen D-pad once tap movement is stable
Objective: let the control scheme match the new design.

Files:
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/main.js`

Recommended behavior:
- keep `ACT`
- hide the D-pad in graph chapters, or reduce it to an accessibility fallback behind a toggle
- preserve query-string fallback like `?touchpad=1` if you want emergency testing

Verification:
- graph chapter is comfortably playable with taps + ACT only
- the interface no longer advertises movement as “use the pad to move” for graph chapters

Commit:
- `git add index.html styles.css src/main.js && git commit -m "feat: make tap movement primary in monument-style chapters"`

---

## Milestone 7: QA and polish the vertical slice

### Task 17: Add automated tests for structure-driven path updates
Objective: lock down the new game grammar.

Files:
- Modify: `tests/level-graph.test.js`
- Create: `tests/graph-level-state.test.js`

Test cases:
- rotating a structure changes reachable neighbors
- a goal remains unreachable before rotation and reachable after rotation
- graph levels initialize player position from `startNodeId`

Verification:
- `npm test`

Commit:
- `git add tests/level-graph.test.js tests/graph-level-state.test.js && git commit -m "test: cover structure-driven graph navigation"`

### Task 18: Browser-QA the mobile chapter in forced mobile mode
Objective: verify the feel, not just the code.

Files:
- No source changes required unless bugs found

Run:
- `npm run build`
- `npm run preview`
- open `http://127.0.0.1:4173/?mobile=1`

Checklist:
- title and chapter copy are touch-first
- graph chapter fits the portrait screen compositionally
- taps reliably select nodes and rotators
- route changes are visually clear after rotation
- no keyboard is needed for the happy path
- experience feels calm and “architectural” rather than hectic

If issues appear:
- fix readability before adding more content
- fix composition before adding more mechanics
- fix interaction reliability before changing art

Commit:
- `git add ... && git commit -m "fix: polish monument-style mobile chapter"`

---

## Recommended content roadmap after the vertical slice works

Do not port all 13 levels immediately. Convert them in waves.

Wave 1: prototype the new language
- Signal Stair
- Modem Chapel
- Floppy Causeway

Wave 2: broaden the architecture vocabulary
- rotating bridge
- folding stair
- perspective-alignment fake bridge

Wave 3: refit the story spine
- chapter intros become memory-ritual beats
- old machines become shrine-like guides
- ending becomes ascent/reconnection instead of escape sprint

A good rule:
- each new chapter adds exactly one new spatial idea
- no chapter should need both hazard mastery and puzzle reasoning

---

## Exact file-by-file impact summary

Primary implementation files:
- `src/game.js`
  - add graph state
  - add tap movement
  - add structure state
  - add graph update branch
  - gate legacy hazard systems off in graph chapters
- `src/levels.js`
  - add graph chapter data: nodes, edges, interactors, cameraRig, structureStates
  - repurpose one existing mobile chapter into the first Monument Valley-style slice
- `src/renderer.js`
  - add world-point hit conversion for taps
  - render nodes, active edges, goal markers, and rotating structures
  - support anchored composition camera
- `src/main.js`
  - route scene taps into the game
  - keep touch controls, but make tap movement primary
- `index.html`
  - update touch-first copy and potentially reduce visible D-pad emphasis
- `styles.css`
  - adjust control layout for tap-first puzzle mode
- `src/level-graph.js`
  - new helper module for graph/path logic
- `tests/level-graph.test.js`
  - graph state coverage
- `tests/graph-level-state.test.js`
  - structure interaction coverage

Secondary docs:
- `docs/design/monument-valley-mobile-pillars.md`
- `docs/plans/2026-04-19-monument-valley-mobile-pivot.md`

---

## Success criteria

This pivot is successful when all of the following are true in the mobile repo:
- one level can be finished with taps and ACT, no D-pad required
- the player never needs dexterity timing to solve that level
- rotating one structure visibly changes the valid path
- the camera frames the whole chapter like a portrait sculpture
- the stage reads cleanly on a phone-sized screen
- the tone feels quieter, stranger, and more reverent than the current scrapyard run

If you only build one thing from this plan, build:
- one compact portrait chapter
- one rotating bridge mechanic
- one tap-to-move flow

That is enough to prove whether “Obsolete meets Monument Valley” is real.
