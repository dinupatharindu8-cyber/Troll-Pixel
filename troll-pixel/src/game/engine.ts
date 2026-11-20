import { GAME_HEIGHT, GAME_WIDTH, LEVELS } from './levels';
import { soundEngine } from './sound';
import {
  CloneFrame,
  FloatingCallout,
  InputState,
  LevelDef,
  LightningStrike,
  Particle,
  PlayerState,
  RuntimeChasingWall,
  RuntimeDoor,
  RuntimeMovingGate,
  RuntimePlatform,
  RuntimeRainSpike,
  RuntimeRisingFloor,
  RuntimeSawblade,
  RuntimeSpike,
  RuntimeSwitch,
} from './types';

const FIXED_DT = 1 / 120;
const GRAVITY = 1950;
const MAX_FALL = 780;
const RUN_SPEED = 272;

// Smooth ease-out horizontal acceleration & deceleration rates (1/s)
const GROUND_ACCEL_RATE = 23;
const GROUND_DECEL_RATE = 15.5;
const ICE_ACCEL_RATE = 5.2;
const ICE_DECEL_RATE = 1.35;
const AIR_ACCEL_RATE = 14;
const AIR_DECEL_RATE = 6.5;

const JUMP_VEL = 635;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER_TIME = 0.12;
const RESPAWN_DELAY = 0.24;
const FADE_DURATION = 0.15;

const PARTICLE_POOL_SIZE = 240;
const CALLOUT_POOL_SIZE = 16;
const RAIN_SPIKE_POOL_SIZE = 64;
const CLONE_RING_SIZE = 256;
const STATIC_PAD = 64;
const STATIC_SCALE = 2;

const DEATH_COLORS = ['#3B2110', '#FFF7ED', '#5C3317', '#261408', '#FDE68A'];
const WIN_COLORS = ['#FDE68A', '#FFF7ED', '#A78BFA', '#F59E0B'];
const CONFETTI_COLORS = ['#FDE68A', '#4ADE80', '#60A5FA', '#F472B6', '#FFF7ED'];
const BURST_COLORS = ['#DC2626', '#FEF08A', '#3B2110', '#FFF7ED'];
const WOOD_COLORS = ['#5C3317', '#3B2110'];
const PORTAL_COLORS = ['#A78BFA', '#FDE68A'];
const SWITCH_COLORS = ['#FDE68A', '#FFF7ED'];
const FAKE_SPIKE_COLORS = ['#FFF7ED', '#3B2110'];

interface DustMote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  fillStyle: string;
}

interface WindLine {
  x: number;
  y: number;
  len: number;
  speed: number;
}

export interface EngineCallbacks {
  onDeath: (levelId: number) => void;
  onLevelComplete: (levelId: number) => void;
  onTrapBanner?: (text: string | null) => void;
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleRectOverlap(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function easeOutStep(current: number, target: number, factor60: number, dt: number): number {
  const diff = target - current;
  if (Math.abs(diff) < 0.25) return target;
  return current + diff * (1 - Math.pow(1 - factor60, dt * 60));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class GameEngine {
  private level: LevelDef = LEVELS[0];
  private platforms: RuntimePlatform[] = [];
  private spikes: RuntimeSpike[] = [];
  private sawblades: RuntimeSawblade[] = [];
  private doors: RuntimeDoor[] = [];
  private switches: RuntimeSwitch[] = [];
  private rainSpikes: RuntimeRainSpike[] = [];
  private movingGates: RuntimeMovingGate[] = [];
  private cloneHistory: CloneFrame[] = [];
  private cloneWriteIdx = 0;
  private cloneCount = 0;
  private chasingWall: RuntimeChasingWall | null = null;
  private risingFloor: RuntimeRisingFloor | null = null;
  private particles: Particle[] = [];
  private particleCursor = 0;
  private callouts: FloatingCallout[] = [];
  private calloutCursor = 0;
  private dust: DustMote[] = [];
  private windLines: WindLine[] = [];
  private persistedTriggers: Set<string> = new Set();
  private lightning: LightningStrike | null = null;

  private staticTerrainCanvas: HTMLCanvasElement | null = null;
  private staticTerrainCtx: CanvasRenderingContext2D | null = null;
  private hasStaticCache = false;
  private cachedGradCtx: CanvasRenderingContext2D | null = null;
  private cachedBgGrad: CanvasGradient | null = null;
  private cachedPortalGrad: CanvasGradient | null = null;
  private signWidthCache: Map<string, number> = new Map();

  private fakeDeathActive = false;
  private fakeDeathTriggeredOnce = false;
  private windTimer = 0;
  private windGusting = false;
  private inReverseZone = false;

  private levelElapsed = 0;
  private controlSwapTimer = 0;
  private controlsSwapped = false;
  private controlSwapPulse = 0;
  private rainWaveTimer = 0;
  private rainWaveIndex = 0;
  private switchTriggered = false;
  private switchTriggerTime = 0;
  private fakeVictoryActive = false;
  private fakeVictoryTimer = 0;
  private fakeVictoryDone = false;
  private shrinkLeft = 0;
  private shrinkRight = GAME_WIDTH;
  private shrinkTop = 0;
  private shrinkBottom = GAME_HEIGHT;
  private prevShrinkLeft = 0;
  private prevShrinkRight = GAME_WIDTH;
  private prevShrinkTop = 0;
  private prevShrinkBottom = GAME_HEIGHT;

  private player: PlayerState;
  private prevPlayerX = 0;
  private prevPlayerY = 0;
  private prevPlayerSquashX = 1;
  private prevPlayerSquashY = 1;
  private prevPlayerLean = 0;
  private lookAheadX = 0;
  private camX = 0;
  private camY = 0;
  private runDustTimer = 0;
  private transitionAlpha = 1;

  private accumulator = 0;
  private renderAlpha = 1;
  private shakeIntensity = 0;
  private globalTime = 0;
  private active = false;
  private callbacks: EngineCallbacks;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
    this.initPools();
    this.initOffscreenCache();
    this.player = this.createFreshPlayer(LEVELS[0]);
    this.prevPlayerX = this.player.x;
    this.prevPlayerY = this.player.y;
    this.initDust();
    this.loadLevel(1, true);
  }

  private initPools(): void {
    this.particles = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vx: 0,
      vy: 0,
      size: 4,
      color: '#3B2110',
      life: 0,
      maxLife: 1,
      gravity: 0,
      rotation: 0,
      vRot: 0,
    }));

    this.callouts = Array.from({ length: CALLOUT_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vy: 0,
      text: '',
      color: '#FFF7ED',
      life: 0,
      maxLife: 0.9,
    }));

    this.rainSpikes = Array.from({ length: RAIN_SPIKE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      prevY: 0,
      w: 18,
      h: 24,
      speed: 0,
      warningTimer: 0,
      endY: GAME_HEIGHT,
    }));

    this.cloneHistory = Array.from({ length: CLONE_RING_SIZE }, () => ({
      x: 0,
      y: 0,
      facing: 1 as const,
      squashX: 1,
      squashY: 1,
      gravityDir: 1 as const,
      runCycle: 0,
    }));
  }

  private initOffscreenCache(): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = (GAME_WIDTH + STATIC_PAD * 2) * STATIC_SCALE;
    canvas.height = (GAME_HEIGHT + STATIC_PAD * 2) * STATIC_SCALE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      this.staticTerrainCanvas = canvas;
      this.staticTerrainCtx = ctx;
    }
  }

  private clearPools(): void {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles[i].active = false;
    }
    for (let i = 0; i < CALLOUT_POOL_SIZE; i++) {
      this.callouts[i].active = false;
    }
    this.clearRainSpikes();
    this.cloneWriteIdx = 0;
    this.cloneCount = 0;
  }

  private clearRainSpikes(): void {
    for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
      this.rainSpikes[i].active = false;
    }
  }

  private initDust(): void {
    this.dust = Array.from({ length: 16 }, () => {
      const alpha = 0.14 + Math.random() * 0.2;
      return {
        x: Math.random() * GAME_WIDTH,
        y: Math.random() * GAME_HEIGHT,
        r: 1.5 + Math.random() * 2,
        vx: -10 + Math.random() * 20,
        vy: -14 + Math.random() * 8,
        fillStyle: `rgba(255, 247, 237, ${alpha.toFixed(3)})`,
      };
    });

    this.windLines = Array.from({ length: 18 }, () => ({
      x: Math.random() * GAME_WIDTH,
      y: 40 + Math.random() * (GAME_HEIGHT - 120),
      len: 30 + Math.random() * 55,
      speed: 560 + Math.random() * 300,
    }));
  }

  private createFreshPlayer(level: LevelDef): PlayerState {
    return {
      x: level.spawn.x,
      y: level.spawn.y,
      w: 24,
      h: 28,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: false,
      onIce: false,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      jumpHeld: false,
      gravityDir: 1,
      controlsReversed: false,
      mirrored: false,
      jumpsUsed: 0,
      squashX: 1,
      squashY: 1,
      leanAngle: 0,
      runCycle: 0,
      dead: false,
      respawnTimer: 0,
      won: false,
      winTimer: 0,
      panicTimer: 0,
    };
  }

  public setActive(isActive: boolean): void {
    this.active = isActive;
  }

  public loadLevel(levelId: number, resetPersisted = true): void {
    const found = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    this.level = found;
    if (resetPersisted) {
      this.persistedTriggers.clear();
      this.clearPools();
    }
    this.resetRoundEntities();
    this.rebuildStaticTerrainCache();
    this.player = this.createFreshPlayer(this.level);
    this.prevPlayerX = this.player.x;
    this.prevPlayerY = this.player.y;
    this.prevPlayerSquashX = 1;
    this.prevPlayerSquashY = 1;
    this.prevPlayerLean = 0;
    this.lookAheadX = 0;
    this.camX = 0;
    this.camY = 0;
    this.accumulator = 0;
    this.renderAlpha = 1;
    this.shakeIntensity = 0;
    this.transitionAlpha = 1;
  }

  private resetRoundEntities(): void {
    this.fakeDeathActive = false;
    this.fakeDeathTriggeredOnce = false;
    this.windTimer = 0;
    this.windGusting = false;
    this.inReverseZone = false;
    this.lightning = null;
    this.runDustTimer = 0;

    this.levelElapsed = 0;
    this.controlSwapTimer = 0;
    this.controlsSwapped = false;
    this.controlSwapPulse = 0;
    this.clearRainSpikes();
    this.rainWaveTimer = 0.25;
    this.rainWaveIndex = 0;
    this.cloneWriteIdx = 0;
    this.cloneCount = 0;
    this.switchTriggered = false;
    this.switchTriggerTime = 0;
    this.fakeVictoryActive = false;
    this.fakeVictoryTimer = 0;
    this.fakeVictoryDone = false;
    this.shrinkLeft = 0;
    this.shrinkRight = GAME_WIDTH;
    this.shrinkTop = 0;
    this.shrinkBottom = GAME_HEIGHT;
    this.prevShrinkLeft = 0;
    this.prevShrinkRight = GAME_WIDTH;
    this.prevShrinkTop = 0;
    this.prevShrinkBottom = GAME_HEIGHT;

    const noStaticBecauseFadeAll = this.level.fadeAllPlatformsAfter !== undefined;

    this.platforms = this.level.platforms.map((p) => {
      const wasPersisted = Boolean(p.persistAfterTrigger && this.persistedTriggers.has(p.id));
      const startX = wasPersisted && p.targetX !== undefined ? p.targetX : p.x;
      const startY = wasPersisted && p.targetY !== undefined ? p.targetY : p.y;
      const isStaticKind = p.kind === undefined || p.kind === 'solid' || p.kind === 'ice';
      return {
        ...p,
        curX: startX,
        curY: startY,
        curW: p.w,
        prevX: startX,
        prevY: startY,
        prevW: p.w,
        triggered: wasPersisted,
        active: true,
        vanished: false,
        fadeAlpha: p.kind === 'invisible' ? 0 : 1,
        springTimer: 0,
        springPop: 0,
        slammed: wasPersisted,
        shrinkingStarted: false,
        revealed: false,
        periodicTimer: p.fallDelay ?? 0,
        crumbleTimer: 0,
        crumbling: false,
        isStaticCached: !noStaticBecauseFadeAll && isStaticKind,
      };
    });

    this.spikes = this.level.spikes.map((s) => {
      const isStatic = (s.kind === undefined || s.kind === 'normal') && !s.hiddenUntilDoorTrigger;
      return {
        ...s,
        active: !s.hiddenUntilDoorTrigger,
        vanished: false,
        popScale: s.hiddenUntilDoorTrigger || s.kind === 'delayed' ? 0 : 1,
        popVel: 0,
        armed: false,
        armTimer: 0,
        emerged: s.kind !== 'delayed',
        isStaticCached: isStatic,
      };
    });

    this.sawblades = (this.level.sawblades || []).map((sb) => ({
      ...sb,
      curX: sb.x,
      curY: sb.y,
      prevX: sb.x,
      prevY: sb.y,
      triggered: false,
      active: sb.triggerX === undefined,
      delayTimer: sb.delay ?? 0,
      angle: 0,
      prevAngle: 0,
      patrolT: 0,
    }));

    this.doors = this.level.doors.map((d) => {
      const wasPersisted = Boolean(d.persistAfterTrigger && this.persistedTriggers.has(d.id));
      const startX = wasPersisted && d.targetX !== undefined ? d.targetX : d.x;
      const startY = wasPersisted && d.targetY !== undefined ? d.targetY : d.y;
      return {
        ...d,
        curX: startX,
        curY: startY,
        prevX: startX,
        prevY: startY,
        triggered: wasPersisted,
        burstTriggered: false,
        shimmerPhase: Math.random() * Math.PI * 2,
        monsterMode: false,
        monsterAngle: 0,
        prevMonsterAngle: 0,
        locked: d.kind === 'locked_chain',
        runawayIndex: 0,
        runawayCooldown: 0,
      };
    });

    this.switches = (this.level.switches || []).map((sw) => ({
      ...sw,
      pressed: false,
    }));

    this.movingGates = (this.level.movingGates || []).map((mg) => {
      const midY = (mg.minY + mg.maxY) / 2;
      const amp = (mg.maxY - mg.minY) / 2;
      const startGapY = midY + Math.sin(mg.phase) * amp;
      return {
        ...mg,
        t: 0,
        curGapY: startGapY,
        prevGapY: startGapY,
      };
    });

    if (this.level.chasingWall) {
      this.chasingWall = {
        active: false,
        curX: this.level.chasingWall.startX,
        prevX: this.level.chasingWall.startX,
        w: this.level.chasingWall.w,
        triggerX: this.level.chasingWall.triggerX,
        speed: this.level.chasingWall.speed,
        spikeExtend: 0,
        prevSpikeExtend: 0,
        isLaser: Boolean(this.level.chasingWall.isLaser),
      };
    } else {
      this.chasingWall = null;
    }

    if (this.level.risingFloor) {
      this.risingFloor = {
        active: false,
        curY: this.level.risingFloor.startY,
        prevY: this.level.risingFloor.startY,
        speed: this.level.risingFloor.speed,
        triggerX: this.level.risingFloor.triggerX,
        minY: this.level.risingFloor.minY,
      };
    } else {
      this.risingFloor = null;
    }
  }

  private rebuildStaticTerrainCache(): void {
    const ctx = this.staticTerrainCtx;
    const canvas = this.staticTerrainCanvas;
    if (!ctx || !canvas) {
      this.hasStaticCache = false;
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(STATIC_SCALE, 0, 0, STATIC_SCALE, STATIC_PAD * STATIC_SCALE, STATIC_PAD * STATIC_SCALE);

    // 1. Batch static platform bodies (#3B2110)
    ctx.fillStyle = '#3B2110';
    ctx.beginPath();
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.isStaticCached) continue;
      ctx.rect(plat.curX, plat.curY, plat.curW, plat.h);
    }
    ctx.fill();

    // 2. Batch static normal top highlights (#523018)
    ctx.fillStyle = '#523018';
    ctx.beginPath();
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.isStaticCached || plat.kind === 'ice') continue;
      ctx.rect(plat.curX, plat.curY, plat.curW, Math.min(4, plat.h));
    }
    ctx.fill();

    // 3. Batch static ice highlights (#BAE6FD & #E0F2FE)
    ctx.fillStyle = '#BAE6FD';
    ctx.beginPath();
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.isStaticCached || plat.kind !== 'ice') continue;
      ctx.rect(plat.curX, plat.curY, plat.curW, 7);
    }
    ctx.fill();

    ctx.fillStyle = '#E0F2FE';
    ctx.beginPath();
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.isStaticCached || plat.kind !== 'ice') continue;
      ctx.rect(plat.curX, plat.curY, plat.curW, 3);
    }
    ctx.fill();

    // 4. Batch static bottom shadows (#261408)
    ctx.fillStyle = '#261408';
    ctx.beginPath();
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.isStaticCached) continue;
      const sh = Math.min(4, plat.h);
      ctx.rect(plat.curX, plat.curY + plat.h - sh, plat.curW, sh);
    }
    ctx.fill();

    // 5. Batch static spikes dark silhouette (#1B0E06) and white glint (#FFF7ED)
    const spikeUnit = 16;
    ctx.fillStyle = '#1B0E06';
    ctx.beginPath();
    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      if (!s.isStaticCached) continue;
      if (s.dir === 'up' || s.dir === 'down') {
        const count = Math.max(1, Math.round(s.w / spikeUnit));
        const unitW = s.w / count;
        const baseY = s.dir === 'up' ? s.y + s.h : s.y;
        const tipY = s.dir === 'up' ? s.y : s.y + s.h;
        for (let k = 0; k < count; k++) {
          const sx = s.x + k * unitW;
          const midX = sx + unitW / 2;
          ctx.moveTo(sx, baseY);
          ctx.lineTo(midX, tipY);
          ctx.lineTo(sx + unitW, baseY);
          ctx.closePath();
        }
      } else {
        const count = Math.max(1, Math.round(s.h / spikeUnit));
        const unitH = s.h / count;
        const baseX = s.dir === 'left' ? s.x + s.w : s.x;
        const tipX = s.dir === 'left' ? s.x : s.x + s.w;
        for (let k = 0; k < count; k++) {
          const sy = s.y + k * unitH;
          const midY = sy + unitH / 2;
          ctx.moveTo(baseX, sy);
          ctx.lineTo(tipX, midY);
          ctx.lineTo(baseX, sy + unitH);
          ctx.closePath();
        }
      }
    }
    ctx.fill();

    ctx.fillStyle = '#FFF7ED';
    ctx.beginPath();
    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      if (!s.isStaticCached) continue;
      if (s.dir === 'up' || s.dir === 'down') {
        const count = Math.max(1, Math.round(s.w / spikeUnit));
        const unitW = s.w / count;
        const baseY = s.dir === 'up' ? s.y + s.h : s.y;
        const tipY = s.dir === 'up' ? s.y : s.y + s.h;
        for (let k = 0; k < count; k++) {
          const sx = s.x + k * unitW;
          const midX = sx + unitW / 2;
          ctx.moveTo(sx + 2.5, baseY);
          ctx.lineTo(midX, tipY + (s.dir === 'up' ? 3 : -3));
          ctx.lineTo(midX, baseY);
          ctx.closePath();
        }
      } else {
        const count = Math.max(1, Math.round(s.h / spikeUnit));
        const unitH = s.h / count;
        const baseX = s.dir === 'left' ? s.x + s.w : s.x;
        const tipX = s.dir === 'left' ? s.x : s.x + s.w;
        for (let k = 0; k < count; k++) {
          const sy = s.y + k * unitH;
          const midY = sy + unitH / 2;
          ctx.moveTo(baseX, sy + 2.5);
          ctx.lineTo(tipX + (s.dir === 'left' ? 3 : -3), midY);
          ctx.lineTo(baseX, midY);
          ctx.closePath();
        }
      }
    }
    ctx.fill();

    this.hasStaticCache = true;
  }

  public handleCanvasClick(virtualX: number, virtualY: number): void {
    if (!this.active || !this.fakeDeathActive || this.player.dead || this.player.won) return;
    if (virtualX >= 360 && virtualX <= 600 && virtualY >= 280 && virtualY <= 338) {
      this.fakeDeathActive = false;
      this.addCallout(480, 250, 'FELL FOR IT!', '#FEF08A');
      this.killPlayer();
    }
  }

  private capturePrevStates(): void {
    this.prevPlayerX = this.player.x;
    this.prevPlayerY = this.player.y;
    this.prevPlayerSquashX = this.player.squashX;
    this.prevPlayerSquashY = this.player.squashY;
    this.prevPlayerLean = this.player.leanAngle;

    this.prevShrinkLeft = this.shrinkLeft;
    this.prevShrinkRight = this.shrinkRight;
    this.prevShrinkTop = this.shrinkTop;
    this.prevShrinkBottom = this.shrinkBottom;

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      plat.prevX = plat.curX;
      plat.prevY = plat.curY;
      plat.prevW = plat.curW;
    }

    for (let i = 0; i < this.sawblades.length; i++) {
      const saw = this.sawblades[i];
      saw.prevX = saw.curX;
      saw.prevY = saw.curY;
      saw.prevAngle = saw.angle;
    }

    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      door.prevX = door.curX;
      door.prevY = door.curY;
      door.prevMonsterAngle = door.monsterAngle;
    }

    for (let i = 0; i < this.movingGates.length; i++) {
      const mg = this.movingGates[i];
      mg.prevGapY = mg.curGapY;
    }

    if (this.chasingWall) {
      this.chasingWall.prevX = this.chasingWall.curX;
      this.chasingWall.prevSpikeExtend = this.chasingWall.spikeExtend;
    }

    if (this.risingFloor) {
      this.risingFloor.prevY = this.risingFloor.curY;
    }

    for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
      const rs = this.rainSpikes[i];
      if (rs.active) rs.prevY = rs.y;
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const pt = this.particles[i];
      if (pt.active) {
        pt.prevX = pt.x;
        pt.prevY = pt.y;
      }
    }
  }

  public stepFrame(rawDt: number, input: InputState): void {
    const clampedDt = Math.min(rawDt, 0.05);
    this.globalTime += clampedDt;
    this.updateDust(clampedDt);

    if (!this.active) {
      input.jumpJustPressed = false;
      input.downJustPressed = false;
      return;
    }

    // Smooth 150ms fade-in when alive or newly spawned
    if (!this.player.dead && !this.player.won && this.transitionAlpha > 0) {
      this.transitionAlpha = Math.max(0, this.transitionAlpha - clampedDt / FADE_DURATION);
    }

    // Smooth exponential screen-shake decay normalized across refresh rates
    if (this.shakeIntensity > 0) {
      this.shakeIntensity *= Math.pow(0.85, clampedDt * 60);
      if (this.shakeIntensity < 0.12) {
        this.shakeIntensity = 0;
      }
    }

    // Smooth directional camera look-ahead damping (frame-rate independent)
    const targetLookAhead = this.player.facing * 22 + (this.player.vx / RUN_SPEED) * 14;
    this.lookAheadX = lerp(this.lookAheadX, targetLookAhead, 1 - Math.exp(-5.2 * clampedDt));

    const pCenterX = this.player.x + this.player.w / 2;
    const pCenterY = this.player.y + this.player.h / 2;
    const targetCamX = Math.max(
      -34,
      Math.min(34, (pCenterX - GAME_WIDTH / 2) * 0.036 + this.lookAheadX)
    );
    const targetCamY = Math.max(
      -16,
      Math.min(16, (pCenterY - 345) * 0.045 + (this.player.vy / MAX_FALL) * 6)
    );
    const camBlend = 1 - Math.exp(-6.5 * clampedDt);
    this.camX = lerp(this.camX, targetCamX, camBlend);
    this.camY = lerp(this.camY, targetCamY, camBlend);

    this.accumulator += clampedDt;
    while (this.accumulator >= FIXED_DT) {
      this.capturePrevStates();
      this.fixedUpdate(FIXED_DT, input);
      input.jumpJustPressed = false;
      input.downJustPressed = false;
      this.accumulator -= FIXED_DT;
    }
    this.renderAlpha = Math.max(0, Math.min(1, this.accumulator / FIXED_DT));
  }

  private updateDust(dt: number): void {
    for (let i = 0; i < this.dust.length; i++) {
      const d = this.dust[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < 0) d.x = GAME_WIDTH;
      if (d.x > GAME_WIDTH) d.x = 0;
      if (d.y < 0) d.y = GAME_HEIGHT;
      if (d.y > GAME_HEIGHT) d.y = 0;
    }
    if (this.windGusting) {
      for (let i = 0; i < this.windLines.length; i++) {
        const w = this.windLines[i];
        w.x -= w.speed * dt;
        if (w.x + w.len < 0) {
          w.x = GAME_WIDTH + Math.random() * 100;
          w.y = 40 + Math.random() * (GAME_HEIGHT - 120);
        }
      }
    }
  }

  private addCallout(x: number, y: number, text: string, color = '#FFF7ED'): void {
    for (let n = 0; n < CALLOUT_POOL_SIZE; n++) {
      const idx = (this.calloutCursor + n) % CALLOUT_POOL_SIZE;
      const c = this.callouts[idx];
      if (!c.active) {
        this.calloutCursor = (idx + 1) % CALLOUT_POOL_SIZE;
        c.active = true;
        c.x = x;
        c.y = y;
        c.vy = -42;
        c.text = text;
        c.color = color;
        c.life = 0.9;
        c.maxLife = 0.9;
        return;
      }
    }
    const c = this.callouts[this.calloutCursor];
    this.calloutCursor = (this.calloutCursor + 1) % CALLOUT_POOL_SIZE;
    c.active = true;
    c.x = x;
    c.y = y;
    c.vy = -42;
    c.text = text;
    c.color = color;
    c.life = 0.9;
    c.maxLife = 0.9;
  }

  private allocParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    color: string,
    life: number,
    maxLife: number,
    gravity: number,
    rotation: number,
    vRot: number
  ): void {
    for (let n = 0; n < PARTICLE_POOL_SIZE; n++) {
      const idx = (this.particleCursor + n) % PARTICLE_POOL_SIZE;
      const pt = this.particles[idx];
      if (!pt.active) {
        this.particleCursor = (idx + 1) % PARTICLE_POOL_SIZE;
        pt.active = true;
        pt.x = x;
        pt.y = y;
        pt.prevX = x;
        pt.prevY = y;
        pt.vx = vx;
        pt.vy = vy;
        pt.size = size;
        pt.color = color;
        pt.life = life;
        pt.maxLife = maxLife;
        pt.gravity = gravity;
        pt.rotation = rotation;
        pt.vRot = vRot;
        return;
      }
    }
    const pt = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    pt.active = true;
    pt.x = x;
    pt.y = y;
    pt.prevX = x;
    pt.prevY = y;
    pt.vx = vx;
    pt.vy = vy;
    pt.size = size;
    pt.color = color;
    pt.life = life;
    pt.maxLife = maxLife;
    pt.gravity = gravity;
    pt.rotation = rotation;
    pt.vRot = vRot;
  }

  private spawnRainSpike(
    x: number,
    y: number,
    w: number,
    h: number,
    speed: number,
    warningTimer: number,
    endY: number
  ): void {
    for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
      const rs = this.rainSpikes[i];
      if (!rs.active) {
        rs.active = true;
        rs.x = x;
        rs.y = y;
        rs.prevY = y;
        rs.w = w;
        rs.h = h;
        rs.speed = speed;
        rs.warningTimer = warningTimer;
        rs.endY = endY;
        return;
      }
    }
  }

  private spawnDustPuff(x: number, y: number, vxBase: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.allocParticle(
        x + (Math.random() - 0.5) * 8,
        y + (Math.random() - 0.5) * 4,
        vxBase + (Math.random() - 0.5) * 55,
        -18 - Math.random() * 45,
        3 + Math.random() * 2.5,
        i % 2 === 0 ? 'rgba(255, 247, 237, 0.7)' : 'rgba(92, 51, 23, 0.7)',
        0.25 + Math.random() * 0.18,
        0.43,
        160,
        0,
        (Math.random() - 0.5) * 4
      );
    }
  }

  private spawnExplosion(cx: number, cy: number, count: number, colors: readonly string[]): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 110 + Math.random() * 340;
      this.allocParticle(
        cx + (Math.random() - 0.5) * 14,
        cy + (Math.random() - 0.5) * 16,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 140,
        4 + Math.random() * 5,
        colors[i % colors.length],
        0.55 + Math.random() * 0.45,
        1.0,
        980,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 14
      );
    }
  }

  private pushCloneFrame(p: PlayerState): void {
    const slot = this.cloneHistory[this.cloneWriteIdx];
    slot.x = p.x;
    slot.y = p.y;
    slot.facing = p.facing;
    slot.squashX = p.squashX;
    slot.squashY = p.squashY;
    slot.gravityDir = p.gravityDir;
    slot.runCycle = p.runCycle;
    this.cloneWriteIdx = (this.cloneWriteIdx + 1) % CLONE_RING_SIZE;
    if (this.cloneCount < CLONE_RING_SIZE) {
      this.cloneCount += 1;
    }
  }

  private getDelayedCloneFrame(stepsAgo: number): CloneFrame | null {
    if (this.cloneCount <= stepsAgo) return null;
    const idx = (this.cloneWriteIdx - 1 - stepsAgo + CLONE_RING_SIZE * 2) % CLONE_RING_SIZE;
    return this.cloneHistory[idx];
  }

  private killPlayer(): void {
    if (this.player.dead || this.player.won) return;
    this.player.dead = true;
    this.player.respawnTimer = RESPAWN_DELAY;
    this.fakeDeathActive = false;
    this.shakeIntensity = 9;

    soundEngine.playDeath();
    this.spawnExplosion(
      this.player.x + this.player.w / 2,
      this.player.y + this.player.h / 2,
      26,
      DEATH_COLORS
    );
    this.callbacks.onDeath(this.level.id);
  }

  private winLevel(): void {
    if (this.player.dead || this.player.won) return;
    this.player.won = true;
    this.player.winTimer = 0.55;
    this.fakeDeathActive = false;
    if (this.level.id === LEVELS.length) {
      soundEngine.playVictoryFanfare();
    } else {
      soundEngine.playLevelWin();
    }
    this.spawnExplosion(
      this.player.x + this.player.w / 2,
      this.player.y + this.player.h / 2,
      20,
      WIN_COLORS
    );
    this.callbacks.onLevelComplete(this.level.id);
  }

  private fixedUpdate(dt: number, input: InputState): void {
    if (this.lightning) {
      this.lightning.timer = Math.max(0, this.lightning.timer - dt);
      if (this.lightning.timer <= 0) this.lightning = null;
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      pt.vy += pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rotation += pt.vRot * dt;
      if (pt.y > 440 - pt.size && pt.vy > 0 && pt.y < 460) {
        pt.vy *= -0.4;
        pt.vx *= 0.8;
        pt.y = 440 - pt.size;
      }
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
      }
    }

    for (let i = 0; i < CALLOUT_POOL_SIZE; i++) {
      const c = this.callouts[i];
      if (!c.active) continue;
      c.y += c.vy * dt;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
      }
    }

    if (this.player.dead) {
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer <= FADE_DURATION) {
        this.transitionAlpha = Math.min(1, (FADE_DURATION - Math.max(0, this.player.respawnTimer)) / FADE_DURATION);
      }
      if (this.player.respawnTimer <= 0) {
        this.resetRoundEntities();
        this.player = this.createFreshPlayer(this.level);
        this.prevPlayerX = this.player.x;
        this.prevPlayerY = this.player.y;
        this.prevPlayerSquashX = 1;
        this.prevPlayerSquashY = 1;
        this.prevPlayerLean = 0;
        this.transitionAlpha = 1;
      }
      return;
    }

    if (this.player.won) {
      this.player.winTimer = Math.max(0, this.player.winTimer - dt);
      return;
    }

    const p = this.player;
    if (p.panicTimer > 0) p.panicTimer = Math.max(0, p.panicTimer - dt);
    this.levelElapsed += dt;

    // Fake Victory Fireworks celebration phase (Level 24)
    if (this.fakeVictoryActive) {
      p.vx = 0;
      p.vy = 0;
      this.fakeVictoryTimer -= dt;
      if (Math.random() < 0.25) {
        this.spawnExplosion(
          160 + Math.random() * 640,
          100 + Math.random() * 140,
          5,
          CONFETTI_COLORS
        );
      }
      if (this.fakeVictoryTimer <= 0) {
        this.fakeVictoryActive = false;
        this.fakeVictoryDone = true;
        this.shakeIntensity = 9;
        soundEngine.playTrapTrigger();
        soundEngine.playSlam();
        for (let i = 0; i < this.doors.length; i++) {
          const door = this.doors[i];
          if (door.kind === 'fake_victory') {
            door.burstTriggered = true;
            this.spawnExplosion(door.curX + door.w / 2, door.curY + door.h / 2, 24, BURST_COLORS);
          }
        }
        for (let i = 0; i < this.spikes.length; i++) {
          const sp = this.spikes[i];
          if (sp.kind === 'door_burst') {
            sp.active = true;
            sp.popScale = 0.05;
            sp.popVel = 14.5;
          }
        }
        for (let i = 0; i < this.platforms.length; i++) {
          const plat = this.platforms[i];
          if (plat.kind === 'hatch_drop') {
            plat.vanished = true;
            plat.active = false;
            this.spawnExplosion(plat.curX + plat.curW / 2, plat.curY + plat.h / 2, 14, WOOD_COLORS);
          }
        }
        p.panicTimer = 1.2;
        this.addCallout(p.x + p.w / 2, p.y - 16, 'SIKE!!', '#FEF08A');
      }
      return;
    }

    // Fluid squash-and-stretch + movement lean interpolation
    const airStretch = !p.onGround ? Math.min(0.14, (Math.abs(p.vy) / MAX_FALL) * 0.14) : 0;
    const targetSqY = 1 + airStretch;
    const targetSqX = 1 / (1 + airStretch * 0.65);
    const sqBlend = 1 - Math.exp(-15 * dt);
    p.squashX = lerp(p.squashX, targetSqX, sqBlend);
    p.squashY = lerp(p.squashY, targetSqY, sqBlend);

    const targetLean = (p.vx / RUN_SPEED) * 0.095 * p.gravityDir;
    p.leanAngle = lerp(p.leanAngle, targetLean, 1 - Math.exp(-16 * dt));

    const pCenterX = p.x + p.w / 2;

    if (
      this.level.reverseTriggerX !== undefined &&
      !p.controlsReversed &&
      pCenterX >= this.level.reverseTriggerX
    ) {
      p.controlsReversed = true;
      p.panicTimer = 0.9;
      this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
      soundEngine.playWarp(false);
      this.addCallout(pCenterX, p.y - 18, 'CONTROLS REVERSED!', '#FEF08A');
    }

    this.inReverseZone = false;
    if (this.level.reverseZones) {
      for (let i = 0; i < this.level.reverseZones.length; i++) {
        const rz = this.level.reverseZones[i];
        if (pCenterX >= rz.minX && pCenterX <= rz.maxX) {
          this.inReverseZone = true;
          break;
        }
      }
    }

    if (
      this.level.gravityFlipTriggerX !== undefined &&
      p.gravityDir === 1 &&
      pCenterX >= this.level.gravityFlipTriggerX &&
      (this.level.gravityUnflipTriggerX === undefined || pCenterX < this.level.gravityUnflipTriggerX)
    ) {
      p.gravityDir = -1;
      p.onGround = false;
      p.panicTimer = 0.85;
      this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
      soundEngine.playWarp(true);
      this.addCallout(pCenterX, p.y - 16, 'GRAVITY FLIP!', '#FDE68A');
    }

    if (
      this.level.gravityUnflipTriggerX !== undefined &&
      p.gravityDir === -1 &&
      pCenterX >= this.level.gravityUnflipTriggerX
    ) {
      p.gravityDir = 1;
      p.onGround = false;
      p.panicTimer = 0.65;
      this.shakeIntensity = Math.max(this.shakeIntensity, 3.5);
      soundEngine.playWarp(false);
      this.addCallout(pCenterX, p.y + p.h + 18, 'GRAVITY NORMAL!', '#FDE68A');
    }

    if (
      this.level.mirrorTriggerX !== undefined &&
      !p.mirrored &&
      pCenterX >= this.level.mirrorTriggerX
    ) {
      p.mirrored = true;
      p.panicTimer = 1.0;
      this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
      soundEngine.playWarp(true);
      this.addCallout(GAME_WIDTH / 2, 180, 'MIRROR WORLD!', '#FEF08A');
    }

    if (
      this.level.fakeDeathTriggerX !== undefined &&
      !this.fakeDeathTriggeredOnce &&
      pCenterX >= this.level.fakeDeathTriggerX
    ) {
      this.fakeDeathTriggeredOnce = true;
      this.fakeDeathActive = true;
      p.panicTimer = 1.0;
      soundEngine.playDeath();
    }

    // Level 21: Periodic control swap (Left/Right AND Jump/Down)
    if (this.controlSwapPulse > 0) {
      this.controlSwapPulse = Math.max(0, this.controlSwapPulse - dt * 2.4);
    }
    if (this.level.controlSwapInterval) {
      this.controlSwapTimer += dt;
      if (this.controlSwapTimer >= this.level.controlSwapInterval) {
        this.controlSwapTimer -= this.level.controlSwapInterval;
        this.controlsSwapped = !this.controlsSwapped;
        this.controlSwapPulse = 1;
        p.panicTimer = 0.65;
        soundEngine.playSwapPulse();
      }
    }

    if (this.level.wind) {
      this.windTimer += dt;
      const totalCycle = this.level.wind.calmDuration + this.level.wind.gustDuration;
      const phaseTime = this.windTimer % totalCycle;
      this.windGusting = phaseTime >= this.level.wind.calmDuration;
    }

    if (this.chasingWall) {
      if (!this.chasingWall.active && pCenterX >= this.chasingWall.triggerX) {
        this.chasingWall.active = true;
        p.panicTimer = 1.2;
        this.shakeIntensity = Math.max(this.shakeIntensity, 5);
        soundEngine.playTrapTrigger();
        if (!this.chasingWall.isLaser) {
          this.addCallout(this.chasingWall.curX + 70, 290, 'RUN!!', '#FEF08A');
        }
      }
      if (this.chasingWall.active) {
        this.chasingWall.spikeExtend = Math.min(1, this.chasingWall.spikeExtend + dt * 8);
        this.chasingWall.curX += this.chasingWall.speed * dt;
        if (!this.chasingWall.isLaser && Math.random() < 0.18) {
          this.allocParticle(
            this.chasingWall.curX + this.chasingWall.w,
            434,
            -30 - Math.random() * 40,
            -40 - Math.random() * 60,
            5,
            '#5C3317',
            0.35,
            0.35,
            400,
            0,
            2
          );
        }
      }
    }

    if (this.risingFloor) {
      if (!this.risingFloor.active && (pCenterX >= this.risingFloor.triggerX || p.y < 410)) {
        this.risingFloor.active = true;
        soundEngine.playTrapTrigger();
        this.addCallout(pCenterX, p.y - 20, 'CLIMB!!', '#FEF08A');
      }
      if (this.risingFloor.active) {
        this.risingFloor.curY = Math.max(
          this.risingFloor.minY,
          this.risingFloor.curY - this.risingFloor.speed * dt
        );
      }
    }

    // Level 28: Shrinking room walls closing in toward center
    if (this.level.shrinkingRoom) {
      const sr = this.level.shrinkingRoom;
      const cx = GAME_WIDTH / 2;
      const cy = GAME_HEIGHT / 2;
      this.shrinkLeft = Math.min(cx - sr.minHalfW, this.shrinkLeft + sr.speedX * dt);
      this.shrinkRight = Math.max(cx + sr.minHalfW, this.shrinkRight - sr.speedX * dt);
      this.shrinkTop = Math.min(cy - sr.minHalfH, this.shrinkTop + sr.speedY * dt);
      this.shrinkBottom = Math.max(cy + sr.minHalfH, this.shrinkBottom - sr.speedY * dt);
    }

    // Level 25: Bullet-Hell Spike Rain waves (pooled, zero allocations)
    if (this.level.spikeRain) {
      const cfg = this.level.spikeRain;
      this.rainWaveTimer -= dt;
      if (this.rainWaveTimer <= 0) {
        this.rainWaveTimer = cfg.waveInterval;
        this.rainWaveIndex += 1;
        const span = cfg.maxX - cfg.minX;
        const colW = span / cfg.columns;
        const safeCol = (this.rainWaveIndex * 2) % Math.max(1, cfg.columns - 1);
        for (let c = 0; c < cfg.columns; c++) {
          if (c === safeCol || c === safeCol + 1) continue;
          if ((c + this.rainWaveIndex) % 3 === 0) continue;
          this.spawnRainSpike(
            cfg.minX + c * colW + (colW - 18) / 2,
            cfg.startY,
            18,
            24,
            cfg.speed,
            0.36,
            cfg.endY
          );
        }
        soundEngine.playTick();
      }

      for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
        const rs = this.rainSpikes[i];
        if (!rs.active) continue;
        if (rs.warningTimer > 0) {
          rs.warningTimer -= dt;
        } else {
          rs.y += rs.speed * dt;
          if (rs.y + rs.h >= rs.endY) {
            this.spawnDustPuff(rs.x + rs.w / 2, rs.endY - 2, 0, 2);
            rs.active = false;
          }
        }
      }
    }

    // Level 27: Moving Laser Gates
    for (let i = 0; i < this.movingGates.length; i++) {
      const mg = this.movingGates[i];
      mg.t += dt;
      const midY = (mg.minY + mg.maxY) / 2;
      const amp = (mg.maxY - mg.minY) / 2;
      mg.curGapY = midY + Math.sin(mg.t * mg.speed + mg.phase) * amp;
    }

    // Level 23: Switch activation
    for (let i = 0; i < this.switches.length; i++) {
      const sw = this.switches[i];
      if (!sw.pressed && rectsOverlap(p.x, p.y, p.w, p.h, sw.x - 4, sw.y - 6, sw.w + 8, sw.h + 10)) {
        sw.pressed = true;
        this.switchTriggered = true;
        this.switchTriggerTime = this.levelElapsed;
        soundEngine.playSwitch();
        this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
        for (let j = 0; j < this.doors.length; j++) {
          const door = this.doors[j];
          if (door.kind === 'locked_chain') {
            door.locked = false;
            this.spawnExplosion(door.curX + door.w / 2, door.curY + door.h / 2, 12, SWITCH_COLORS);
          }
        }
        this.addCallout(sw.x + sw.w / 2, sw.y - 18, 'UNLOCKED! RUN!', '#FDE68A');
      }
    }

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (
        !plat.triggered &&
        plat.triggerX !== undefined &&
        pCenterX >= plat.triggerX &&
        (plat.kind === 'sliding' || plat.kind === 'falling_ceiling' || plat.kind === 'cover_drop')
      ) {
        plat.triggered = true;
        p.panicTimer = 0.5;
        if (plat.persistAfterTrigger) {
          this.persistedTriggers.add(plat.id);
        }
        soundEngine.playTrapTrigger();
      }

      if (plat.triggered) {
        const easeFactor = plat.kind === 'falling_ceiling' ? 0.12 : 0.18;
        if (plat.targetX !== undefined) {
          plat.curX = easeOutStep(plat.curX, plat.targetX, easeFactor, dt);
        }
        if (plat.targetY !== undefined) {
          plat.curY = easeOutStep(plat.curY, plat.targetY, easeFactor, dt);
        }
        if (
          plat.kind === 'falling_ceiling' &&
          !plat.slammed &&
          plat.targetY !== undefined &&
          Math.abs(plat.curY - plat.targetY) < 2.5
        ) {
          plat.curY = plat.targetY;
          plat.slammed = true;
          this.shakeIntensity = Math.max(this.shakeIntensity, 6.5);
          soundEngine.playSlam();
          this.spawnExplosion(plat.curX + plat.w / 2, plat.curY + plat.h, 10, WOOD_COLORS);
        }
      }

      if (plat.kind === 'shrinking' && plat.shrinkingStarted) {
        const targetW = plat.shrinkTargetW ?? 10;
        plat.curW = easeOutStep(plat.curW, targetW, 0.095, dt);
        plat.curX = plat.x + (plat.w - plat.curW) / 2;
      }

      if (plat.kind === 'periodic_falling') {
        const period = plat.fallPeriod ?? 2.0;
        plat.periodicTimer += dt;
        const cyclePos = plat.periodicTimer % period;
        if (cyclePos < 0.25) {
          plat.curY = -50;
          plat.prevY = -50;
        } else {
          plat.curY += (plat.moveSpeed ?? 375) * dt;
          if (plat.curY > GAME_HEIGHT + 30) {
            plat.curY = GAME_HEIGHT + 30;
          }
        }
      }

      if (plat.kind === 'hologram' && plat.triggered) {
        plat.fadeAlpha = Math.max(0.22, plat.fadeAlpha - dt * 3.5);
      }

      if (plat.kind === 'fake_wall') {
        const nearFakeWall = p.x + p.w > plat.curX - 18 && p.x < plat.curX + plat.w + 32;
        const targetAlpha = nearFakeWall ? 0.18 : 1.0;
        plat.fadeAlpha += (targetAlpha - plat.fadeAlpha) * Math.min(1, dt * 10);
      }

      if (plat.kind === 'invisible' && plat.revealed) {
        plat.fadeAlpha = Math.min(0.85, plat.fadeAlpha + dt * 6);
      }

      if (plat.kind === 'spring' && plat.springPop > 0) {
        plat.springPop = Math.max(0, plat.springPop - dt * 2.5);
      }

      // Level 22: Fade all platforms to invisible after memory window
      if (
        this.level.fadeAllPlatformsAfter !== undefined &&
        this.levelElapsed >= this.level.fadeAllPlatformsAfter
      ) {
        plat.fadeAlpha = Math.max(0, plat.fadeAlpha - dt * 4.5);
      }

      // Level 23: Bridge segments crumble sequentially after switch pressed
      if (plat.kind === 'crumble_after_switch' && this.switchTriggered && !plat.vanished) {
        const dropAt = (plat.switchDropOrder ?? 0) * 0.46 + 0.55;
        if (this.levelElapsed - this.switchTriggerTime >= dropAt) {
          plat.crumbling = true;
          plat.crumbleTimer += dt;
          if (plat.crumbleTimer >= 0.22) {
            plat.vanished = true;
            plat.active = false;
            soundEngine.playPoof();
            this.spawnExplosion(plat.curX + plat.curW / 2, plat.curY + 12, 10, WOOD_COLORS);
          }
        }
      }

      // Level 25 & 30: Floor segments crumble shortly after being stepped on
      if (plat.kind === 'crumble_on_step' && plat.crumbling && !plat.vanished) {
        plat.crumbleTimer += dt;
        if (plat.crumbleTimer >= (plat.crumbleDelay ?? 0.5)) {
          plat.vanished = true;
          plat.active = false;
          soundEngine.playPoof();
          this.spawnExplosion(plat.curX + plat.curW / 2, plat.curY + 10, 10, WOOD_COLORS);
        }
      }
    }

    for (let i = 0; i < this.sawblades.length; i++) {
      const saw = this.sawblades[i];
      saw.angle += dt * 14;
      if (saw.patrol) {
        const dx = saw.patrol.x2 - saw.patrol.x1;
        const dy = saw.patrol.y2 - saw.patrol.y1;
        const dist = Math.hypot(dx, dy) || 1;
        saw.patrolT += (saw.patrol.speed / dist) * dt;
        const ping = 1 - Math.abs((saw.patrolT % 2) - 1);
        saw.curX = lerp(saw.patrol.x1, saw.patrol.x2, ping);
        saw.curY = lerp(saw.patrol.y1, saw.patrol.y2, ping);
        continue;
      }
      if (!saw.triggered && saw.triggerX !== undefined && pCenterX >= saw.triggerX) {
        saw.triggered = true;
        saw.active = true;
        soundEngine.playSaw();
      }
      if (saw.triggered) {
        if (saw.delayTimer > 0) {
          saw.delayTimer -= dt;
        } else {
          const spd = saw.speed ?? 380;
          if (spd >= 450) {
            if (saw.targetX !== undefined) saw.curX = easeOutStep(saw.curX, saw.targetX, 0.2, dt);
            if (saw.targetY !== undefined) saw.curY = easeOutStep(saw.curY, saw.targetY, 0.2, dt);
          } else {
            if (saw.targetX !== undefined) saw.curX = moveTowards(saw.curX, saw.targetX, spd * dt);
            if (saw.targetY !== undefined) saw.curY = moveTowards(saw.curY, saw.targetY, spd * dt);
          }
        }
      }
    }

    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      door.shimmerPhase += dt * 4.5;
      if (door.runawayCooldown > 0) {
        door.runawayCooldown = Math.max(0, door.runawayCooldown - dt);
      }
      if (door.kind === 'moving' && !door.triggered && door.triggerX !== undefined && pCenterX >= door.triggerX) {
        door.triggered = true;
        p.panicTimer = 0.7;
        if (door.persistAfterTrigger) {
          this.persistedTriggers.add(door.id);
        }
        soundEngine.playTrapTrigger();
        this.addCallout(door.curX + 20, door.curY - 12, 'NOPE!', '#FFF7ED');
      }
      if (door.kind === 'monster_saw' && !door.monsterMode && door.triggerX !== undefined && pCenterX >= door.triggerX) {
        door.monsterMode = true;
        p.panicTimer = 0.75;
        this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
        soundEngine.playSaw();
        this.addCallout(door.curX + 20, door.curY - 16, 'MONSTER DOOR!', '#FEF08A');
      }
      if (
        door.kind === 'teleport_runaway' &&
        door.runawayCooldown <= 0 &&
        door.runawayPositions &&
        door.runawayIndex < door.runawayPositions.length &&
        rectsOverlap(p.x - 10, p.y - 6, p.w + 20, p.h + 12, door.curX, door.curY, door.w, door.h)
      ) {
        const nextPos = door.runawayPositions[door.runawayIndex];
        this.spawnExplosion(door.curX + door.w / 2, door.curY + door.h / 2, 12, PORTAL_COLORS);
        door.curX = nextPos.x;
        door.curY = nextPos.y;
        door.prevX = nextPos.x;
        door.prevY = nextPos.y;
        door.runawayIndex += 1;
        door.runawayCooldown = 0.24;
        soundEngine.playTeleport();
        this.spawnExplosion(door.curX + door.w / 2, door.curY + door.h / 2, 12, PORTAL_COLORS);
        this.addCallout(
          door.curX + 20,
          door.curY - 14,
          door.runawayIndex >= door.runawayPositions.length ? 'COME GET IT!' : 'NOPE!',
          '#FEF08A'
        );
      }
      if (door.monsterMode) {
        door.monsterAngle += dt * 15;
      }
      if (door.triggered && door.targetX !== undefined) {
        door.curX = easeOutStep(door.curX, door.targetX, 0.18, dt);
      }
      if (door.triggered && door.targetY !== undefined) {
        door.curY = easeOutStep(door.curY, door.targetY, 0.18, dt);
      }
    }

    for (let i = 0; i < this.spikes.length; i++) {
      const spike = this.spikes[i];
      if (spike.kind === 'delayed') {
        if (!spike.armed && !spike.emerged) {
          const triggerRectY = spike.dir === 'down' ? spike.y - 4 : spike.y + spike.h - 14;
          if (rectsOverlap(p.x, p.y, p.w, p.h, spike.x, triggerRectY, spike.w, 20)) {
            spike.armed = true;
            soundEngine.playTick();
          }
        }
        if (spike.armed && !spike.emerged) {
          spike.armTimer += dt;
          if (spike.armTimer >= (spike.delaySeconds ?? 0.5)) {
            spike.emerged = true;
            spike.popScale = 0.05;
            spike.popVel = 14.5;
            soundEngine.playTrapTrigger();
          }
        }
        if (spike.emerged && (Math.abs(1 - spike.popScale) > 0.002 || Math.abs(spike.popVel) > 0.01)) {
          const force = (1 - spike.popScale) * 260;
          spike.popVel = (spike.popVel + force * dt) * Math.exp(-16 * dt);
          spike.popScale += spike.popVel * dt;
        } else if (spike.emerged) {
          spike.popScale = 1;
          spike.popVel = 0;
        }
      } else if (spike.active && (Math.abs(1 - spike.popScale) > 0.002 || Math.abs(spike.popVel) > 0.01)) {
        const force = (1 - spike.popScale) * 240;
        spike.popVel = (spike.popVel + force * dt) * Math.exp(-15 * dt);
        spike.popScale += spike.popVel * dt;
      } else if (spike.active) {
        spike.popScale = 1;
        spike.popVel = 0;
      }
    }

    // 3. Smooth Ease-Out Horizontal Movement & Running Dust
    let moveInput = 0;
    if (input.left) moveInput -= 1;
    if (input.right) moveInput += 1;
    if (p.controlsReversed || this.inReverseZone || this.controlsSwapped) moveInput *= -1;

    const apexThreshold = this.level.lowGravity ? 70 : 100;
    const atApex = !p.onGround && Math.abs(p.vy) < apexThreshold;

    if (moveInput !== 0) {
      p.facing = moveInput > 0 ? 1 : -1;
      let rate = p.onGround ? (p.onIce ? ICE_ACCEL_RATE : GROUND_ACCEL_RATE) : AIR_ACCEL_RATE;
      if (p.vx * moveInput < 0 && !p.onIce) {
        rate *= 1.45;
      }
      if (atApex) {
        rate *= 1.15;
      }
      p.vx = lerp(p.vx, moveInput * RUN_SPEED, 1 - Math.exp(-rate * dt));
      if (p.onGround) {
        p.runCycle += dt * 18;
        this.runDustTimer += dt;
        if (this.runDustTimer >= 0.095 && Math.abs(p.vx) > 140) {
          this.runDustTimer = 0;
          const footY = p.gravityDir === 1 ? p.y + p.h - 2 : p.y + 2;
          this.spawnDustPuff(p.x + p.w / 2 - p.facing * 8, footY, -p.facing * 28, 1);
        }
      }
    } else {
      const rate = p.onGround ? (p.onIce ? ICE_DECEL_RATE : GROUND_DECEL_RATE) : AIR_DECEL_RATE;
      p.vx = lerp(p.vx, 0, 1 - Math.exp(-rate * dt));
      if (Math.abs(p.vx) < 2) p.vx = 0;
      if (Math.abs(p.vx) < 8) p.runCycle = 0;
    }

    if (this.level.wind && this.windGusting) {
      p.vx += this.level.wind.force * dt;
      if (p.vx < -RUN_SPEED * 1.15) p.vx = -RUN_SPEED * 1.15;
    }

    // 4. Jump Buffering (120ms), Coyote Time (120ms), Variable Jump Height & Apex Hang-Time
    const effectiveJumpJustPressed = this.controlsSwapped ? input.downJustPressed : input.jumpJustPressed;
    const effectiveJumpHeld = this.controlsSwapped ? input.down : input.jumpHeld;

    if (effectiveJumpJustPressed) {
      p.jumpBufferTimer = JUMP_BUFFER_TIME;
    } else if (p.jumpBufferTimer > 0) {
      p.jumpBufferTimer = Math.max(0, p.jumpBufferTimer - dt);
    }

    if (p.onGround) {
      p.coyoteTimer = COYOTE_TIME;
    } else if (p.coyoteTimer > 0) {
      p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
    }

    const activeGravity = this.level.lowGravity ? 540 : GRAVITY;
    const activeJumpVel = this.level.lowGravity ? 440 : JUMP_VEL;
    const activeMaxFall = this.level.lowGravity ? 320 : MAX_FALL;

    if (p.jumpBufferTimer > 0 && p.coyoteTimer > 0) {
      p.jumpsUsed += 1;
      if (this.level.jumpLimit !== undefined && p.jumpsUsed > this.level.jumpLimit) {
        p.jumpBufferTimer = 0;
        p.coyoteTimer = 0;
        this.lightning = { x: p.x + p.w / 2, timer: 0.3, maxTimer: 0.3 };
        soundEngine.playLightning();
        this.addCallout(p.x + p.w / 2, p.y - 26, '4TH JUMP! ZAP!', '#FEF08A');
        this.killPlayer();
        return;
      }

      p.vy = -activeJumpVel * p.gravityDir;
      p.onGround = false;
      p.onIce = false;
      p.coyoteTimer = 0;
      p.jumpBufferTimer = 0;
      p.squashX = 0.68;
      p.squashY = 1.36;
      this.spawnDustPuff(p.x + p.w / 2, p.gravityDir === 1 ? p.y + p.h : p.y, 0, 3);
      soundEngine.playJump();
    } else if (this.level.lowGravity && effectiveJumpJustPressed && !p.onGround) {
      p.vy = -255 * p.gravityDir;
      p.jumpBufferTimer = 0;
      p.squashX = 0.8;
      p.squashY = 1.24;
      this.spawnDustPuff(p.x + p.w / 2, p.y + p.h / 2, 0, 2);
      soundEngine.playJump();
    }

    const dirVel = p.vy * p.gravityDir;
    const cutThreshold = this.level.lowGravity ? -60 : -80;
    let gravityMult = 1;
    if (!effectiveJumpHeld && dirVel < cutThreshold) {
      gravityMult = this.level.lowGravity ? 2.0 : 2.75;
    } else if (!p.onGround && Math.abs(dirVel) < apexThreshold) {
      gravityMult = 0.62;
    }

    p.vy += activeGravity * gravityMult * p.gravityDir * dt;
    if (p.gravityDir === 1 && p.vy > activeMaxFall) p.vy = activeMaxFall;
    if (p.gravityDir === -1 && p.vy < -activeMaxFall) p.vy = -activeMaxFall;

    // 5. Move & Collide X
    p.x += p.vx * dt;
    if (p.x < 0) {
      p.x = 0;
      p.vx = 0;
    } else if (p.x + p.w > GAME_WIDTH) {
      p.x = GAME_WIDTH - p.w;
      p.vx = 0;
    }

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (plat.kind === 'periodic_falling') continue;
      if (
        plat.kind === 'falling_ceiling' &&
        plat.triggered &&
        !plat.slammed &&
        p.y >= plat.curY + plat.h - 14
      ) {
        continue;
      }
      if (!this.isPlatformSolid(plat, p)) continue;
      if (rectsOverlap(p.x, p.y, p.w, p.h, plat.curX, plat.curY, plat.curW, plat.h)) {
        if (p.vx > 0) {
          p.x = plat.curX - p.w;
        } else if (p.vx < 0) {
          p.x = plat.curX + plat.curW;
        }
        p.vx = 0;
      }
    }

    // 6. Move & Collide Y
    const wasOnGround = p.onGround;
    p.onGround = false;
    p.onIce = false;
    p.y += p.vy * dt;

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (plat.kind === 'periodic_falling') {
        if (rectsOverlap(p.x + 2, p.y + 2, p.w - 4, p.h - 4, plat.curX, plat.curY, plat.curW, plat.h)) {
          this.killPlayer();
          return;
        }
        continue;
      }

      if (!this.isPlatformSolid(plat, p)) continue;
      if (rectsOverlap(p.x, p.y, p.w, p.h, plat.curX, plat.curY, plat.curW, plat.h)) {
        if (
          plat.kind === 'falling_ceiling' &&
          plat.triggered &&
          !plat.slammed &&
          plat.curY > plat.prevY &&
          p.y + p.h > plat.curY + plat.h - 14
        ) {
          this.killPlayer();
          return;
        }

        if (p.vy > 0) {
          p.y = plat.curY - p.h;
          p.vy = 0;
          if (p.gravityDir === 1) {
            p.onGround = true;
            if (plat.kind === 'ice') p.onIce = true;
            if (plat.kind === 'shrinking' && !plat.shrinkingStarted) {
              plat.shrinkingStarted = true;
              soundEngine.playTrapTrigger();
            }
            if (plat.kind === 'crumble_on_step' && !plat.crumbling) {
              plat.crumbling = true;
              soundEngine.playTick();
            }
            if (plat.kind === 'invisible' && !plat.revealed) {
              plat.revealed = true;
              soundEngine.playTick();
              this.addCallout(plat.curX + plat.curW / 2, plat.curY - 14, 'SECRET BRIDGE!', '#FEF08A');
            }
          }
        } else if (p.vy < 0) {
          p.y = plat.curY + plat.h;
          p.vy = 0;
          if (p.gravityDir === -1) {
            p.onGround = true;
          }
        }
      }
    }

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (plat.kind === 'hologram' && !plat.triggered) {
        if (rectsOverlap(p.x, p.y + 2, p.w, p.h, plat.curX, plat.curY, plat.curW, plat.h)) {
          plat.triggered = true;
          p.panicTimer = 0.7;
          soundEngine.playTrapTrigger();
          this.addCallout(plat.curX + plat.curW / 2, plat.curY - 12, 'HOLOGRAM!', '#FEF08A');
        }
      }

      if (plat.kind === 'spring') {
        const standingOnSpring =
          p.onGround &&
          p.gravityDir === 1 &&
          Math.abs(p.y + p.h - plat.curY) <= 3 &&
          p.x + p.w > plat.curX + 4 &&
          p.x < plat.curX + plat.curW - 4;

        if (standingOnSpring) {
          plat.springTimer += dt;
          if (Math.abs(p.vx) < 180 || plat.springTimer >= 0.035) {
            p.vy = plat.springVelocity ?? -1020;
            p.onGround = false;
            p.squashX = 0.65;
            p.squashY = 1.45;
            p.panicTimer = 0.7;
            plat.springPop = 1;
            plat.springTimer = 0;
            soundEngine.playSpring();
            this.addCallout(plat.curX + plat.curW / 2, plat.curY - 18, 'BOING!', '#FFF7ED');
          }
        } else {
          plat.springTimer = 0;
        }
      }
    }

    if (!wasOnGround && p.onGround) {
      p.squashX = 1.34;
      p.squashY = 0.7;
      this.spawnDustPuff(p.x + p.w / 2, p.gravityDir === 1 ? p.y + p.h : p.y, 0, 5);
      soundEngine.playLand();
    }

    if (p.y > GAME_HEIGHT + 40 || p.y + p.h < -50) {
      this.killPlayer();
      return;
    }

    if (this.chasingWall && this.chasingWall.active) {
      const cwRight =
        this.chasingWall.curX +
        this.chasingWall.w +
        (this.chasingWall.isLaser ? 0 : this.chasingWall.spikeExtend * 18);
      if (p.x < cwRight) {
        this.killPlayer();
        return;
      }
    }

    if (this.risingFloor && this.risingFloor.active) {
      if (p.y + p.h > this.risingFloor.curY + 8) {
        this.killPlayer();
        return;
      }
    }

    for (let i = 0; i < this.sawblades.length; i++) {
      const saw = this.sawblades[i];
      if (!saw.active) continue;
      if (circleRectOverlap(saw.curX, saw.curY, saw.radius * 0.76, p.x + 2, p.y + 2, p.w - 4, p.h - 4)) {
        this.killPlayer();
        return;
      }
    }

    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      if (!s.active || s.vanished) continue;
      if (s.kind === 'delayed' && !s.emerged) continue;

      const padX = 5;
      const padY = 6;
      const sx = s.dir === 'right' ? s.x : s.x + padX;
      const sy = s.dir === 'down' ? s.y : s.y + padY;
      const sw = Math.max(4, s.w - (s.dir === 'left' || s.dir === 'right' ? padX : padX * 2));
      const sh = Math.max(4, s.h - (s.dir === 'up' || s.dir === 'down' ? padY : padY * 2));

      if (rectsOverlap(p.x + 2, p.y + 2, p.w - 4, p.h - 4, sx, sy, sw, sh)) {
        if (s.kind === 'fake_vanish') {
          s.vanished = true;
          soundEngine.playPoof();
          this.spawnExplosion(s.x + s.w / 2, s.y + s.h / 2, 12, FAKE_SPIKE_COLORS);
          this.addCallout(s.x + s.w / 2, s.y - 12, 'FAKE SPIKE!', '#FDE68A');
        } else {
          this.killPlayer();
          return;
        }
      }
    }

    // Level 25: Rain spikes collision
    for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
      const rs = this.rainSpikes[i];
      if (!rs.active || rs.warningTimer > 0) continue;
      if (rectsOverlap(p.x + 3, p.y + 3, p.w - 6, p.h - 6, rs.x + 3, rs.y + 3, rs.w - 6, rs.h - 5)) {
        this.killPlayer();
        return;
      }
    }

    // Level 27: Moving laser gate collisions
    for (let i = 0; i < this.movingGates.length; i++) {
      const mg = this.movingGates[i];
      if (
        rectsOverlap(p.x + 2, p.y + 2, p.w - 4, p.h - 4, mg.x, 0, mg.w, mg.curGapY) ||
        rectsOverlap(
          p.x + 2,
          p.y + 2,
          p.w - 4,
          p.h - 4,
          mg.x,
          mg.curGapY + mg.gapHeight,
          mg.w,
          GAME_HEIGHT - (mg.curGapY + mg.gapHeight)
        )
      ) {
        this.killPlayer();
        return;
      }
    }

    // Level 28: Shrinking room spiked compactor walls
    if (this.level.shrinkingRoom) {
      if (
        p.x < this.shrinkLeft + 10 ||
        p.x + p.w > this.shrinkRight - 10 ||
        p.y < this.shrinkTop + 10 ||
        p.y + p.h > this.shrinkBottom - 10
      ) {
        this.killPlayer();
        return;
      }
    }

    // Level 26: Shadow Clone recording & collision (pre-allocated circular buffer)
    if (this.level.shadowCloneDelay !== undefined) {
      this.pushCloneFrame(p);
      const delaySteps = Math.round(this.level.shadowCloneDelay / FIXED_DT);
      const bufferGrace = Math.round(0.2 / FIXED_DT);
      if (this.cloneCount > delaySteps + bufferGrace) {
        const clone = this.getDelayedCloneFrame(delaySteps);
        if (clone && rectsOverlap(p.x + 4, p.y + 4, p.w - 8, p.h - 8, clone.x + 4, clone.y + 4, p.w - 8, p.h - 8)) {
          this.addCallout(p.x + p.w / 2, p.y - 14, 'CLONE TOUCH!', '#FEF08A');
          this.killPlayer();
          return;
        }
      }
    }

    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      if (door.kind === 'monster_saw' && door.monsterMode) {
        const sawCx = door.curX + door.w / 2;
        const sawCy = door.curY + door.h - 22;
        if (circleRectOverlap(sawCx, sawCy, 19, p.x + 2, p.y + 2, p.w - 4, p.h - 4)) {
          this.killPlayer();
          return;
        }
        continue;
      }

      if (door.kind === 'fake_victory' && door.burstTriggered) {
        continue;
      }

      if (rectsOverlap(p.x + 3, p.y + 3, p.w - 6, p.h - 6, door.curX + 4, door.curY + 4, door.w - 8, door.h - 8)) {
        if (door.locked) {
          continue;
        } else if (door.kind === 'fake_victory') {
          if (!this.fakeVictoryActive && !this.fakeVictoryDone) {
            this.fakeVictoryActive = true;
            this.fakeVictoryTimer = 0.8;
            soundEngine.playLevelWin();
            this.spawnExplosion(door.curX + door.w / 2, door.curY + door.h / 2, 24, CONFETTI_COLORS);
          }
          return;
        } else if (door.kind === 'fake_trap') {
          if (!door.burstTriggered) {
            door.burstTriggered = true;
            for (let j = 0; j < this.spikes.length; j++) {
              const sp = this.spikes[j];
              if (sp.kind === 'door_burst') {
                sp.active = true;
                sp.popScale = 0.05;
                sp.popVel = 14.5;
              }
            }
            this.addCallout(door.curX + 20, door.curY - 16, 'FAKE DOOR!', '#FEF08A');
          }
          this.killPlayer();
          return;
        } else if (door.kind === 'teleport_trap' && door.teleportTo) {
          this.spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, 14, PORTAL_COLORS);
          p.x = door.teleportTo.x;
          p.y = door.teleportTo.y;
          this.prevPlayerX = p.x;
          this.prevPlayerY = p.y;
          p.vx = 0;
          p.vy = 0;
          p.panicTimer = 1.0;
          soundEngine.playTeleport();
          this.spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, 14, PORTAL_COLORS);
          this.addCallout(p.x + 12, p.y - 16, 'GOTCHA!', '#FEF08A');
          return;
        } else if (
          door.kind === 'teleport_runaway' &&
          door.runawayPositions &&
          door.runawayIndex < door.runawayPositions.length
        ) {
          return;
        } else {
          this.winLevel();
          return;
        }
      }
    }
  }

  private isPlatformSolid(plat: RuntimePlatform, p: PlayerState): boolean {
    if (!plat.active || plat.vanished) return false;
    if (plat.kind === 'hologram') {
      return !plat.triggered;
    }
    if (plat.kind === 'fake_wall') {
      return false;
    }
    if (plat.kind === 'falling_ceiling' && plat.triggered && !plat.slammed) {
      return (
        p.y + p.h <= plat.curY + 8 ||
        p.y >= plat.curY + plat.h - 8 ||
        p.x + p.w <= plat.curX + 4 ||
        p.x >= plat.curX + plat.curW - 4
      );
    }
    return true;
  }

  private ensureContextCaches(ctx: CanvasRenderingContext2D): void {
    if (this.cachedGradCtx === ctx) return;
    this.cachedGradCtx = ctx;

    const bgGrad = ctx.createLinearGradient(0, -20, 0, GAME_HEIGHT + 20);
    bgGrad.addColorStop(0, '#E8A14F');
    bgGrad.addColorStop(1, '#D58435');
    this.cachedBgGrad = bgGrad;

    // Canonical 49px height portal gradient (scaled cleanly per door)
    const portalGrad = ctx.createLinearGradient(0, 0, 0, 49);
    portalGrad.addColorStop(0, '#4C1D95');
    portalGrad.addColorStop(0.55, '#1E102E');
    portalGrad.addColorStop(1, '#0F0718');
    this.cachedPortalGrad = portalGrad;
  }

  public render(ctx: CanvasRenderingContext2D): void {
    const alpha = this.renderAlpha;
    this.ensureContextCaches(ctx);

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // Extended background so camera look-ahead & shake never reveal edges
    ctx.fillStyle = this.cachedBgGrad || '#E29848';
    ctx.fillRect(-64, -64, GAME_WIDTH + 128, GAME_HEIGHT + 128);

    // Camera look-ahead + smooth exponential screen shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.12) {
      shakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
    }
    ctx.translate(-this.camX + shakeX, -this.camY + shakeY);

    ctx.fillStyle = 'rgba(255, 247, 237, 0.05)';
    ctx.fillRect(-64, -64, GAME_WIDTH + 128, 154);
    ctx.fillStyle = 'rgba(59, 33, 16, 0.06)';
    ctx.fillRect(-64, GAME_HEIGHT - 120, GAME_WIDTH + 128, 184);

    for (let i = 0; i < this.dust.length; i++) {
      const d = this.dust[i];
      ctx.fillStyle = d.fillStyle;
      ctx.fillRect(d.x, d.y, d.r, d.r);
    }

    if (this.level.wind && this.windGusting) {
      ctx.strokeStyle = 'rgba(255, 247, 237, 0.48)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.windLines.length; i++) {
        const w = this.windLines[i];
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.x + w.len, w.y);
      }
      ctx.stroke();
    }

    // Mirror World transform (Level 19)
    ctx.save();
    if (this.player.mirrored) {
      ctx.translate(GAME_WIDTH, 0);
      ctx.scale(-1, 1);
    }

    if (this.level.signs) {
      for (let i = 0; i < this.level.signs.length; i++) {
        const sign = this.level.signs[i];
        const isActive =
          (sign.triggerType === 'reverse' && this.player.controlsReversed) ||
          (sign.triggerType === 'reverse_zone' && this.inReverseZone) ||
          (sign.triggerType === 'gravity' && this.player.gravityDir === -1) ||
          (sign.triggerType === 'mirror' && this.player.mirrored);
        this.drawSign(
          ctx,
          sign.x,
          sign.y,
          isActive ? sign.activeText : sign.idleText || '',
          isActive,
          this.player.mirrored
        );
      }
    }

    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      if (door.kind === 'fake_victory' && door.burstTriggered) continue;
      this.drawDoor(ctx, door, alpha);
    }

    for (let i = 0; i < this.switches.length; i++) {
      this.drawSwitch(ctx, this.switches[i]);
    }

    // Blit all static terrain platforms and static spikes in one draw call (< 1ms)
    if (this.hasStaticCache && this.staticTerrainCanvas) {
      ctx.drawImage(
        this.staticTerrainCanvas,
        -STATIC_PAD,
        -STATIC_PAD,
        GAME_WIDTH + STATIC_PAD * 2,
        GAME_HEIGHT + STATIC_PAD * 2
      );
    }

    // Dynamic / non-cached spikes only
    for (let i = 0; i < this.spikes.length; i++) {
      const spike = this.spikes[i];
      if (!spike.active || spike.vanished) continue;
      if (this.hasStaticCache && spike.isStaticCached) continue;
      this.drawSpikeStrip(ctx, spike);
    }

    for (let i = 0; i < RAIN_SPIKE_POOL_SIZE; i++) {
      const rs = this.rainSpikes[i];
      if (!rs.active) continue;
      this.drawRainSpike(ctx, rs, alpha);
    }

    for (let i = 0; i < this.movingGates.length; i++) {
      this.drawMovingGate(ctx, this.movingGates[i], alpha);
    }

    for (let i = 0; i < this.sawblades.length; i++) {
      const saw = this.sawblades[i];
      if (!saw.active) continue;
      const rx = lerp(saw.prevX, saw.curX, alpha);
      const ry = lerp(saw.prevY, saw.curY, alpha);
      const rAngle = lerp(saw.prevAngle, saw.angle, alpha);
      this.drawSawblade(ctx, rx, ry, saw.radius, rAngle, false);
    }

    // Dynamic / non-cached platforms only
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      if (!plat.active || plat.vanished) continue;
      if (this.hasStaticCache && plat.isStaticCached) continue;
      this.drawPlatform(ctx, plat, alpha);
    }

    if (this.level.shrinkingRoom) {
      this.drawShrinkingRoom(ctx, alpha);
    }

    if (this.chasingWall) {
      this.drawChasingWall(ctx, this.chasingWall, alpha);
    }

    if (this.risingFloor) {
      this.drawRisingFloor(ctx, this.risingFloor, alpha);
    }

    if (this.lightning) {
      this.drawLightning(ctx, this.lightning);
    }

    // Level 26: Shadow Clone (sub-step interpolated from circular buffer)
    if (this.level.shadowCloneDelay !== undefined && !this.player.dead && !this.player.won) {
      const delaySteps = Math.round(this.level.shadowCloneDelay / FIXED_DT);
      const cloneCur = this.getDelayedCloneFrame(delaySteps);
      if (cloneCur) {
        const clonePrev = this.getDelayedCloneFrame(delaySteps + 1) || cloneCur;
        this.drawShadowClone(ctx, clonePrev, cloneCur, alpha);
      }
    }

    // Sub-pixel interpolated Player rendering with smooth squash/stretch & lean
    if (!this.player.dead && !this.player.won) {
      const renderX = lerp(this.prevPlayerX, this.player.x, alpha);
      const renderY = lerp(this.prevPlayerY, this.player.y, alpha);
      const renderSqX = lerp(this.prevPlayerSquashX, this.player.squashX, alpha);
      const renderSqY = lerp(this.prevPlayerSquashY, this.player.squashY, alpha);
      const renderLean = lerp(this.prevPlayerLean, this.player.leanAngle, alpha);
      this.drawPlayer(ctx, this.player, renderX, renderY, renderSqX, renderSqY, renderLean);
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      const pAlpha = Math.max(0, Math.min(1, pt.life / 0.35));
      const ptx = lerp(pt.prevX, pt.x, alpha);
      const pty = lerp(pt.prevY, pt.y, alpha);
      ctx.save();
      ctx.globalAlpha = pAlpha;
      ctx.translate(ptx + pt.size / 2, pty + pt.size / 2);
      ctx.rotate(pt.rotation);
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }

    ctx.restore();

    if (this.level.controlSwapInterval && !this.player.dead && !this.player.won) {
      this.drawControlSwapIndicator(ctx);
    }

    if (this.fakeVictoryActive) {
      this.drawFakeVictoryBanner(ctx);
    }

    if (this.level.jumpLimit !== undefined && !this.player.dead && !this.player.won) {
      const remaining = Math.max(0, this.level.jumpLimit - this.player.jumpsUsed);
      const label = `JUMPS LEFT: ${remaining}`;
      const drawPx = lerp(this.prevPlayerX, this.player.x, alpha);
      const drawPy = lerp(this.prevPlayerY, this.player.y, alpha);
      const cx = this.player.mirrored ? GAME_WIDTH - (drawPx + this.player.w / 2) : drawPx + this.player.w / 2;
      const cy = drawPy - 16;
      ctx.save();
      ctx.font = '900 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#261408';
      ctx.fillText(label, cx + 1.5, cy + 1.5);
      ctx.fillStyle = remaining === 0 ? '#FCA5A5' : '#FFF7ED';
      ctx.fillText(label, cx, cy);
      ctx.restore();
    }

    if (this.level.wind && this.windGusting) {
      ctx.save();
      ctx.font = '900 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#261408';
      ctx.fillText('<<< WIND GUST! <<<', GAME_WIDTH / 2 + 2, 54);
      ctx.fillStyle = '#FFF7ED';
      ctx.fillText('<<< WIND GUST! <<<', GAME_WIDTH / 2, 52);
      ctx.restore();
    }

    for (let i = 0; i < CALLOUT_POOL_SIZE; i++) {
      const c = this.callouts[i];
      if (!c.active) continue;
      const cAlpha = Math.max(0, Math.min(1, c.life / 0.3));
      const drawX = this.player.mirrored ? GAME_WIDTH - c.x : c.x;
      ctx.save();
      ctx.globalAlpha = cAlpha;
      ctx.font = '900 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#261408';
      ctx.fillText(c.text, drawX + 2, c.y + 2);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, drawX, c.y);
      ctx.restore();
    }

    if (this.fakeDeathActive && !this.player.dead && !this.player.won) {
      this.drawFakeDeathScreen(ctx);
    }

    ctx.restore();

    // Seamless 150ms level fade-in / fade-out crossfade overlay
    if (this.transitionAlpha > 0.005) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, this.transitionAlpha));
      ctx.fillStyle = '#1B0E06';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      ctx.restore();
    }

    // Fixed crisp outer viewport frame (unaffected by camera offset)
    ctx.save();
    ctx.strokeStyle = '#3B2110';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, GAME_WIDTH - 4, GAME_HEIGHT - 4);
    ctx.restore();
  }

  private drawFakeDeathScreen(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(27, 14, 6, 0.52)';
    ctx.fillRect(-40, -40, GAME_WIDTH + 80, GAME_HEIGHT + 80);

    const bx = 280;
    const by = 148;
    const bw = 400;
    const bh = 216;

    ctx.fillStyle = '#1B0E06';
    ctx.fillRect(bx + 6, by + 6, bw, bh);

    ctx.fillStyle = '#2B170A';
    ctx.fillRect(bx, by, bw, bh);

    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#EF4444';
    ctx.font = '900 32px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('GAME OVER', GAME_WIDTH / 2, by + 58);

    ctx.fillStyle = '#E8A14F';
    ctx.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('Your run has ended.', GAME_WIDTH / 2, by + 94);

    ctx.fillStyle = '#E29848';
    ctx.fillRect(360, 280, 240, 52);
    ctx.fillStyle = '#261408';
    ctx.font = '900 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('CLICK TO RESTART', GAME_WIDTH / 2, 312);

    ctx.restore();
  }

  private drawSign(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    isActive: boolean,
    unmirrorText = false
  ): void {
    if (!text) return;
    ctx.save();
    ctx.font = '900 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    let textW = this.signWidthCache.get(text);
    if (textW === undefined) {
      textW = ctx.measureText(text).width;
      this.signWidthCache.set(text, textW);
    }
    const boxW = Math.max(108, textW + 26);
    const boxH = 34;
    const bx = x - boxW / 2;
    const by = y - boxH / 2 + Math.sin(this.globalTime * 4) * 3;

    ctx.fillStyle = '#261408';
    ctx.fillRect(bx + 3, by + 3, boxW, boxH);

    ctx.fillStyle = isActive ? '#DC2626' : '#3B2110';
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.strokeStyle = isActive ? '#FEF08A' : '#5C3317';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, boxW - 2, boxH - 2);

    ctx.translate(x, by + boxH / 2 + 1);
    if (unmirrorText) {
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = isActive ? '#FEF08A' : '#FFF7ED';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, plat: RuntimePlatform, alpha: number): void {
    const x = lerp(plat.prevX, plat.curX, alpha);
    const y = lerp(plat.prevY, plat.curY, alpha);
    const w = lerp(plat.prevW, plat.curW, alpha);
    const h = plat.h;

    if (plat.fadeAlpha <= 0.01 && plat.kind !== 'invisible') {
      return;
    }

    ctx.save();
    if (plat.kind === 'invisible') {
      if (!plat.revealed) {
        ctx.restore();
        return;
      }
      ctx.globalAlpha = plat.fadeAlpha;
      ctx.fillStyle = '#3B2110';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#FDE68A';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.restore();
      return;
    }

    if (plat.kind === 'hologram' && plat.triggered) {
      ctx.globalAlpha = plat.fadeAlpha;
      ctx.fillStyle = '#3B2110';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#FEF08A';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.restore();
      return;
    }

    if (plat.fadeAlpha < 1) {
      ctx.globalAlpha = plat.fadeAlpha;
    }

    if (plat.crumbling) {
      const jitterX = (Math.random() - 0.5) * 3;
      const jitterY = (Math.random() - 0.5) * 2;
      ctx.translate(jitterX, jitterY);
    }

    if (plat.kind === 'spring' && plat.springPop > 0) {
      const popH = plat.springPop * 26;
      ctx.strokeStyle = '#FFF7ED';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 10, y);
      ctx.lineTo(x + w - 10, y - popH * 0.35);
      ctx.lineTo(x + 10, y - popH * 0.7);
      ctx.lineTo(x + w - 10, y - popH);
      ctx.stroke();
      ctx.fillStyle = '#3B2110';
      ctx.fillRect(x + 4, y - popH - 6, w - 8, 6);
    }

    ctx.fillStyle = '#3B2110';
    ctx.fillRect(x, y, w, h);

    if (plat.kind === 'ice') {
      ctx.fillStyle = '#BAE6FD';
      ctx.fillRect(x, y, w, 7);
      ctx.fillStyle = '#E0F2FE';
      ctx.fillRect(x, y, w, 3);
    } else {
      ctx.fillStyle = '#523018';
      ctx.fillRect(x, y, w, Math.min(4, h));
    }

    ctx.fillStyle = '#261408';
    ctx.fillRect(x, y + h - Math.min(4, h), w, Math.min(4, h));

    if (plat.kind === 'spring') {
      ctx.fillStyle = '#6B4022';
      ctx.fillRect(x + 4, y + 2, w - 8, 2);
      ctx.fillStyle = '#261408';
      ctx.fillRect(x, y, 2, 10);
      ctx.fillRect(x + w - 2, y, 2, 10);
    }

    if (plat.kind === 'shrinking' && w > 14) {
      ctx.fillStyle = '#E8A14F';
      ctx.fillRect(x + 3, y + h / 2 - 1, 4, 2);
      ctx.fillRect(x + w - 7, y + h / 2 - 1, 4, 2);
    }

    ctx.restore();
  }

  private drawSpikeStrip(ctx: CanvasRenderingContext2D, s: RuntimeSpike): void {
    const spikeUnit = 16;
    ctx.save();

    if (s.kind === 'delayed' && !s.emerged) {
      const plateY = s.dir === 'down' ? s.y : s.y + s.h - 4;
      const glintY = s.dir === 'down' ? s.y + 1 : s.y + s.h - 3;
      ctx.fillStyle = '#261408';
      ctx.fillRect(s.x, plateY, s.w, 4);
      ctx.fillStyle = s.armed ? '#EF4444' : '#6B4022';
      ctx.fillRect(s.x + 2, glintY, s.w - 4, 2);
      ctx.restore();
      return;
    }

    if (s.dir === 'up' || s.dir === 'down') {
      const count = Math.max(1, Math.round(s.w / spikeUnit));
      const unitW = s.w / count;
      const h = s.h * s.popScale;
      const baseY = s.dir === 'up' ? s.y + s.h : s.y;
      const tipY = s.dir === 'up' ? s.y + s.h - h : s.y + h;

      ctx.fillStyle = '#1B0E06';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sx = s.x + i * unitW;
        const midX = sx + unitW / 2;
        ctx.moveTo(sx, baseY);
        ctx.lineTo(midX, tipY);
        ctx.lineTo(sx + unitW, baseY);
        ctx.closePath();
      }
      ctx.fill();

      ctx.fillStyle = '#FFF7ED';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sx = s.x + i * unitW;
        const midX = sx + unitW / 2;
        ctx.moveTo(sx + 2.5, baseY);
        ctx.lineTo(midX, tipY + (s.dir === 'up' ? 3 : -3));
        ctx.lineTo(midX, baseY);
        ctx.closePath();
      }
      ctx.fill();
    } else {
      const count = Math.max(1, Math.round(s.h / spikeUnit));
      const unitH = s.h / count;
      const w = s.w * s.popScale;
      const baseX = s.dir === 'left' ? s.x + s.w : s.x;
      const tipX = s.dir === 'left' ? s.x + s.w - w : s.x + w;

      ctx.fillStyle = '#1B0E06';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sy = s.y + i * unitH;
        const midY = sy + unitH / 2;
        ctx.moveTo(baseX, sy);
        ctx.lineTo(tipX, midY);
        ctx.lineTo(baseX, sy + unitH);
        ctx.closePath();
      }
      ctx.fill();

      ctx.fillStyle = '#FFF7ED';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sy = s.y + i * unitH;
        const midY = sy + unitH / 2;
        ctx.moveTo(baseX, sy + 2.5);
        ctx.lineTo(tipX + (s.dir === 'left' ? 3 : -3), midY);
        ctx.lineTo(baseX, midY);
        ctx.closePath();
      }
      ctx.fill();
    }

    ctx.restore();
  }

  private drawSawblade(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    isMonster: boolean
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    const teeth = 10;
    ctx.fillStyle = '#1B0E06';
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const r = i % 2 === 0 ? radius + 4 : radius - 4;
      const a = (i * Math.PI) / teeth;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFF7ED';
    ctx.beginPath();
    ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3B2110';
    ctx.beginPath();
    ctx.arc(0, 0, radius - 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    if (isMonster) {
      ctx.save();
      ctx.fillStyle = '#FFF7ED';
      ctx.fillRect(cx - 8, cy - 6, 5, 5);
      ctx.fillRect(cx + 3, cy - 6, 5, 5);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(cx - 6, cy - 4, 2.5, 2.5);
      ctx.fillRect(cx + 4.5, cy - 4, 2.5, 2.5);
      ctx.restore();
    }
  }

  private drawDoor(ctx: CanvasRenderingContext2D, door: RuntimeDoor, alpha: number): void {
    const x = lerp(door.prevX, door.curX, alpha);
    const y = lerp(door.prevY, door.curY, alpha);
    const w = door.w;
    const h = door.h;

    if (door.kind === 'monster_saw' && door.monsterMode) {
      const rAngle = lerp(door.prevMonsterAngle, door.monsterAngle, alpha);
      this.drawSawblade(ctx, x + w / 2, y + h - 22, 22, rAngle, true);
      return;
    }

    ctx.save();
    if (door.inverted) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(1, -1);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }

    const pulse = 0.5 + 0.5 * Math.sin(door.shimmerPhase);
    ctx.fillStyle = `rgba(254, 240, 138, ${(0.12 + pulse * 0.12).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(x - 5, y - 5, w + 10, h + 6, [w / 2, w / 2, 2, 2]);
    ctx.fill();

    ctx.fillStyle = '#261408';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]);
    ctx.fill();

    const innerPad = 5;
    const ix = x + innerPad;
    const iy = y + innerPad;
    const iw = w - innerPad * 2;
    const ih = h - innerPad;

    ctx.save();
    ctx.translate(ix, iy);
    ctx.scale(1, ih / 49);
    ctx.fillStyle = this.cachedPortalGrad || '#1E102E';
    ctx.beginPath();
    ctx.roundRect(0, 0, iw, 49, [iw / 2, iw / 2, 0, 0]);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = `rgba(253, 230, 138, ${(0.35 + pulse * 0.35).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.45 + Math.sin(door.shimmerPhase * 1.3) * 3, 5 + pulse * 2, 0, Math.PI * 2);
    ctx.fill();

    if (door.locked) {
      ctx.strokeStyle = '#FDE68A';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 2, y + 14);
      ctx.lineTo(x + w + 2, y + h - 10);
      ctx.moveTo(x + w + 2, y + 14);
      ctx.lineTo(x - 2, y + h - 10);
      ctx.stroke();

      ctx.fillStyle = '#E29848';
      ctx.fillRect(x + w / 2 - 7, y + h / 2 - 6, 14, 13);
      ctx.strokeStyle = '#261408';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + w / 2 - 7, y + h / 2 - 6, 14, 13);
    }

    ctx.restore();
  }

  private drawChasingWall(ctx: CanvasRenderingContext2D, wall: RuntimeChasingWall, alpha: number): void {
    const x = lerp(wall.prevX, wall.curX, alpha);
    const w = wall.w;
    const ext = lerp(wall.prevSpikeExtend, wall.spikeExtend, alpha);
    ctx.save();

    if (wall.isLaser) {
      ctx.fillStyle = 'rgba(220, 38, 38, 0.25)';
      ctx.fillRect(-64, -64, x + w + 72, GAME_HEIGHT + 128);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(x, -64, w, GAME_HEIGHT + 128);
      ctx.fillStyle = '#FEF08A';
      ctx.fillRect(x + w - 5, -64, 4, GAME_HEIGHT + 128);
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#3B2110';
    ctx.fillRect(-64, -64, x + w + 64, GAME_HEIGHT + 128);

    ctx.fillStyle = '#523018';
    ctx.fillRect(x + w - 5, -64, 5, GAME_HEIGHT + 128);

    if (ext > 0.02) {
      const spikeW = 22 * ext;
      const count = 20;
      const unitH = GAME_HEIGHT / count;

      ctx.fillStyle = '#1B0E06';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sy = i * unitH;
        const tipX = x + w + spikeW;
        const midY = sy + unitH / 2;
        ctx.moveTo(x + w, sy + 1);
        ctx.lineTo(tipX, midY);
        ctx.lineTo(x + w, sy + unitH - 1);
        ctx.closePath();
      }
      ctx.fill();

      ctx.fillStyle = '#FFF7ED';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const sy = i * unitH;
        const tipX = x + w + spikeW;
        const midY = sy + unitH / 2;
        ctx.moveTo(x + w, sy + 3);
        ctx.lineTo(tipX - 3, midY);
        ctx.lineTo(x + w, midY);
        ctx.closePath();
      }
      ctx.fill();

      const eyeX = x + w - 24;
      const eyeY = 230;
      ctx.fillStyle = '#FFF7ED';
      ctx.fillRect(eyeX - 10, eyeY, 9, 9);
      ctx.fillRect(eyeX + 5, eyeY, 9, 9);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(eyeX - 6, eyeY + 3, 4, 4);
      ctx.fillRect(eyeX + 9, eyeY + 3, 4, 4);
    }

    ctx.restore();
  }

  private drawRisingFloor(ctx: CanvasRenderingContext2D, floor: RuntimeRisingFloor, alpha: number): void {
    const y = lerp(floor.prevY, floor.curY, alpha);
    ctx.save();
    ctx.fillStyle = '#3B2110';
    ctx.fillRect(-64, y + 18, GAME_WIDTH + 128, GAME_HEIGHT - y + 64);

    const spikeW = 24;
    const count = Math.ceil(GAME_WIDTH / spikeW);
    const baseY = y + 18;
    const tipY = y;

    ctx.fillStyle = '#1B0E06';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const sx = i * spikeW;
      const midX = sx + spikeW / 2;
      ctx.moveTo(sx, baseY);
      ctx.lineTo(midX, tipY);
      ctx.lineTo(sx + spikeW, baseY);
      ctx.closePath();
    }
    ctx.fill();

    ctx.fillStyle = '#FFF7ED';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const sx = i * spikeW;
      const midX = sx + spikeW / 2;
      ctx.moveTo(sx + 3, baseY);
      ctx.lineTo(midX, tipY + 3);
      ctx.lineTo(midX, baseY);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  private drawLightning(ctx: CanvasRenderingContext2D, strike: LightningStrike): void {
    const alpha = Math.max(0, strike.timer / strike.maxTimer);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FEF08A';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(strike.x, -20);
    ctx.lineTo(strike.x - 14, 130);
    ctx.lineTo(strike.x + 16, 260);
    ctx.lineTo(strike.x - 8, 390);
    ctx.lineTo(strike.x, 440);
    ctx.stroke();

    ctx.strokeStyle = '#FFF7ED';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: PlayerState,
    x: number,
    y: number,
    sqX: number,
    sqY: number,
    lean: number
  ): void {
    ctx.save();

    const cx = x + p.w / 2;
    const anchorY = p.gravityDir === 1 ? y + p.h : y;

    ctx.translate(cx, anchorY);
    ctx.rotate(lean);
    ctx.scale(sqX, sqY * p.gravityDir);

    const bodyW = p.w;
    const bodyH = p.h - 5;

    const moving = Math.abs(p.vx) > 20;
    const legSwing = moving && p.onGround ? Math.sin(p.runCycle) * 3.5 : 0;
    const leftLegY = -6 + Math.max(0, -legSwing);
    const rightLegY = -6 + Math.max(0, legSwing);

    ctx.fillStyle = '#261408';
    ctx.fillRect(-7 + legSwing * 0.4, leftLegY, 5, 6);
    ctx.fillRect(2 - legSwing * 0.4, rightLegY, 5, 6);

    ctx.fillStyle = '#261408';
    ctx.fillRect(-bodyW / 2, -p.h, bodyW, bodyH);

    ctx.fillStyle = '#4A2813';
    ctx.fillRect(-bodyW / 2 + 2, -p.h + 2, bodyW - 4, bodyH - 4);

    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-bodyW / 2 + 2, -p.h + 2, bodyW - 4, 3);

    const lookShift = p.facing * 2.5;
    const eyeY = -p.h + 9;
    const isPanic = p.panicTimer > 0 || !p.onGround;
    const eyeW = isPanic ? 6 : 5;
    const eyeH = isPanic ? 7 : 6;

    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(-7 + lookShift, eyeY, eyeW, eyeH);
    ctx.fillRect(2 + lookShift, eyeY, eyeW, eyeH);

    const pupilOffsetX = p.facing === 1 ? 2 : 0;
    const pupilOffsetY = p.vy * p.gravityDir > 120 ? 3 : 2;
    ctx.fillStyle = '#1B0E06';
    ctx.fillRect(-7 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);
    ctx.fillRect(2 + lookShift + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 2.5);

    ctx.restore();
  }

  private drawSwitch(ctx: CanvasRenderingContext2D, sw: RuntimeSwitch): void {
    ctx.save();
    const pressOffset = sw.pressed ? 8 : 0;
    ctx.fillStyle = '#261408';
    ctx.fillRect(sw.x - 3, sw.y + sw.h - 6, sw.w + 6, 6);
    ctx.fillStyle = sw.pressed ? '#4ADE80' : '#DC2626';
    ctx.fillRect(sw.x, sw.y + pressOffset, sw.w, sw.h - 4 - pressOffset);
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(sw.x + 3, sw.y + pressOffset + 2, sw.w - 6, 2);
    ctx.restore();
  }

  private drawRainSpike(ctx: CanvasRenderingContext2D, rs: RuntimeRainSpike, alpha: number): void {
    const ry = lerp(rs.prevY, rs.y, alpha);
    ctx.save();
    if (rs.warningTimer > 0) {
      ctx.strokeStyle = 'rgba(220, 38, 38, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(rs.x + rs.w / 2, ry);
      ctx.lineTo(rs.x + rs.w / 2, rs.endY);
      ctx.stroke();

      ctx.fillStyle = '#DC2626';
      ctx.fillRect(rs.x + 3, ry, rs.w - 6, 6);
      ctx.restore();
      return;
    }

    const midX = rs.x + rs.w / 2;
    ctx.fillStyle = '#1B0E06';
    ctx.beginPath();
    ctx.moveTo(rs.x, ry);
    ctx.lineTo(midX, ry + rs.h);
    ctx.lineTo(rs.x + rs.w, ry);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFF7ED';
    ctx.beginPath();
    ctx.moveTo(rs.x + 3, ry);
    ctx.lineTo(midX, ry + rs.h - 3);
    ctx.lineTo(midX, ry);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawMovingGate(ctx: CanvasRenderingContext2D, mg: RuntimeMovingGate, alpha: number): void {
    const gapY = lerp(mg.prevGapY, mg.curGapY, alpha);
    ctx.save();
    const topH = gapY;
    const botY = gapY + mg.gapHeight;
    const botH = GAME_HEIGHT - botY;

    ctx.fillStyle = '#3B2110';
    ctx.fillRect(mg.x, 0, mg.w, topH);
    ctx.fillRect(mg.x, botY, mg.w, botH);

    ctx.fillStyle = '#DC2626';
    ctx.fillRect(mg.x + mg.w / 2 - 3, 0, 6, topH - 4);
    ctx.fillRect(mg.x + mg.w / 2 - 3, botY + 4, 6, botH - 4);

    ctx.fillStyle = '#FEF08A';
    ctx.fillRect(mg.x - 2, topH - 6, mg.w + 4, 6);
    ctx.fillRect(mg.x - 2, botY, mg.w + 4, 6);
    ctx.restore();
  }

  private drawShrinkingRoom(ctx: CanvasRenderingContext2D, alpha: number): void {
    const sLeft = lerp(this.prevShrinkLeft, this.shrinkLeft, alpha);
    const sRight = lerp(this.prevShrinkRight, this.shrinkRight, alpha);
    const sTop = lerp(this.prevShrinkTop, this.shrinkTop, alpha);
    const sBottom = lerp(this.prevShrinkBottom, this.shrinkBottom, alpha);

    ctx.save();
    ctx.fillStyle = '#3B2110';
    ctx.fillRect(-64, -64, sLeft + 64, GAME_HEIGHT + 128);
    ctx.fillRect(sRight, -64, GAME_WIDTH - sRight + 64, GAME_HEIGHT + 128);
    ctx.fillRect(-64, -64, GAME_WIDTH + 128, sTop + 64);
    ctx.fillRect(-64, sBottom, GAME_WIDTH + 128, GAME_HEIGHT - sBottom + 64);

    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 4;
    ctx.strokeRect(sLeft, sTop, Math.max(0, sRight - sLeft), Math.max(0, sBottom - sTop));

    ctx.strokeStyle = '#FEF08A';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      sLeft + 3,
      sTop + 3,
      Math.max(0, sRight - sLeft - 6),
      Math.max(0, sBottom - sTop - 6)
    );
    ctx.restore();
  }

  private drawShadowClone(
    ctx: CanvasRenderingContext2D,
    prevC: CloneFrame,
    c: CloneFrame,
    alpha: number
  ): void {
    const rx = lerp(prevC.x, c.x, alpha);
    const ry = lerp(prevC.y, c.y, alpha);
    const rSqX = lerp(prevC.squashX, c.squashX, alpha);
    const rSqY = lerp(prevC.squashY, c.squashY, alpha);
    const rCycle = lerp(prevC.runCycle, c.runCycle, alpha);

    ctx.save();
    const cx = rx + 12;
    const anchorY = c.gravityDir === 1 ? ry + 28 : ry;
    ctx.translate(cx, anchorY);
    ctx.scale(rSqX, rSqY * c.gravityDir);
    ctx.globalAlpha = 0.78;

    const moving = Math.abs(rx) > 0;
    const legSwing = moving ? Math.sin(rCycle) * 3.5 : 0;
    ctx.fillStyle = '#1E102E';
    ctx.fillRect(-7 + legSwing * 0.4, -6 + Math.max(0, -legSwing), 5, 6);
    ctx.fillRect(2 - legSwing * 0.4, -6 + Math.max(0, legSwing), 5, 6);

    ctx.fillStyle = '#2E1065';
    ctx.fillRect(-12, -28, 24, 23);
    ctx.strokeStyle = '#A78BFA';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-11, -27, 22, 21);

    const lookShift = c.facing * 2.5;
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-7 + lookShift, -19, 5, 5);
    ctx.fillRect(2 + lookShift, -19, 5, 5);
    ctx.restore();
  }

  private drawControlSwapIndicator(ctx: CanvasRenderingContext2D): void {
    if (this.controlSwapPulse <= 0 && !this.controlsSwapped) return;
    ctx.save();
    if (this.controlSwapPulse > 0) {
      ctx.strokeStyle = `rgba(254, 240, 138, ${(this.controlSwapPulse * 0.75).toFixed(3)})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, GAME_WIDTH - 8, GAME_HEIGHT - 8);
    }

    if (this.controlsSwapped) {
      ctx.font = '900 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#261408';
      ctx.fillRect(GAME_WIDTH / 2 - 96, 14, 192, 22);
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(GAME_WIDTH / 2 - 96, 14, 192, 22);
      ctx.fillStyle = '#FEF08A';
      ctx.fillText('L<->R  |  JUMP<->DOWN', GAME_WIDTH / 2, 29);
    }
    ctx.restore();
  }

  private drawFakeVictoryBanner(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(27, 14, 6, 0.45)';
    ctx.fillRect(-40, -40, GAME_WIDTH + 80, GAME_HEIGHT + 80);

    const bx = GAME_WIDTH / 2 - 180;
    const by = GAME_HEIGHT / 2 - 54;
    ctx.fillStyle = '#2B170A';
    ctx.fillRect(bx, by, 360, 108);
    ctx.strokeStyle = '#E29848';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, 360, 108);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#4ADE80';
    ctx.font = '900 30px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('LEVEL CLEAR!', GAME_WIDTH / 2, by + 54);
    ctx.fillStyle = '#FFF7ED';
    ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('Advancing to next stage...', GAME_WIDTH / 2, by + 84);
    ctx.restore();
  }
}
