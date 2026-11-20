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
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LevelSelectModal } from './components/LevelSelectModal';
import { formatRunTime, ShareModal } from './components/ShareModal';
import { GameEngine } from './game/engine';
import { GAME_HEIGHT, GAME_WIDTH, LEVELS } from './game/levels';
import { soundEngine } from './game/sound';
import { GamePhase, InputState, LevelProgress } from './game/types';

const PROGRESS_STORAGE_KEY = 'troll_pixel_progress_v1';

function loadInitialProgress(): LevelProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LevelProgress>;
      return {
        unlockedLevel: Math.min(LEVELS.length, Math.max(1, parsed.unlockedLevel || 1)),
        deathsPerLevel: parsed.deathsPerLevel || {},
        completedLevels: Array.isArray(parsed.completedLevels) ? parsed.completedLevels : [],
      };
    }
  } catch {
    // ignore storage parse issues
  }
  return {
    unlockedLevel: 1,
    deathsPerLevel: {},
    completedLevels: [],
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
    const isModalOpen = showLevelSelect || showShareModal;
    modalOpenRef.current = isModalOpen;
    if (engineRef.current) {
      engineRef.current.setActive(phase === 'PLAYING' && !isModalOpen);
    }
    if (isModalOpen) {
      clearAllInputs();
    }
  }, [phase, showLevelSelect, showShareModal, clearAllInputs]);

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
        levelSpanRef.current.textContent = `LEVEL ${levelId}`;
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

  useEffect(() => {
    const engine = new GameEngine({
      onDeath: (lvlId) => {
        runDeathsRef.current += 1;
        runDeathsPerLevelRef.current[lvlId] = (runDeathsPerLevelRef.current[lvlId] || 0) + 1;
        progressRef.current.deathsPerLevel[lvlId] =
          (progressRef.current.deathsPerLevel[lvlId] || 0) + 1;
        saveProgress(progressRef.current);
        updateDeathHudRef(runDeathsRef.current);
      },
      onLevelComplete: (lvlId) => {
        const now = performance.now();
        if (phaseRef.current === 'PLAYING') {
          accumulatedElapsedRef.current += now - runStartPerfRef.current;
          runStartPerfRef.current = now;
        }

        const prevProg = progressRef.current;
        const nextUnlocked = Math.min(LEVELS.length, Math.max(prevProg.unlockedLevel, lvlId + 1));
        const completed = prevProg.completedLevels.includes(lvlId)
          ? prevProg.completedLevels
          : [...prevProg.completedLevels, lvlId];
        progressRef.current = {
          unlockedLevel: nextUnlocked,
          deathsPerLevel: { ...prevProg.deathsPerLevel },
          completedLevels: completed,
        };
        saveProgress(progressRef.current);
        syncStatsToState();

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
    engine.loadLevel(1, true);
    engine.setActive(false);

    let rafId = 0;
    let lastTime = performance.now();
    let cachedCanvas: HTMLCanvasElement | null = null;
    let cachedCtx: CanvasRenderingContext2D | null = null;

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      engine.stepFrame(dt, inputRef.current);
      advanceTimerIfPlaying(now);

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const targetW = Math.round(GAME_WIDTH * dpr);
        const targetH = Math.round(GAME_HEIGHT * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        if (canvas !== cachedCanvas) {
          cachedCanvas = canvas;
          cachedCtx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        }
        if (cachedCtx) {
          cachedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          engine.render(cachedCtx);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advanceTimerIfPlaying, syncStatsToState, updateDeathHudRef]);

  useEffect(() => {
    if (phase !== 'LEVEL_CLEAR') return;
    const timeout = setTimeout(() => {
      const nextId = Math.min(LEVELS.length, currentLevelId + 1);
      startLevel(nextId, true);
    }, 650);
    return () => clearTimeout(timeout);
  }, [phase, currentLevelId, startLevel]);

  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (showLevelSelect || showShareModal) {
      accumulatedElapsedRef.current += performance.now() - runStartPerfRef.current;
      runStartPerfRef.current = performance.now();
    } else {
      runStartPerfRef.current = performance.now();
    }
  }, [showLevelSelect, showShareModal, phase]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
        e.preventDefault();
        keyLeftRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        keyRightRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        keyDownRef.current = true;
        syncCombinedInput();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        e.preventDefault();
        keyJumpRef.current = true;
        syncCombinedInput();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
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

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearAllInputs, startFreshRun, startLevel, syncCombinedInput]);

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

  const handleResetProgress = () => {
    const fresh: LevelProgress = {
      unlockedLevel: 1,
      deathsPerLevel: {},
      completedLevels: [],
    };
    progressRef.current = fresh;
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
        // ignore
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
    <div className="flex h-dvh w-full flex-col bg-[#261408] text-[#FFF7ED] select-none">
      {/* Top HUD Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#5C3317] bg-[#2B170A] px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <button
            type="button"
            onClick={() => {
              clearAllInputs();
              updateDeathHudRef(0);
              syncStatsToState();
              setPhase('TITLE');
            }}
            className="font-arcade text-base font-black tracking-tight text-[#E29848] transition-colors hover:text-[#FDE68A] whitespace-nowrap shrink-0 sm:text-lg"
          >
            TROLL PIXEL
          </button>

          <div className="hidden h-4 w-px bg-[#5C3317] sm:block" aria-hidden="true" />

          <div className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
            <span
              ref={levelSpanRef}
              className="font-arcade font-bold tabular-nums text-[#FFF7ED] whitespace-nowrap shrink-0"
            >
              LEVEL 1
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div
            ref={deathsContainerRef}
            className="flex items-center gap-1.5 font-arcade text-xs font-bold tabular-nums text-[#FFF7ED] sm:text-sm"
            aria-label="Deaths: 0"
          >
            <Skull className="h-4 w-4 text-[#E29848]" />
            <span ref={deathsSpanRef}>0</span>
          </div>

          <div className="hidden items-center font-arcade text-xs font-semibold tabular-nums text-[#E8A14F] sm:flex sm:text-sm">
            <span ref={timerSpanRef}>00:00.0</span>
          </div>

          <div className="h-4 w-px bg-[#5C3317]" aria-hidden="true" />

          {phase === 'PLAYING' && (
            <button
              type="button"
              onClick={() => startLevel(currentLevelId, true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B]"
              title="Restart Level (R)"
              aria-label="Restart level"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleMute}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B]"
            title={muted ? 'Unmute Sound' : 'Mute Sound'}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? <VolumeX className="h-4 w-4 text-[#E8A14F]" /> : <Volume2 className="h-4 w-4" />}
          </button>

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

          <button
            type="button"
            onClick={() => {
              syncStatsToState();
              setShowLevelSelect(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#E29848] px-3 text-xs font-bold text-[#261408] transition-colors hover:bg-[#F59E0B] focus-visible:outline-2 focus-visible:outline-[#FFF7ED] whitespace-nowrap shrink-0"
          >
            <Grid className="h-3.5 w-3.5" />
            <span>Levels</span>
          </button>
        </div>
      </header>

      {/* Main Game Viewport */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#261408] p-2 sm:p-4">
        <div className="relative flex aspect-video max-h-full w-full max-w-[1180px] items-center justify-center overflow-hidden rounded-lg shadow-2xl">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="h-full w-full block rounded-lg"
            aria-label="TROLL PIXEL game canvas"
          />

          {phase === 'LEVEL_CLEAR' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#1B0E06]/55">
              <div className="rounded-xl border-2 border-[#E29848] bg-[#2B170A] px-8 py-5 text-center shadow-2xl">
                <div className="font-arcade text-xs font-semibold text-[#E8A14F]">
                  Level {currentLevelId} Survived
                </div>
                <div className="mt-1 font-arcade text-2xl font-black text-[#FFF7ED]">
                  Next Trap Loading...
                </div>
              </div>
            </div>
          )}

          {phase === 'TITLE' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1B0E06]/80 p-4">
              <div className="w-full max-w-md rounded-xl border-2 border-[#E29848] bg-[#2B170A] p-6 text-center shadow-2xl sm:p-8">
                <div className="font-arcade text-xs font-semibold tracking-wide text-[#E8A14F]">
                  30 Deceptive Stages · 3 Worlds
                </div>
                <h1 className="mt-2 font-arcade text-4xl font-black tracking-tight text-[#FFF7ED] sm:text-5xl">
                  TROLL PIXEL
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-[#E8A14F]">
                  Everything looks safe until it betrays you. Die fast, learn the trick, and reach the portal.
                </p>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={startFreshRun}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#E29848] px-5 py-3 text-sm font-black text-[#261408] transition-colors hover:bg-[#F59E0B] focus-visible:outline-2 focus-visible:outline-[#FFF7ED] whitespace-nowrap"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Start Game
                  </button>

                  {progress.unlockedLevel > 1 && (
                    <button
                      type="button"
                      onClick={() => startLevel(progress.unlockedLevel, true)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#5C3317] bg-[#3B2110] px-4 py-3 text-sm font-bold text-[#FFF7ED] transition-colors hover:bg-[#523018] whitespace-nowrap"
                    >
                      Continue L{progress.unlockedLevel}
                    </button>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#5C3317]/60 pt-4 text-xs text-[#E8A14F]/90">
                  <span>Move: A / D or Arrows</span>
                  <span aria-hidden="true">·</span>
                  <span>Jump: W / Up / Space</span>
                  <span aria-hidden="true">·</span>
                  <span>Reset: R</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {touchVisible && phase === 'PLAYING' && !showLevelSelect && !showShareModal && (
          <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex items-end justify-between px-4 sm:bottom-5 sm:px-8">
            <div className="pointer-events-auto flex items-center gap-3">
              <button
                type="button"
                aria-label="Move Left"
                {...makePointerHandlers(leftPointersRef)}
                className="touch-game-btn flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/85 text-[#FFF7ED] active:scale-95 active:bg-[#523018]"
              >
                <ArrowLeft className="h-7 w-7" />
              </button>
              <button
                type="button"
                aria-label="Move Right"
                {...makePointerHandlers(rightPointersRef)}
                className="touch-game-btn flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/85 text-[#FFF7ED] active:scale-95 active:bg-[#523018]"
              >
                <ArrowRight className="h-7 w-7" />
              </button>
            </div>

            <div className="pointer-events-auto flex items-center gap-3">
              {currentLevelId === 21 && (
                <button
                  type="button"
                  aria-label="Down"
                  {...makePointerHandlers(downPointersRef)}
                  className="touch-game-btn flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#FFF7ED]/30 bg-[#3B2110]/85 text-[#FFF7ED] active:scale-95 active:bg-[#523018]"
                >
                  <ArrowDown className="h-7 w-7" />
                </button>
              )}
              <button
                type="button"
                aria-label="Jump"
                {...makePointerHandlers(jumpPointersRef)}
                className="touch-game-btn flex h-16 w-20 items-center justify-center rounded-xl border-2 border-[#FDE68A]/45 bg-[#3B2110]/85 font-arcade text-xs font-black text-[#FFF7ED] active:scale-95 active:bg-[#E29848] active:text-[#261408]"
              >
                <ArrowUp className="h-7 w-7" />
              </button>
            </div>
          </div>
        )}
      </main>

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

      <ShareModal
        open={showShareModal}
        isVictory={phase === 'VICTORY'}
        currentLevelId={currentLevelId}
        totalDeaths={runDeaths}
        elapsedMs={phase === 'VICTORY' ? finalElapsedMs : advanceTimerIfPlaying(performance.now())}
        deathsPerLevel={runDeathsPerLevel}
        onPlayAgain={() => startFreshRun()}
        onClose={
          phase === 'VICTORY'
            ? undefined
            : () => setShowShareModal(false)
        }
      />
    </div>
  );
}