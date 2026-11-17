/**
 * The animation lab, in 3D (`?lab&3d`).
 *
 * Every swim style in a strip of water, every idle activity on a lounger,
 * every reaction on a figure that stands. The camera orbits, so a stroke
 * can be looked at from the side, from above and from the front; the
 * scrubbers freeze a stroke, an activity or a reaction at one moment. The
 * parts of a stroke that a side view cannot show (the roll, the arms out to
 * the side, the wave down the spine) are what is worth looking at here.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARCHETYPES, specFor, type Archetype, type SwimStyle } from '../scene/characters/spec';
import { type ReactionKind } from '../scene/characters/poses';
import { ACTIONS, ACTION_ORDER, type ActionKind } from '../scene/motion/actions';
import { applyPose3D } from '../scene/characters3d/apply3d';
import { buildRig3D, characterMaterial, type Rig3D } from '../scene/characters3d/rig3d';
import { restPosition } from '../scene/characters3d/skeleton3d';
import { LEISURE_KINDS, type LeisureKind } from '../scene/motion/leisureKind';
import { PoseDriver, type PropKind } from '../scene/motion/driver';
import { underwaterUniforms } from '../scene/pool3d/underwater';

const SWIM_ORDER: SwimStyle[] = ['crawl', 'breaststroke', 'butterfly', 'doggy', 'backstroke', 'float'];
/**
 * `?shape=squat` (or any archetype) draws the lounger row with that figure
 * shape, so a two-handed prop can be checked on a short or a round body.
 * Without it each figure keeps the shape its id gives.
 */
const SHAPE = (() => {
  const shape = new URLSearchParams(window.location.search).get('shape');
  return shape && Object.keys(ARCHETYPES).includes(shape) ? (shape as Archetype) : null;
})();
const REACTIONS: ReactionKind[] = ['wave', 'look'];
const HEIGHT = 1.7;
const WATER_Y = -0.18;
/** The row of loungers: one for every activity, along x, at this depth. */
const ROW_Z = -1.5;
const ROW_SPACING = 1.6;
/** How long one loop of an activity takes in the lab, in seconds. */
const LAB_SECONDS = 12;

interface Controls {
  phase: number;
  activityU: number;
  reactionU: number;
  playing: boolean;
}

interface Figure {
  rig: Rig3D;
  driver: PoseDriver;
  kind: 'swim' | 'leisure' | 'reaction' | 'action' | 'edge';
  reaction?: ReactionKind;
  action?: ActionKind;
  /** How long it is until the one-shot action plays again. */
  actionTimer: number;
  /** The activity of a lounger. */
  leisure?: LeisureKind;
}

/** The "lounger" select: one lounger framed, or the whole row. */
const ROW_VIEW = -1;

export function Lab3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<Controls>({ phase: 0, activityU: 0.4, reactionU: 0.35, playing: true });
  const [controls, setControls] = useState<Controls>(controlsRef.current);
  const [dump, setDump] = useState('');

  const [propsOnly, setPropsOnly] = useState(false);
  const figuresRef = useRef<Figure[]>([]);
  /** The lounger that is framed, or ROW_VIEW for the whole row. */
  const [focus, setFocus] = useState(0);
  /** Set by the camera buttons and the select once the scene exists. */
  const viewRef = useRef<(view: 'front' | 'side', index: number) => void>(() => undefined);
  const focusRef = useRef<(index: number) => void>(() => undefined);

  const update = (patch: Partial<Controls>) => {
    controlsRef.current = { ...controlsRef.current, ...patch };
    setControls(controlsRef.current);
  };

  const togglePropsOnly = (on: boolean) => {
    setPropsOnly(on);
    // The bodies share one material and their outlines are drawn apart, so
    // turning them off hides every body in the lab, and the props stay.
    characterMaterial().visible = !on;
    for (const f of figuresRef.current) f.rig.outline.visible = !on;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color('#bfe6f7');
    scene.add(new HemisphereLight('#cfeefc', '#e9dcc4', 1.5));
    const sun = new DirectionalLight('#fff4e0', 2.2);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    scene.add(sun);
    underwaterUniforms.uWaterY.value = WATER_Y;

    // The deck, in two pieces either side of the strip of water: one piece
    // over the whole floor covered the water and hid the swimmers.
    const deckMaterial = new MeshLambertMaterial({ color: '#e9dcc4' });
    for (const [z, depth] of [[-8.9, 20.6], [9.65, 10.1]] as const) {
      const deck = new Mesh(new PlaneGeometry(40, depth), deckMaterial);
      deck.rotation.x = -Math.PI / 2;
      deck.position.set(0, 0, z);
      deck.receiveShadow = true;
      scene.add(deck);
    }
    for (const x of [-27, 27]) {
      const side = new Mesh(new PlaneGeometry(26, 3.6), deckMaterial);
      side.rotation.x = -Math.PI / 2;
      side.position.set(x, 0, 3);
      scene.add(side);
    }
    // A strip of water for the swimmers: a sunken box and a see-through top.
    // Drawn from the inside, the box is a hollow basin: its top face is
    // culled, and the floor and the walls show.
    const basin = new Mesh(
      new BoxGeometry(14, 1.6, 3.2),
      new MeshLambertMaterial({ color: '#7cc8e0', side: BackSide }),
    );
    basin.position.set(0, -0.81, 3);
    scene.add(basin);
    const water = new Mesh(
      new PlaneGeometry(14, 3.2),
      new MeshLambertMaterial({ color: '#3aa7d0', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_Y, 3);
    scene.add(water);

    const figures: Figure[] = [];
    figuresRef.current = figures;
    const add = (id: string, overrides: Parameters<typeof specFor>[2], kind: Figure['kind'], x: number, z: number, reaction?: ReactionKind, action?: ActionKind) => {
      const spec = specFor(id, 'subagent', overrides);
      const rig = buildRig3D(spec);
      const scale = HEIGHT * spec.height;
      rig.root.scale.setScalar(scale);
      scene.add(rig.root);
      const driver = new PoseDriver(spec);
      const figure: Figure = { rig, driver, kind, reaction, action, actionTimer: 0 };
      if (kind === 'swim') {
        driver.setState('swimming');
        // Lying along +x, the middle of the body over its spot.
        rig.root.rotation.y = Math.PI / 2;
        rig.root.position.set(x - scale * 0.5, WATER_Y - 0.06, z);
      } else if (kind === 'leisure') {
        // On its lounger, leaning back, the hips over the seat.
        driver.setState('lounging');
        const hip = restPosition(rig.skeleton, 'hips').y * scale;
        rig.root.position.set(x, 0.42 - hip, z);
      } else if (kind === 'edge') {
        // Sitting on the coping, the feet over the water.
        driver.setState('edgeSitting');
        const hip = restPosition(rig.skeleton, 'hips').y * scale;
        rig.root.position.set(x, -hip + 0.05, z);
      } else {
        driver.setState('resting');
        rig.root.position.set(x, 0, z);
      }
      figures.push(figure);
    };

    SWIM_ORDER.forEach((style, i) => add(`lab-swim-${style}`, { swimStyle: style, accessory: 'none' }, 'swim', -4.8 + i * 3.2, 3));
    // One lounger for every activity of the 3D pool, in one row, each with its name.
    const labels: { el: HTMLDivElement; at: Vector3 }[] = [];
    const loungers: Group[] = [];
    const loungerFigures: Figure[] = [];
    const rowX0 = -((LEISURE_KINDS.length - 1) / 2) * ROW_SPACING;
    LEISURE_KINDS.forEach((leisure, i) => {
      const x = rowX0 + i * ROW_SPACING;
      // Every activity is played by the driver, so the lab shows what the
      // pool shows: the activity's own pose and prop.
      add(`lab-act-${leisure}`, { idleActivity: 'none', accessory: 'none', ...(SHAPE ? { archetype: SHAPE } : {}) }, 'leisure', x, ROW_Z);
      const f = figures[figures.length - 1];
      f.leisure = leisure;
      f.driver.playActivity(leisure, LAB_SECONDS);
      loungerFigures.push(f);
      // A seat and a back rest to lean on.
      const lounger = new Group();
      const seat = new Mesh(new BoxGeometry(0.7, 0.42, 1.4), new MeshLambertMaterial({ color: '#f2c14e' }));
      seat.position.set(x, 0.21, ROW_Z + 0.45);
      seat.receiveShadow = true;
      const back = new Mesh(new BoxGeometry(0.7, 0.9, 0.08), new MeshLambertMaterial({ color: '#f2c14e' }));
      back.position.set(x, 0.75, ROW_Z - 0.35);
      back.rotation.x = -0.62;
      lounger.add(seat, back);
      scene.add(lounger);
      loungers.push(lounger);
      // The name, over the lounger's head.
      const el = document.createElement('div');
      el.textContent = leisure;
      el.style.cssText =
        'position:absolute;left:0;top:0;transform:translate(-50%,-100%);padding:1px 6px;border-radius:4px;' +
        'background:rgba(255,255,255,0.85);color:#1b2430;font:12px/1.4 system-ui,sans-serif;white-space:nowrap;pointer-events:none;';
      host.appendChild(el);
      labels.push({ el, at: new Vector3(x, 1.5, ROW_Z) });
    });
    REACTIONS.forEach((kind, i) => add(`lab-react-${kind}`, { accessory: i ? 'cap' : 'sunhat' }, 'reaction', 6 + i * 1.4, -4, kind));
    // A figure on the coping, its feet in the water: the edge where the
    // waiting agents sit (Sprint 24).
    add('lab-edge-sit', { accessory: 'none' }, 'edge', -3.4, 1.2);
    // A row of standing figures, one for every action. The one that treads
    // water stands in the water at the end of the strip.
    ACTION_ORDER.forEach((kind, i) => {
      if (kind === 'tread') {
        const spec = specFor('lab-action-tread', 'subagent', { accessory: 'none' });
        const rig = buildRig3D(spec);
        const scale = HEIGHT * spec.height;
        rig.root.scale.setScalar(scale);
        rig.root.position.set(-6.4, WATER_Y - 0.06, 3);
        scene.add(rig.root);
        figures.push({ rig, driver: new PoseDriver(spec), kind: 'action', action: kind, actionTimer: 0 });
        return;
      }
      add(`lab-action-${kind}`, { accessory: 'none' }, 'action', -6.2 + i * 2.4, -7.8, undefined, kind);
    });
    // The props the errands carry (Sprint 25), each in the hand of a standing figure.
    const CARRIED: PropKind[] = ['icecream', 'bottle', 'paddle', 'paddleDark', 'towel'];
    CARRIED.forEach((prop, i) => {
      add(`lab-prop-${prop}`, { accessory: 'none' }, 'action', -6.2 + i * 2.4, -10.6);
      figures[figures.length - 1].driver.setCarry(prop);
    });

    const camera = new PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.set(2, 9, 14);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.3, -0.5);
    orbit.enableDamping = true;
    orbit.update();

    // Only the framed lounger is shown: the others would stand in the line of
    // sight of the camera. A row view shows them all.
    const shown: boolean[] = loungers.map(() => true);
    const showOnly = (index: number) => {
      loungers.forEach((lounger, i) => {
        const on = index === ROW_VIEW || i === index;
        shown[i] = on;
        lounger.visible = on;
        loungerFigures[i].rig.root.visible = on;
      });
    };
    focusRef.current = showOnly;
    showOnly(0);

    // The camera on the framed lounger, from its foot end (where its face
    // looks) or from its side. It is far enough back to take the whole figure,
    // which lies about 1.5 m long, and a little above it.
    viewRef.current = (view, index) => {
      const i = index === ROW_VIEW ? Math.floor(LEISURE_KINDS.length / 2) : index;
      const x = rowX0 + i * ROW_SPACING;
      if (view === 'front') camera.position.set(x, 1.05, ROW_Z + 2.7);
      else camera.position.set(x + 2.9, 0.8, ROW_Z + 0.05);
      orbit.target.set(x, 0.72, view === 'front' ? ROW_Z - 0.1 : ROW_Z + 0.05);
      orbit.update();
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const projected = new Vector3();
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    (window as unknown as { __agentpoolLab?: unknown }).__agentpoolLab = { figures, camera, orbit };

    let last = performance.now();
    let dumpTimer = 0;
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dtMs = Math.min(100, now - last);
      last = now;
      const c = controlsRef.current;
      for (const f of figures) {
        if (!c.playing) {
          if (f.kind === 'swim') f.driver.setPhase(c.phase);
          // The activity slider runs the lounger's activity by hand.
          if (f.kind === 'leisure') f.driver.forceActivity(c.activityU);
          if (f.kind === 'reaction' && f.reaction) f.driver.scrubReaction(f.reaction, c.reactionU);
          // The reaction scrubber scrubs the actions too.
          if (f.kind === 'action' && f.action) f.driver.scrubAction(f.action, c.reactionU);
        } else if (f.kind === 'reaction' && f.reaction && !f.driver.isReacting) {
          f.driver.react(f.reaction);
        } else if (f.kind === 'leisure' && f.leisure && !f.driver.isDoingActivity) {
          // A lounger that has finished its loop starts it again.
          f.driver.playActivity(f.leisure, LAB_SECONDS);
        } else if (f.kind === 'action' && f.action) {
          if (ACTIONS[f.action].loop) {
            f.driver.hold(f.action);
          } else {
            // A one-shot action plays again every three seconds.
            f.actionTimer += dtMs;
            if (f.actionTimer >= 3000) {
              f.actionTimer = 0;
              f.driver.play(f.action);
            }
          }
        }
        // The driver always runs: it keeps the blink, the mouth and the hair.
        const pose = f.driver.update(c.playing ? dtMs : 0.0001);
        applyPose3D(f.rig, pose, {
          eyes: f.driver.eyes,
          hair: f.driver.hair,
          mouth: f.driver.mouth,
          ponytail: f.driver.ponytail,
          prop: f.driver.prop,
        });
      }
      orbit.update();
      renderer.render(scene, camera);
      // The names follow their loungers; a name behind the camera is hidden.
      const hostW = renderer.domElement.clientWidth;
      const hostH = renderer.domElement.clientHeight;
      labels.forEach((label, i) => {
        projected.copy(label.at).project(camera);
        label.el.style.display = shown[i] && projected.z < 1 ? '' : 'none';
        label.el.style.left = `${((projected.x + 1) / 2) * hostW}px`;
        label.el.style.top = `${((1 - projected.y) / 2) * hostH}px`;
      });
      dumpTimer += dtMs;
      if (dumpTimer > 250) {
        dumpTimer = 0;
        const p = figures[0].driver.currentPose;
        setDump(
          `crawl  arm R ${p.armR.toFixed(2)}  out ${p.armOutR.toFixed(2)}  roll ${p.roll.toFixed(2)}  ` +
            `spine ${p.spine.toFixed(2)}  kick L ${p.legL.toFixed(2)}`,
        );
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      orbit.dispose();
      for (const f of figures) f.rig.destroy();
      for (const label of labels) label.el.remove();
      characterMaterial().visible = true;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="lab">
      <div className="lab-stage lab-stage--3d" ref={hostRef} />
      <div className="lab-controls">
        <label>
          phase {controls.phase.toFixed(2)}
          <input type="range" min={0} max={1} step={0.005} value={controls.phase} onChange={(e) => update({ phase: Number(e.target.value), playing: false })} />
        </label>
        <label>
          activity {controls.activityU.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={controls.activityU} onChange={(e) => update({ activityU: Number(e.target.value), playing: false })} />
        </label>
        <label>
          reaction {controls.reactionU.toFixed(2)}
          <input type="range" min={0} max={1} step={0.005} value={controls.reactionU} onChange={(e) => update({ reactionU: Number(e.target.value), playing: false })} />
        </label>
        <label>
          <input type="checkbox" checked={controls.playing} onChange={(e) => update({ playing: e.target.checked })} />
          animate
        </label>
        <label>
          <input type="checkbox" checked={propsOnly} onChange={(e) => togglePropsOnly(e.target.checked)} />
          props only
        </label>
        <label>
          lounger
          <select
            value={focus}
            onChange={(e) => {
              const index = Number(e.target.value);
              setFocus(index);
              focusRef.current(index);
            }}
          >
            {LEISURE_KINDS.map((kind, i) => (
              <option key={kind} value={i}>{kind}</option>
            ))}
            <option value={ROW_VIEW}>whole row</option>
          </select>
        </label>
        <button type="button" onClick={() => viewRef.current('front', focus)}>front</button>
        <button type="button" onClick={() => viewRef.current('side', focus)}>side</button>
        <pre className="lab-dump">{dump}</pre>
      </div>
    </div>
  );
}
