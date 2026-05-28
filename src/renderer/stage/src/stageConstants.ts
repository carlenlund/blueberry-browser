import * as THREE from "three";

/** Y of the stage floor; all cards sit just above this. */
export const FLOOR_Y = -1.4;
/** Top surface of the cards — the avatar's feet stand on this. */
export const CARD_SURFACE_Y = FLOOR_Y + 0.012;
/** Card width along the walking axis (X). Constant so steps feel even. */
export const CARD_LENGTH = 3.6;
/** Gap between cards along the walking axis (avatar can fall through here). */
export const CARD_GAP = 0.84;
/** Card body height below the walkable top surface. */
export const CARD_CUBE_HEIGHT = 12;
/** Fall this far below card tops before respawning on the first card. */
export const VOID_RESPAWN_FALL_DEPTH = 15;
export const VOID_RESPAWN_Y = CARD_SURFACE_Y - VOID_RESPAWN_FALL_DEPTH;
/** Blue distance fog — near/far tuned for cracks between card cubes. */
export const STAGE_FOG_NEAR = 10;
export const STAGE_FOG_FAR = 30;
export const STAGE_FOG_COLOR_DARK = "#4a6bb5";
export const STAGE_FOG_COLOR_LIGHT = "#8eb0f0";
/** Used until we have a real screenshot to compute the card's aspect. */
export const DEFAULT_PAGE_ASPECT = 1.4;
/** Avatar body offset above its feet. */
export const AVATAR_HEIGHT = 0.35;
export const PRECLICK_RUN_MS = 420;
export const MINING_MS = 420;
export const MINE_TICK_MS = 180;
export const MINE_LETTERS_PER_BATCH = 2;
export const PREMOVE_MARK_MS = 140;
export const AVATAR_YAW_OFFSET = Math.PI / 2;
/** Delay before walking to a newly spawned card so it renders first. */
export const NEW_CARD_WALK_DELAY_MS = 80;
export const MOVEMENT_SPEED_SCALE = 0.6;
/** Arrow-key walk speed in stage units per second. */
export const ARROW_MOVE_SPEED = 2.4 * MOVEMENT_SPEED_SCALE;
/** Damp factor when walking the avatar toward a card target. */
export const AVATAR_WALK_DAMP = 3.5 * MOVEMENT_SPEED_SCALE;
export const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
export const JUMP_VELOCITY = 3.2;
export const GRAVITY = 11;
export const GROUND_CONTACT_EPSILON = 0.02;
export const AVATAR_CLIP_FPS = 30;
export const AVATAR_CLIP_START_FRAME = 1;
export const AVATAR_LOOP_END_TRIM_FRAMES = 2;

export type AvatarLoopProfile = { startFrame: number; endTrimFrames: number };

export const AVATAR_LOCOMOTION_LOOP: AvatarLoopProfile = {
  startFrame: AVATAR_CLIP_START_FRAME,
  endTrimFrames: AVATAR_LOOP_END_TRIM_FRAMES,
};
export const AVATAR_SUBTLE_LOOP: AvatarLoopProfile = {
  startFrame: 0,
  endTrimFrames: 0,
};

export const AVATAR_HEAD_LOCAL = new THREE.Vector3(0, 0.42, 0);
export const AVATAR_VISUAL_CENTER_LOCAL = new THREE.Vector3(0, 0.02, 0);
export const AVATAR_SPEECH_APEX_LOCAL = new THREE.Vector3(0.12, 0.1, 0);
export const SPEECH_TRIANGLE_APEX_NDC_X_OFFSET = 0.06;
export const AVATAR_TALK_YAW = 0;
export const TALK_CAMERA_OFFSET = new THREE.Vector3(0, 0.85, 3.35);
export const SPEECH_TRIANGLE_EDGE_NDC_X = 1;
export const SPEECH_TRIANGLE_NDC_Y_SPREAD = 0.055;
export const SPEECH_TRIANGLE_APEX_NDC_Y_OFFSET = 0.16;
export const CAMERA_DEFAULT_POSITION = new THREE.Vector3(0, 10, 6.35);
export const CAMERA_LOOK_AT_Y = -1.48;
export const DEFAULT_LOOK_AT = new THREE.Vector3(0, CAMERA_LOOK_AT_Y, 0);
