import { useEffect } from 'react';
import { useIsTV } from '@/lib/contexts/TVContext';
import type { FullscreenMode } from '../useDesktopPlayerState';

interface UseDesktopShortcutsProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    fullscreenMode: FullscreenMode;
    isPlaying: boolean;
    volume: number;
    isPiPSupported: boolean;
    togglePlay: () => void;
    toggleMute: () => void;
    toggleFullscreen: () => void;
    toggleWindowFullscreen: () => void;
    togglePictureInPicture: () => void;
    skipForward: () => void;
    skipBackward: () => void;
    showVolumeBarTemporarily: () => void;
    setShowControls: (show: boolean) => void;
    setVolume: (volume: number) => void;
    setIsMuted: (muted: boolean) => void;
    controlsTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

export function useDesktopShortcuts({
    videoRef,
    containerRef,
    fullscreenMode,
    isPlaying,
    volume,
    isPiPSupported,
    togglePlay,
    toggleMute,
    toggleFullscreen,
    toggleWindowFullscreen,
    togglePictureInPicture,
    skipForward,
    skipBackward,
    showVolumeBarTemporarily,
    setShowControls,
    setVolume,
    setIsMuted,
    controlsTimeoutRef,
}: UseDesktopShortcutsProps) {
    const isTV = useIsTV();

    // On TV, entering fullscreen moves focus to the player stage so arrows seek right away
    useEffect(() => {
        if (!isTV || fullscreenMode === 'none') return;
        const container = containerRef.current;
        if (container && !container.contains(document.activeElement)) {
            container.focus({ preventScroll: true });
        }
    }, [isTV, fullscreenMode, containerRef]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore shortcuts if typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            // Show controls on any key press
            setShowControls(true);
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
            if (isPlaying) {
                controlsTimeoutRef.current = setTimeout(() => {
                    // Keep controls visible while the D-pad focus sits on one of them
                    const active = document.activeElement;
                    if (isTV && active !== containerRef.current && containerRef.current?.contains(active)) {
                        return;
                    }
                    setShowControls(false);
                }, 3000);
            }

            // On TV the arrows normally move focus (spatial navigation); the player only takes
            // Left/Right when its stage is focused, or in fullscreen with nothing else focused.
            const active = document.activeElement;
            const isStageFocused = Boolean(containerRef.current) && active === containerRef.current;
            const ownsHorizontalArrows = !isTV || (!e.defaultPrevented && (
                isStageFocused || (fullscreenMode !== 'none' && (!active || active === document.body))
            ));

            switch (e.key.toLowerCase()) {
                case 'enter':
                    if (isTV && isStageFocused) {
                        e.preventDefault();
                        togglePlay();
                    }
                    break;
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'f':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'w':
                    e.preventDefault();
                    toggleWindowFullscreen();
                    break;
                case 'm':
                    e.preventDefault();
                    toggleMute();
                    break;
                case 'p':
                    if (isPiPSupported) {
                        e.preventDefault();
                        togglePictureInPicture();
                    }
                    break;
                case 'arrowright':
                    if (!ownsHorizontalArrows) break;
                    e.preventDefault();
                    skipForward();
                    break;
                case 'l':
                    e.preventDefault();
                    skipForward();
                    break;
                case 'arrowleft':
                    if (!ownsHorizontalArrows) break;
                    e.preventDefault();
                    skipBackward();
                    break;
                case 'j':
                    e.preventDefault();
                    skipBackward();
                    break;
                case 'arrowup':
                    // TV remotes have hardware volume; Up/Down are used for focus navigation.
                    // On the stage with hidden controls they only reveal the controls (done above).
                    if (isTV) {
                        if (isStageFocused && !e.defaultPrevented) e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    const newVolUp = Math.min(1, volume + 0.1);
                    setVolume(newVolUp);
                    if (videoRef.current) {
                        videoRef.current.volume = newVolUp;
                        videoRef.current.muted = newVolUp === 0;
                    }
                    setIsMuted(newVolUp === 0);
                    localStorage.setItem('kvideo-volume', String(newVolUp));
                    localStorage.setItem('kvideo-muted', String(newVolUp === 0));
                    showVolumeBarTemporarily();
                    break;
                case 'arrowdown':
                    if (isTV) {
                        if (isStageFocused && !e.defaultPrevented) e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    const newVolDown = Math.max(0, volume - 0.1);
                    setVolume(newVolDown);
                    if (videoRef.current) {
                        videoRef.current.volume = newVolDown;
                        videoRef.current.muted = newVolDown === 0;
                    }
                    setIsMuted(newVolDown === 0);
                    localStorage.setItem('kvideo-volume', String(newVolDown));
                    localStorage.setItem('kvideo-muted', String(newVolDown === 0));
                    showVolumeBarTemporarily();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        isTV,
        videoRef,
        containerRef,
        fullscreenMode,
        isPlaying,
        volume,
        isPiPSupported,
        togglePlay,
        toggleMute,
        toggleFullscreen,
        toggleWindowFullscreen,
        togglePictureInPicture,
        skipForward,
        skipBackward,
        showVolumeBarTemporarily,
        setShowControls,
        setVolume,
        setIsMuted,
        controlsTimeoutRef,
    ]);
}
