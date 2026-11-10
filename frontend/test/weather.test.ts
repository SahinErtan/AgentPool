/**
 * The weather over the pool.
 *
 * The weather is a pure function of the clock, so everyone watching the
 * same pool sees the same rain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rainAmount, SPELL_S, weatherFor } from '../src/scene/pool/weather';

/** A time in the middle of a spell that rains. */
function aRainSpell(): number {
  for (let spell = 0; spell < 400; spell += 1) {
    const start = spell * SPELL_S;
    if (weatherFor(start + 10) === 'rain') return start + SPELL_S / 2;
  }
  throw new Error('no rain in the first four hundred spells');
}

test('the weather is the same for everybody', () => {
  const at = 1_700_000_000;
  assert.equal(weatherFor(at), weatherFor(at));
});

test('the weather holds for a whole spell', () => {
  const at = 1_700_000_000;
  const spell = Math.floor(at / SPELL_S);
  const weather = weatherFor(at);
  assert.equal(weatherFor(spell * SPELL_S + 1), weather);
  assert.equal(weatherFor(spell * SPELL_S + SPELL_S - 1), weather);
});

test('the weather changes from one spell to the next', () => {
  // Over a hundred spells there is more than one kind of weather.
  const kinds = new Set<string>();
  for (let spell = 0; spell < 100; spell += 1) {
    kinds.add(weatherFor(spell * SPELL_S + 5));
  }
  assert.ok(kinds.size > 1, 'the weather never changes');
});

test('there is no rain when it does not rain', () => {
  for (let spell = 0; spell < 60; spell += 1) {
    const at = spell * SPELL_S + 100;
    if (weatherFor(at) === 'rain') continue;
    assert.equal(rainAmount(at), 0);
  }
});

test('the rain is heaviest in the middle of the spell', () => {
  const middle = aRainSpell();
  assert.equal(weatherFor(middle), 'rain');
  assert.equal(rainAmount(middle), 1);
});

test('the rain fades in and out', () => {
  const middle = aRainSpell();
  const start = middle - SPELL_S / 2;
  assert.ok(rainAmount(start) < 0.5, 'the rain does not fade in');
  assert.ok(rainAmount(middle - SPELL_S / 2 + 120) > rainAmount(start));
});
