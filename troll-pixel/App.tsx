import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Grid,
  Play,
  RotateCcw,
  Share2,
  Skull,
  Sparkles,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdBanner } from './components/AdBanner';
import { LevelSelectModal } from './components/LevelSelectModal';
import { formatRunTime, ShareModal } from './components/ShareModal';
import { SkinPreviewCanvas, SkinSelectModal } from './components/SkinSelectModal';
import { GameEngine } from './game/engine';
import { GAME_HEIGHT, GAME_WIDTH, LEVELS } from './game/levels';
import { isSkinUnlocked, SKIN_DEFS } from './game/skins';
import { soundEngine } from './game/sound';
import { GamePhase, InputState, LevelProgress, SkinId } from './game/types';

const PROGRESS_STORAGE_KEY = 'troll_pixel_progress_v1';
const SKIP_AD_URL = 'https://araplhn.org/4/a60b3edcc5d3de6178bd8c0997ff8781';

function loadInitialProgress(): LevelProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LevelProgress>;
      const deathsPerLevel = parsed.deathsPerLevel || {};
      const sumDeaths = Object.values(deathsPerLevel).reduce((acc, n) => acc + n, 0);
      const base: LevelProgress = {
        unlockedLevel: Math.min(LEVELS.length, Math.max(1, parsed.unlockedLevel || 1)),
        deathsPerLevel,
        completedLevels: Array.isArray(parsed.completedLevels) ? parsed.completedLevels : [],
        totalDeaths: Math.max(parsed.totalDeaths || 0, sumDeaths),
        bestRunMs: typeof parsed.bestRunMs === 'number' ? parsed.bestRunMs : undefined,
      };
      const candidateSkin = parsed.selectedSkin || 'default';
      base.selectedSkin = isSkinUnlocked(candidateSkin, base) ? candidateSkin : 'default';
      return base;
    }
  } catch {
    // ignore storage parse issues
  }
  return {
    unlockedLevel: 1,
    deathsPerLevel: {},
    completedLevels: [],
    selectedSkin: 'default',
    totalDeaths: 0,
  };
}

function saveProgress(progress: LevelProgress): void {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // ignore storage write issues
  }
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('TITLE');
  const [currentLevelId, setCurrentLevelId] = useState<number>(1);
  const [progress, setProgress] = useState<LevelProgress>(loadInitialProgress);
  const [runDeaths, setRunDeaths] = useState<number>(0);
  const [runDeathsPerLevel, setRunDeathsPerLevel] = useState<Record<number, number>>({});
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [showLevelSelect, setShowLevelSelect] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [showSkinSelect, setShowSkinSelect] = useState<boolean>(false);
  const [selectedSkin, setSelectedSkin] = useState<SkinId>(() => progress.selectedSkin || 'default');
  const [skinUnlockToast, setSkinUnlockToast] = useState<string | null>(null);
  const [canSkipLevel, setCanSkipLevel] = useState<boolean>(false);
  const [touchVisible, setTouchVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 1024;
  });
  const [finalElapsedMs, setFinalElapsedMs] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const timerSpanRef = useRef<HTMLSpanElement | null>(null);
  const deathsSpanRef = useRef<HTMLSpanElement | null>(null);
  const deathsContainerRef = useRef<HTMLDivElement | null>(null);
  const levelSpanRef = useRef<HTMLSpanElement | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  const currentLevelIdRef = useRef<number>(currentLevelId);
  const modalOpenRef = useRef<boolean>(false);

  const progressRef = useRef<LevelProgress>(progress);
  const runDeathsRef = useRef<number>(0);
  const runDeathsPerLevelRef = useRef<Record<number, number>>({});
  const lastDisplayedDeathsRef = useRef<number>(-1);
  const lastDisplayedLevelRef = useRef<number>(-1);

  const runStartPerfRef = useRef<number>(0);
  const accumulatedElapsedRef = useRef<number>(0);
  const lastDisplayedTenthsRef = useRef<number>(-1);

  const inputRef = useRef<InputState>({
    left: false,
    right: false,
    down: false,
    downJustPressed: false,
    jumpHeld: false,
    jumpJustPressed: false,
  });

  // Multi-touch pointer sets so multi-touch controls never stick or drop
  const leftPointersRef = useRef<Set<number>>(new Set());
  const rightPointersRef = useRef<Set<number>>(new Set());
  const downPointersRef = useRef<Set<number>>(new Set());
  const jumpPointersRef = useRef<Set<number>>(new Set());
  const keyLeftRef = useRef<boolean>(false);
  const keyRightRef = useRef<boolean>(false);
  const keyDownRef = useRef<boolean>(false);
  const keyJumpRef = useRef<boolean>(false);

  const syncCombinedInput = useCallback(() => {
    const leftActive = keyLeftRef.current || leftPointersRef.current.size > 0;
    const rightActive = keyRightRef.current || rightPointersRef.current.size > 0;
    const downActive = keyDownRef.current || downPointersRef.current.size > 0;
    const jumpActive = keyJumpRef.current || jumpPointersRef.current.size > 0;

    if (jumpActive && !inputRef.current.jumpHeld) {
      inputRef.current.jumpJustPressed = true;
    }
    if (downActive && !inputRef.current.down) {
      inputRef.current.downJustPressed = true;
    }
    inputRef.current.left = leftActive;
    inputRef.current.right = rightActive;
    inputRef.current.down = downActive;
    inputRef.current.jumpHeld = jumpActive;
  }, []);

  const clearAllInputs = useCallback(() => {
    leftPointersRef.current.clear();
    rightPointersRef.current.clear();
    downPointersRef.current.clear();
    jumpPointersRef.current.clear();
    keyLeftRef.current = false;
    keyRightRef.current = false;
    keyDownRef.current = false;
    keyJumpRef.current = false;
    inputRef.current.left = false;
    inputRef.current.right = false;
    inputRef.current.down = false;
    inputRef.current.downJustPressed = false;
    inputRef.current.jumpHeld = false;
    inputRef.current.jumpJustPressed = false;
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const isModalOpen = showLevelSelect || showShareModal || showSkinSelect;
    modalOpenRef.current = isModalOpen;
    if (engineRef.current) {
      engineRef.current.setActive(phase === 'PLAYING' && !isModalOpen);
    }
    if (isModalOpen) {
      clearAllInputs();
    }
  }, [phase, showLevelSelect, showShareModal, showSkinSelect, clearAllInputs]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setSkin(selectedSkin);
    }
  }, [selectedSkin]);

  useEffect(() => {
    if (!skinUnlockToast) return;
    const timeout = setTimeout(() => setSkinUnlockToast(null), 3000);
    return () => clearTimeout(timeout);
  }, [skinUnlockToast]);

  const updateDeathHudRef = useCallback((deaths: number) => {
    if (deaths !== lastDisplayedDeathsRef.current) {
      lastDisplayedDeathsRef.current = deaths;
      if (deathsSpanRef.current) {
        deathsSpanRef.current.textContent = String(deaths);
      }
      if (deathsContainerRef.current) {
        deathsContainerRef.current.setAttribute('aria-label', `Deaths: ${deaths}`);
      }
    }
  }, []);

  const updateLevelHudRef = useCallback((levelId: number) => {
    if (levelId !== lastDisplayedLevelRef.current) {
      lastDisplayedLevelRef.current = levelId;
      if (levelSpanRef.current) {
        levelSpanRef.current.textContent = `LV ${levelId}/${LEVELS.length}`;
      }
    }
  }, []);

  const syncStatsToState = useCallback(() => {
    setRunDeaths(runDeathsRef.current);
    setRunDeathsPerLevel({ ...runDeathsPerLevelRef.current });
    setProgress({
      unlockedLevel: progressRef.current.unlockedLevel,
      deathsPerLevel: { ...progressRef.current.deathsPerLevel },
      completedLevels: [...progressRef.current.completedLevels],
      selectedSkin: progressRef.current.selectedSkin || 'default',
      totalDeaths: progressRef.current.totalDeaths || 0,
      bestRunMs: progressRef.current.bestRunMs,
    });
  }, []);

  const advanceTimerIfPlaying = useCallback((now: number) => {
    if (phaseRef.current === 'PLAYING' && !modalOpenRef.current) {
      const total = accumulatedElapsedRef.current + (now - runStartPerfRef.current);
      const tenths = Math.floor(total / 100);
      if (tenths !== lastDisplayedTenthsRef.current) {
        lastDisplayedTenthsRef.current = tenths;
        if (timerSpanRef.current) {
          timerSpanRef.current.textContent = formatRunTime(total);
        }
      }
      return total;
    }
    return accumulatedElapsedRef.current;
  }, []);

  const startLevel = useCallback(
    (levelId: number, resetPersisted = true) => {
      soundEngine.unlock();
      clearAllInputs();
      currentLevelIdRef.current = levelId;
      updateLevelHudRef(levelId);
      updateDeathHudRef(runDeathsRef.current);
      setCanSkipLevel((runDeathsPerLevelRef.current[levelId] || 0) >= 5 && levelId < LEVELS.length);
      setCurrentLevelId(levelId);
      setPhase('PLAYING');
      setShowLevelSelect(false);
      setShowShareModal(false);
      runStartPerfRef.current = performance.now();
      if (engineRef.current) {
        engineRef.current.loadLevel(levelId, resetPersisted);
        engineRef.current.setActive(true);
      }
    },
    [clearAllInputs, updateDeathHudRef, updateLevelHudRef]
  );

  const startFreshRun = useCallback(() => {
    accumulatedElapsedRef.current = 0;
    lastDisplayedTenthsRef.current = -1;
    if (timerSpanRef.current) {
      timerSpanRef.current.textContent = '00:00.0';
    }
    runDeathsRef.current = 0;
    runDeathsPerLevelRef.current = {};
    updateDeathHudRef(0);
    setRunDeaths(0);
    setRunDeathsPerLevel({});
    startLevel(1, true);
  }, [startLevel, updateDeathHudRef]);

  // Initialize GameEngine & display-synced RAF loop (zero React re-renders during gameplay)
  useEffect(() => {
    const engine = new GameEngine({
      onDeath: (lvlId) => {
        runDeathsRef.current += 1;
        const lvlDeaths = (runDeathsPerLevelRef.current[lvlId] || 0) + 1;
        runDeathsPerLevelRef.current[lvlId] = lvlDeaths;
        const prevLifetime = progressRef.current.totalDeaths || 0;
        const nextLifetime = prevLifetime + 1;
        progressRef.current.totalDeaths = nextLifetime;
        progressRef.current.deathsPerLevel[lvlId] =
          (progressRef.current.deathsPerLevel[lvlId] || 0) + 1;
        saveProgress(progressRef.current);
        updateDeathHudRef(runDeathsRef.current);

        if (lvlDeaths === 5 && lvlId < LEVELS.length) {
          setCanSkipLevel(true);
        }

        if (prevLifetime < 50 && nextLifetime >= 50) {
          soundEngine.playUnlock();
          setSkinUnlockToast('Skin Unlocked: Clown Skin!');
        }
      },
      onLevelComplete: (lvlId) => {
        const now = performance.now();
        if (phaseRef.current === 'PLAYING') {
          accumulatedElapsedRef.current += now - runStartPerfRef.current;
          runStartPerfRef.current = now;
        }

        const prevProg = progressRef.current;
        const hadNinja = isSkinUnlocked('ninja', prevProg);
        const hadKing = isSkinUnlocked('king', prevProg);

        const nextUnlocked = Math.min(LEVELS.length, Math.max(prevProg.unlockedLevel, lvlId + 1));
        const completed = prevProg.completedLevels.includes(lvlId)
          ? prevProg.completedLevels
          : [...prevProg.completedLevels, lvlId];

        const updatedBestRunMs =
          lvlId >= LEVELS.length
            ? prevProg.bestRunMs === undefined
              ? accumulatedElapsedRef.current
              : Math.min(prevProg.bestRunMs, accumulatedElapsedRef.current)
            : prevProg.bestRunMs;

        progressRef.current = {
          unlockedLevel: nextUnlocked,
          deathsPerLevel: { ...prevProg.deathsPerLevel },
          completedLevels: completed,
          selectedSkin: prevProg.selectedSkin || 'default',
          totalDeaths: prevProg.totalDeaths || 0,
          bestRunMs: updatedBestRunMs,
        };
        saveProgress(progressRef.current);
        syncStatsToState();

        if (!hadKing && isSkinUnlocked('king', progressRef.current)) {
          soundEngine.playUnlock();
          setSkinUnlockToast('Skin Unlocked: Golden Crown King!');
        } else if (!hadNinja && isSkinUnlocked('ninja', progressRef.current)) {
          soundEngine.playUnlock();
          setSkinUnlockToast('Skin Unlocked: Ninja Skin!');
        }

        if (lvlId >= LEVELS.length) {
          setFinalElapsedMs(accumulatedElapsedRef.current);
          setPhase('VICTORY');
          setShowShareModal(true);
        } else {
          setPhase('LEVEL_CLEAR');
        }
      },
    });

    engineRef.current = engine;
    engine.setSkin(progressRef.current.selectedSkin || 'default');
    engine.loadLevel(1, true);
    engine.setActive(false);

    let rafId = 0;
    let lastTime = performance.now();
    let cachedCanvas: HTMLCanvasElement | null = null;
    let cachedCtx: CanvasRenderingContext2D | null = null;
    let cachedDpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const updateDpr = () => {
      cachedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    };
    window.addEventListener('resize', updateDpr);

    const loop = (now: number) => {
      const dt = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;

      engine.stepFrame(dt, inputRef.current);
      advanceTimerIfPlaying(now);

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = cachedDpr;
        const targetW = Math.round(GAME_WIDTH * dpr);
        const targetH = Math.round(GAME_HEIGHT * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        if (canvas !== cachedCanvas) {
          cachedCanvas = canvas;
          cachedCtx =
            canvas.getContext('2d', { alpha: false, desynchronized: true }) ??
            canvas.getContext('2d');
        }
        if (cachedCtx) {
          cachedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          engine.render(cachedCtx);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateDpr);
    };
  }, [advanceTimerIfPlaying, syncStatsToState, updateDeathHudRef]);

  // Auto-advance after brief celebration on Level Clear
  useEffect(() => {
    if (phase !== 'LEVEL_CLEAR') return;
    const timeout = setTimeout(() => {
      const nextId = Math.min(LEVELS.length, currentLevelId + 1);
      startLevel(nextId, true);
    }, 650);
    return () => clearTimeout(timeout);
  }, [phase, currentLevelId, startLevel]);

  // Pause/resume run timer cleanly when modals open/close
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (showLevelSelect || showShareModal || showSkinSelect) {
      accumulatedElapsedRef.current += performance.now() - runStartPerfRef.current;
      runStartPerfRef.current = performance.now();
    } else {
      runStartPerfRef.current = performance.now();
    }
  }, [showLevelSelect, showShareModal, showSkinSelect, phase]);

  // Desktop keyboard controls
  useEffect(() => {
    const isScrollKey = (code: string) =>
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'Space';

    const onKeyDown = (e: KeyboardEvent) => {
      if (isScrollKey(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;

      soundEngine.unlock();

      if (phaseRef.current === 'TITLE' && !modalOpenRef.current) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          startFreshRun();
          return;
        }
      }

      if (e.code === 'KeyR' && phaseRef.current === 'PLAYING' && !modalOpenRef.current) {
        e.preventDefault();
        startLevel(currentLevelIdRef.current, true);
        return;
      }

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keyLeftRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keyRightRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keyDownRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        keyJumpRef.current = true;
        syncCombinedInput();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isScrollKey(e.code)) {
        e.preventDefault();
      }

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keyLeftRef.current = false;
        syncCombinedInput();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keyRightRef.current = false;
        syncCombinedInput();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keyDownRef.current = false;
        syncCombinedInput();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        keyJumpRef.current = false;
        syncCombinedInput();
      }
    };

    const onBlur = () => clearAllInputs();

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearAllInputs, startFreshRun, startLevel, syncCombinedInput]);

  // Detect touch usage or viewport resize for responsive mobile controls
  useEffect(() => {
    const onFirstTouch = () => setTouchVisible(true);
    const onResize = () => {
      if (window.innerWidth < 1024 || window.matchMedia('(pointer: coarse)').matches) {
        setTouchVisible(true);
      }
    };
    window.addEventListener('touchstart', onFirstTouch, { passive: true, once: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const handleToggleMute = () => {
    const nextMuted = soundEngine.toggleMute();
    setMuted(nextMuted);
  };

  const handleSelectSkin = (skinId: SkinId) => {
    setSelectedSkin(skinId);
    progressRef.current.selectedSkin = skinId;
    saveProgress(progressRef.current);
    syncStatsToState();
  };

  const handleSkipLevel = () => {
    window.open(SKIP_AD_URL, '_blank');
    const now = performance.now();
    if (phaseRef.current === 'PLAYING') {
      accumulatedElapsedRef.current += now - runStartPerfRef.current;
      runStartPerfRef.current = now;
    }
    const nextId = Math.min(LEVELS.length, currentLevelId + 1);
    const prevProg = progressRef.current;
    progressRef.current = {
      ...prevProg,
      unlockedLevel: Math.max(prevProg.unlockedLevel, nextId),
    };
    saveProgress(progressRef.current);
    syncStatsToState();
    soundEngine.playTick();
    startLevel(nextId, true);
  };

  const handleResetProgress = () => {
    const fresh: LevelProgress = {
      unlockedLevel: 1,
      deathsPerLevel: {},
      completedLevels: [],
      selectedSkin: 'default',
      totalDeaths: 0,
    };
    progressRef.current = fresh;
    setSelectedSkin('default');
    setProgress(fresh);
    saveProgress(fresh);
    setShowLevelSelect(false);
    startFreshRun();
  };

  const makePointerHandlers = (targetSetRef: React.MutableRefObject<Set<number>>) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      soundEngine.unlock();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore if pointer capture unavailable
      }
      targetSetRef.current.add(e.pointerId);
      syncCombinedInput();
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      targetSetRef.current.delete(e.pointerId);
      syncCombinedInput();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      targetSetRef.current.delete(e.pointerId);
      syncCombinedInput();
    },
  });

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const rect = canvas.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * GAME_WIDTH;
    const vy = ((e.clientY - rect.top) / rect.height) * GAME_HEIGHT;
    engine.handleCanvasClick(vx, vy);
  };

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#261408] pb-[58px] text-[#FFF7ED] select-none md:pb-[98px]">
      {/* Top HUD Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-1.5 border-b border-[#5C3317] bg-[#2B170A] px-1.5 sm:h-14 sm:gap-4 sm:px-6">
        {/* Left side: Desktop Logo + Compact Stat Pills (LV, Deaths, Timer) */}
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              clearAllInputs();
              updateDeathHudRef(0);
              syncStatsToState();
              setPhase('TITLE');
            }}
            className="hidden font-arcade text-lg font-black tracking-tight text-[#E29848] transition-colors hover:text-[#FDE68A] whitespace-nowrap shrink-0 sm:inline-flex"
          >
            TROLL PIXEL
          </button>

          <div className="hidden h-4 w-px bg-[#5C3317] sm:block" aria-hidden="true" />

          {/* Level Badge Pill */}
          <div className="flex items-center rounded-md border border-[#5C3317] bg-[#3B2110] px-1.5 py-1 font-arcade text-[10px] font-bold tabular-nums text-[#FFF7ED] whitespace-nowrap shrink-0 sm:px-2.5 sm:text-xs">
            <span ref={levelSpanRef}>LV 1/{LEVELS.length}</span>
          </div>

          {/* Death Counter Pill (updated via DOM ref for zero React re-renders) */}
          <div
            ref={deathsContainerRef}
            className="flex items-center gap-1 rounded-md border border-[#5C3317] bg-[#3B2110] px-1.5 py-1 font-arcade text-[10px] font-bold tabular-nums text-[#FFF7ED] whitespace-nowrap shrink-0 sm:gap-1.5 sm:px-2.5 sm:text-xs"
            aria-label="Deaths: 0"
          >
            <Skull className="h-3 w-3 shrink-0 text-[#E29848] sm:h-3.5 sm:w-3.5" />
            <span ref={deathsSpanRef}>0</span>
          </div>

          {/* Live Speedrun Timer Pill (updated via DOM ref for zero React re-renders) */}
          <div
            className="flex items-center gap-1 rounded-md border border-[#5C3317] bg-[#3B2110] px-1.5 py-1 font-arcade text-[10px] font-semibold tabular-nums text-[#E8A14F] whitespace-nowrap shrink-0 sm:gap-1.5 sm:px-2.5 sm:text-xs"
            aria-label="Speedrun timer"
          >
            <Timer className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span ref={timerSpanRef}>00:00.0</span>
          </div>
        </div>

        {/* Right side: Skip Level (after 5+ deaths), Restart, Sound Mute/Unmute, Share (desktop), Level Select */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Skip Level Button (Rewarded Direct Link after 5+ deaths on current level) */}
          {phase === 'PLAYING' && canSkipLevel && currentLevelId < LEVELS.length && (
            <button
              type="button"
              onClick={handleSkipLevel}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#FDE68A]/50 bg-[#F59E0B] px-1.5 font-arcade text-[10px] font-black text-[#261408] transition-colors hover:bg-[#FBBF24] focus-visible:outline-2 focus-visible:outline-[#FFF7ED] whitespace-nowrap shrink-0 sm:h-9 sm:px-2.5 sm:text-xs"
              title="Watch ad in new tab to skip this level"
            >
              <span className="sm:hidden">Skip ⏭️</span>
              <span className="hidden sm:inline">Skip Level ⏭️</span>
            </button>
          )}

          {/* Restart Current Level */}
          {phase === 'PLAYING' && (
            <button
              type="button"
              onClick={() => startLevel(currentLevelId, true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B] sm:h-9 sm:w-9"
              title="Restart Level (R)"
              aria-label="Restart level"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}

          {/* Mute / Unmute */}
          <button
            type="button"
            onClick={handleToggleMute}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B] sm:h-9 sm:w-9"
            title={muted ? 'Unmute Sound' : 'Mute Sound'}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? (
              <VolumeX className="h-4 w-4 text-[#E8A14F]" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>

          {/* Share Score Card */}
          {phase !== 'TITLE' && (
            <button
              type="button"
              onClick={() => {
                syncStatsToState();
                setFinalElapsedMs(advanceTimerIfPlaying(performance.now()));
                setShowShareModal(true);
              }}
              className="hidden h-9 items-center gap-1.5 rounded-lg border border-[#5C3317] bg-[#3B2110] px-3 text-xs font-semibold text-[#FFF7ED] transition-colors hover:bg-[#523018] sm:inline-flex whitespace-nowrap shrink-0"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
          )}

          {/* Level Select Button */}
          <button
            type="button"
            onClick={() => {
              syncStatsToState();
              setShowLevelSelect(true);
            }}
            className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg bg-[#E29848] text-xs font-bold text-[#261408] transition-colors hover:bg-[#F59E0B] focus-visible:outline-2 focus-visible:outline-[#FFF7ED] whitespace-nowrap shrink-0 sm:h-9 sm:w-auto sm:px-3"
            aria-label="Open level select"
          >
            <Grid className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Levels</span>
          </button>
        </div>
      </header>

      {/* Main Game Viewport */}
      <main
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-[#261408] p-1.5 sm:p-4 ${
          touchVisible && phase === 'PLAYING'
            ? 'pb-16 sm:pb-4 [@media(max-height:540px)]:pb-1.5'
            : ''
        }`}
      >
        <div className="relative flex aspect-video max-h-full w-full max-w-[min(1180px,calc((100dvh-8.25rem)*1.7778))] items-center justify-center overflow-hidden rounded-lg shadow-2xl md:max-w-[min(1180px,calc((100dvh-11.25rem)*1.7778))]">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="h-full w-full block rounded-lg touch-none transform-gpu"
            aria-label="TROLL PIXEL game canvas"
          />
        </div>

        {/* Level Clear Overlay */}
        {phase === 'LEVEL_CLEAR' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#1B0E06]/45 p-4">
            <div className="rounded-xl border-2 border-[#E29848] bg-[#2B170A] px-6 py-4 text-center shadow-2xl sm:px-8 sm:py-5">
              <div className="font-arcade text-xs font-semibold text-[#E8A14F]">
                Level {currentLevelId} Survived
              </div>
              <div className="mt-1 font-arcade text-xl font-black text-[#FFF7ED] sm:text-2xl">
                Next Trap Loading...
              </div>
            </div>
          </div>
        )}

        {/* Skin Unlock Toast */}
        {skinUnlockToast && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-[#FDE68A] bg-[#2B170A]/95 px-3.5 py-1.5 font-arcade text-[11px] font-bold text-[#FDE68A] shadow-xl sm:top-4 sm:px-4 sm:py-2 sm:text-xs">
            {skinUnlockToast}
          </div>
        )}

        {/* Title Menu Overlay (fills main viewport cleanly on portrait & landscape phones) */}
        {phase === 'TITLE' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1B0E06]/65 p-3 backdrop-blur-[2px] sm:p-4">
            <div className="max-h-full w-[92vw] max-w-md overflow-y-auto rounded-xl border-2 border-[#E29848] bg-[#2B170A] p-4 text-center shadow-2xl sm:p-7">
              <div className="flex items-center justify-center gap-3 text-left sm:flex-col sm:gap-2 sm:text-center">
                <SkinPreviewCanvas
                  skinId={selectedSkin}
                  size={52}
                  className="h-13 w-13 sm:h-14 sm:w-14"
                />
                <div className="min-w-0">
                  <div className="font-arcade text-[11px] font-semibold tracking-wide text-[#E8A14F] sm:text-xs">
                    50 Deceptive Stages · 5 Worlds
                  </div>
                  <h1 className="mt-0.5 font-arcade text-2xl font-black tracking-tight text-[#FFF7ED] sm:mt-1 sm:text-4xl">
                    TROLL PIXEL
                  </h1>
                </div>
              </div>

              <p className="mt-2.5 text-xs leading-relaxed text-[#E8A14F] sm:mt-3 sm:text-sm">
                Everything looks safe until it betrays you. Die fast, learn the trick, and reach the portal.
              </p>

              {/* Compact Horizontal Row: PLAY · LEVELS · SKINS */}
              <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-2.5">
                <button
                  type="button"
                  onClick={startFreshRun}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#E29848] px-2.5 py-2.5 font-arcade text-xs font-black text-[#261408] transition-colors hover:bg-[#F59E0B] focus-visible:outline-2 focus-visible:outline-[#FFF7ED] whitespace-nowrap sm:py-3 sm:text-sm"
                >
                  <Play className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" />
                  <span>PLAY</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    syncStatsToState();
                    setShowLevelSelect(true);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#5C3317] bg-[#3B2110] px-2.5 py-2.5 font-arcade text-xs font-bold text-[#FFF7ED] transition-colors hover:border-[#E29848] hover:bg-[#523018] whitespace-nowrap sm:py-3 sm:text-sm"
                >
                  <Grid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span>LEVELS</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    syncStatsToState();
                    setShowSkinSelect(true);
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#5C3317] bg-[#3B2110] px-2.5 py-2.5 font-arcade text-xs font-bold text-[#FDE68A] transition-colors hover:border-[#E29848] hover:bg-[#523018] whitespace-nowrap sm:py-3 sm:text-sm"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                  <span>
                    SKINS {SKIN_DEFS.filter((s) => isSkinUnlocked(s.id, progress)).length}/{SKIN_DEFS.length}
                  </span>
                </button>
              </div>

              {progress.unlockedLevel > 1 && (
                <button
                  type="button"
                  onClick={() => startLevel(progress.unlockedLevel, true)}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#5C3317] bg-[#241208] px-4 py-2 font-arcade text-xs font-bold text-[#FFF7ED] transition-colors hover:border-[#E29848] hover:bg-[#3B2110] whitespace-nowrap sm:py-2.5"
                >
                  Continue Stage {progress.unlockedLevel}
                </button>
              )}

              <div className="mt-4 hidden flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#5C3317]/60 pt-3.5 text-xs text-[#E8A14F]/90 sm:flex">
                <span>Move: A / D or Arrows</span>
                <span aria-hidden="true">·</span>
                <span>Jump: W / Up / Space</span>
                <span aria-hidden="true">·</span>
                <span>Reset: R</span>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Multi-Touch Controls (positioned safely above pinned bottom banner ad) */}
        {touchVisible && phase === 'PLAYING' && !showLevelSelect && !showShareModal && !showSkinSelect && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex items-end justify-between px-3 sm:px-8 md:bottom-[104px]">
            <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                aria-label="Move Left"
                {...makePointerHandlers(leftPointersRef)}
                className="touch-game-btn flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/60 text-[#FFF7ED] backdrop-blur-[2px] active:scale-95 active:bg-[#3B2110]/85 sm:h-16 sm:w-16 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-12"
              >
                <ArrowLeft className="h-6 w-6 sm:h-7 sm:w-7" />
              </button>
              <button
                type="button"
                aria-label="Move Right"
                {...makePointerHandlers(rightPointersRef)}
                className="touch-game-btn flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/60 text-[#FFF7ED] backdrop-blur-[2px] active:scale-95 active:bg-[#3B2110]/85 sm:h-16 sm:w-16 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-12"
              >
                <ArrowRight className="h-6 w-6 sm:h-7 sm:w-7" />
              </button>
            </div>

            <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-3">
              {Boolean(LEVELS[currentLevelId - 1]?.controlSwapInterval) && (
                <button
                  type="button"
                  aria-label="Down"
                  {...makePointerHandlers(downPointersRef)}
                  className="touch-game-btn flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/60 text-[#FFF7ED] backdrop-blur-[2px] active:scale-95 active:bg-[#3B2110]/85 sm:h-16 sm:w-16 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-12"
                >
                  <ArrowDown className="h-6 w-6 sm:h-7 sm:w-7" />
                </button>
              )}
              <button
                type="button"
                aria-label="Jump"
                {...makePointerHandlers(jumpPointersRef)}
                className="touch-game-btn flex h-14 w-18 items-center justify-center rounded-xl border-2 border-[#FDE68A]/45 bg-[#3B2110]/65 font-arcade text-xs font-black text-[#FFF7ED] backdrop-blur-[2px] active:scale-95 active:bg-[#E29848]/85 active:text-[#261408] sm:h-16 sm:w-20 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-16"
              >
                <ArrowUp className="h-6 w-6 sm:h-7 sm:w-7" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <LevelSelectModal
        open={showLevelSelect}
        currentLevelId={currentLevelId}
        progress={progress}
        onSelectLevel={(lvlId) => startLevel(lvlId, true)}
        onResetProgress={handleResetProgress}
        onOpenShare={() => {
          syncStatsToState();
          setFinalElapsedMs(advanceTimerIfPlaying(performance.now()));
          setShowShareModal(true);
        }}
        onClose={() => setShowLevelSelect(false)}
      />

      <SkinSelectModal
        open={showSkinSelect}
        progress={progress}
        selectedSkin={selectedSkin}
        onSelectSkin={handleSelectSkin}
        onClose={() => setShowSkinSelect(false)}
      />

      <ShareModal
        open={showShareModal}
        isVictory={phase === 'VICTORY'}
        currentLevelId={currentLevelId}
        totalDeaths={runDeaths}
        elapsedMs={phase === 'VICTORY' ? finalElapsedMs : advanceTimerIfPlaying(performance.now())}
        bestRunMs={progress.bestRunMs}
        deathsPerLevel={runDeathsPerLevel}
        onPlayAgain={() => startFreshRun()}
        onClose={
          phase === 'VICTORY'
            ? undefined
            : () => setShowShareModal(false)
        }
      />

      <AdBanner />
    </div>
  );
}
