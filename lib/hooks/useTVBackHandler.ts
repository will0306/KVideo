import { useEffect, useRef } from 'react';
import { hasOpenTVLayer } from '@/lib/hooks/useSpatialNavigation';
import { TV_BACK_EVENT } from '@/lib/utils/spatial-navigation';

/**
 * Handles the Android TV shell's Back key for page state that is not a history entry
 * (e.g. search results shown via router.replace). Open dialogs/menus/sidebars close first.
 */
export function useTVBackHandler(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;

    const handleBack = (event: Event) => {
      if (event.defaultPrevented || hasOpenTVLayer()) return;
      event.preventDefault();
      onBackRef.current();
    };

    window.addEventListener(TV_BACK_EVENT, handleBack);
    return () => window.removeEventListener(TV_BACK_EVENT, handleBack);
  }, [active]);
}
