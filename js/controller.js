// js/controller.js
// 메인 requestAnimationFrame 루프, 화면 상태 머신, 사용자 액션 디스패치, DOM/네트워크 연결 모듈

import { SCREEN_STATES, createInitialState, cloneState } from "./state.js";
import {
  initCombatRound,
  stepCombat,
  triggerCoachCall,
  shuffleRandomComp
} from "./engine.js";
import {
  executeWeeklyAction,
  startPlayerMatchOrSimWeek,
  quickSimulateFullRound,
  advanceDraftStep,
  selectRiteCard,
  recordSetWinAndProceed
} from "./league.js";
import {
  configureNeon,
  getNetworkMode,
  createRoom,
  joinRoom,
  claimSeat,
  syncRoomState,
  subscribeRoomUpdates
} from "./network.js";
import { initRenderer, renderArena } from "./renderer.js";
import { initHUD, renderHUD, showModal } from "./hud.js";

let appState = createInitialState();
let canvasCtx = null;
let unsubscribeRoom = null;
let rafId = null;
let lastTimestamp = 0;
let accumulator = 0;
const FIXED_DT = 1 / 60;

/**
 * 현재 방 상태를 버전업하고 원격/로컬 탭으로 동기화한다.
 */
async function commitAndSync() {
  appState.version = Number(appState.version || 1) + 1;
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

    appState = next;
    renderHUD(appState);
  });
}

/**
 * 60fps 메인 루프 (COMBAT 상태일 때만 물리/AI 스텝 및 Canvas 렌더 수행)
 * @param {number} timestamp
 */
function mainLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const elapsed = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;

  if (appState.screen === SCREEN_STATES.COMBAT && canvasCtx) {
    if (appState.combat.running && !appState.combat.paused) {
      const speedMult = appState.combat.speedMult || 1;
      accumulator += elapsed * speedMult;

      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 6) {
        const res = stepCombat(appState, FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
        if (res.roundEnded) {
          accumulator = 0;
          break;
        }
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
  const canvas = document.getElementById("arena-canvas");
  if (canvas) {
    canvasCtx = initRenderer(canvas);
  }

  initHUD({
    getState: () => appState,

    onCreateRoom: async () => {
      appState = createInitialState();
      appState.localSeatIndex = 0;
      appState.seats[0].isAI = false;
      const coachInput = document.getElementById("input-coach-name")?.value?.trim();
      if (coachInput) appState.seats[0].coachName = coachInput;

      const { roomCode, mode } = await createRoom(appState);
      appState.roomCode = roomCode;
      appState.screen = SCREEN_STATES.WEEKLY_HUB;
      attachRoomSubscription(roomCode);
      renderHUD(appState);
      showModal(
        "리그 방 생성 완료",
        `<p>4자리 룸 코드: <strong style="font-size:18px;color:#fcd34d;">${roomCode}</strong></p>
         <p>연결 모드: <strong>${mode}</strong></p>
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
        appState.screen = SCREEN_STATES.WEEKLY_HUB;
      }
      attachRoomSubscription(appState.roomCode);
      renderHUD(appState);
      const teamName = appState.seats[res.assignedSeat]?.teamName || "구단";
      showModal(
        "시트 인수 및 참여 완료",
        `<p><strong>${teamName}</strong> (시트 #${res.assignedSeat + 1}) 감독으로 합류했습니다!</p>
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
      renderHUD(appState);
      showModal(
        "DB 연결 모드 변경",
        ok
          ? `<p>Neon Serverless Postgres 모드가 활성화되었습니다. (모드: <strong>${getNetworkMode()}</strong>)</p>`
          : `<p>로컬 멀티탭 모드(BroadcastChannel + localStorage)로 전환되었습니다.</p>`
      );
    },

    onStartQuickExhibition: () => {
      appState.activeSeries.seriesMode = "EXHIBITION";
      appState.activeSeries.bestOf = 1;
      appState.activeSeries.currentSet = 1;
      appState.activeSeries.blueWins = 0;
      appState.activeSeries.redWins = 0;
      appState.activeSeries.blueRites = [];
      appState.activeSeries.redRites = [];
      shuffleRandomComp(appState);
      initCombatRound(appState);
      appState.screen = SCREEN_STATES.COMBAT;
      renderHUD(appState);
    },

    onGoHub: () => {
      appState.combat.running = false;
      appState.screen = appState.playoffs?.active
        ? SCREEN_STATES.PLAYOFF_BRACKET
        : SCREEN_STATES.WEEKLY_HUB;
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
      advanceDraftStep(appState, champId);
      await commitAndSync();
    },

    onTriggerCoachCall: (callType) => {
      const series = appState.activeSeries;
      const myTeamSide = series.redSeat === appState.localSeatIndex ? "red" : "blue";
      triggerCoachCall(appState, myTeamSide, callType);
      renderHUD(appState);
    },

    onToggleSpeed: () => {
      appState.combat.speedMult = appState.combat.speedMult === 1 ? 2 : 1;
      renderHUD(appState);
    },

    onTogglePause: () => {
      appState.combat.paused = !appState.combat.paused;
      renderHUD(appState);
    },

    onNextSetOrContinue: async (winnerTeam) => {
      recordSetWinAndProceed(appState, winnerTeam);
      await commitAndSync();
    },

    onShuffleExhibition: () => {
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
    }
  });

  renderHUD(appState);

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
