/**
 * The keyboard of the agent list, and the link to an agent.
 *
 * The list is the accessible twin of the pool: somebody who cannot use a
 * mouse walks the very same rows with the arrow keys. The arithmetic of
 * that walk is pure, so it is tested here without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keyAction, nextSelection } from '../src/ui/keyboard';
import { agentFromSearch, searchWithAgent } from '../src/state/store';

const IDS = ['session:a', 'session:b', 'subagent:c'];

test('the arrow keys are the ones that walk the list', () => {
  assert.equal(keyAction('ArrowDown'), 'move');
  assert.equal(keyAction('ArrowUp'), 'move');
  assert.equal(keyAction('Home'), 'move');
  assert.equal(keyAction('End'), 'move');
});

test('enter opens and escape closes', () => {
  assert.equal(keyAction('Enter'), 'open');
  assert.equal(keyAction('Escape'), 'close');
});

test('a key that is not ours is none of our business', () => {
  assert.equal(keyAction('a'), 'none');
  assert.equal(keyAction('Tab'), 'none');
  assert.equal(keyAction('Shift'), 'none');
});

test('the down arrow walks to the next row', () => {
  assert.equal(nextSelection(IDS, 'session:a', 'ArrowDown'), 'session:b');
  assert.equal(nextSelection(IDS, 'session:b', 'ArrowDown'), 'subagent:c');
});

test('the up arrow walks to the row above', () => {
  assert.equal(nextSelection(IDS, 'session:b', 'ArrowUp'), 'session:a');
  assert.equal(nextSelection(IDS, 'subagent:c', 'ArrowUp'), 'session:b');
});

test('the list stops at its ends, it does not wrap around', () => {
  assert.equal(nextSelection(IDS, 'subagent:c', 'ArrowDown'), 'subagent:c');
  assert.equal(nextSelection(IDS, 'session:a', 'ArrowUp'), 'session:a');
});

test('walking from nowhere starts at an end of the list', () => {
  assert.equal(nextSelection(IDS, null, 'ArrowDown'), 'session:a');
  assert.equal(nextSelection(IDS, null, 'ArrowUp'), 'subagent:c');
});

test('home and end jump to the ends', () => {
  assert.equal(nextSelection(IDS, 'session:b', 'Home'), 'session:a');
  assert.equal(nextSelection(IDS, 'session:b', 'End'), 'subagent:c');
});

test('escape clears the selection', () => {
  assert.equal(nextSelection(IDS, 'session:b', 'Escape'), null);
  assert.equal(nextSelection(IDS, null, 'Escape'), null);
});

test('enter stays on the row that is to be opened', () => {
  assert.equal(nextSelection(IDS, 'session:b', 'Enter'), 'session:b');
  // There is no row to open when the cursor is nowhere.
  assert.equal(nextSelection(IDS, null, 'Enter'), null);
});

test('an empty list does nothing', () => {
  assert.equal(nextSelection([], null, 'ArrowDown'), null);
  assert.equal(nextSelection([], null, 'ArrowUp'), null);
  assert.equal(nextSelection([], null, 'Home'), null);
  assert.equal(nextSelection([], null, 'End'), null);
  assert.equal(nextSelection([], null, 'Enter'), null);
});

test('a key that is not handled leaves the selection alone', () => {
  assert.equal(nextSelection(IDS, 'session:b', 'a'), 'session:b');
  assert.equal(nextSelection(IDS, 'session:b', 'Tab'), 'session:b');
  assert.equal(nextSelection(IDS, null, 'x'), null);
});

test('a link to an agent is read out of the address bar', () => {
  assert.equal(agentFromSearch('?agent=session%3Aabc'), 'session:abc');
  assert.equal(agentFromSearch('?foo=1&agent=session%3Aabc'), 'session:abc');
});

test('an address bar without an agent has no agent in it', () => {
  assert.equal(agentFromSearch(''), null);
  assert.equal(agentFromSearch('?foo=1'), null);
  assert.equal(agentFromSearch('?agent='), null);
});

test('the agent goes into the address bar, escaped', () => {
  assert.equal(searchWithAgent('', 'session:abc'), '?agent=session%3Aabc');
  assert.equal(searchWithAgent('?foo=1', 'session:abc'), '?foo=1&agent=session%3Aabc');
});

test('the agent comes out of the address bar when it is cleared', () => {
  assert.equal(searchWithAgent('?agent=session%3Aabc', null), '');
  assert.equal(searchWithAgent('?foo=1&agent=session%3Aabc', null), '?foo=1');
});

test('the agent survives the round trip through the address bar', () => {
  const search = searchWithAgent('', 'session:abc');
  assert.equal(agentFromSearch(search), 'session:abc');
});
