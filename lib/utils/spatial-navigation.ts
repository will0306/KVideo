/**
 * Spatial navigation helpers shared by the TV D-pad navigation hook.
 * Kept free of DOM globals so the geometry can be unit tested.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Event the Android TV shell dispatches on Back; preventDefault() marks it handled by the page. */
export const TV_BACK_EVENT = 'kvideo-android-back';

/** Natively or explicitly focusable elements that D-pad navigation can land on. */
export const SPATIAL_FOCUSABLE_SELECTOR = [
  '[data-focusable]',
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Overlays (dialogs, menus, sidebars, IPTV player) that trap navigation and close on Back. */
export const SPATIAL_LAYER_SELECTOR = '[data-tv-layer]:not([aria-hidden="true"]), [aria-modal="true"]';

export const DIRECTION_BY_KEY: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Which arrow keys an element handles itself (value of its data-tv-keys attribute). */
export function isDirectionOwnedByElement(ownedKeys: string | null, direction: Direction): boolean {
  if (!ownedKeys) return false;
  if (ownedKeys === 'all') return true;
  if (ownedKeys === 'horizontal') return direction === 'left' || direction === 'right';
  if (ownedKeys === 'vertical') return direction === 'up' || direction === 'down';
  return false;
}

/** Distance between two 1D ranges; 0 when they overlap. */
function rangeGap(startA: number, sizeA: number, startB: number, sizeB: number): number {
  return Math.max(0, startB - (startA + sizeA), startA - (startB + sizeB));
}

function getCenter(box: Box): { x: number; y: number } {
  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  };
}

/** Candidate tiers, searched in order: the first tier with a match in the direction wins. */
export const CANDIDATE_TIER = {
  /** Descendants of the focused element: moving off the player stage enters its control bar */
  inside: 0,
  normal: 1,
  /** Floating buttons (back-to-top, favorites) are only a last resort */
  floating: 2,
} as const;

/**
 * Returns the index of the candidate box closest to `current` in `direction`,
 * or -1 when nothing lies in that direction. `tiers` (default: all normal) ranks candidates.
 */
export function findBestCandidateIndex(
  current: Box,
  candidates: Box[],
  direction: Direction,
  tiers: number[] = []
): number {
  const tierOf = (index: number) => tiers[index] ?? CANDIDATE_TIER.normal;
  const orderedTiers = Array.from(new Set(candidates.map((_, index) => tierOf(index)))).sort((a, b) => a - b);

  for (const tier of orderedTiers) {
    const indices = candidates.map((_, index) => index).filter(index => tierOf(index) === tier);
    const best = findBestAmong(current, candidates, indices, direction);
    if (best >= 0) return best;
  }
  return -1;
}

function findBestAmong(current: Box, candidates: Box[], indices: number[], direction: Direction): number {
  const currentCenter = getCenter(current);

  let bestIndex = -1;
  let bestScore = Infinity;

  indices.forEach(index => {
    const candidate = candidates[index];
    const candidateCenter = getCenter(candidate);
    const dx = candidateCenter.x - currentCenter.x;
    const dy = candidateCenter.y - currentCenter.y;

    let isInDirection = false;
    switch (direction) {
      case 'up':
        isInDirection = dy < -10;
        break;
      case 'down':
        isInDirection = dy > 10;
        break;
      case 'left':
        isInDirection = dx < -10;
        break;
      case 'right':
        isInDirection = dx > 10;
        break;
    }

    if (!isInDirection) return;

    // Edge-based distance so wide targets (search box, player) aren't penalised for a far-off
    // center: gap along the travel axis plus how far the boxes miss each other sideways
    const isVertical = direction === 'up' || direction === 'down';
    const primaryGap = Math.max(0, {
      up: current.top - (candidate.top + candidate.height),
      down: candidate.top - (current.top + current.height),
      left: current.left - (candidate.left + candidate.width),
      right: candidate.left - (current.left + current.width),
    }[direction]);
    const sideGap = isVertical
      ? rangeGap(current.left, current.width, candidate.left, candidate.width)
      : rangeGap(current.top, current.height, candidate.top, candidate.height);
    // Center offset only breaks ties between equally aligned candidates
    const centerOffset = isVertical ? Math.abs(dx) : Math.abs(dy);
    const score = primaryGap + sideGap * 3 + centerOffset * 0.01;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}
