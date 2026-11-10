/**
 * The animation lab — the Phase 0 tuning harness.
 *
 * It renders every swim style side by side, every idle activity on a lounger,
 * and adds a phase scrubber plus a stick-figure overlay that dumps the numeric
 * pose. This is the tool that turns "the crawl looks wrong" into "the elbow
 * bend peaks 0.3 s too late".
 */

import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { observeHostSize } from '../scene/pixi';
import { CharacterAnimator } from '../scene/characters/animator';
import { buildRig } from '../scene/characters/rig';
import { specFor, type IdleActivity, type SwimStyle } from '../scene/characters/spec';
import type { ReactionKind } from '../scene/characters/poses';

const SWIM_ORDER: SwimStyle[] = ['crawl', 'breaststroke', 'butterfly', 'doggy'];
const ACTIVITY_ORDER: IdleActivity[] = [
  'tea',
  'book',
  'phone',
  'sunbathe',
  'nap',
  'stretch',
  'snack',
  'chat',
  'newspaper',
  'cards',
  'call',
];

const UNIT = 190; // pixels per character height

interface Controls {
  phase: number;
  activityU: number;
  reactionU: number;
  playing: boolean;
  skeleton: boolean;
}

export function Lab() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<Controls>({
    phase: 0,
    activityU: 0.4,
    reactionU: 0.35,
    playing: true,
    skeleton: false,
  });
  const [controls, setControls] = useState<Controls>(controlsRef.current);
  const [dump, setDump] = useState('');
  const [error, setError] = useState('');

  const update = (patch: Partial<Controls>) => {
    controlsRef.current = { ...controlsRef.current, ...patch };
    setControls(controlsRef.current);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let initialized = false;
    const app = new Application();
    const animators: CharacterAnimator[] = [];
    let resizeObserver: ResizeObserver | null = null;

    app
      .init({
        antialias: true,
        background: '#0d1b26',
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        initialized = true;
        host.appendChild(app.canvas);
        resizeObserver = observeHostSize(app, host);

        const scene = new Container();
        app.stage.addChild(scene);

        // Backdrop: a water band for the swimmers and a deck band for the loungers.
        const backdrop = new Graphics();
        backdrop.rect(0, 0, 4000, 4000).fill('#0d1b26');
        backdrop.rect(0, 0, 4000, 220).fill('#12314a');
        backdrop.rect(0, 220, 4000, 4000).fill('#c9b79a');
        scene.addChild(backdrop);

        const swimmers: CharacterAnimator[] = [];
        SWIM_ORDER.forEach((style, i) => {
          const spec = specFor(`lab-swim-${style}`, 'subagent', { swimStyle: style, height: 1 });
          const rig = buildRig(spec);
          rig.root.position.set(170 + i * 280, 210);
          rig.root.scale.set(UNIT * spec.height);
          scene.addChild(rig.root);
          const animator = new CharacterAnimator(rig);
          animator.setState('swimming');
          swimmers.push(animator);
          animators.push(animator);

          const label = new Text({
            text: style,
            style: { fontFamily: 'monospace', fontSize: 14, fill: 0xdff2ff },
          });
          label.position.set(170 + i * 280 - 30, 226);
          scene.addChild(label);
        });

        const loungers: CharacterAnimator[] = [];
        // The activities are laid out in rows, so that a long list still
        // fits on the screen.
        const PER_ROW = 4;
        const COLUMN = 300;
        const ROW = 220;
        ACTIVITY_ORDER.forEach((activity, i) => {
          const spec = specFor(`lab-act-${activity}`, 'subagent', { idleActivity: activity });
          const rig = buildRig(spec);
          rig.root.position.set(150 + (i % PER_ROW) * COLUMN, 430 + Math.floor(i / PER_ROW) * ROW);
          rig.root.scale.set(UNIT * spec.height);
          scene.addChild(rig.root);
          const animator = new CharacterAnimator(rig);
          animator.setState('lounging');
          loungers.push(animator);
          animators.push(animator);

          const label = new Text({
            text: activity,
            style: { fontFamily: 'monospace', fontSize: 14, fill: 0x3a2f22 },
          });
          label.position.set(150 + (i % PER_ROW) * COLUMN - 30, 442 + Math.floor(i / PER_ROW) * ROW);
          scene.addChild(label);
        });

        const skeletonGraphics = new Graphics();
        scene.addChild(skeletonGraphics);

        // The reactions: the same wave on a character that lies down and on
        // one that stands, and the look of a swimmer.
        const reactions: { animator: CharacterAnimator; kind: ReactionKind }[] = [];
        const REACTIONS: { kind: ReactionKind; state: 'lounging' | 'resting' | 'swimming' }[] = [
          { kind: 'waveLying', state: 'lounging' },
          { kind: 'wave', state: 'resting' },
          { kind: 'look', state: 'swimming' },
        ];
        const REACTION_ROW = 430 + Math.ceil(ACTIVITY_ORDER.length / PER_ROW) * ROW + 60;
        REACTIONS.forEach((item, i) => {
          const spec = specFor(`lab-react-${item.kind}-${item.state}`, 'subagent');
          const rig = buildRig(spec);
          rig.root.position.set(170 + i * 280, REACTION_ROW);
          rig.root.scale.set(UNIT * spec.height);
          scene.addChild(rig.root);
          const animator = new CharacterAnimator(rig);
          animator.setState(item.state);
          animator.scrubReaction(item.kind, controlsRef.current.reactionU);
          animators.push(animator);
          reactions.push({ animator, kind: item.kind });

          const label = new Text({
            text: `${item.kind} / ${item.state}`,
            style: { fontFamily: 'monospace', fontSize: 14, fill: 0x3a2f22 },
          });
          label.position.set(170 + i * 280 - 40, REACTION_ROW + 12);
          scene.addChild(label);
        });

        app.ticker.add((ticker) => {
          const dt = ticker.deltaMS;
          const c = controlsRef.current;

          for (const a of swimmers) {
            if (!c.playing) a.setPhase(c.phase);
            a.update(dt);
          }
          for (const a of loungers) {
            // Always force the activity in the lab so every variant is visible.
            a.forceActivity(c.activityU);
            a.update(dt);
          }
          for (const r of reactions) {
            r.animator.scrubReaction(r.kind, c.reactionU);
            r.animator.update(dt);
          }

          skeletonGraphics.clear();
          if (c.skeleton) {
            for (const a of animators) {
              const rig = a.rig;
              const p = (node: Container) => {
                const g = node.getGlobalPosition();
                return { x: g.x, y: g.y };
              };
              const sh = p(rig.armL);
              const el = p(rig.elbowL);
              const ha = p(rig.handL);
              const shR = p(rig.armR);
              const elR = p(rig.elbowR);
              const haR = p(rig.handR);
              const hp = p(rig.legL);
              const kn = p(rig.kneeL);
              const ft = p(rig.footL);
              const hpR = p(rig.legR);
              const knR = p(rig.kneeR);
              const ftR = p(rig.footR);
              const hd = p(rig.headPivot);
              const body = p(rig.body);
              const line = (a1: { x: number; y: number }, b1: { x: number; y: number }) => {
                skeletonGraphics.moveTo(a1.x, a1.y).lineTo(b1.x, b1.y);
              };
              line(sh, el);
              line(el, ha);
              line(shR, elR);
              line(elR, haR);
              line(hp, kn);
              line(kn, ft);
              line(hpR, knR);
              line(knR, ftR);
              line(body, hd);
              skeletonGraphics.stroke({ width: 1.5, color: 0xff4d6d, alpha: 0.9 });
            }
          }

          const first = swimmers[0];
          const lounger = loungers[0];
          if (first && lounger) {
            const lp = lounger.currentPose;
            const p = first.currentPose;
            setDump(
              `loungeRootRot ${lp.rootRot.toFixed(2)} w=${JSON.stringify(lounger.layerWeights)}  swimRootRot ${p.rootRot.toFixed(2)}  armL ${p.armL.toFixed(2)}  elbowL ${p.elbowL.toFixed(
                2,
              )}  armR ${p.armR.toFixed(2)}  legL ${p.legL.toFixed(2)}  kneeL ${p.kneeL.toFixed(
                2,
              )}  bodyPitch ${p.bodyPitch.toFixed(2)}  bob ${p.bob.toFixed(3)}`,
            );
          }
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      for (const a of animators) a.destroy();
      resizeObserver?.disconnect();
      // Only tear down a fully initialised application; destroying a pending
      // one throws inside Pixi.
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);

  return (
    <div className="lab">
      <div className="lab-stage" ref={hostRef} />
      {error ? <pre className="lab-error">init failed: {error}</pre> : null}
      <div className="lab-controls">
        <label>
          phase {controls.phase.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={controls.phase}
            onChange={(e) => update({ phase: Number(e.target.value) })}
          />
        </label>
        <label>
          activity {controls.activityU.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={controls.activityU}
            onChange={(e) => update({ activityU: Number(e.target.value) })}
          />
        </label>
        <label>
          reaction {controls.reactionU.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={controls.reactionU}
            onChange={(e) => update({ reactionU: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={controls.playing}
            onChange={(e) => update({ playing: e.target.checked })}
          />
          animate
        </label>
        <label>
          <input
            type="checkbox"
            checked={controls.skeleton}
            onChange={(e) => update({ skeleton: e.target.checked })}
          />
          skeleton
        </label>
        <pre className="lab-dump">{dump}</pre>
      </div>
    </div>
  );
}
