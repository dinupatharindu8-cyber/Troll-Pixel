export type GamePhase = 'TITLE' | 'PLAYING' | 'LEVEL_CLEAR' | 'VICTORY';

export type SpikeDirection = 'up' | 'down' | 'left' | 'right';

export interface PlatformDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind?:
    | 'solid'
    | 'sliding'
    | 'falling_ceiling'
    | 'hologram'
    | 'spring'
    | 'cover_drop'
    | 'fake_wall'
    | 'shrinking'
    | 'ice'
    | 'invisible'
    | 'periodic_falling'
    | 'crumble_on_step'
    | 'crumble_after_switch'
    | 'hatch_drop';
  targetX?: number;
  targetY?: number;
  moveSpeed?: number;
  triggerX?: number;
  persistAfterTrigger?: boolean;
  springVelocity?: number;
  shrinkTargetW?: number;
  shrinkSpeed?: number;
  fallPeriod?: number;
  fallDelay?: number;
  crumbleDelay?: number;
  switchDropOrder?: number;
}

export interface SpikeDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: SpikeDirection;
  kind?: 'normal' | 'fake_vanish' | 'door_burst' | 'delayed';
  hiddenUntilDoorTrigger?: boolean;
  delaySeconds?: number;
}

export interface SawbladeDef {
  id: string;
  x: number;
  y: number;
  radius: number;
  targetX?: number;
  targetY?: number;
  speed?: number;
  triggerX?: number;
  delay?: number;
  patrol?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    speed: number;
  };
}

export interface DoorDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  inverted?: boolean;
  kind:
    | 'real'
    | 'moving'
    | 'fake_trap'
    | 'teleport_trap'
    | 'monster_saw'
    | 'locked_chain'
    | 'fake_victory'
    | 'teleport_runaway';
  targetX?: number;
  targetY?: number;
  moveSpeed?: number;
  triggerX?: number;
  persistAfterTrigger?: boolean;
  teleportTo?: { x: number; y: number };
  runawayPositions?: { x: number; y: number }[];
}

export interface SwitchDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChasingWallDef {
  startX: number;
  w: number;
  triggerX: number;
  speed: number;
  isLaser?: boolean;
}

export interface RisingFloorDef {
  startY: number;
  speed: number;
  triggerX: number;
  minY: number;
}

export interface SpikeRainConfig {
  minX: number;
  maxX: number;
  startY: number;
  endY: number;
  speed: number;
  waveInterval: number;
  columns: number;
}

export interface MovingLaserGate {
  id: string;
  x: number;
  w: number;
  gapHeight: number;
  minY: number;
  maxY: number;
  speed: number;
  phase: number;
}

export interface ShrinkingRoomConfig {
  speedX: number;
  speedY: number;
  minHalfW: number;
  minHalfH: number;
}

export interface WindConfig {
  force: number;
  gustDuration: number;
  calmDuration: number;
}

export interface ReverseZone {
  minX: number;
  maxX: number;
}

export interface SignDef {
  id: string;
  x: number;
  y: number;
  idleText?: string;
  activeText: string;
  triggerType: 'reverse' | 'gravity' | 'mirror' | 'reverse_zone';
}

export interface LevelDef {
  id: number;
  title: string;
  subtitle: string;
  spawn: { x: number; y: number };
  platforms: PlatformDef[];
  spikes: SpikeDef[];
  doors: DoorDef[];
  sawblades?: SawbladeDef[];
  switches?: SwitchDef[];
  movingGates?: MovingLaserGate[];
  reverseTriggerX?: number;
  reverseZones?: ReverseZone[];
  gravityFlipTriggerX?: number;
  gravityUnflipTriggerX?: number;
  mirrorTriggerX?: number;
  fakeDeathTriggerX?: number;
  jumpLimit?: number;
  wind?: WindConfig;
  chasingWall?: ChasingWallDef;
  risingFloor?: RisingFloorDef;
  controlSwapInterval?: number;
  fadeAllPlatformsAfter?: number;
  spikeRain?: SpikeRainConfig;
  shadowCloneDelay?: number;
  lowGravity?: boolean;
  shrinkingRoom?: ShrinkingRoomConfig;
  signs?: SignDef[];
}

export interface RuntimePlatform extends PlatformDef {
  curX: number;
  curY: number;
  curW: number;
  prevX: number;
  prevY: number;
  prevW: number;
  triggered: boolean;
  active: boolean;
  vanished: boolean;
  fadeAlpha: number;
  springTimer: number;
  springPop: number;
  slammed: boolean;
  shrinkingStarted: boolean;
  revealed: boolean;
  periodicTimer: number;
  crumbleTimer: number;
  crumbling: boolean;
  isStaticCached: boolean;
}

export interface RuntimeSpike extends SpikeDef {
  active: boolean;
  vanished: boolean;
  popScale: number;
  prevPopScale: number;
  popVel: number;
  armed: boolean;
  armTimer: number;
  emerged: boolean;
  isStaticCached: boolean;
}

export interface RuntimeSawblade extends SawbladeDef {
  curX: number;
  curY: number;
  prevX: number;
  prevY: number;
  triggered: boolean;
  active: boolean;
  delayTimer: number;
  angle: number;
  prevAngle: number;
  patrolT: number;
}

export interface RuntimeDoor extends DoorDef {
  curX: number;
  curY: number;
  prevX: number;
  prevY: number;
  triggered: boolean;
  burstTriggered: boolean;
  shimmerPhase: number;
  monsterMode: boolean;
  monsterAngle: number;
  prevMonsterAngle: number;
  locked: boolean;
  runawayIndex: number;
  runawayCooldown: number;
}

export interface RuntimeSwitch extends SwitchDef {
  pressed: boolean;
}

export interface RuntimeRainSpike {
  active: boolean;
  x: number;
  y: number;
  prevY: number;
  w: number;
  h: number;
  speed: number;
  warningTimer: number;
  endY: number;
}

export interface RuntimeMovingGate extends MovingLaserGate {
  curGapY: number;
  prevGapY: number;
  t: number;
}

export interface RuntimeChasingWall {
  active: boolean;
  curX: number;
  prevX: number;
  w: number;
  triggerX: number;
  speed: number;
  spikeExtend: number;
  prevSpikeExtend: number;
  isLaser: boolean;
}

export interface RuntimeRisingFloor {
  active: boolean;
  curY: number;
  prevY: number;
  speed: number;
  triggerX: number;
  minY: number;
}

export interface CloneFrame {
  x: number;
  y: number;
  facing: 1 | -1;
  squashX: number;
  squashY: number;
  gravityDir: 1 | -1;
  runCycle: number;
}

export interface LightningStrike {
  x: number;
  timer: number;
  maxTimer: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  gravity: number;
  rotation: number;
  vRot: number;
}

export interface FloatingCallout {
  active: boolean;
  x: number;
  y: number;
  prevY: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface PlayerState {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;
  onIce: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpHeld: boolean;
  gravityDir: 1 | -1;
  controlsReversed: boolean;
  mirrored: boolean;
  jumpsUsed: number;
  squashX: number;
  squashY: number;
  leanAngle: number;
  runCycle: number;
  dead: boolean;
  respawnTimer: number;
  won: boolean;
  winTimer: number;
  panicTimer: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  down: boolean;
  downJustPressed: boolean;
  jumpHeld: boolean;
  jumpJustPressed: boolean;
}

export type SkinId = 'default' | 'clown' | 'ninja' | 'king';

export interface LevelProgress {
  unlockedLevel: number;
  deathsPerLevel: Record<number, number>;
  completedLevels: number[];
  selectedSkin?: SkinId;
  totalDeaths?: number;
  bestRunMs?: number;
}
