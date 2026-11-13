// js/controller.js
// 메인 requestAnimationFrame 루프, 화면 상태 머신, 사용자 액션 디스패치, DOM/네트워크 연결 모듈

import { SCREEN_STATES, ROOM_MODES, MAP_ORDER, SCHEDULE_MODES, createInitialState, cloneState } from "./state.js";
import {
  initCombatRound,
  stepCombat,
  fastForwardToNextHighlight,
  triggerCoachCall,
  shuffleRandomComp
} from "./engine.js";
import {
  executeWeeklyAction,
  hireHeadCoach,
  updateBanPickNote,
  updateAutoSchedule,
  upgradeFacility,
  selectSponsorContract,
  tickRealTimeRoutineIfDue,
  signStoveRookie,
  startNextSeason,
  startPlayerMatchOrSimWeek,
  quickSimulateFullRound,
  advanceDraftStep,
  runCoachDraftStep,
  selectRiteCard,
  autoSelectCoachRiteCard,
  recordSetWinAndProceed,
  setScheduleMode,
  checkAndResolveDueMatches,
  startVodReplay,
  rerollArcadeRoster,
  toggleArcadeReady,
  startArcadeVsAI,
  swapArcadeDraftAssignment,
  confirmArcadePlayerAssignment,
  rematchArcadeSwapSides
} from "./league.js";
import {
  configureNeon,
  getNetworkMode,
  getSessionPlayerId,
  testNeonConnection,
  restoreSessionIfPossible,
  createRoom,
  joinRoom,
  claimSeat,
  syncRoomState,
  subscribeRoomUpdates
} from "./network.js";
import { initAudio, playSfx, isAudioMuted, toggleAudioMute } from "./audio.js";
import { initRenderer, renderArena } from "./renderer.js";
import { initHUD, renderHUD, showModal, updateScheduleCountdownHUD } from "./hud.js";

const LOCAL_SAVE_KEY = "atm_saved_league_v2";

function saveLocalLeagueState(state) {
  try {
    if (typeof localStorage === "undefined" || !state) return;
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(state));
  } catch {
    // 저장 공간 제한 시 무시
  }
}

function loadLocalLeagueState() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.seats) || !Array.isArray(parsed.schedule)) return null;
    if (parsed.screen === SCREEN_STATES.COMBAT) {
      parsed.combat.running = false;
      parsed.screen = parsed.roomMode === ROOM_MODES.ARCADE_2P
        ? SCREEN_STATES.ARCADE_LOBBY
        : (parsed.playoffs?.active ? SCREEN_STATES.PLAYOFF_BRACKET : SCREEN_STATES.WEEKLY_HUB);
    }
    return parsed;
  } catch {
    return null;
  }
}

let appState = loadLocalLeagueState() || createInitialState();
let canvasCtx = null;
let unsubscribeRoom = null;
let rafId = null;
let lastTimestamp = 0;
let accumulator = 0;
let draftAutoAccum = 0;
let scheduleTickAccum = 0;
const handledRemoteCallIds = new Set();
const FIXED_DT = 1 / 60;

/**
 * 현재 방 상태를 버전업하고 원격/로컬 탭으로 동기화한다.
 */
async function commitAndSync() {
  appState.version = Number(appState.version || 1) + 1;
  saveLocalLeagueState(appState);
  renderHUD(appState);
  if (appState.roomCode) {
    await syncRoomState(appState);
  }
}

/**
 * 룸 코드 실시간 업데이트 구독을 재설정한다.
 * @param {string} roomCode
 */
function attachRoomSubscription(roomCode) {
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
  if (!roomCode) return;

  unsubscribeRoom = subscribeRoomUpdates(roomCode, (incomingState) => {
    const myLocalSeat = appState.localSeatIndex;
    const prevScreen = appState.screen;
    const next = cloneState(incomingState);

    // 각 브라우저 탭이 조종 중인 자기 시트 번호는 유지하되,
    // 상대방의 시트 인수(isAI false)나 리그 기록/주차 변경은 반영한다.
    if (
      typeof myLocalSeat === "number" &&
      myLocalSeat >= 0 &&
      myLocalSeat < next.seats.length &&
      prevScreen !== SCREEN_STATES.LOBBY
    ) {
      next.localSeatIndex = myLocalSeat;
    } else if (prevScreen === SCREEN_STATES.LOBBY) {
      next.localSeatIndex = myLocalSeat;
      next.screen = SCREEN_STATES.LOBBY;
    }

    // 2인 아케이드 라이브 Bo3: 동일 세트 전투 진행 중에는 상대의 전술 콜 이벤트만 반영하고 로컬 60fps 시뮬레이션은 유지
    if (
      next.roomMode === ROOM_MODES.ARCADE_2P &&
      appState.screen === SCREEN_STATES.COMBAT &&
      next.screen === SCREEN_STATES.COMBAT &&
      appState.activeSeries?.currentSet === next.activeSeries?.currentSet
    ) {
      const incomingCalls = next.activeMatch?.callEvents || [];
      let applied = false;
      if (!appState.activeMatch) appState.activeMatch = {};
      if (!Array.isArray(appState.activeMatch.callEvents)) appState.activeMatch.callEvents = [];
      for (const ev of incomingCalls) {
        if (!ev?.id || handledRemoteCallIds.has(ev.id)) continue;
        handledRemoteCallIds.add(ev.id);
        appState.activeMatch.callEvents.push(ev);
        if (triggerCoachCall(appState, ev.team, ev.callType)) {
          playSfx("CALL");
          applied = true;
        }
      }
      if (applied) {
        renderHUD(appState);
      }
      return;
    }

    // 다른 화면에서 COMBAT으로 전이 시 아직 파이터가 초기화되지 않았으면 즉시 초기화
    if (
      next.screen === SCREEN_STATES.COMBAT &&
      appState.screen !== SCREEN_STATES.COMBAT &&
      (!next.combat?.fighters || next.combat.fighters.length === 0)
    ) {
      initCombatRound(next);
    }

    appState = next;
    renderHUD(appState);
  }, appState.roomMode || ROOM_MODES.LEAGUE_6P);
}

/**
 * 60fps 메인 루프 (COMBAT 상태일 때만 물리/AI 스텝 및 Canvas 렌더 수행)
 * @param {number} timestamp
 */
function mainLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const elapsed = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;

  scheduleTickAccum += elapsed;
  if (scheduleTickAccum >= 1.0) {
    scheduleTickAccum = 0;
    if (appState.roomMode !== ROOM_MODES.ARCADE_2P) {
      const nowMs = Date.now();
      const routineTicks = tickRealTimeRoutineIfDue(appState, nowMs);
      const resolved = checkAndResolveDueMatches(appState, nowMs);
      if (resolved > 0 || routineTicks > 0) {
        saveLocalLeagueState(appState);
        renderHUD(appState);
      } else if (appState.screen === SCREEN_STATES.WEEKLY_HUB || appState.screen === SCREEN_STATES.PLAYOFF_BRACKET) {
        updateScheduleCountdownHUD(appState);
      }
    }
  }

  if (appState.screen === SCREEN_STATES.DRAFT && appState.roomMode !== ROOM_MODES.ARCADE_2P && !appState.liveOverride) {
    draftAutoAccum += elapsed;
    if (draftAutoAccum >= 0.52) {
      draftAutoAccum = 0;
      if (runCoachDraftStep(appState)) {
        playSfx("CLICK");
        saveLocalLeagueState(appState);
        renderHUD(appState);
      }
    }
  } else {
    draftAutoAccum = 0;
  }

  if (appState.screen === SCREEN_STATES.COMBAT && canvasCtx) {
    if (appState.combat.running && !appState.combat.paused) {
      const speedMult = appState.combat.speedMult || 1;
      accumulator += elapsed * speedMult;

      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 16) {
        const res = stepCombat(appState, FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
        if (res.roundEnded) {
          accumulator = 0;
          playSfx("VICTORY_FANFARE");
          break;
        }
      }
      if (Array.isArray(appState.combat.sfxQueue) && appState.combat.sfxQueue.length > 0) {
        for (const sfxType of appState.combat.sfxQueue) {
          playSfx(sfxType);
        }
        appState.combat.sfxQueue.length = 0;
      }
    }
    renderArena(canvasCtx, appState);
    renderHUD(appState);
  }

  rafId = window.requestAnimationFrame(mainLoop);
}

/**
 * 애플리케이션을 부트스트랩한다.
 */
export function initApp() {
  initAudio();
  const canvas = document.getElementById("arena-canvas");
  if (canvas) {
    canvasCtx = initRenderer(canvas);
  }

  if (appState.roomMode !== ROOM_MODES.ARCADE_2P) {
    tickRealTimeRoutineIfDue(appState, Date.now());
    checkAndResolveDueMatches(appState, Date.now());
  }
  saveLocalLeagueState(appState);

  initHUD({
    getState: () => appState,
    isSfxEnabled: () => !isAudioMuted(),

    onToggleSfx: () => {
      const nextMuted = toggleAudioMute();
      if (!nextMuted) playSfx("CARD_CLICK");
      renderHUD(appState);
    },

    onSetScheduleMode: async (mode) => {
      playSfx("CLICK");
      setScheduleMode(appState, mode, Date.now());
      await commitAndSync();
    },

    onHireCoach: async (coachId) => {
      playSfx("CALL");
      const res = hireHeadCoach(appState, appState.localSeatIndex, coachId);
      if (!res.ok) {
        showModal("감독 영입 실패", `<p>${res.message}</p>`);
        return;
      }
      await commitAndSync();
      showModal("감독 영입 계약 완료", `<p>${res.message}</p>`);
    },

    onToggleNoteChamp: async (field, champId) => {
      playSfx("CLICK");
      const seat = appState.seats[appState.localSeatIndex];
      const cur = [...(seat?.banPickNote?.[field] || [])];
      const idx = cur.indexOf(champId);
      if (idx >= 0) {
        cur.splice(idx, 1);
      } else {
        if (cur.length >= 2) cur.shift();
        cur.push(champId);
      }
      updateBanPickNote(appState, appState.localSeatIndex, { [field]: cur });
      await commitAndSync();
    },

    onUpdateBanPickNote: async (patch) => {
      playSfx("CLICK");
      updateBanPickNote(appState, appState.localSeatIndex, patch);
      await commitAndSync();
    },

    onToggleLiveOverride: () => {
      playSfx("CLICK");
      appState.liveOverride = !appState.liveOverride;
      saveLocalLeagueState(appState);
      renderHUD(appState);
    },

    onCoachDraftStep: async () => {
      playSfx("CLICK");
      if (runCoachDraftStep(appState)) {
        await commitAndSync();
      }
    },

    onCoachSelectRite: async () => {
      playSfx("CALL");
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      autoSelectCoachRiteCard(appState, myTeamSide);
      await commitAndSync();
    },

    onWatchVod: (matchId) => {
      playSfx("CALL");
      if (!startVodReplay(appState, matchId, 0)) {
        showModal("VOD 재생 불가", "<p>저장된 리플레이 데이터가 없습니다.</p>");
        return;
      }
      renderHUD(appState);
    },

    onSelectMap: async (mapId) => {
      playSfx("CLICK");
      if (mapId === "AUTO") {
        appState.preferredMapId = "AUTO";
        appState.activeSeries.selectedMapId = MAP_ORDER[0];
        appState.activeSeries.mapId = MAP_ORDER[0];
      } else {
        appState.preferredMapId = mapId;
        appState.activeSeries.selectedMapId = mapId;
        appState.activeSeries.mapId = mapId;
      }
      if (appState.roomCode && appState.screen !== SCREEN_STATES.LOBBY) {
        await commitAndSync();
      } else {
        saveLocalLeagueState(appState);
        renderHUD(appState);
      }
    },

    onCreateArcadeRoom: async () => {
      playSfx("CALL");
      const prefMap = appState.preferredMapId || "AUTO";
      appState = createInitialState("", SCHEDULE_MODES.INSTANT_TEST, ROOM_MODES.ARCADE_2P);
      appState.preferredMapId = prefMap;
      appState.localSeatIndex = 0;
      appState.seats[0].isAI = false;
      appState.seats[0].playerId = getSessionPlayerId();
      const coachInput = document.getElementById("input-coach-name")?.value?.trim();
      if (coachInput) {
        appState.seats[0].gmName = coachInput;
        appState.seats[0].coachName = coachInput;
      }

      const { roomCode, mode } = await createRoom(appState);
      appState.roomCode = roomCode;
      appState.screen = SCREEN_STATES.ARCADE_LOBBY;
      saveLocalLeagueState(appState);
      attachRoomSubscription(roomCode);
      renderHUD(appState);
      showModal(
        "⚔️ 2인 아케이드 라이브 방 생성",
        `<p>4자리 룸 코드: <strong style="font-size:18px;color:#fcd34d;">${roomCode}</strong></p>
         <p>모드: <strong>2인 아케이드 라이브 (즉시 Bo3)</strong> · 연결: <strong>${mode}</strong></p>
         <p class="muted-text">친구가 다른 탭/기기에서 코드를 입력해 <strong>RED TEAM</strong>으로 입장하거나, 곧바로 AI 라이벌과 즉시 Bo3를 시작할 수 있습니다.</p>`
      );
    },

    onCreateRoom: async () => {
      const selectedMode = appState.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
      const prefMap = appState.preferredMapId || "AUTO";
      appState = createInitialState("", selectedMode, ROOM_MODES.LEAGUE_6P);
      appState.preferredMapId = prefMap;
      appState.localSeatIndex = 0;
      appState.seats[0].isAI = false;
      appState.seats[0].playerId = getSessionPlayerId();
      const coachInput = document.getElementById("input-coach-name")?.value?.trim();
      if (coachInput) appState.seats[0].gmName = coachInput;

      const { roomCode, mode } = await createRoom(appState);
      appState.roomCode = roomCode;
      appState.screen = SCREEN_STATES.WEEKLY_HUB;
      saveLocalLeagueState(appState);
      attachRoomSubscription(roomCode);
      renderHUD(appState);
      showModal(
        "리그 방 생성 완료",
        `<p>4자리 룸 코드: <strong style="font-size:18px;color:#fcd34d;">${roomCode}</strong></p>
         <p>연결 모드: <strong>${mode}</strong> · 스케줄: <strong>${selectedMode}</strong></p>
         <p class="muted-text">다른 브라우저 탭에서 이 코드를 입력하면 AI 구단 시트를 즉시 인수해 합류할 수 있습니다.</p>`
      );
    },

    onJoinRoom: async (roomCode, coachName) => {
      const res = await joinRoom(roomCode, null, coachName);
      if (!res.ok || !res.state) {
        showModal("방 참여 실패", `<p>${res.error || "룸 코드를 확인해 주세요."}</p>`);
        return;
      }

      appState = res.state;
      appState.localSeatIndex = res.assignedSeat;
      if (appState.screen === SCREEN_STATES.LOBBY) {
        appState.screen = appState.roomMode === ROOM_MODES.ARCADE_2P
          ? SCREEN_STATES.ARCADE_LOBBY
          : SCREEN_STATES.WEEKLY_HUB;
      }
      if (
        appState.screen === SCREEN_STATES.COMBAT &&
        (!appState.combat?.fighters || appState.combat.fighters.length === 0)
      ) {
        initCombatRound(appState);
      }
      saveLocalLeagueState(appState);
      attachRoomSubscription(appState.roomCode);
      renderHUD(appState);
      const teamName = appState.seats[res.assignedSeat]?.teamName || "구단";
      const modeBadge = (res.roomMode || appState.roomMode) === ROOM_MODES.ARCADE_2P
        ? "⚔️ 2인 아케이드 라이브 Bo3"
        : "🏆 6구단 데일리 리그";
      showModal(
        "시트 인수 및 참여 완료",
        `<p>모드: <strong>${modeBadge}</strong></p>
         <p><strong>${teamName}</strong> (시트 #${res.assignedSeat + 1}) 감독으로 합류했습니다!</p>
         <p>연결 모드: <strong>${res.mode}</strong></p>`
      );
    },

    onTakeOverSeat: async (seatIndex, coachName) => {
      if (!appState.roomCode) {
        await createRoom(appState);
        attachRoomSubscription(appState.roomCode);
      }
      appState = await claimSeat(appState, seatIndex, coachName);
      if (appState.screen === SCREEN_STATES.LOBBY) {
        appState.screen = SCREEN_STATES.WEEKLY_HUB;
      }
      renderHUD(appState);
    },

    onConfigureNeon: (connStr) => {
      const ok = configureNeon(connStr);
      if (appState.roomCode) {
        attachRoomSubscription(appState.roomCode);
      }
      renderHUD(appState);
      showModal(
        "DB 연결 모드 변경",
        ok
          ? `<p>🟢 Neon Serverless Postgres 모드가 활성화되었습니다. (모드: <strong>${getNetworkMode()}</strong>)</p>`
          : `<p>🟡 로컬 멀티탭 모드(BroadcastChannel + localStorage)로 전환되었습니다.</p>`
      );
    },

    onTestNeon: async (connStr) => {
      return testNeonConnection(connStr);
    },

    onVodSelectSet: (setIdx) => {
      playSfx("CARD_CLICK");
      const matchId = appState.activeSeries?.replayMatchId || appState.activeSeries?.matchId;
      if (matchId && startVodReplay(appState, matchId, setIdx)) {
        renderHUD(appState);
      }
    },

    onVodSkipHighlight: () => {
      playSfx("COACH_CALL");
      const res = fastForwardToNextHighlight(appState, 600);
      if (res.roundEnded) {
        playSfx("VICTORY_FANFARE");
      } else if (res.hit === "COUNTER") {
        playSfx("COUNTER_PARRY");
      } else if (res.hit === "ORB") {
        playSfx("ORB_SHATTER");
      } else if (res.hit === "KILL") {
        playSfx("HIT_IMPACT");
      }
      renderHUD(appState);
    },

    onStartQuickExhibition: () => {
      playSfx("CALL");
      appState.activeSeries.seriesMode = "EXHIBITION";
      appState.activeSeries.bestOf = 1;
      appState.activeSeries.currentSet = 1;
      appState.activeSeries.blueWins = 0;
      appState.activeSeries.redWins = 0;
      appState.activeSeries.blueRites = [];
      appState.activeSeries.redRites = [];
      if (appState.preferredMapId && appState.preferredMapId !== "AUTO") {
        appState.activeSeries.mapId = appState.preferredMapId;
      } else {
        appState.activeSeries.mapId = appState.activeSeries.selectedMapId || MAP_ORDER[0];
      }
      shuffleRandomComp(appState);
      initCombatRound(appState);
      appState.screen = SCREEN_STATES.COMBAT;
      renderHUD(appState);
    },

    onGoHub: () => {
      appState.combat.running = false;
      appState.screen = appState.roomMode === ROOM_MODES.ARCADE_2P
        ? SCREEN_STATES.ARCADE_LOBBY
        : (appState.playoffs?.active ? SCREEN_STATES.PLAYOFF_BRACKET : SCREEN_STATES.WEEKLY_HUB);
      renderHUD(appState);
    },

    onArcadeReroll: async () => {
      playSfx("CARD_CLICK");
      rerollArcadeRoster(appState, appState.localSeatIndex);
      await commitAndSync();
    },

    onArcadeToggleReady: async () => {
      playSfx("COACH_CALL");
      toggleArcadeReady(appState, appState.localSeatIndex);
      await commitAndSync();
    },

    onArcadeStartVsAI: async () => {
      playSfx("CALL");
      startArcadeVsAI(appState);
      await commitAndSync();
    },

    onArcadeSwapAssign: async (idxA, idxB) => {
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      if (swapArcadeDraftAssignment(appState, myTeamSide, idxA, idxB)) {
        playSfx("CARD_CLICK");
        await commitAndSync();
      }
    },

    onArcadeConfirmAssign: async () => {
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      playSfx("CALL");
      confirmArcadePlayerAssignment(appState, myTeamSide);
      await commitAndSync();
    },

    onArcadeRematch: async () => {
      playSfx("COACH_CALL");
      rematchArcadeSwapSides(appState);
      await commitAndSync();
    },

    onExitToLobby: () => {
      playSfx("CLICK");
      if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
      }
      appState.combat.running = false;
      appState.screen = SCREEN_STATES.LOBBY;
      saveLocalLeagueState(appState);
      renderHUD(appState);
    },

    onWeeklyAction: async (actionType, payload) => {
      const result = executeWeeklyAction(appState, appState.localSeatIndex, actionType, payload);
      if (!result.ok) {
        showModal("행동 불가", `<p>${result.message}</p>`);
        return;
      }
      await commitAndSync();
      showModal("구단 운영 결과", `<p>${result.message}</p>`);
    },

    onStartRoundMatch: async () => {
      startPlayerMatchOrSimWeek(appState);
      await commitAndSync();
    },

    onQuickSimRound: async () => {
      quickSimulateFullRound(appState);
      await commitAndSync();
    },

    onDraftSelectChamp: async (champId) => {
      playSfx("CLICK");
      advanceDraftStep(appState, champId);
      await commitAndSync();
    },

    onTriggerCoachCall: (callType) => {
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      if (triggerCoachCall(appState, myTeamSide, callType)) {
        playSfx("CALL");
        if (appState.roomMode === ROOM_MODES.ARCADE_2P && appState.roomCode) {
          if (!appState.activeMatch) appState.activeMatch = {};
          if (!Array.isArray(appState.activeMatch.callEvents)) appState.activeMatch.callEvents = [];
          const ev = {
            id: `${myTeamSide}_${callType}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            team: myTeamSide,
            callType
          };
          handledRemoteCallIds.add(ev.id);
          appState.activeMatch.callEvents.push(ev);
          if (appState.activeMatch.callEvents.length > 24) {
            appState.activeMatch.callEvents.shift();
          }
          appState.version = Number(appState.version || 1) + 1;
          syncRoomState(appState).catch(() => {});
        }
      }
      renderHUD(appState);
    },

    onToggleSpeed: () => {
      playSfx("CLICK");
      const cur = appState.combat.speedMult || 1;
      appState.combat.speedMult = cur === 1 ? 2 : cur === 2 ? 4 : 1;
      renderHUD(appState);
    },

    onTogglePause: () => {
      playSfx("CLICK");
      appState.combat.paused = !appState.combat.paused;
      renderHUD(appState);
    },

    onNextSetOrContinue: async (winnerTeam) => {
      playSfx("CLICK");
      recordSetWinAndProceed(appState, winnerTeam);
      await commitAndSync();
    },

    onShuffleExhibition: () => {
      playSfx("CALL");
      if (!appState.preferredMapId || appState.preferredMapId === "AUTO") {
        const idx = MAP_ORDER.indexOf(appState.activeSeries.mapId);
        appState.activeSeries.mapId = MAP_ORDER[(idx + 1) % MAP_ORDER.length];
      } else {
        appState.activeSeries.mapId = appState.preferredMapId;
      }
      shuffleRandomComp(appState);
      initCombatRound(appState);
      renderHUD(appState);
    },

    onSelectRiteCard: async (riteId) => {
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      selectRiteCard(appState, myTeamSide, riteId);
      await commitAndSync();
    },

    onPlayoffNextMatch: async () => {
      startPlayerMatchOrSimWeek(appState);
      await commitAndSync();
    },

    onPlayoffQuickSim: async () => {
      quickSimulateFullRound(appState);
      await commitAndSync();
    },

    onNewSeason: async () => {
      const prevCode = appState.roomCode;
      const prevLocal = appState.localSeatIndex;
      const prevCoach = appState.seats[prevLocal]?.coachName || "Host Coach";
      appState = createInitialState(prevCode);
      appState.localSeatIndex = prevLocal;
      if (appState.seats[prevLocal]) {
        appState.seats[prevLocal].isAI = false;
        appState.seats[prevLocal].coachName = prevCoach;
      }
      appState.screen = SCREEN_STATES.WEEKLY_HUB;
      await commitAndSync();
    },

    onUpdateRoutine: async (slotKey, activityKey, focusStat) => {
      playSfx("CLICK");
      updateAutoSchedule(appState, appState.localSeatIndex, slotKey, activityKey, focusStat);
      await commitAndSync();
    },

    onUpgradeFacility: async (facilityKey) => {
      const res = upgradeFacility(appState, appState.localSeatIndex, facilityKey);
      if (!res.ok) {
        showModal("시설 증축 불가", `<p>${res.message}</p>`);
        return;
      }
      playSfx("CALL");
      await commitAndSync();
    },

    onSelectSponsor: async (sponsorId) => {
      const res = selectSponsorContract(appState, appState.localSeatIndex, sponsorId);
      if (res.ok) playSfx("CLICK");
      await commitAndSync();
    },

    onSignStoveRookie: async (rookieIndex) => {
      const res = signStoveRookie(appState, appState.localSeatIndex, rookieIndex);
      if (!res.ok) {
        showModal("신인 계약 불가", `<p>${res.message}</p>`);
        return;
      }
      playSfx("CALL");
      await commitAndSync();
    },

    onStartNextSeason: async () => {
      playSfx("WIN");
      startNextSeason(appState);
      await commitAndSync();
    }
  });

  renderHUD(appState);

  if (appState.roomCode) {
    attachRoomSubscription(appState.roomCode);
    restoreSessionIfPossible(appState).then((restored) => {
      if (restored && restored.seats) {
        appState = restored;
        saveLocalLeagueState(appState);
        renderHUD(appState);
      }
    }).catch(() => {});
  }

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }
  rafId = window.requestAnimationFrame(mainLoop);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
