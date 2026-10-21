/**
 * useSpatialNavigation
 * Provides D-pad/arrow key based 2D spatial navigation for TV mode.
 * Navigates between all focusable elements (buttons, links, inputs, [data-focusable], ...)
 * inside the top-most layer: an open dialog/menu/sidebar ([data-tv-layer], [aria-modal]),
 * the fullscreen player, or the whole page.
 * Also handles the Android TV shell's Back event by closing the top-most layer.
 */

import { useEffect } from 'react';
import {
  CANDIDATE_TIER,
  DIRECTION_BY_KEY,
  type Direction,
  SPATIAL_FOCUSABLE_SELECTOR,
  SPATIAL_LAYER_SELECTOR,
  TV_BACK_EVENT,
  findBestCandidateIndex,
  isDirectionOwnedByElement,
} from '@/lib/utils/spatial-navigation';

const NATIVELY_ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);

const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color', 'image']);

function isTextField(el: HTMLElement): boolean {
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type);
}

function isToggleInput(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
}

/** Text fields keep Left/Right for the caret, sliders for their value. */
function usesHorizontalArrows(el: HTMLElement): boolean {
  return isTextField(el) || (el instanceof HTMLInputElement && el.type === 'range');
}

function isRendered(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return window.getComputedStyle(el).visibility !== 'hidden';
}

function isOnScreen(el: HTMLElement): boolean {
  if (!isRendered(el)) return false;
  const rect = el.getBoundingClientRect();
  return rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
}

function getTopLayer(): HTMLElement | null {
  const layers = Array.from(document.querySelectorAll<HTMLElement>(SPATIAL_LAYER_SELECTOR)).filter(isOnScreen);
  return layers.length > 0 ? layers[layers.length - 1] : null;
}

/** True while a dialog, menu, sidebar or fullscreen player would consume the TV Back key. */
export function hasOpenTVLayer(): boolean {
  return Boolean(document.fullscreenElement || getTopLayer() || getWebFullscreenPlayer());
}

function getWebFullscreenPlayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.is-web-fullscreen');
}

function getNavigationScope(): ParentNode {
  const layer = getTopLayer();
  if (layer) return layer;
  if (document.fullscreenElement instanceof HTMLElement) return document.fullscreenElement;
  return getWebFullscreenPlayer() ?? document;
}

function getFocusableElements(scope: ParentNode): HTMLElement[] {
  const elements = Array.from(scope.querySelectorAll<HTMLElement>(SPATIAL_FOCUSABLE_SELECTOR));
  // A focusable layer root (e.g. the fullscreen player stage) stays reachable from its own controls
  if (scope instanceof HTMLElement && scope.matches(SPATIAL_FOCUSABLE_SELECTOR)) {
    elements.unshift(scope);
  }
  return elements.filter(el => {
    if (el.hasAttribute('disabled')) return false;
    if (el.closest('[aria-hidden="true"], [inert], [data-no-spatial]')) return false;
    return isRendered(el);
  });
}

/**
 * Returns a per-keypress lookup of the nearest position:fixed ancestor-or-self below `scope`.
 * Cards share ancestors, so caching keeps style reads to one per DOM node.
 */
function createFixedAncestorLookup(scope: ParentNode) {
  const cache = new Map<HTMLElement, HTMLElement | null>();
  const lookup = (node: HTMLElement | null): HTMLElement | null => {
    if (!node || node === scope) return null;
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const result = window.getComputedStyle(node).position === 'fixed' ? node : lookup(node.parentElement);
    cache.set(node, result);
    return result;
  };
  return lookup;
}

/** Scrolls the nearest scrollable ancestor of `from` (up to `layer`) that can move in `direction`. */
function scrollWithinLayer(from: HTMLElement, layer: HTMLElement, direction: Direction) {
  if (direction !== 'up' && direction !== 'down') return;
  for (let el: HTMLElement | null = from; el; el = el === layer ? null : el.parentElement) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if ((overflowY !== 'auto' && overflowY !== 'scroll') || el.scrollHeight <= el.clientHeight) continue;
    const canScroll = direction === 'up' ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight;
    if (canScroll) {
      el.scrollBy({ top: (direction === 'up' ? -1 : 1) * el.clientHeight * 0.6, behavior: 'smooth' });
      return;
    }
  }
}

export function useSpatialNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const direction = DIRECTION_BY_KEY[e.key];
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (direction) {
        // Skip if the event was already handled (e.g., by search history dropdown)
        if (e.defaultPrevented) return;

        // For input/textarea: allow Left/Right for cursor movement,
        // but let Up/Down navigate spatially so the user can escape the input on TV.
        if (focused && usesHorizontalArrows(focused) && (direction === 'left' || direction === 'right')) {
          return;
        }

        if (focused?.closest('[data-no-spatial]')) return;

        // Elements like the player stage handle some arrows themselves (seek, channel switch)
        if (focused && isDirectionOwnedByElement(focused.getAttribute('data-tv-keys'), direction)) {
          return;
        }

        const scope = getNavigationScope();
        const focusableElements = getFocusableElements(scope);
        if (focusableElements.length === 0) return;

        if (!focused || !focusableElements.includes(focused)) {
          const preferred = focusableElements.find(el => el.hasAttribute('data-tv-autofocus'));
          const initial = preferred ?? focusableElements[0];
          initial.focus({ preventScroll: true });
          initial.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          e.preventDefault();
          return;
        }

        const candidates = focusableElements.filter(el => el !== focused);
        const fixedAncestorOf = createFixedAncestorLookup(scope);
        const bestIndex = findBestCandidateIndex(
          focused.getBoundingClientRect(),
          candidates.map(el => el.getBoundingClientRect()),
          direction,
          candidates.map(el => {
            if (focused.contains(el)) return CANDIDATE_TIER.inside;
            // Floating = inside a fixed box (back-to-top, favorites) that doesn't also hold the focus
            const fixedAncestor = fixedAncestorOf(el);
            return fixedAncestor && !fixedAncestor.contains(focused) ? CANDIDATE_TIER.floating : CANDIDATE_TIER.normal;
          })
        );

        if (bestIndex >= 0) {
          const best = candidates[bestIndex];
          best.focus({ preventScroll: true });
          best.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          e.preventDefault();
        } else if (scope !== document) {
          // Keep focus trapped in the open layer: old WebViews (Chrome 66) otherwise run their own
          // D-pad navigation and move focus out of it. Scroll instead so text below the last control stays reachable.
          scrollWithinLayer(focused, scope as HTMLElement, direction);
          e.preventDefault();
        }
      } else if (e.key === 'Enter') {
        if (!focused || isTextField(focused)) return;

        // Native buttons/links activate themselves on Enter; checkboxes and custom
        // role="button" elements only react to clicks
        const isCustomButton = focused.getAttribute('role') === 'button' &&
          !NATIVELY_ACTIVATABLE_TAGS.has(focused.tagName);
        if (focused.hasAttribute('data-focusable') || isCustomButton || isToggleInput(focused)) {
          focused.click();
          e.preventDefault();
        }
      }
    };

    // Back from the Android TV shell: close the top-most layer via its Escape handling.
    // Leaving the event un-prevented lets the shell fall back to history navigation.
    const handleBack = (event: Event) => {
      if (document.fullscreenElement) {
        event.preventDefault();
        void document.exitFullscreen().catch(() => {});
        return;
      }

      const layer = getTopLayer() ?? getWebFullscreenPlayer();
      if (!layer) return;

      event.preventDefault();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let target: HTMLElement = layer;
      if (active && isTextField(active)) {
        active.blur();
      } else if (active && layer.contains(active)) {
        target = active;
      }
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    };

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener(TV_BACK_EVENT, handleBack);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(TV_BACK_EVENT, handleBack);
    };
  }, [enabled]);
}
