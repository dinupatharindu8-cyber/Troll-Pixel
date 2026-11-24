import { Check, Lock, RotateCcw, Share2, X } from 'lucide-react';
import { LEVELS } from '../game/levels';
import { LevelProgress } from '../game/types';

interface LevelSelectModalProps {
  open: boolean;
  currentLevelId: number;
  progress: LevelProgress;
  onSelectLevel: (levelId: number) => void;
  onResetProgress: () => void;
  onOpenShare: () => void;
  onClose: () => void;
}

export function LevelSelectModal({
  open,
  currentLevelId,
  progress,
  onSelectLevel,
  onResetProgress,
  onOpenShare,
  onClose,
}: LevelSelectModalProps) {
  if (!open) return null;

  const world1 = LEVELS.filter((l) => l.id <= 10);
  const world2 = LEVELS.filter((l) => l.id > 10 && l.id <= 20);
  const world3 = LEVELS.filter((l) => l.id > 20 && l.id <= 30);
  const world4 = LEVELS.filter((l) => l.id > 30 && l.id <= 40);
  const world5 = LEVELS.filter((l) => l.id > 40);

  const renderGrid = (items: typeof LEVELS) => (
    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
      {items.map((lvl) => {
        const isUnlocked = lvl.id <= progress.unlockedLevel;
        const isCompleted = progress.completedLevels.includes(lvl.id);
        const isCurrent = lvl.id === currentLevelId;
        const lvlDeaths = progress.deathsPerLevel[lvl.id] || 0;

        return (
          <button
            key={lvl.id}
            type="button"
            disabled={!isUnlocked}
            onClick={() => {
              onSelectLevel(lvl.id);
              onClose();
            }}
            className={`group relative flex flex-col justify-between rounded-lg border-2 p-2.5 text-left transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-[#F59E0B] ${
              !isUnlocked
                ? 'cursor-not-allowed border-[#3B2110] bg-[#1F1007] opacity-55'
                : isCurrent
                  ? 'border-[#F59E0B] bg-[#4A2813] hover:-translate-y-0.5'
                  : 'border-[#5C3317] bg-[#3B2110] hover:-translate-y-0.5 hover:border-[#E29848]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-arcade text-base font-bold tabular-nums text-[#FDE68A]">
                {String(lvl.id).padStart(2, '0')}
              </span>
              {!isUnlocked ? (
                <Lock className="h-3.5 w-3.5 text-[#A1785A]" />
              ) : isCompleted ? (
                <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
              ) : null}
            </div>
            <div className="mt-1.5 truncate text-xs font-semibold text-[#FFF7ED]">
              Stage {lvl.id}
            </div>
            <div className="mt-0.5 font-arcade text-[11px] tabular-nums text-[#E8A14F]/85">
              {isUnlocked ? `${lvlDeaths} ${lvlDeaths === 1 ? 'death' : 'deaths'}` : 'Locked'}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B0E06]/80 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Level Select"
    >
      <div className="max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-xl border-2 border-[#5C3317] bg-[#2B170A] p-6 text-[#FFF7ED] shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#5C3317]/60 pb-4">
          <div>
            <h2 className="font-arcade text-xl font-bold tracking-tight text-[#FFF7ED]">
              Select Level
            </h2>
            <p className="mt-1 text-sm text-[#E8A14F]">
              Survive all 50 stages across five worlds to become a Certified Troll Master.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B]"
            aria-label="Close level select"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* World 1 */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-arcade text-sm font-bold text-[#FDE68A]">
              World 1: Classic Trolls (1–10)
            </h3>
            <span className="font-arcade text-xs tabular-nums text-[#E8A14F]">
              {world1.filter((l) => progress.completedLevels.includes(l.id)).length} / 10 cleared
            </span>
          </div>
          {renderGrid(world1)}
        </div>

        {/* World 2 */}
        <div className="mt-6 border-t border-[#5C3317]/50 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-arcade text-sm font-bold text-[#FCA5A5]">
              World 2: Nightmare Trolls (11–20)
            </h3>
            <span className="font-arcade text-xs tabular-nums text-[#E8A14F]">
              {world2.filter((l) => progress.completedLevels.includes(l.id)).length} / 10 cleared
            </span>
          </div>
          {renderGrid(world2)}
        </div>

        {/* World 3 */}
        <div className="mt-6 border-t border-[#5C3317]/50 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-arcade text-sm font-bold text-[#C4B5FD]">
              World 3: Impossible Mode (21–30)
            </h3>
            <span className="font-arcade text-xs tabular-nums text-[#E8A14F]">
              {world3.filter((l) => progress.completedLevels.includes(l.id)).length} / 10 cleared
            </span>
          </div>
          {renderGrid(world3)}
        </div>

        {/* World 4 */}
        <div className="mt-6 border-t border-[#5C3317]/50 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-arcade text-sm font-bold text-[#FDBA74]">
              World 4: Pure Pain &amp; Betrayal (31–40)
            </h3>
            <span className="font-arcade text-xs tabular-nums text-[#E8A14F]">
              {world4.filter((l) => progress.completedLevels.includes(l.id)).length} / 10 cleared
            </span>
          </div>
          {renderGrid(world4)}
        </div>

        {/* World 5 */}
        <div className="mt-6 border-t border-[#5C3317]/50 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-arcade text-sm font-bold text-[#F87171]">
              World 5: Developer&apos;s Revenge (41–50)
            </h3>
            <span className="font-arcade text-xs tabular-nums text-[#E8A14F]">
              {world5.filter((l) => progress.completedLevels.includes(l.id)).length} / 10 cleared
            </span>
          </div>
          {renderGrid(world5)}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#5C3317]/60 pt-4">
          <button
            type="button"
            onClick={onResetProgress}
            className="inline-flex items-center gap-2 rounded-lg border border-[#5C3317] bg-[#241208] px-3 py-2 text-xs font-medium text-[#E8A14F] transition-colors hover:bg-[#3B2110] hover:text-[#FFF7ED] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Save
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenShare();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#E29848] px-4 py-2 text-xs font-bold text-[#261408] transition-colors hover:bg-[#F59E0B] whitespace-nowrap shrink-0"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share Card
          </button>
        </div>
      </div>
    </div>
  );
}
