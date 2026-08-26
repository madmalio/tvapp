export function isMobileScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const isMobileSize = window.innerWidth < 768;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  return isMobileSize || (isMobileUA && isTouch);
}

export async function lockToLandscape(container?: HTMLElement | null, video?: HTMLVideoElement | null) {
  // Strictly only auto-fullscreen / lock orientation on mobile screens
  if (!isMobileScreen()) {
    return;
  }

  try {
    // 1. iOS Safari native video fullscreen
    if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
      try {
        (video as any).webkitEnterFullscreen();
        return;
      } catch {
        // Fall through to standard APIs
      }
    }

    // 2. Standard HTML5 Fullscreen on container (required before locking orientation in Chrome/Chromium)
    const target = container || document.documentElement;
    if (!document.fullscreenElement) {
      if (target.requestFullscreen) {
        await target.requestFullscreen().catch(() => {});
      } else if ((target as any).webkitRequestFullscreen) {
        await (target as any).webkitRequestFullscreen().catch(() => {});
      }
    }

    // 3. Screen orientation lock to landscape
    // @ts-ignore
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      // @ts-ignore
      await screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (err) {
    console.warn("Landscape orientation lock:", err);
  }
}

export function unlockScreenOrientation() {
  try {
    // @ts-ignore
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      // @ts-ignore
      screen.orientation.unlock();
    }
  } catch {
    // Ignore
  }
}
