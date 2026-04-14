export function getViewportProfile({ width = 1280, height = 720, forceMobile = false } = {}) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const isPortrait = safeHeight >= safeWidth;
  const narrowScreen = safeWidth <= 820;
  const mode = forceMobile || (narrowScreen && isPortrait) ? 'mobile' : 'desktop';

  return {
    mode,
    isPortrait,
    sceneAspectRatio: mode === 'mobile' ? '9 / 16' : '16 / 9',
    showSecondaryInfo: mode !== 'mobile',
    showTouchControls: mode === 'mobile',
    showMasthead: mode !== 'mobile',
    compactTitle: mode === 'mobile',
  };
}
