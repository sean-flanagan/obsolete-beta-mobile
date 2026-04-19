import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeEnabled, findNodePath, getReachableNeighbors, getNodeById } from '../src/level-graph.js';

const graphLevel = {
  nodes: [
    { id: 'entry' },
    { id: 'landing' },
    { id: 'bridge' },
    { id: 'goal' },
    { id: 'detour' },
  ],
  edges: [
    { from: 'entry', to: 'landing' },
    { from: 'landing', to: 'bridge' },
    { from: 'bridge', to: 'goal', requiresState: { bridgeA: 'north' } },
    { from: 'bridge', to: 'detour', requiresState: { bridgeA: 'east' } },
  ],
};

test('getNodeById returns a node when it exists', () => {
  assert.deepEqual(getNodeById(graphLevel, 'landing'), { id: 'landing' });
  assert.equal(getNodeById(graphLevel, 'missing'), null);
});

test('edgeEnabled respects structure orientation requirements', () => {
  assert.equal(edgeEnabled({ from: 'a', to: 'b' }, {}), true);
  assert.equal(edgeEnabled({ from: 'a', to: 'b', requiresState: { bridgeA: 'north' } }, { bridgeA: 'north' }), true);
  assert.equal(edgeEnabled({ from: 'a', to: 'b', requiresState: { bridgeA: 'north' } }, { bridgeA: 'east' }), false);
});

test('getReachableNeighbors exposes only active graph edges', () => {
  assert.deepEqual(getReachableNeighbors(graphLevel, 'bridge', { bridgeA: 'north' }).sort(), ['goal', 'landing']);
  assert.deepEqual(getReachableNeighbors(graphLevel, 'bridge', { bridgeA: 'east' }).sort(), ['detour', 'landing']);
});

test('findNodePath returns the correct route for the active structure state', () => {
  assert.deepEqual(findNodePath(graphLevel, 'entry', 'goal', { bridgeA: 'north' }), ['entry', 'landing', 'bridge', 'goal']);
  assert.deepEqual(findNodePath(graphLevel, 'entry', 'goal', { bridgeA: 'east' }), []);
  assert.deepEqual(findNodePath(graphLevel, 'entry', 'detour', { bridgeA: 'east' }), ['entry', 'landing', 'bridge', 'detour']);
});
