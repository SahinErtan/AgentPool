/**
 * The model of an agent, in words, and the tokens it costs.
 *
 * The names come from Claude Code and from other tools, and they change
 * with every release: the rule may not break on a name it has never
 * seen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prettyModel, prettyTokens, prettyTurn } from '../src/scene/model';

test('the Claude models are named in words', () => {
  assert.equal(prettyModel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(prettyModel('claude-haiku-5-5'), 'Haiku 5.5');
  assert.equal(prettyModel('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(prettyModel('claude-opus-5'), 'Opus 5');
});

test('the models of other tools are named in words too', () => {
  assert.equal(prettyModel('MiniMax-M3.1-Flash'), 'MiniMax M3.1 Flash');
  assert.equal(prettyModel('qwen3.5:2b'), 'Qwen 3.5 2B');
  assert.equal(prettyModel('gemma4:12b'), 'Gemma 4 12B');
});

test('a name nobody knows comes back as it is', () => {
  assert.equal(prettyModel('something-new-1.0'), 'Something New 1.0');
  assert.equal(prettyModel('llama3'), 'Llama 3');
});

test('no model says nothing', () => {
  assert.equal(prettyModel(null), '');
  assert.equal(prettyModel(undefined), '');
  assert.equal(prettyModel('  '), '');
});

test('the tokens are counted in thousands and millions', () => {
  assert.equal(prettyTokens(0), '0');
  assert.equal(prettyTokens(999), '999');
  assert.equal(prettyTokens(1000), '1.0 k');
  assert.equal(prettyTokens(1234), '1.2 k');
  assert.equal(prettyTokens(12900), '13 k');
  assert.equal(prettyTokens(1_500_000), '1.5 M');
  assert.equal(prettyTokens(12_000_000), '12 M');
});

test('no tokens say nothing', () => {
  assert.equal(prettyTokens(null), '');
  assert.equal(prettyTokens(undefined), '');
});

test('a turn says what went in and what came out', () => {
  assert.equal(prettyTurn(1234, 56), '1.2 k in · 56 out');
  assert.equal(prettyTurn(1234, null), '1.2 k in');
  assert.equal(prettyTurn(null, 56), '56 out');
  assert.equal(prettyTurn(null, null), '');
});
