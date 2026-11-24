import { LevelProgress, SkinId } from './types';

export interface SkinDef {
  id: SkinId;
  name: string;
  tagline: string;
  unlockRequirement: string;
  accentColor: string;
  particleColors: readonly string[];
}

export const SKIN_DEFS: readonly SkinDef[] = [
  {
    id: 'default',
    name: 'Default Hero',
    tagline: 'Original espresso cube with sturdy boots.',
    unlockRequirement: 'Unlocked by default',
    accentColor: '#F59E0B',
    particleColors: ['#3B2110', '#FFF7ED', '#5C3317', '#261408', '#FDE68A'],
  },
  {
    id: 'clown',
    name: 'Clown Skin',
    tagline: 'Embrace the circus after 50 glorious fails.',
    unlockRequirement: '50 total deaths',
    accentColor: '#EF4444',
    particleColors: ['#FFF7ED', '#EF4444', '#38BDF8', '#FDE68A', '#261408'],
  },
  {
    id: 'ninja',
    name: 'Ninja Skin',
    tagline: 'Swift shinobi of World 2 shadows.',
    unlockRequirement: 'Beat World 2 (Level 20)',
    accentColor: '#DC2626',
    particleColors: ['#1E293B', '#DC2626', '#FFF7ED', '#0F172A', '#94A3B8'],
  },
  {
    id: 'king',
    name: 'Golden Crown King',
    tagline: 'Sovereign ruler who conquered all 50 traps.',
    unlockRequirement: 'Beat Level 50',
    accentColor: '#FACC15',
    particleColors: ['#FACC15', '#FDE68A', '#7C3AED', '#FFF7ED', '#F59E0B'],
  },
];

export function getTotalSavedDeaths(progress: LevelProgress): number {
  const sumPerLevel = Object.values(progress.deathsPerLevel).reduce((acc, n) => acc + n, 0);
  return Math.max(progress.totalDeaths || 0, sumPerLevel);
}

export function isSkinUnlocked(skinId: SkinId, progress: LevelProgress): boolean {
  switch (skinId) {
    case 'default':
      return true;
    case 'clown':
      return getTotalSavedDeaths(progress) >= 50;
    case 'ninja':
      return progress.completedLevels.includes(20) || progress.unlockedLevel >= 21;
    case 'king':
      return progress.completedLevels.includes(50);
    default:
      return false;
  }
}

export function getSkinProgressLabel(skinId: SkinId, progress: LevelProgress): string {
  if (isSkinUnlocked(skinId, progress)) return 'Unlocked';
  switch (skinId) {
    case 'clown': {
      const deaths = Math.min(50, getTotalSavedDeaths(progress));
      return `Locked · ${deaths}/50 deaths`;
    }
    case 'ninja':
      return 'Locked · Beat Level 20';
    case 'king':
      return 'Locked · Beat Level 50';
    default:
      return 'Locked';
  }
}

export function getSkinParticleColors(skinId: SkinId): readonly string[] {
  const found = SKIN_DEFS.find((s) => s.id === skinId);
  return found ? found.particleColors : SKIN_DEFS[0].particleColors;
}

export interface SkinDrawParams {
  skinId: SkinId;
  w: number;
  h: number;
  facing: 1 | -1;
  vx: number;
  vy: number;
  onGround: boolean;
  isPanic: boolean;
  gravityDir: 1 | -1;
  runCycle: number;
}

/**
 * Draws the chunky retro-pixel hero in local character coordinates where
 * (0, 0) is the bottom-center anchor (standing on ground) and -h is the top.
 */
export function drawSkinBody(ctx: CanvasRenderingContext2D, params: SkinDrawParams): void {
  const { skinId, w, h, facing, vx, vy, onGround, isPanic, gravityDir, runCycle } = params;
  const bodyW = w;
  const bodyH = h - 5;

  const moving = Math.abs(vx) > 20;
  const legSwing = moving && onGround ? Math.sin(runCycle) * 3.5 : 0;
  const leftLegY = -6 + Math.max(0, -legSwing);
  const rightLegY = -6 + Math.max(0, legSwing);
  const lookShift = facing * 2.5;
  const eyeY = -h + 9;
  const eyeW = isPanic ? 6 : 5;
  const eyeH = isPanic ? 7 : 6;
  const pupilOffsetX = facing === 1 ? 2 : 0;
  const pupilOffsetY = vy * gravityDir > 120 ? 3 : 2;

  if (skinId === 'clown') {
    // Big red clown shoes
    ctx.fillStyle = '#B91C1C';
    ctx.fillRect(-8 + legSwing * 0.4, leftLegY, 7, 6);
    ctx.fillRect(1 - legSwing * 0.4, rightLegY, 7, 6);

    // Fluffy crimson afro puffs on sides
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-bodyW / 2 - 4, -h + 2, 5, 11);
    ctx.fillRect(bodyW / 2 - 1, -h + 2, 5, 11);
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-bodyW / 2 - 3, -h + 3, 3, 7);
    ctx.fillRect(bodyW / 2, -h + 3, 3, 7);

    // Dark outline + white clown makeup torso/head
    ctx.fillStyle = '#261408';
    ctx.fillRect(-bodyW / 2, -h, bodyW, bodyH);
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, bodyH - 4);

    // Rainbow ruffled pixel collar
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(-bodyW / 2 + 2, -9, 6, 4);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-3, -9, 6, 4);
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(3, -9, bodyW / 2 - 5, 4);

    // Expressive dark eye outlines + pupils
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(-7 + lookShift, eyeY, eyeW, eyeH);
    ctx.fillRect(2 + lookShift, eyeY, eyeW, eyeH);
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(-7 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
    ctx.fillRect(2 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);

    // Classic bright red pixel clown nose
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-2.5 + lookShift, eyeY + 5, 5, 4);
    ctx.fillStyle = '#FCA5A5';
    ctx.fillRect(-1.5 + lookShift, eyeY + 5.5, 2, 1.5);
    return;
  }

  if (skinId === 'ninja') {
    // Dark shinobi boots
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-7 + legSwing * 0.4, leftLegY, 5, 6);
    ctx.fillRect(2 - legSwing * 0.4, rightLegY, 5, 6);

    // Trailing crimson headband tails behind facing direction
    const tailDir = -facing;
    const flutter = Math.sin(runCycle * 1.4) * 1.5;
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(tailDir * (bodyW / 2) + (tailDir < 0 ? -5 : 0), -h + 4 + flutter, 5, 3);
    ctx.fillRect(tailDir * (bodyW / 2) + (tailDir < 0 ? -7 : 2), -h + 7 - flutter * 0.6, 5, 2.5);

    // Dark obsidian hood & suit
    ctx.fillStyle = '#090D16';
    ctx.fillRect(-bodyW / 2, -h, bodyW, bodyH);
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, bodyH - 4);

    // Crimson ninja headband
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-bodyW / 2 + 1, -h + 4, bodyW - 2, 4);

    // Warm skin-tone eye slit
    ctx.fillStyle = '#FDBA74';
    ctx.fillRect(-bodyW / 2 + 3, eyeY, bodyW - 6, 7);

    // Focused sharp eyes inside slit
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(-6 + lookShift, eyeY + 1, 4.5, 4.5);
    ctx.fillRect(2 + lookShift, eyeY + 1, 4.5, 4.5);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-6 + lookShift + pupilOffsetX * 0.8, eyeY + 2, 2.2, 2.5);
    ctx.fillRect(2 + lookShift + pupilOffsetX * 0.8, eyeY + 2, 2.2, 2.5);

    // Diagonal crimson sash on chest
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-bodyW / 2 + 3, -9, bodyW - 6, 2);
    return;
  }

  if (skinId === 'king') {
    // Royal gold boots
    ctx.fillStyle = '#92400E';
    ctx.fillRect(-7 + legSwing * 0.4, leftLegY, 5, 6);
    ctx.fillRect(2 - legSwing * 0.4, rightLegY, 5, 6);

    // Regal purple royal cape fluttering slightly behind
    const capeX = facing === 1 ? -bodyW / 2 - 3 : bodyW / 2 - 1;
    ctx.fillStyle = '#6D28D9';
    ctx.fillRect(capeX, -h + 6, 4, bodyH - 5);

    // Golden pixel crown above head (3 prongs + jewels)
    ctx.fillStyle = '#B45309';
    ctx.fillRect(-9, -h - 6, 18, 6);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-8, -h - 5, 16, 5);
    ctx.fillRect(-8, -h - 8, 4, 3);
    ctx.fillRect(-2, -h - 9, 4, 4);
    ctx.fillRect(4, -h - 8, 4, 3);
    // Crown jewels
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-1, -h - 4, 2, 2);
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(-6, -h - 4, 2, 2);
    ctx.fillRect(4, -h - 4, 2, 2);

    // Dark outline + gleaming gold pixel body
    ctx.fillStyle = '#451A03';
    ctx.fillRect(-bodyW / 2, -h, bodyW, bodyH);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, bodyH - 4);
    ctx.fillStyle = '#FDE68A';
    ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, 4);

    // Royal purple collar trim
    ctx.fillStyle = '#7C3AED';
    ctx.fillRect(-bodyW / 2 + 2, -9, bodyW - 4, 4);

    // Expressive eyes
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(-7 + lookShift, eyeY, eyeW, eyeH);
    ctx.fillRect(2 + lookShift, eyeY, eyeW, eyeH);
    ctx.fillStyle = '#1B0E06';
    ctx.fillRect(-7 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
    ctx.fillRect(2 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
    return;
  }

  // Default Hero
  ctx.fillStyle = '#261408';
  ctx.fillRect(-7 + legSwing * 0.4, leftLegY, 5, 6);
  ctx.fillRect(2 - legSwing * 0.4, rightLegY, 5, 6);

  ctx.fillStyle = '#261408';
  ctx.fillRect(-bodyW / 2, -h, bodyW, bodyH);

  ctx.fillStyle = '#4A2813';
  ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, bodyH - 4);

  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(-bodyW / 2 + 2, -h + 2, bodyW - 4, 3);

  ctx.fillStyle = '#FFF7ED';
  ctx.fillRect(-7 + lookShift, eyeY, eyeW, eyeH);
  ctx.fillRect(2 + lookShift, eyeY, eyeW, eyeH);

  ctx.fillStyle = '#1B0E06';
  ctx.fillRect(-7 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
  ctx.fillRect(2 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
}
