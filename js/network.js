// js/network.js
// 4자리 룸 코드 기반 방 생성/참여, AI 시트 인수, Neon HTTP SQL API 및 로컬 BroadcastChannel/localStorage 동기화 모듈

import { cloneState } from "./state.js";

const STORAGE_PREFIX = "atm_room_";
const CHANNEL_PREFIX = "atm_channel_";
const NEON_CONFIG_KEY = "atm_neon_config";

// 모듈 내부 Neon 연결 설정 상태
const neonConfig = {
  configured: false,
  endpoint: "",
  connectionString: ""
};

// 현재 탭에서 열려 있는 BroadcastChannel 캐시
const activeChannels = new Map();

/**
 * 4자리 숫자(1000..9999) 룸 코드를 생성한다.
 * @returns {string}
 */
function generateRoomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * roomCode를 4자리 문자열로 정규화한다.
 * @param {string} code
 * @returns {string}
 */
function normalizeRoomCode(code) {
  return String(code ?? "").trim().slice(0, 4);
}

/**
 * Neon 연결 문자열 또는 HTTP 엔드포인트 문자열을 파싱하여 설정한다.
 * @param {string} connectionUrlOrEndpoint
 * @returns {boolean}
 */
export function configureNeon(connectionUrlOrEndpoint) {
  const raw = String(connectionUrlOrEndpoint ?? "").trim();
  if (!raw) {
    neonConfig.configured = false;
    neonConfig.endpoint = "";
    neonConfig.connectionString = "";
    try {
      localStorage.removeItem(NEON_CONFIG_KEY);
    } catch {
      // 스토리지 접근 실패 무시
    }
    return false;
  }

  try {
    if (raw.startsWith("postgres://") || raw.startsWith("postgresql://")) {
      const parsed = new URL(raw);
      if (!parsed.hostname) return false;
      neonConfig.endpoint = `https://${parsed.hostname}/sql`;
      neonConfig.connectionString = raw;
      neonConfig.configured = true;
    } else if (raw.startsWith("https://") || raw.startsWith("http://")) {
      const parsed = new URL(raw);
      neonConfig.endpoint = parsed.pathname.endsWith("/sql")
        ? raw
        : `${parsed.origin}/sql`;
      neonConfig.connectionString = "";
      neonConfig.configured = true;
    } else {
      return false;
    }

    try {
      localStorage.setItem(NEON_CONFIG_KEY, raw);
    } catch {
      // 스토리지 저장 실패 무시
    }
    return true;
  } catch {
    return false;
  }
}

// 초기 로드 시 저장된 Neon 설정이 있다면 복원한다.
try {
  const savedNeon = localStorage.getItem(NEON_CONFIG_KEY);
  if (savedNeon) {
    configureNeon(savedNeon);
  }
} catch {
  // 초기 환경에서 localStorage 접근 불가 시 무시
}

/**
 * 현재 활성 네트워크 모드를 반환한다.
 * @returns {"NEON" | "LOCAL"}
 */
export function getNetworkMode() {
  return neonConfig.configured && neonConfig.endpoint ? "NEON" : "LOCAL";
}

/**
 * Neon Serverless Postgres HTTP SQL API 요청을 실행한다.
 * @param {string} query
 * @param {Array} params
 * @returns {Promise<{ ok: boolean, rows: Array }>}
 */
async function executeNeonSql(query, params) {
  if (!neonConfig.configured || !neonConfig.endpoint) {
    return { ok: false, rows: [] };
  }

  const headers = {
    "Content-Type": "application/json"
  };
  if (neonConfig.connectionString) {
    headers["Neon-Connection-String"] = neonConfig.connectionString;
  }

  try {
    const response = await fetch(neonConfig.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, params })
    });
    if (!response.ok) {
      return { ok: false, rows: [] };
    }
    const data = await response.json();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

/**
 * 로컬 저장소(localStorage)에 방 상태를 저장하고 BroadcastChannel로 전파한다.
 * @param {string} roomCode
 * @param {object} stateSnapshot
 * @param {string} [sourceTag]
 */
function saveAndBroadcastLocal(roomCode, stateSnapshot, sourceTag = "sync") {
  const code = normalizeRoomCode(roomCode);
  if (!code) return;

  try {
    localStorage.setItem(STORAGE_PREFIX + code, JSON.stringify(stateSnapshot));
  } catch {
    // 용량 초과 등 예외 무시
  }

  if (typeof BroadcastChannel !== "undefined") {
    let channel = activeChannels.get(code);
    if (!channel) {
      channel = new BroadcastChannel(CHANNEL_PREFIX + code);
      activeChannels.set(code, channel);
    }
    try {
      channel.postMessage({
        type: "ROOM_STATE_UPDATE",
        roomCode: code,
        sourceTag,
        version: stateSnapshot.version || 1,
        state: stateSnapshot
      });
    } catch {
      // 직렬화 오류 무시
    }
  }
}

/**
 * 로컬 저장소에서 방 상태를 불러온다.
 * @param {string} roomCode
 * @returns {object | null}
 */
function loadLocalRoom(roomCode) {
  const code = normalizeRoomCode(roomCode);
  if (!code) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + code);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 새 6인 리그 방을 생성하고 4자리 룸 코드를 부여한다.
 * @param {object} state
 * @returns {Promise<{ roomCode: string, mode: "NEON" | "LOCAL" }>}
 */
export async function createRoom(state) {
  const roomCode =
    state.roomCode && /^\d{4}$/.test(String(state.roomCode))
      ? String(state.roomCode)
      : generateRoomCode();

  state.roomCode = roomCode;
  state.localSeatIndex = 0;
  state.version = Number(state.version || 1);

  if (state.seats && state.seats[0]) {
    state.seats[0].isAI = false;
  }

  // 동기화용 스냅샷은 localSeatIndex를 클라이언트별로 유지하도록 그대로 저장하되,
  // 방 생성자의 시트 상태를 반영한다.
  const snapshot = cloneState(state);
  saveAndBroadcastLocal(roomCode, snapshot, "create");

  let mode = "LOCAL";
  if (getNetworkMode() === "NEON") {
    const upsertQuery =
      "INSERT INTO rooms (room_code, host_seat, version, state_json, updated_at) " +
      "VALUES ($1, $2, $3, $4::jsonb, NOW()) " +
      "ON CONFLICT (room_code) DO UPDATE SET version = rooms.version + 1, state_json = EXCLUDED.state_json, updated_at = NOW() " +
      "RETURNING room_code, version, state_json;";
    const result = await executeNeonSql(upsertQuery, [
      roomCode,
      0,
      snapshot.version,
      JSON.stringify(snapshot)
    ]);
    if (result.ok) {
      mode = "NEON";
    }
  }

  return { roomCode, mode };
}

/**
 * 4자리 룸 코드로 기존 방에 참여하며, 요청된 시트 또는 빈 AI 시트를 인수한다.
 * @param {string} roomCode
 * @param {number | null} [preferredSeatIndex]
 * @param {string} [coachName]
 * @returns {Promise<{ ok: boolean, state: object | null, assignedSeat: number, mode: "NEON" | "LOCAL", error?: string }>}
 */
export async function joinRoom(roomCode, preferredSeatIndex = null, coachName = "Guest Coach") {
  const code = normalizeRoomCode(roomCode);
  if (!/^\d{4}$/.test(code)) {
    return {
      ok: false,
      state: null,
      assignedSeat: -1,
      mode: "LOCAL",
      error: "4자리 숫자 룸 코드를 입력해 주세요."
    };
  }

  let loadedState = null;
  let mode = "LOCAL";

  if (getNetworkMode() === "NEON") {
    const selectQuery =
      "SELECT room_code, version, state_json, updated_at FROM rooms WHERE room_code = $1 LIMIT 1;";
    const res = await executeNeonSql(selectQuery, [code]);
    if (res.ok && res.rows.length > 0) {
      const row = res.rows[0];
      loadedState =
        typeof row.state_json === "string"
          ? JSON.parse(row.state_json)
          : cloneState(row.state_json);
      if (loadedState) {
        loadedState.version = Number(row.version || loadedState.version || 1);
      }
      mode = "NEON";
    }
  }

  if (!loadedState) {
    loadedState = loadLocalRoom(code);
    mode = "LOCAL";
  }

  if (!loadedState || !Array.isArray(loadedState.seats)) {
    return {
      ok: false,
      state: null,
      assignedSeat: -1,
      mode,
      error: `룸 코드 [${code}]를 찾을 수 없습니다.`
    };
  }

  const nextState = cloneState(loadedState);
  nextState.roomCode = code;

  // 시트 배정 로직: 선호 시트가 지정되었고 유효하면 사용, 아니면 AI 시트 자동 탐색
  let targetSeat = -1;
  if (
    typeof preferredSeatIndex === "number" &&
    preferredSeatIndex >= 0 &&
    preferredSeatIndex < nextState.seats.length
  ) {
    targetSeat = preferredSeatIndex;
  } else {
    const aiSeat = nextState.seats.find((seat) => seat.isAI);
    targetSeat = aiSeat ? aiSeat.seatIndex : 0;
  }

  nextState.localSeatIndex = targetSeat;
  const seatObj = nextState.seats[targetSeat];
  if (seatObj && seatObj.isAI) {
    seatObj.isAI = false;
    seatObj.coachName = String(coachName || `Coach ${targetSeat + 1}`).trim() || `Coach ${targetSeat + 1}`;
    nextState.version = Number(nextState.version || 1) + 1;
    await syncRoomState(nextState);
  }

  return {
    ok: true,
    state: nextState,
    assignedSeat: targetSeat,
    mode
  };
}

/**
 * 특정 AI 시트(또는 시트)를 인간 감독으로 인수(isAI: true -> false)하고 동기화한다.
 * @param {object} state
 * @param {number} seatIndex
 * @param {string} coachName
 * @returns {Promise<object>}
 */
export async function claimSeat(state, seatIndex, coachName = "Human Coach") {
  const seat = state?.seats?.[seatIndex];
  if (!seat) {
    return state;
  }

  seat.isAI = false;
  seat.coachName = String(coachName || `Coach ${seatIndex + 1}`).trim() || `Coach ${seatIndex + 1}`;
  state.localSeatIndex = seatIndex;
  state.version = Number(state.version || 1) + 1;

  await syncRoomState(state);
  return state;
}

/**
 * 현재 게임 상태를 Neon 및 로컬(BroadcastChannel + localStorage)에 동기화한다.
 * @param {object} state
 * @returns {Promise<boolean>}
 */
export async function syncRoomState(state) {
  const code = normalizeRoomCode(state?.roomCode);
  if (!code) return false;

  const snapshot = cloneState(state);
  snapshot.version = Number(snapshot.version || 1);

  saveAndBroadcastLocal(code, snapshot, "sync");

  if (getNetworkMode() === "NEON") {
    const upsertQuery =
      "INSERT INTO rooms (room_code, host_seat, version, state_json, updated_at) " +
      "VALUES ($1, $2, $3, $4::jsonb, NOW()) " +
      "ON CONFLICT (room_code) DO UPDATE SET version = rooms.version + 1, state_json = EXCLUDED.state_json, updated_at = NOW() " +
      "RETURNING room_code, version, state_json;";
    const result = await executeNeonSql(upsertQuery, [
      code,
      snapshot.localSeatIndex ?? 0,
      snapshot.version,
      JSON.stringify(snapshot)
    ]);
    return result.ok;
  }

  return true;
}

/**
 * 원격/다른 탭의 룸 상태 업데이트를 실시간 구독한다.
 * BroadcastChannel + window storage 이벤트 + Neon 폴링(설정 시)을 결합한다.
 * @param {string} roomCode
 * @param {(newState: object) => void} onRemoteUpdate
 * @returns {() => void} 구독 해제 함수
 */
export function subscribeRoomUpdates(roomCode, onRemoteUpdate) {
  const code = normalizeRoomCode(roomCode);
  if (!code || typeof onRemoteUpdate !== "function") {
    return () => {};
  }

  let disposed = false;
  let lastSeenVersion = -1;

  const emitIfNewer = (incoming) => {
    if (disposed || !incoming || normalizeRoomCode(incoming.roomCode) !== code) return;
    const incomingVer = Number(incoming.version || 0);
    if (incomingVer > 0 && incomingVer === lastSeenVersion) return;
    lastSeenVersion = incomingVer;
    onRemoteUpdate(cloneState(incoming));
  };

  let bc = null;
  const handleBroadcast = (event) => {
    const payload = event?.data;
    if (payload?.type === "ROOM_STATE_UPDATE" && payload.state) {
      emitIfNewer(payload.state);
    }
  };

  if (typeof BroadcastChannel !== "undefined") {
    bc = new BroadcastChannel(CHANNEL_PREFIX + code);
    bc.addEventListener("message", handleBroadcast);
  }

  const handleStorage = (event) => {
    if (event.key !== STORAGE_PREFIX + code || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      emitIfNewer(parsed);
    } catch {
      // JSON 파싱 오류 무시
    }
  };
  window.addEventListener("storage", handleStorage);

  // Neon 모드일 때 다른 기기 간 동기화를 위한 가벼운 3초 폴링
  let pollTimer = null;
  if (getNetworkMode() === "NEON") {
    pollTimer = window.setInterval(async () => {
      if (disposed) return;
      const selectQuery =
        "SELECT room_code, version, state_json FROM rooms WHERE room_code = $1 LIMIT 1;";
      const res = await executeNeonSql(selectQuery, [code]);
      if (res.ok && res.rows.length > 0) {
        const row = res.rows[0];
        const parsed =
          typeof row.state_json === "string"
            ? JSON.parse(row.state_json)
            : row.state_json;
        if (parsed) {
          parsed.version = Number(row.version || parsed.version || 1);
          emitIfNewer(parsed);
        }
      }
    }, 3000);
  }

  return () => {
    disposed = true;
    if (bc) {
      bc.removeEventListener("message", handleBroadcast);
      bc.close();
    }
    window.removeEventListener("storage", handleStorage);
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
  };
}
