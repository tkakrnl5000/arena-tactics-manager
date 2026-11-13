/**
 * js/audio.js
 * 외부 오디오 파일 없는 순수 Web Audio API 프로시저럴 효과음 합성 모듈
 * 첫 사용자 포인터/터치 입력 시 AudioContext를 자동 언락하며, localStorage에 음소거 상태를 영속 저장한다.
 */

const MUTE_STORAGE_KEY = "atm_audio_muted";

let audioCtx = null;
let noiseBuffer = null;
let muted = false;
let initialized = false;
const lastPlayedAt = new Map();

try {
  if (typeof localStorage !== "undefined") {
    muted = localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  }
} catch {
  muted = false;
}

function getOrCreateContext() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (!noiseBuffer && audioCtx) {
    const sampleRate = audioCtx.sampleRate || 44100;
    const len = Math.floor(sampleRate * 0.4);
    const buf = audioCtx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = buf;
  }
  return audioCtx;
}

/**
 * 첫 사용자 제스처에서 Web Audio 컨텍스트를 언락한다.
 */
export function initAudio() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const unlock = () => {
    getOrCreateContext();
  };
  window.addEventListener("pointerdown", unlock, { passive: true, capture: true });
  window.addEventListener("touchstart", unlock, { passive: true, capture: true });
  window.addEventListener("keydown", unlock, { passive: true, capture: true });
}

export function isAudioMuted() {
  return Boolean(muted);
}

export function setAudioMuted(nextMuted) {
  muted = Boolean(nextMuted);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
    }
  } catch {
    // 스토리지 접근 불가 무시
  }
  return muted;
}

export function toggleAudioMute() {
  return setAudioMuted(!muted);
}

function playTone(ctx, opts) {
  const {
    type = "sine",
    freqStart = 440,
    freqEnd = 440,
    delay = 0,
    duration = 0.1,
    attack = 0.004,
    peakGain = 0.08
  } = opts;

  const t0 = ctx.currentTime + delay;
  const t1 = t0 + duration;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freqStart), t0);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t1);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.01);
}

function playFilteredNoise(ctx, opts) {
  if (!noiseBuffer) return;
  const {
    filterType = "bandpass",
    freqStart = 1200,
    freqEnd = 400,
    q = 1.6,
    duration = 0.14,
    peakGain = 0.08
  } = opts;

  const t0 = ctx.currentTime;
  const t1 = t0 + duration;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.setValueAtTime(q, t0);
  filter.frequency.setValueAtTime(freqStart, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t1);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t1 + 0.01);
}

const ALIAS_MAP = {
  CLICK: "CARD_CLICK",
  COUNTER: "COUNTER_PARRY",
  CALL: "COACH_CALL",
  WIN: "VICTORY_FANFARE"
};

const THROTTLE_MS = {
  M1_FIRE: 55,
  HIT_IMPACT: 45,
  M2_SKILLSHOT: 75,
  CARD_CLICK: 30
};

/**
 * 프로시저럴 효과음 재생 (9종 + 호환 별칭)
 * @param {string} rawType
 */
export function playSfx(rawType = "CARD_CLICK") {
  const type = ALIAS_MAP[rawType] || rawType;
  if (muted || typeof window === "undefined") return;

  const nowMs = performance.now ? performance.now() : Date.now();
  const minGap = THROTTLE_MS[type] || 0;
  if (minGap > 0) {
    const prev = lastPlayedAt.get(type) || 0;
    if (nowMs - prev < minGap) return;
    lastPlayedAt.set(type, nowMs);
  }

  try {
    const ctx = getOrCreateContext();
    if (!ctx) return;

    switch (type) {
      case "M1_FIRE":
        playTone(ctx, { type: "triangle", freqStart: 640, freqEnd: 260, duration: 0.055, peakGain: 0.045 });
        break;

      case "M2_SKILLSHOT":
        playFilteredNoise(ctx, { filterType: "bandpass", freqStart: 1800, freqEnd: 480, duration: 0.14, peakGain: 0.07 });
        playTone(ctx, { type: "sawtooth", freqStart: 420, freqEnd: 790, duration: 0.12, peakGain: 0.045 });
        break;

      case "HIT_IMPACT":
        playTone(ctx, { type: "sine", freqStart: 165, freqEnd: 52, duration: 0.085, peakGain: 0.095 });
        playFilteredNoise(ctx, { filterType: "lowpass", freqStart: 900, freqEnd: 240, duration: 0.06, peakGain: 0.05 });
        break;

      case "COUNTER_PARRY":
        // 날카로운 금속성 하모닉 클랭 + 잔향 쉬머
        playTone(ctx, { type: "triangle", freqStart: 980, freqEnd: 1560, duration: 0.14, peakGain: 0.11 });
        playTone(ctx, { type: "sine", freqStart: 1975, freqEnd: 1760, delay: 0.015, duration: 0.22, peakGain: 0.075 });
        playTone(ctx, { type: "square", freqStart: 1320, freqEnd: 2240, duration: 0.07, peakGain: 0.04 });
        break;

      case "ORB_SHATTER":
        // 크리스탈 메이저 코드 차임 (C6-E6-G6)
        playTone(ctx, { type: "sine", freqStart: 1046.5, freqEnd: 1046.5, delay: 0.0, duration: 0.24, peakGain: 0.08 });
        playTone(ctx, { type: "sine", freqStart: 1318.5, freqEnd: 1318.5, delay: 0.045, duration: 0.26, peakGain: 0.08 });
        playTone(ctx, { type: "triangle", freqStart: 1567.98, freqEnd: 1567.98, delay: 0.09, duration: 0.3, peakGain: 0.075 });
        break;

      case "EX_SURGE":
        // 묵직한 서브베이스 파워 버스트 + 상승 스윕
        playTone(ctx, { type: "sine", freqStart: 130, freqEnd: 46, duration: 0.26, peakGain: 0.14 });
        playTone(ctx, { type: "sawtooth", freqStart: 220, freqEnd: 660, delay: 0.02, duration: 0.22, peakGain: 0.065 });
        break;

      case "COACH_CALL":
        // 전술 무전 2연속 비프
        playTone(ctx, { type: "sine", freqStart: 880, freqEnd: 920, delay: 0.0, duration: 0.055, peakGain: 0.07 });
        playTone(ctx, { type: "sine", freqStart: 1174, freqEnd: 1174, delay: 0.065, duration: 0.075, peakGain: 0.075 });
        break;

      case "VICTORY_FANFARE":
        // 4음 브라스 신스 아르페지오 (C5-E5-G5-C6)
        playTone(ctx, { type: "triangle", freqStart: 523.25, freqEnd: 523.25, delay: 0.0, duration: 0.12, peakGain: 0.09 });
        playTone(ctx, { type: "triangle", freqStart: 659.25, freqEnd: 659.25, delay: 0.09, duration: 0.12, peakGain: 0.09 });
        playTone(ctx, { type: "triangle", freqStart: 783.99, freqEnd: 783.99, delay: 0.18, duration: 0.12, peakGain: 0.09 });
        playTone(ctx, { type: "sawtooth", freqStart: 1046.5, freqEnd: 1046.5, delay: 0.27, duration: 0.34, peakGain: 0.085 });
        break;

      case "CARD_CLICK":
      default:
        // 탄탄한 테이블탑 카드 스냅
        playTone(ctx, { type: "triangle", freqStart: 540, freqEnd: 290, duration: 0.045, peakGain: 0.05 });
        break;
    }
  } catch {
    // Web Audio 초기화 오류 조용히 무시
  }
}
