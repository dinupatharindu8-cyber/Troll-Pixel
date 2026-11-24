import { Award, Check, Copy, Play, RotateCcw, Skull, Timer, X } from 'lucide-react';
import { useState } from 'react';
import { LEVELS } from '../game/levels';

interface ShareModalProps {
  open: boolean;
  isVictory: boolean;
  currentLevelId: number;
  totalDeaths: number;
  elapsedMs: number;
  bestRunMs?: number;
  deathsPerLevel: Record<number, number>;
  onPlayAgain: () => void;
  onClose?: () => void;
}

export function formatRunTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function ShareModal({
  open,
  isVictory,
  currentLevelId,
  totalDeaths,
  elapsedMs,
  bestRunMs,
  deathsPerLevel,
  onPlayAgain,
  onClose,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const formattedTime = formatRunTime(elapsedMs);
  const shareText = isVictory
    ? `I beat all ${LEVELS.length} levels of TROLL PIXEL in ${formattedTime} with ${totalDeaths} deaths and earned Certified Troll Master! Can you survive Developer's Revenge?`
    : `I'm at Level ${currentLevelId}/${LEVELS.length} in TROLL PIXEL with ${totalDeaths} deaths in ${formattedTime}! Can you survive Developer's Revenge?`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
      } finally {
        document.body.removeChild(textarea);
      }
    }
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B0E06]/85 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'Certified Troll Master Victory Summary' : 'Run Share Card'}
    >
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border-2 border-[#E29848] bg-[#2B170A] p-6 text-[#FFF7ED] shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#E29848] text-[#261408]">
              {isVictory ? <Award className="h-7 w-7" /> : <Skull className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="font-arcade text-xl font-bold tracking-tight text-[#FFF7ED]">
                {isVictory ? 'Certified Troll Master!' : 'Rage Share Card'}
              </h2>
              <p className="text-sm text-[#E8A14F]">
                {isVictory
                  ? `All ${LEVELS.length} levels across Worlds 1–5 conquered.`
                  : `Currently battling Level ${currentLevelId} / ${LEVELS.length}.`}
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018]"
              aria-label="Close share card"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Summary Metrics */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-[#5C3317] bg-[#3B2110] p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-[#E8A14F]">
              <Skull className="h-4 w-4" />
              <span>Total Deaths</span>
            </div>
            <div className="mt-1 font-arcade text-3xl font-bold tabular-nums text-[#FFF7ED]">
              {totalDeaths}
            </div>
          </div>
          <div className="rounded-lg border border-[#5C3317] bg-[#3B2110] p-4">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#E8A14F]">
              <span className="flex items-center gap-1.5">
                <Timer className="h-4 w-4" />
                <span>Total Time</span>
              </span>
              {isVictory && bestRunMs !== undefined && (
                <span className="font-arcade text-[10px] text-[#4ADE80]">
                  BEST {formatRunTime(bestRunMs)}
                </span>
              )}
            </div>
            <div className="mt-1 font-arcade text-3xl font-bold tabular-nums text-[#FFF7ED]">
              {formattedTime}
            </div>
          </div>
        </div>

        {/* Per-Level Breakdown (All 50 Levels) */}
        <div className="mt-4 rounded-lg border border-[#5C3317] bg-[#241208] p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#E8A14F]">
            <span>Deaths by Level (1–{LEVELS.length})</span>
            {isVictory && (
              <span className="font-arcade text-[#FDE68A]">Rank: Certified Troll Master</span>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
            {LEVELS.map((lvl) => {
              const d = deathsPerLevel[lvl.id] || 0;
              const tierColor =
                lvl.id > 40
                  ? 'text-[#F87171]'
                  : lvl.id > 30
                    ? 'text-[#FDBA74]'
                    : lvl.id > 20
                      ? 'text-[#C4B5FD]'
                      : lvl.id > 10
                        ? 'text-[#FCA5A5]'
                        : 'text-[#E8A14F]';
              return (
                <div
                  key={lvl.id}
                  className="flex items-center justify-between rounded bg-[#3B2110] px-2 py-1 font-arcade text-xs tabular-nums"
                  title={`Level ${lvl.id}`}
                >
                  <span className={tierColor}>L{lvl.id}</span>
                  <span className="font-bold text-[#FFF7ED]">{d}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Copy Preview */}
        <div className="mt-4 rounded-lg border border-[#5C3317]/80 bg-[#1B0E06] px-3.5 py-2.5 text-xs text-[#FDE68A]">
          “{shareText}”
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#E29848] px-4 py-2.5 text-sm font-bold text-[#261408] transition-colors hover:bg-[#F59E0B] whitespace-nowrap"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied to Clipboard!' : 'Challenge a Friend'}
          </button>

          {isVictory ? (
            <button
              type="button"
              onClick={onPlayAgain}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#5C3317] bg-[#3B2110] px-4 py-2.5 text-sm font-semibold text-[#FFF7ED] transition-colors hover:bg-[#523018] whitespace-nowrap"
            >
              <RotateCcw className="h-4 w-4" />
              Play Again
            </button>
          ) : (
            onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#5C3317] bg-[#3B2110] px-4 py-2.5 text-sm font-semibold text-[#FFF7ED] transition-colors hover:bg-[#523018] whitespace-nowrap"
              >
                <Play className="h-4 w-4" />
                Back to Game
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
