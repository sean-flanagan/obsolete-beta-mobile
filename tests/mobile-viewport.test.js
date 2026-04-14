import test from 'node:test';
import assert from 'node:assert/strict';
import { getViewportProfile } from '../src/mobile-viewport.js';

test('forces mobile mode when requested even on wide screens', () => {
  const profile = getViewportProfile({ width: 1280, height: 800, forceMobile: true });
  assert.equal(profile.mode, 'mobile');
  assert.equal(profile.sceneAspectRatio, '9 / 16');
  assert.equal(profile.showSecondaryInfo, false);
  assert.equal(profile.showTouchControls, true);
  assert.equal(profile.showMasthead, false);
});

test('uses mobile portrait mode on narrow tall screens', () => {
  const profile = getViewportProfile({ width: 390, height: 844, forceMobile: false });
  assert.equal(profile.mode, 'mobile');
  assert.equal(profile.isPortrait, true);
  assert.equal(profile.sceneAspectRatio, '9 / 16');
});

test('keeps desktop mode on wide landscape screens', () => {
  const profile = getViewportProfile({ width: 1440, height: 900, forceMobile: false });
  assert.equal(profile.mode, 'desktop');
  assert.equal(profile.sceneAspectRatio, '16 / 9');
  assert.equal(profile.showSecondaryInfo, true);
  assert.equal(profile.showTouchControls, false);
});
