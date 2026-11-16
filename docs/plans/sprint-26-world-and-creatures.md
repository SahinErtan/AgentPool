# Sprint 26 — The world round the pool, and a few creatures

**Goal.** The pool lives even when no agent moves:

- **A few creatures:**
  - a cat that wanders, naps in the sun and watches the swimmers;
  - a duck that visits the quiet water now and then;
  - a pair of birds that cross the sky;
  - two butterflies over the flowers.
- **The sky and the day:**
  - clouds and their shadows drifting over the deck;
  - stars and a moon at night;
  - underwater lights, lanterns and string lights after dark;
  - a lawn sprinkler in the morning;
  - petals and leaves drifting onto the water.
- **The weather changes what people do.** In the rain the loungers cover
  their heads, the walkers hurry and the cat shelters.

**The limit the user set.** The only humans are the agents, and there are
**very few animals**. At most **four creatures on screen at once**, all
kinds together. That is `MAX_CREATURES = 4`, checked by a test.

Read `docs/plans/README.md` first. This sprint needs Sprints 21, 23 and 25.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/pool3d/creatures.ts` (pure: who is where and does what), `src/scene/pool3d/creatures3d.ts` (drawing), `src/scene/pool3d/sky.ts` (clouds, stars, moon, cloud shadows), `src/scene/pool3d/nightlights.ts`, `test/creatures.test.ts` |
| Changed | `pool3d/lighting.ts`, `pool3d/water.ts` (the night glow, calm), `pool3d/environment.ts` (flower beds, lantern posts, the sprinkler head, the wet deck), `pool3d/effects3d.ts` (petals), `pool3d/flow.ts` (rain behaviour), `pool3d/errands.ts` (rain already handled; the cat avoids errand spots), `pool3d/PoolScene3D.ts`, `test/world3d.test.ts` |

---

## Step 26.1 — The creature director (`creatures.ts`, pure)

```ts
export const MAX_CREATURES = 4;
export type CreatureKind = 'cat' | 'duck' | 'bird' | 'butterfly';

export interface Creature {
  id: string;               // 'cat', 'duck', 'bird-0', 'bird-1', 'butterfly-0', 'butterfly-1'
  kind: CreatureKind;
  x: number; y: number; z: number;
  yaw: number;
  state: string;            // per kind, below
  t: number;                // seconds in the state
  target: Vec3 | null;
  /** 0..1, for the drawing: walk cycle, wing beat, paddle. */
  cycle: number;
}

export interface CreatureWorld {
  world: World;
  hour: number;             // 0..24
  light: number;            // palette.light
  raining: boolean;
  reducedMotion: boolean;
  /** People, to keep away from: feet positions and whether they move. */
  people: ReadonlyArray<{ x: number; z: number; moving: boolean; inWater: boolean }>;
  /** Big splashes this frame (from body events), to be startled by. */
  splashes: ReadonlyArray<{ x: number; z: number; size: number }>;
}

export class CreatureDirector {
  constructor(seed: number);
  step(dt: number, now: number, env: CreatureWorld): void;
  get creatures(): readonly Creature[];   // only the ones present
}
```

**The budget.** Creatures are added in this order of priority: cat, duck,
the birds (always as a pair), the butterflies. A creature is only added
when `present + itsCount <= MAX_CREATURES`. For example, with the cat and
the duck present, a pair of birds may come, and then there is no room for
a butterfly.

**Reduced motion.** The cat is present and only sleeps or sits. No duck,
birds or butterflies.

### The cat

There is always one. It is ginger with white paws: a fixed look, with no
id and no label.

**Where it may be:** the deck outside the obstacles and outside the pool
(0.3 m margin), and the garden up to 6 m outside the fence. It may cross
the fence anywhere, because cats go under fences. It avoids the hut and
the trees' trunks, each a 0.8 m circle.

**What it does:**

| State | What happens | Lasts | Next |
|---|---|---|---|
| `wander` | Walks to a target at 0.6 m/s | until it arrives | `sit` 40 %, `groom` 20 %, `sleep` 20 % (in the day, on a sunny spot), `watch` 20 % (if any swimmer) |
| `sit` | Sits, the tail twitching | 8–20 s | `wander` |
| `groom` | Sits and licks a paw | 5–9 s | `sit` or `wander` |
| `sleep` | Curled up | 60–180 s | `stretch` |
| `stretch` | The front legs forward, the back up | 2 s | `wander` |
| `watch` | Walks to the coping nearest the nearest swimmer, sits facing the water, the head turning after that swimmer | 15–40 s | `wander` |
| `flee` | Trots at 1.8 m/s away from the cause, to a point 4 m away | until it arrives | `sit` |
| `shelter` | It rains: walks to the hut's porch, `(hut.x + 1.6, hut.z)`, and sits | while it rains | `wander` |

- **Targets for `wander`** are drawn from a seeded list of interest
  points:
  - 8 sunny deck spots: the near side and the terrace corners;
  - the foot of an occupied lounger, the side away from the pool. It
    naps next to an agent; that one is the cute one;
  - 3 garden spots;
  - the hut's porch.
- **`flee` happens when:**
  - a person is moving towards it within 1.0 m: their velocity points at
    the cat, or at most 45° off;
  - a splash of size 1.4 or more lands within 4 m;
  - the sprinkler runs within 3 m;
  - the person clicks on it (Sprint 27).
- **At night** (`light < 0.25`) the cat sleeps on the hut's porch and only
  wakes to `stretch` and `wander` once an hour.

### The duck

**It visits by day.** It comes when `light > 0.4`, it is not raining, and
the time since the last visit is between 8 and 15 minutes (seeded). At
most one is present.

| State | What happens |
|---|---|
| `flyIn` | It flies in from a garden edge on a descending curve: from y 8 down to the water, 6 s. Its landing spot is a point in the pool with no swimmer within 4 m. It prefers the shallow third; if there is none, it does not come this time. |
| `paddle` | It drifts at 0.25 m/s to a new point every 6–12 s, keeping 2.5 m from every swimmer and 0.5 m from the walls. It leaves a ripple every 1 s. It stays 60–120 s in all. |
| `dabble` | Head under, tail up, for 2 s, every 15–30 s. |
| `takeOff` | It runs on the water for 1 s (wing flaps and 4 small splashes), then climbs away on a curve to a garden edge and leaves. |

It takes off when its time is up, a swimmer comes within 1.8 m, a splash
of size 1.4 or more lands within 5 m, or the light falls below 0.35.

### The birds

- **A pair**, by day (`light > 0.35`), not in the rain. Every 3–6 minutes
  (seeded) they cross the sky on a gentle curve from one side of the world
  to the other, at y 12–18, 6 m apart, in 14–20 s.
- **They may land.** With a 30 % chance, one of them lands on the fence's
  top rail or on a parasol's top for 20–40 s, then flies off after the
  other. That one is `perched`, and its wings fold.
- Both count against the budget while either is present.

### The butterflies

- **Up to two**, when `light > 0.5`, it is not raining and the budget
  allows.
- They flutter round the flower beds (Step 26.3) on noise paths, at
  y 0.3–1.4, at 0.5 m/s. Every 10–20 s one lands on a flower for 3–6 s
  with its wings closed.
- They never go over the water.

**Check.** `test/creatures.test.ts` steps a `CreatureDirector` for 4 hours
of simulated time (dt = 0.1 s). It moves the hour from 6 to 22, with a
rain spell from hour 12 to 12.5, and has 10 fake people walking and
swimming with seeded paths. These must hold:

- **The budget:** at every step, `creatures.length <= MAX_CREATURES`.
- **The cat:**
  - it is never in the pool;
  - it is never inside an obstacle;
  - during the rain it ends at the porch within 60 s;
  - with a person walking straight at it, it flees within 0.5 s.
- **The duck:**
  - it is only present when `light > 0.35`;
  - it is never within 1.5 m of a swimmer for longer than 1 s;
  - it is never outside the pool while `paddle` (0.5 m margin).
- **The birds and the butterflies** are only present by day and not in
  the rain. A butterfly is never over the water.
- **Reduced motion:** only the cat, and it never moves faster than
  0.05 m/s.
- **Determinism:** the same seed and inputs give the same positions at
  t = 3600 s.

## Step 26.2 — Drawing the creatures (`creatures3d.ts`)

Each creature is low-poly and toon-shaded with an outline, built in code
like the characters.

- **The cat:**
  - **The mesh.** Use the rigid-skinning approach from
    `characters3d/rig3d.ts` (one `SkinnedMesh`, a weight of 1 per part,
    vertex colours, the shared toon material) with its own bone list:
    `root, body, chest, head, tail1, tail2, tail3, legFL, legFR, legBL, legBR`.
  - **The parts:**
    - a body capsule of 0.45 m;
    - a head sphere of radius 0.09 with two ear cones and a muzzle;
    - three tail capsules;
    - four leg capsules;
    - white paws: small spheres at the leg ends.
  - **The gait:** the diagonal pairs swing together,
    `legFL = legBR = 0.5·sin(cycle·2π)`, and the other pair is opposite.
    The trot doubles the rate.
  - **`sit`:** the back legs folded, the body pitched up 0.5.
  - **`sleep`:** the body curled; the chest and tail bones yawed 0.9 and
    the tail wrapped round.
  - **The tail** sways on noise in every state, faster when watching.
  - **Too heavy?** If the skinning approach is too much work, a `Group`
    of up to 10 meshes that share one material is acceptable. Write which
    one you chose in the **Deviations**.
- **The duck:** body, head, beak and two wing parts. It bobs on the water
  (`y = waterY + 0.03 + 0.01·sin`). Its wings are folded on the water and
  beat (`rotation.z` ±0.9 at 6 Hz) when flying.
- **A bird:** a small body and two wings, flapping at 4 Hz with glides,
  and dark grey. It is never close to the camera, so it can be tiny.
- **A butterfly:** two quads per wing pair, flapping at 8 Hz (folding
  about the body's axis), in a yellow or a blue, seeded.
- None of them casts a shadow, apart from the cat and the duck.
- None of them can be picked by the character raycaster. Sprint 27 adds
  the cat to its own click test.

**Check.** In the browser, `debug.creatures()` lists the creatures, and
`debug.creature('duck')` calls the duck in now. Screenshots
`26-cat-sleep.png` (next to a lounger), `26-cat-watch.png`, `26-duck.png`,
`26-birds.png` and `26-butterfly.png`. The draw calls rise by at most 8
with all of them present.

## Step 26.3 — Flower beds, lantern posts, the sprinkler and the petals

In `environment.ts`, as merged static pieces:

- **Flower beds.** Three low beds (0.5 m deep, the length of 3–4 hedge
  bushes) in front of the hedge on the garden side of the far fence, with
  small coloured spheres for flowers. The butterflies use their positions,
  so put them in `World` as `flowerBeds: Area[]`.
- **Lantern posts.** Six posts along the fence, inside it, 0.3 m from
  it:
  - two on the near side;
  - two on the far side, behind the loungers;
  - two on the terrace.

  They must stay off the walking paths. The corners of the pool are where
  the paths turn, so no post goes near one. Test that every post is more
  than 1.0 m from every path-graph corner (`CORNER_CLEARANCE`-grown pool
  corners) and from every spot people stand on.
  - Each is a thin post with a lamp box on top. The lamp's material is a
    separate `MeshBasicMaterial`, whose colour is set by the night amount
    (Step 26.5).
  - All six lamp heads go in one `InstancedMesh`.
- **The sprinkler.**
  - A small head on the lawn, 5 m from the fence near the hut.
  - From 07:00 to 09:00, for 10 minutes every 30 minutes, it sweeps an
    arc: the angle goes from −1.2 to 1.2 rad and back in 8 s, launching
    `particles.arc` drops at 6 m/s and 35° up, 25 a second.
  - Not in the rain, and not with reduced motion.
- **The petals** from the 2D pool, in 3D.
  - Up to 6 at once, small pink flat discs drawn as particles of a new
    kind `petal` (6), which drift on noise and fall slowly at 0.3 m/s.
  - A petal that lands on the water floats there, turning slowly, for
    20 s, then fades.
  - One starts every 20–40 s by day when it is not raining, from a
    garden tree near the pool.
  - With the ring-buffer particle pool from Sprint 21 there is nothing new
    to allocate.

## Step 26.4 — The sky (`sky.ts`)

1. **Clouds.**
   - Six puffs, each a merged cluster of 5–8 icosahedrons, flat at the
     bottom, at y 35–55, drifting at 0.6 m/s in the wind's direction and
     wrapping round a 220 m square.
   - Their colour follows the palette: the sky's bottom colour, lightened
     by day and greyed by `palette.clouds`.
   - Overcast (`clouds > 0.6`) adds four more and darkens them. All of
     them are one `InstancedMesh`.
2. **Cloud shadows.**
   - A material patch, written like `patchCaustics` in `water.ts`:
     `patchCloudShadow(material)`. It multiplies the light by
     `1 − 0.22·cloudMask(worldPos.xz)`, where the mask is a smoothstepped
     noise moving with the clouds.
   - Apply it to the deck, the lawn, the loungers and the equipment
     materials.
   - Its strength is `uCloudShadow = palette.light · (0.4 + 0.6·palette.clouds)`:
     none at night.
3. **Stars and the moon.**
   - In the sky dome's shader (`lighting.ts`, `SKY_FRAG`), add stars when
     `palette.stars`: a hashed grid of points that twinkle slowly, only
     above 15° of altitude.
   - The moon is a disc (a small `Mesh`, `MeshBasicMaterial`, pale) placed
     opposite the sun's direction, visible when `light < 0.3`.

## Step 26.5 — The pool at night (`nightlights.ts`)

`night = clamp((0.45 − palette.light) / 0.35, 0, 1)`, eased.

- **Lights under the water:**
  - six small emissive discs on the long walls, 0.5 m under the surface,
    as one `InstancedMesh` with a basic material whose colour goes from
    the wall colour (day) to `#9ff3ff` (night);
  - in `water.ts`, a new uniform `uNightGlow`. It adds
    `vec3(0.1, 0.45, 0.55) * uNightGlow * (1.0 - depth * 0.5)` to the
    body colour, so the pool glows from inside.
- **The lanterns** (from 26.3): their colour goes from grey to
  `#ffd28a` by `night`.
- **String lights** over the terrace:
  - two catenary lines between posts across the terrace, with 30 small
    bulbs in one `InstancedMesh`;
  - by day the bulbs are dull; by night each is `#ffe3a3`, with a slow,
    seeded flicker of ±8 %.
- **Real light, used sparingly:**
  - at most **two** `PointLight`s, one over the lounger rows and one over
    the terrace, intensity `1.2·night`, distance 12, no shadows;
  - measure the frame time with and without them in `?demo=60&debug`;
  - if they cost more than 2 ms a frame, drop them, and say so in the
    **Deviations**.
- The hot tub steams at night: `particles.steam` from three points on its
  surface every 0.4 s.

## Step 26.6 — Rain changes what people do (`flow.ts`, `PoolScene3D`)

The rain is `rainAmount(Date.now() / 1000)` from `pool/weather.ts`, and it
counts as raining above 0.3.

- **Loungers** hold the new action `cover`: a towel over the head, held
  with both hands, with the towel prop carried. A `replace` action on the
  lounging pose: arms −2.4, elbows 2.0, `headPitch` 0.2.
- **Walkers** on the deck walk 1.2× faster and lean forward 0.15. The body
  gets `hurry: boolean`, set by the scene.
- **The queue and the edge-sitters:** the queue does not change; the
  edge-sitters stay, because they are wet anyway.
- **Swimmers:** no change.
- **Errands:** new errands are already limited to towel and hot tub
  (Sprint 25); running ones that are outdoors (`ballGame`, `pingPong`,
  `stroll`, `chat`) end early.
- **A wet deck:** while it rains, the deck's colour darkens by 12 %. It
  dries back over 5 minutes after the rain stops, through a `wetness`
  value (0..1) kept by the scene.
- **The parasols** sway twice as much while it rains.

**Wind** is `wind(time) = 0.5 + 0.5·fbm(time / 90, 777)`, from 0 to 1. It
scales:
- the parasol sway;
- the flag and pennant sway (Sprint 23);
- the cloud drift;
- the duck's drift.

## Step 26.7 — A calm pool

When no agent is working for 120 s in a row, the pool goes calm. It ends
the moment one starts working. (Sprint 27's `quiet` moment uses the same
signal; compute it here, in the scene, as `this.quietFor`.)

- **The water.** A new `water.setCalm(k)` scales the wave amplitudes by
  `1 − 0.6·k`, eased in over 10 s.
- **The cat** prefers `watch` (looking at the still water) and `sleep`.
- **The fountains** stay off (Sprint 23's cycle is skipped).

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- `/?2d` is unchanged.
- **The budget holds in the browser.** Add `debug.time` jumps through a
  day: 06:00, 10:00, 14:00, 19:00 and 23:00. At each, count the
  creatures; it is never more than 4.
- **Through a day:**
  - by day, the cat, the duck, the birds and the butterflies appear over
    time;
  - at night only the cat, asleep on the porch;
  - the underwater lights, the lanterns and the string lights glow.
- **In the rain:** the loungers cover their heads, the cat shelters and
  the deck darkens. To force it, add `debug.force('weather', 'rain')`.
- `/?demo=60&debug` is within budget at noon and at night.
- Screenshots:
  - `26-cat-*.png`;
  - `26-duck.png`;
  - `26-birds.png`;
  - `26-butterfly.png`;
  - `26-clouds.png`;
  - `26-night.png`;
  - `26-rain.png`;
  - `26-sprinkler.png`.
- `docs/next.md` gets the *Sprint 26* entry.

## Deviations

- **26.1, the director's inputs.** `CreatureWorld` has fields the plan did
  not list: `calm`, `sprinkler`, `avoid` (the errand spots, which the cat
  keeps off), and `naps` (the places behind the occupied loungers). A person
  has a `yaw` (its heading), so a walker can be told to be moving at the cat.
  `sprinklerOn`, `nightAmount` and `windAt` are pure exports of `creatures.ts`.
- **26.1, the hut and the trees.** The hut is a rectangle (0.3 m clear) and
  each trunk a circle of 0.8 m, as the plan says for the trunks. The hut is
  not an obstacle for the walkers, so the walkers' paths are unchanged. The
  cat's own way is checked against the hut and the trunks, and a target whose
  way crosses them is not taken.
- **26.1, the duck's take-off.** It also takes off in the rain and when the
  light falls to 0.35 or below. In the dark it is removed at once rather than
  flying away, so it is never present in the dark. Its run is 2.2 m a second
  (1.8 in the plan), so a swimmer cannot keep it on the water for more than a
  second.
- **26.1, the duck test.** "Within 1.5 m of a swimmer for longer than a
  second" is measured while the duck is on the water. In the air it flies
  over the swimmers' heads.
- **26.1, the birds.** The perch is the top of a parasol (2.55 m), not the
  fence rail. The second bird flies six metres behind the first, in line. The
  perched bird flies on to the far side after its wait, and both birds leave
  together when both are done.
- **26.1, the butterflies** fly between the three beds only, which are outside
  the far fence, so they cannot be over the water. They go at once when it is
  dark or raining.
- **26.1, the duck's landing.** A duck needs a shallow point with nobody in the
  water within four metres. In the 24-agent demo the swimmers cover the whole
  shallow third, so the duck does not come, as the plan allows. The test
  pool has room for it.
- **26.2, the cat's rig.** Not a `SkinnedMesh`, and not a group of ten meshes.
  The body (torso, head, ears, muzzle and chest) is one merged mesh, the tail
  another, and the four legs one instanced mesh. That is four draw calls, of
  which only the body is a shadow. The head does not turn on its own; the
  whole cat turns to face the water when it watches.
- **26.2, no outline.** The creatures have no inverted-hull outline, which
  would cost a draw call each. They are toon-shaded with the pieces material.
- **26.2, the duck** is one body mesh and one wings mesh, without a shadow.
  The wings fold flat on the water and are scaled up and down in the air,
  instead of being rotated. The birds are two instanced meshes for the pair
  (bodies and V-shaped wings, flapped by scale). The butterflies are one
  instanced mesh of two wings, and their wings close by scale.
- **26.2, the debug hooks.** `debug.creatures()` and `debug.creature('duck')`
  (or `'birds'`), as the plan says. The call only lets the creature come when
  it can, as the rules say.
- **26.2, the draw calls** with the four creatures of the largest combination
  (cat, duck, two birds) were not measured in one run. Measured at 60 agents:
  274 by clear day, 279 at noon, 276 at night, 288 in the rain, against 290.
- **26.3, the terrace lanterns** are at `mid - 3` and `mid + 1` on the terrace,
  not at `mid ± 4.5`. At `± 4.5` one post stood beside the kiosk on a small
  pool and another by the slide tower's corner; the test caught both.
- **26.3, the sprinkler head** is part of the hedge's merged mesh, not its own
  mesh. The sweep is the plan's: a triangle wave, eight seconds, ±1.2 rad,
  6 m/s at 35 degrees, 25 drops a second.
- **26.3, the petals** are the particle kind 5, not 6: the particle kinds are
  numbered from 0 here and confetti is 4. They are round points, not flat
  discs, so they do not turn as they float. They float at the water's surface
  for the rest of their life of 30 seconds, and fade in the last three.
- **26.4, the moon** is not placed opposite the sun. The sun in `lighting.ts`
  never sets (its elevation has a floor), so the opposite point is below the
  horizon at night. The moon sits at a fixed point in the sky, and it is shown
  when the light is below 0.3.
- **26.4, cloud shadows** are on the deck, the lawn and the shared pieces
  material (the loungers, the fence and the rest). The equipment's own
  materials are not patched.
- **26.4, the stars** are in `SKY_FRAG` and only above 15 degrees, as the
  plan says, with the night taken from `nightAmount` and the palette's `stars`.
- **26.5, the point lights** use decay 1, not the default 2. With the default
  decay the plan's intensity of 1.2 is too dim to see at lounger height. Their
  cost was not measured on its own; the night frame rate at 60 agents was 60.
- **26.5, the equipment's `setNight`** is still a no-op. The night lights live
  in `nightlights.ts`, and the equipment has nothing to light.
- **26.5, the steam** comes from three points round the tub, every 0.4 s, from
  the tub's rim at night.
- **26.6, `hurry`** is a field on the body, set by the scene each frame to
  whether it rains. It multiplies the walking speed by 1.2 and, with the
  outdoor errands (ball, ping-pong, stroll, chat), ends an errand the moment it
  is raining.
- **26.6, the cover** is an action in `replace` mode, built on the lounge pose,
  with the arms up and the head bowed, and the towel carried in the hand. It
  is not started during an errand, an idle activity or a request for the
  person. No test covers it, nor `hurry` or the lean.
- **26.6, the wind** scales the parasols' sway and the clouds' drift. The flags
  and the duck's drift do not follow it yet.
- **26.7, calm.** After 120 seconds with nobody working the water's waves fall
  to 0.4 of their size, eased over 10 seconds; the fountains stop; the cat
  prefers to watch and to sleep. `quietFor` is kept in the scene, for Sprint 27.
- **Not done: screenshots.** `26-clouds`, `26-duck`, `26-birds`,
  `26-butterfly`, `26-sprinkler` and `26-cat-watch` were not taken. Taken:
  `26-cat-sit`, `26-cat-wander`, `26-cat-close`, `26-night`, `26-rain`.
- **Not done: the day-long walk.** `debug.clock` was used at 12, 14 and 23,
  and not at 06, 10 and 19. The duck was not seen on screen in the browser.
  The pure test saw it come and leave over a simulated day.
