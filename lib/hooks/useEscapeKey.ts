import { useEffect } from 'react';

/**
 * Calls `onEscape` when Escape is pressed while `active` is true and nothing else handled it.
 * The TV remote's Back key is delivered as Escape, so this lets overlays close on TV.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        onEscape();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onEscape]);
}
