import { Check, Lock, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  drawSkinBody,
  getSkinProgressLabel,
  getTotalSavedDeaths,
  isSkinUnlocked,
  SKIN_DEFS,
} from '../game/skins';
import { soundEngine } from '../game/sound';
import { LevelProgress, SkinId } from '../game/types';

interface SkinSelectModalProps {
  open: boolean;
  progress: LevelProgress;
  selectedSkin: SkinId;
  onSelectSkin: (skinId: SkinId) => void;
  onClose: () => void;
}

export function SkinPreviewCanvas({
  skinId,
  locked = false,
  size = 56,
  className = '',
}: {
  skinId: SkinId;
  locked?: boolean;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    // Warm retro tile backdrop
    ctx.fillStyle = '#E29848';
    ctx.fillRect(0, 0, size, size);
    const floorH = Math.round(size * 0.2);
    ctx.fillStyle = '#3B2110';
    ctx.fillRect(0, size - floorH, size, floorH);
    ctx.fillStyle = '#523018';
    ctx.fillRect(0, size - floorH, size, Math.max(2, Math.round(floorH * 0.25)));

    ctx.save();
    if (locked) {
      ctx.globalAlpha = 0.45;
    }
    const scale = size / 48;
    ctx.translate(size / 2, size - floorH);
    ctx.scale(scale, scale);
    drawSkinBody(ctx, {
      skinId,
      w: 24,
      h: 28,
      facing: 1,
      vx: 0,
      vy: 0,
      onGround: true,
      isPanic: false,
      gravityDir: 1,
      runCycle: 0,
    });
    ctx.restore();
  }, [skinId, locked, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`shrink-0 rounded-lg border-2 border-[#5C3317] bg-[#E29848] ${className}`}
      aria-hidden="true"
    />
  );
}

export function SkinSelectModal({
  open,
  progress,
  selectedSkin,
  onSelectSkin,
  onClose,
}: SkinSelectModalProps) {
  if (!open) return null;

  const unlockedCount = SKIN_DEFS.filter((s) => isSkinUnlocked(s.id, progress)).length;
  const totalDeaths = getTotalSavedDeaths(progress);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B0E06]/85 p-3 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Character Skins"
    >
      <div className="max-h-[80dvh] w-[92vw] max-w-md overflow-y-auto rounded-xl border-2 border-[#E29848] bg-[#2B170A] p-4 text-[#FFF7ED] shadow-2xl sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-[#5C3317]/60 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E29848] text-[#261408]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-arcade text-base font-bold tracking-tight text-[#FFF7ED] sm:text-lg">
                Skins ({unlockedCount}/{SKIN_DEFS.length})
              </h2>
              <p className="text-[11px] text-[#E8A14F]">
                Total deaths: <span className="font-arcade font-bold text-[#FFF7ED]">{totalDeaths}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#5C3317] bg-[#3B2110] text-[#FFF7ED] transition-colors hover:bg-[#523018] focus-visible:outline-2 focus-visible:outline-[#F59E0B]"
            aria-label="Close skins menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:gap-3">
          {SKIN_DEFS.map((skin) => {
            const unlocked = isSkinUnlocked(skin.id, progress);
            const isEquipped = selectedSkin === skin.id && unlocked;
            const statusText = getSkinProgressLabel(skin.id, progress);

            return (
              <button
                key={skin.id}
                type="button"
                disabled={!unlocked}
                onClick={() => {
                  if (!unlocked) return;
                  soundEngine.playTick();
                  onSelectSkin(skin.id);
                }}
                className={`flex flex-col items-center rounded-xl border-2 p-2.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-[#F59E0B] sm:p-3 ${
                  !unlocked
                    ? 'cursor-not-allowed border-[#3B2110] bg-[#1F1007] opacity-75'
                    : isEquipped
                      ? 'border-[#F59E0B] bg-[#4A2813] shadow-lg'
                      : 'border-[#5C3317] bg-[#3B2110] hover:-translate-y-0.5 hover:border-[#E29848]'
                }`}
              >
                <div className="relative">
                  <SkinPreviewCanvas
                    skinId={skin.id}
                    locked={!unlocked}
                    size={56}
                    className="h-14 w-14 sm:h-16 sm:w-16"
                  />
                  {!unlocked ? (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#5C3317] bg-[#1B0E06]">
                      <Lock className="h-3 w-3 text-[#E8A14F]" />
                    </span>
                  ) : isEquipped ? (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#4ADE80] text-[#1B0E06]">
                      <Check className="h-3 w-3 stroke-[3]" />
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 w-full truncate font-arcade text-xs font-bold text-[#FFF7ED] sm:text-sm">
                  {skin.name}
                </div>

                <div
                  className={`mt-1 w-full truncate font-arcade text-[10px] font-semibold sm:text-[11px] ${
                    isEquipped
                      ? 'text-[#4ADE80]'
                      : unlocked
                        ? 'text-[#FDE68A]'
                        : 'text-[#FCA5A5]'
                  }`}
                >
                  {isEquipped ? 'Equipped' : unlocked ? 'Tap to Equip' : statusText.replace('Locked · ', '')}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#5C3317]/60 pt-3">
          <span className="text-[11px] text-[#E8A14F]/85">
            {SKIN_DEFS.find((s) => s.id === selectedSkin)?.tagline}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg bg-[#E29848] px-4 py-2 text-xs font-bold text-[#261408] transition-colors hover:bg-[#F59E0B]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
