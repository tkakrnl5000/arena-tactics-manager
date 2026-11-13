// js/hud.js
// 순수 DOM UI 렌더링 모듈 (물리/전투 계산 금지, 상태 읽기 및 콜백 전달만 수행)
// 다크 택티컬 e스포츠 방송 스타일 HUD

import {
  SCREEN_STATES,
  CHAMPIONS,
  TRAITS,
  COACH_CALLS,
  getChampionById,
  getRiteById
} from "./state.js";
import { DRAFT_SEQUENCE, getStandings } from "./league.js";
import { getNetworkMode } from "./network.js";

let hudCallbacks = {};
let activeHubTab = "STANDINGS";
let lastRenderedNonCombatSig = "";
let lastRoundEndShown = null;
let toastTimer = null;

// 주요 DOM 요소 캐시
const dom = {};

function cacheDom() {
  const ids = [
    "top-week-badge",
    "top-patch-badge",
    "top-room-badge",
    "top-net-badge",
    "btn-go-hub",
    "btn-create-room",
    "input-room-code",
    "input-coach-name",
    "btn-join-room",
    "btn-quick-exhibition",
    "btn-open-neon-modal",
    "btn-copy-room",
    "lobby-room-status",
    "lobby-seats-list",
    "hub-club-banner",
    "hub-tabs",
    "hub-tab-content",
    "btn-start-round-match",
    "btn-quick-sim-week",
    "btn-open-seats-modal",
    "draft-series-title",
    "draft-phase-banner",
    "draft-blue-slots",
    "draft-red-slots",
    "draft-champ-grid",
    "draft-hint-bar",
    "combat-scoreboard",
    "combat-rites-strip",
    "btn-speed-toggle",
    "btn-pause-combat",
    "call-banner",
    "round-end-overlay",
    "blue-team-bars",
    "red-team-bars",
    "ticker-list",
    "bottom-tactical-bar",
    "rite-series-header",
    "rite-cards-list",
    "rite-equipped-summary",
    "playoff-header",
    "playoff-tree-container",
    "btn-playoff-next-match",
    "btn-playoff-quick-sim",
    "btn-new-season",
    "app-modal",
    "modal-title",
    "modal-close-btn",
    "modal-body",
    "hud-toast"
  ];
  for (const id of ids) {
    dom[id] = document.getElementById(id);
  }
  dom.screens = Array.from(document.querySelectorAll(".screen"));
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * 구단명에서 중계용 3글자 약칭을 만든다. 예) "서울 노바 (Seoul Nova)" → "SNO"
 */
function teamAbbr(teamName) {
  const raw = String(teamName || "TEAM");
  const m = raw.match(/\(([^)]+)\)/);
  const words = (m ? m[1] : raw).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
  }
  return (words[0] || "TEAM").slice(0, 3).toUpperCase();
}

function shortTeamName(teamName) {
  return String(teamName || "").split(" (")[0];
}

/**
 * 6개 역할군 인라인 SVG 아이콘
 */
function getRoleSvg(role, color = "#38BDF8", size = 13) {
  let inner = "";
  switch (role) {
    case "MELEE":
      inner = `<path d="M5 19L19 5M14 5h5v5M7 13l4 4" stroke="${color}" stroke-width="2.2" stroke-linecap="square"/>`;
      break;
    case "RANGED":
      inner = `<circle cx="12" cy="12" r="6" stroke="${color}" stroke-width="2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="${color}" stroke-width="2"/><rect x="11" y="11" width="2" height="2" fill="${color}"/>`;
      break;
    case "TANK":
      inner = `<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>`;
      break;
    case "ASSASSIN":
      inner = `<path d="M6 6l12 12M18 6L6 18" stroke="${color}" stroke-width="2.2" stroke-linecap="square"/>`;
      break;
    case "SUPPORT":
      inner = `<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.6"/>`;
      break;
    case "MAGE":
    default:
      inner = `<polygon points="12,3 19,11 12,21 5,11" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>`;
      break;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">${inner}</svg>`;
}

function getCategorySvg(category) {
  if (category === "OFFENSE") return getRoleSvg("MELEE", "#F43F5E", 16);
  if (category === "DEFENSE") return getRoleSvg("TANK", "#38BDF8", 16);
  return getRoleSvg("SUPPORT", "#F59E0B", 16);
}

function getMasteryRankBadge(level) {
  const lv = Number(level || 1);
  const rank = lv >= 4 ? "S" : lv === 3 ? "A" : lv === 2 ? "B" : "C";
  return `<span class="rank-badge rank-${rank}">${rank}</span>`;
}

function showToast(message) {
  if (!dom["hud-toast"]) return;
  dom["hud-toast"].textContent = message;
  dom["hud-toast"].classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom["hud-toast"]?.classList.remove("show"), 1600);
}

/**
 * 4자리 방 코드를 클립보드에 복사한다.
 */
function copyRoomCode() {
  const state = hudCallbacks.getState ? hudCallbacks.getState() : null;
  const code = state?.roomCode;
  if (!code) {
    showToast("먼저 방을 생성하거나 참여하세요");
    return;
  }
  const done = () => showToast(`방 코드 ${code} 복사 완료`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(done, () => showToast(`방 코드: ${code}`));
  } else {
    showToast(`방 코드: ${code}`);
  }
}

/**
 * 공용 모달을 연다.
 */
export function showModal(title, htmlContent) {
  if (!dom["app-modal"]) return;
  dom["modal-title"].textContent = title;
  dom["modal-body"].innerHTML = htmlContent;
  dom["app-modal"].classList.remove("hidden");
}

/**
 * 공용 모달을 닫는다.
 */
export function hideModal() {
  if (!dom["app-modal"]) return;
  dom["app-modal"].classList.add("hidden");
}

function renderSeatRow(state, seat, labels) {
  const isLocal = seat.seatIndex === state.localSeatIndex;
  const statusBadge = seat.isAI
    ? `<span class="seat-badge badge-ai">AI</span>`
    : `<span class="seat-badge badge-human">HUMAN · ${escapeHtml(seat.coachName)}</span>`;
  const actionBtn = isLocal
    ? `<span class="seat-self-tag">${labels.self}</span>`
    : `<button class="btn ${seat.isAI ? "btn-accent" : "btn-ghost"} btn-sm" data-takeover-seat="${seat.seatIndex}" type="button">${seat.isAI ? "AI 난입 인수" : "전환"}</button>`;
  return `
    <div class="seat-row ${isLocal ? "is-local" : ""} ${seat.isAI ? "is-ai" : "is-human"}">
      <div class="seat-info">
        <span class="seat-dot" style="background:${seat.teamColor}"></span>
        <span class="seat-abbr">${teamAbbr(seat.teamName)}</span>
        <div class="seat-name-wrap">
          <div class="seat-team-name">${escapeHtml(shortTeamName(seat.teamName))}</div>
          <div class="seat-coach-meta"><span class="num">${seat.wins}W ${seat.losses}L</span> · ${statusBadge}</div>
        </div>
      </div>
      ${actionBtn}
    </div>
  `;
}

function openSeatsModal(state) {
  const rows = state.seats.map((seat) => renderSeatRow(state, seat, { self: "내 구단" })).join("");
  const html = `
    <div class="room-code-panel">
      <div>
        <div class="muted-text">ROOM CODE · ${getNetworkMode()}</div>
        <div class="room-code-digits num">${escapeHtml(state.roomCode || "----")}</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-copy-room="1" type="button">코드 복사</button>
    </div>
    <div class="muted-text">다른 브라우저 탭에서 이 코드로 참여해 AI 구단을 인수할 수 있습니다.</div>
    <div class="seats-list-static">${rows}</div>
    <button class="btn btn-ghost btn-sm" id="modal-open-neon-btn" type="button">Neon Postgres 연결 설정</button>
  `;
  showModal("구단 시트 · 멀티플레이", html);
}

function openNeonConfigModal() {
  let saved = "";
  try {
    saved = localStorage.getItem("atm_neon_config") || "";
  } catch {
    saved = "";
  }
  const html = `
    <p class="muted-text" style="margin:0;">
      Neon Serverless Postgres 연결 문자열(<code>postgresql://...</code>) 또는 HTTP SQL 엔드포인트(<code>https://.../sql</code>)를 입력하면 클라우드 DB로 동기화됩니다. 비워두면 로컬(BroadcastChannel + localStorage) 모드로 동작합니다.
    </p>
    <input id="modal-neon-input" class="input-field" type="text" placeholder="postgresql://user:pass@host/db?sslmode=require" value="${escapeHtml(saved)}" />
    <div style="display:flex;gap:6px;">
      <button id="modal-neon-save" class="btn btn-primary flex-1" type="button">저장 및 적용</button>
      <button id="modal-neon-clear" class="btn btn-ghost" type="button">로컬 모드</button>
    </div>
  `;
  showModal("Neon DB 연동 설정", html);
}

/**
 * HUD 이벤트 리스너를 초기화한다.
 * @param {object} callbacks
 */
export function initHUD(callbacks) {
  hudCallbacks = callbacks || {};
  cacheDom();

  dom["modal-close-btn"]?.addEventListener("click", hideModal);
  dom["app-modal"]?.addEventListener("click", (e) => {
    if (e.target === dom["app-modal"]) hideModal();
  });

  dom["modal-body"]?.addEventListener("click", (e) => {
    const takeoverBtn = e.target.closest("[data-takeover-seat]");
    if (takeoverBtn) {
      const seatIndex = Number(takeoverBtn.dataset.takeoverSeat);
      const coachInput = dom["input-coach-name"]?.value?.trim() || "Human Coach";
      hideModal();
      hudCallbacks.onTakeOverSeat?.(seatIndex, coachInput);
      return;
    }
    if (e.target.closest("[data-copy-room]")) {
      copyRoomCode();
      return;
    }
    if (e.target.id === "modal-open-neon-btn") {
      openNeonConfigModal();
      return;
    }
    if (e.target.id === "modal-neon-save") {
      const val = document.getElementById("modal-neon-input")?.value || "";
      hudCallbacks.onConfigureNeon?.(val);
      hideModal();
      return;
    }
    if (e.target.id === "modal-neon-clear") {
      hudCallbacks.onConfigureNeon?.("");
      hideModal();
    }
  });

  dom["top-room-badge"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openSeatsModal(hudCallbacks.getState());
  });
  dom["btn-go-hub"]?.addEventListener("click", () => hudCallbacks.onGoHub?.());
  dom["btn-copy-room"]?.addEventListener("click", copyRoomCode);

  dom["btn-create-room"]?.addEventListener("click", () => hudCallbacks.onCreateRoom?.());
  dom["btn-join-room"]?.addEventListener("click", () => {
    const code = dom["input-room-code"]?.value?.trim() || "";
    const coach = dom["input-coach-name"]?.value?.trim() || "Human Coach";
    hudCallbacks.onJoinRoom?.(code, coach);
  });
  dom["btn-quick-exhibition"]?.addEventListener("click", () => hudCallbacks.onStartQuickExhibition?.());
  dom["btn-open-neon-modal"]?.addEventListener("click", openNeonConfigModal);

  dom["lobby-seats-list"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-takeover-seat]");
    if (!btn) return;
    const seatIndex = Number(btn.dataset.takeoverSeat);
    const coach = dom["input-coach-name"]?.value?.trim() || "Human Coach";
    hudCallbacks.onTakeOverSeat?.(seatIndex, coach);
  });

  dom["hub-tabs"]?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-hub-tab]");
    if (!tabBtn) return;
    activeHubTab = tabBtn.dataset.hubTab;
    for (const el of dom["hub-tabs"].querySelectorAll(".hub-tab")) {
      el.classList.toggle("active", el.dataset.hubTab === activeHubTab);
    }
    lastRenderedNonCombatSig = "";
    if (hudCallbacks.getState) renderHUD(hudCallbacks.getState());
  });

  dom["hub-tab-content"]?.addEventListener("click", (e) => {
    const trainBtn = e.target.closest("[data-action-train]");
    if (trainBtn) {
      hudCallbacks.onWeeklyAction?.("TRAIN", { playerIndex: Number(trainBtn.dataset.actionTrain) });
      return;
    }
    if (e.target.closest("[data-action-scrim]")) {
      hudCallbacks.onWeeklyAction?.("SCRIM", {});
      return;
    }
    if (e.target.closest("[data-action-rest]")) {
      hudCallbacks.onWeeklyAction?.("REST", {});
      return;
    }
    const faBtn = e.target.closest("[data-action-fa]");
    if (faBtn) {
      hudCallbacks.onWeeklyAction?.("SCOUT_FA", { faIndex: Number(faBtn.dataset.actionFa) });
      return;
    }
    const swapBtn = e.target.closest("[data-action-swap]");
    if (swapBtn) {
      hudCallbacks.onWeeklyAction?.("SWAP_STARTER", { starterIndex: Number(swapBtn.dataset.actionSwap) });
    }
  });

  dom["btn-start-round-match"]?.addEventListener("click", () => hudCallbacks.onStartRoundMatch?.());
  dom["btn-quick-sim-week"]?.addEventListener("click", () => hudCallbacks.onQuickSimRound?.());
  dom["btn-open-seats-modal"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openSeatsModal(hudCallbacks.getState());
  });

  dom["draft-champ-grid"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-champ-id]");
    if (!btn || btn.disabled) return;
    hudCallbacks.onDraftSelectChamp?.(btn.dataset.champId);
  });

  dom["btn-speed-toggle"]?.addEventListener("click", () => hudCallbacks.onToggleSpeed?.());
  dom["btn-pause-combat"]?.addEventListener("click", () => hudCallbacks.onTogglePause?.());
  dom["bottom-tactical-bar"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-call]");
    if (!btn || btn.disabled) return;
    hudCallbacks.onTriggerCoachCall?.(btn.dataset.call);
  });

  dom["round-end-overlay"]?.addEventListener("click", (e) => {
    const nextBtn = e.target.closest("[data-round-next]");
    if (nextBtn) {
      hudCallbacks.onNextSetOrContinue?.(nextBtn.dataset.roundNext);
      return;
    }
    if (e.target.closest("[data-exhibition-shuffle]")) {
      hudCallbacks.onShuffleExhibition?.();
      return;
    }
    if (e.target.closest("[data-back-hub]")) {
      hudCallbacks.onGoHub?.();
    }
  });

  dom["rite-cards-list"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rite-id]");
    if (!btn) return;
    hudCallbacks.onSelectRiteCard?.(btn.dataset.riteId);
  });

  dom["btn-playoff-next-match"]?.addEventListener("click", () => hudCallbacks.onPlayoffNextMatch?.());
  dom["btn-playoff-quick-sim"]?.addEventListener("click", () => hudCallbacks.onPlayoffQuickSim?.());
  dom["btn-new-season"]?.addEventListener("click", () => hudCallbacks.onNewSeason?.());
}

/**
 * 전체 HUD를 현재 게임 상태에 맞춰 갱신한다.
 * @param {object} state
 */
export function renderHUD(state) {
  if (!state || !dom.screens) return;

  const netMode = getNetworkMode();
  dom["top-week-badge"].textContent = state.playoffs?.active
    ? "PLAYOFFS Bo5"
    : state.screen === SCREEN_STATES.LOBBY
      ? "LOBBY"
      : `WEEK ${state.week}/${state.maxWeeks}`;
  dom["top-patch-badge"].textContent = `PATCH ${state.patchVersion}`;
  dom["top-room-badge"].textContent = `ROOM ${state.roomCode || "----"}`;
  dom["top-net-badge"].textContent = netMode;
  dom["top-net-badge"].className = `pill ${netMode === "NEON" ? "pill-neon" : "pill-local"}`;

  const showGoHub = state.screen !== SCREEN_STATES.LOBBY && state.screen !== SCREEN_STATES.WEEKLY_HUB;
  dom["btn-go-hub"].classList.toggle("hidden", !showGoHub);

  for (const scr of dom.screens) {
    scr.classList.toggle("active", scr.dataset.screen === state.screen);
  }

  if (state.screen === SCREEN_STATES.COMBAT) {
    renderCombatHUD(state);
    return;
  }

  const sig = JSON.stringify({
    screen: state.screen,
    version: state.version,
    tab: activeHubTab,
    week: state.week,
    room: state.roomCode,
    localSeat: state.localSeatIndex,
    seatsAI: state.seats.map((s) => (s.isAI ? 1 : 0)).join(""),
    ap: state.seats[state.localSeatIndex]?.ap,
    funds: state.seats[state.localSeatIndex]?.funds,
    draftStep: state.activeSeries?.draft?.stepIndex,
    riteLen: state.activeSeries?.riteOptions?.length,
    poRound: state.playoffs?.round,
    poChamp: state.playoffs?.championSeat,
    rosterSig: state.seats[state.localSeatIndex]?.roster
      ?.map((p) => `${p.playerId}:${p.condition}:${p.stats.mechanics}`)
      .join(",")
  });
  if (sig === lastRenderedNonCombatSig) return;
  lastRenderedNonCombatSig = sig;

  if (state.screen === SCREEN_STATES.LOBBY) renderLobbyScreen(state);
  else if (state.screen === SCREEN_STATES.WEEKLY_HUB) renderWeeklyHub(state);
  else if (state.screen === SCREEN_STATES.DRAFT) renderDraftScreen(state);
  else if (state.screen === SCREEN_STATES.RITE_DRAFT) renderRiteDraftScreen(state);
  else if (state.screen === SCREEN_STATES.PLAYOFF_BRACKET) renderPlayoffScreen(state);
}

export const updateHUD = renderHUD;

function renderLobbyScreen(state) {
  dom["lobby-room-status"].textContent = state.roomCode
    ? `ROOM ${state.roomCode} · SEAT #${state.localSeatIndex + 1}`
    : "방 대기 중";
  dom["lobby-seats-list"].innerHTML = state.seats
    .map((seat) => renderSeatRow(state, seat, { self: "조종 중" }))
    .join("");
}

function renderWeeklyHub(state) {
  const mySeat = state.seats[state.localSeatIndex] || state.seats[0];
  const weekObj = state.schedule.find((w) => w.week === state.week);
  const myMatch = weekObj?.matches.find(
    (m) => m.homeSeat === mySeat.seatIndex || m.awaySeat === mySeat.seatIndex
  );
  let nextOpponentText = "정규시즌 종료";
  if (state.playoffs?.active) {
    nextOpponentText = "TOP-4 Bo5 플레이오프 진행 중";
  } else if (myMatch) {
    const oppSeatIdx = myMatch.homeSeat === mySeat.seatIndex ? myMatch.awaySeat : myMatch.homeSeat;
    const oppSeat = state.seats[oppSeatIdx];
    nextOpponentText = myMatch.completed
      ? `이번 주 완료 ${myMatch.homeSets}:${myMatch.awaySets}`
      : `NEXT vs ${teamAbbr(oppSeat?.teamName)} · ${shortTeamName(oppSeat?.teamName)} (Bo3)`;
  }
  const diff = mySeat.setWins - mySeat.setLosses;
  const apPips = Array.from({ length: mySeat.maxAp }, (_, i) => `<i class="ap-pip ${i < mySeat.ap ? "on" : ""}"></i>`).join("");

  dom["hub-club-banner"].innerHTML = `
    <div class="hub-banner-top">
      <div class="hub-team-id">
        <span class="team-abbr-chip" style="border-color:${mySeat.teamColor};color:${mySeat.teamColor}">${teamAbbr(mySeat.teamName)}</span>
        <div class="hub-team-title">${escapeHtml(shortTeamName(mySeat.teamName))}</div>
      </div>
      <div class="hub-ap-pill">AP ${apPips}</div>
    </div>
    <div class="hub-stat-strip num">
      <div><span>W-L</span><strong>${mySeat.wins}-${mySeat.losses}</strong></div>
      <div><span>SET</span><strong>${diff >= 0 ? "+" : ""}${diff}</strong></div>
      <div><span>GOLD</span><strong class="gold-text">${mySeat.funds}</strong></div>
    </div>
    <div class="hub-banner-sub">
      <span>${escapeHtml(nextOpponentText)}</span>
      <span>${escapeHtml(mySeat.coachName)}</span>
    </div>
  `;

  if (activeHubTab === "STANDINGS") {
    const standings = getStandings(state);
    const rows = standings
      .map((s, idx) => {
        const d = s.setWins - s.setLosses;
        const games = s.wins + s.losses;
        const winRate = games > 0 ? Math.round((s.wins / games) * 100) : 0;
        const isMine = s.seatIndex === mySeat.seatIndex ? "my-team" : "";
        const row = `
          <tr class="standings-row ${idx < 4 ? "playoff-cut" : ""} ${isMine}">
            <td class="rank-cell">${idx + 1}</td>
            <td class="team-cell"><span class="team-bar" style="background:${s.teamColor}"></span><strong>${teamAbbr(s.teamName)}</strong> <span class="muted-text">${escapeHtml(shortTeamName(s.teamName))}</span></td>
            <td><strong>${s.wins}-${s.losses}</strong></td>
            <td>${d >= 0 ? "+" : ""}${d}</td>
            <td>${winRate}%</td>
            <td>${s.isAI ? `<span class="seat-badge badge-ai">AI</span>` : `<span class="seat-badge badge-human">HUM</span>`}</td>
          </tr>
        `;
        if (idx === 3) {
          return row + `<tr class="playoff-cutline-row"><td colspan="6"><div class="playoff-cutline-divider">PLAYOFF LINE</div></td></tr>`;
        }
        return row;
      })
      .join("");

    const matchesHtml = (weekObj?.matches || [])
      .map((m) => {
        const h = state.seats[m.homeSeat];
        const a = state.seats[m.awaySeat];
        const isMine = m.homeSeat === mySeat.seatIndex || m.awaySeat === mySeat.seatIndex;
        const score = m.completed
          ? `<strong class="num">${m.homeSets} : ${m.awaySets}</strong>`
          : `<span class="muted-text">VS</span>`;
        return `
          <div class="schedule-item ${isMine ? "my-match" : ""}">
            <span class="sched-team"><i class="team-bar" style="background:${h.teamColor}"></i>${teamAbbr(h.teamName)}</span>
            ${score}
            <span class="sched-team right">${teamAbbr(a.teamName)}<i class="team-bar" style="background:${a.teamColor}"></i></span>
          </div>
        `;
      })
      .join("");

    dom["hub-tab-content"].innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">REGULAR SEASON STANDINGS</h3>
          <span class="muted-text">TOP 4 진출</span>
        </div>
        <table class="standings-table num">
          <thead><tr><th>#</th><th style="text-align:left">TEAM</th><th>W-L</th><th>SET</th><th>WIN%</th><th>CTRL</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">WEEK ${state.week} MATCHUPS · Bo3</h3>
        </div>
        <div class="schedule-list">${matchesHtml}</div>
      </div>
    `;
  } else if (activeHubTab === "MANAGEMENT") {
    const disabled = mySeat.ap <= 0 ? "disabled" : "";
    const trainButtons = mySeat.roster
      .slice(0, 3)
      .map(
        (p, idx) => `
        <button class="btn btn-secondary btn-row" data-action-train="${idx}" ${disabled} type="button">
          <span>${escapeHtml(p.name)}</span>
          <span class="num muted-text">MEC ${p.stats.mechanics} → ${Math.min(99, p.stats.mechanics + 4)}</span>
        </button>`
      )
      .join("");

    dom["hub-tab-content"].innerHTML = `
      <div class="action-grid">
        <div class="ap-card">
          <div class="ap-card-title">팀 스크림</div>
          <div class="ap-card-desc">주전 3인 숙련도 +1 · 팀워크 +3 · 컨디션 -5</div>
          <button class="btn btn-primary btn-sm" data-action-scrim="1" ${disabled} type="button">실행 · 1 AP</button>
        </div>
        <div class="ap-card">
          <div class="ap-card-title">휴식 · 멘탈 케어</div>
          <div class="ap-card-desc">전원 컨디션 +22 · 멘탈 +3</div>
          <button class="btn btn-accent btn-sm" data-action-rest="1" ${disabled} type="button">실행 · 1 AP</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">개인 집중 훈련</h3>
          <span class="muted-text">MEC +4 · REF +3 · 1 AP</span>
        </div>
        <div class="stack-6">${trainButtons}</div>
      </div>
    `;
  } else if (activeHubTab === "ROSTER") {
    const renderPlayerCard = (p, opts) => {
      const { isStarter, idx, isFA } = opts;
      const traitObj = TRAITS[p.trait] || { name: p.trait };
      const topChampId = Object.keys(p.mastery || {})[0] || "kylen";
      const topChamp = getChampionById(topChampId);
      const favChamps = Object.entries(p.mastery || {})
        .map(([cid, lv]) => {
          const c = getChampionById(cid);
          return `<span class="mastery-chip">${getRoleSvg(c.role, c.color, 11)} ${escapeHtml(c.shortName)} ${getMasteryRankBadge(lv)}</span>`;
        })
        .join("");
      const ovr = Math.round((p.stats.mechanics + p.stats.reflex + p.stats.teamwork + p.stats.mental) / 4);
      const statBar = (label, v) => `
        <div class="stat-line">
          <span>${label}</span>
          <div class="stat-track"><div class="stat-fill" style="width:${v}%"></div></div>
          <strong>${v}</strong>
        </div>`;
      const actionArea = isFA
        ? `<button class="btn btn-accent btn-sm" data-action-fa="${idx}" ${mySeat.ap > 0 && mySeat.funds >= p.cost ? "" : "disabled"} type="button">영입 <span class="num">${p.cost}G</span> · 1 AP</button>`
        : isStarter
          ? `<button class="btn btn-ghost btn-sm" data-action-swap="${idx}" type="button">후보와 교체 · 0 AP</button>`
          : `<span class="seat-badge badge-ai">SUB</span>`;

      return `
        <div class="player-card ${isFA ? "is-fa" : isStarter ? "is-starter" : "is-sub"}">
          <div class="player-top-row">
            <div class="player-identity">
              <span class="role-svg-badge">${getRoleSvg(topChamp.role, topChamp.color, 14)}</span>
              <div>
                <strong class="player-name">${isFA ? "FA" : isStarter ? `ST${idx + 1}` : "SUB"} · ${escapeHtml(p.name)}</strong>
                <div class="muted-text small">${escapeHtml(traitObj.name)} · COND <span class="num">${p.condition}%</span></div>
              </div>
            </div>
            <div class="ovr-badge num">${ovr}</div>
          </div>
          <div class="stat-grid num">
            ${statBar("MEC", p.stats.mechanics)}
            ${statBar("REF", p.stats.reflex)}
            ${statBar("TMW", p.stats.teamwork)}
            ${statBar("MNT", p.stats.mental)}
          </div>
          <div class="mastery-pills-row">${favChamps}</div>
          ${actionArea}
        </div>
      `;
    };

    const rosterHtml = mySeat.roster
      .map((p, idx) => renderPlayerCard(p, { isStarter: idx < 3, idx, isFA: false }))
      .join("");
    const faHtml = (state.faPool || [])
      .map((fa, idx) => renderPlayerCard(fa, { isStarter: false, idx, isFA: true }))
      .join("");

    dom["hub-tab-content"].innerHTML = `
      <div class="card">
        <div class="card-header-row"><h3 class="card-title">ACTIVE ROSTER</h3><span class="muted-text">주전 3 + 후보 1</span></div>
        <div class="stack-7">${rosterHtml}</div>
      </div>
      <div class="card">
        <div class="card-header-row"><h3 class="card-title">FREE AGENT MARKET</h3><span class="muted-text">영입 시 후보 교체</span></div>
        <div class="stack-7">${faHtml}</div>
      </div>
    `;
  } else if (activeHubTab === "PATCH") {
    const notes = state.patchNotes || [];
    dom["hub-tab-content"].innerHTML = notes.length
      ? notes
          .slice()
          .reverse()
          .map((n) => {
            const entry = (b, buff) => `
              <div class="patch-entry">
                <span class="patch-pill ${buff ? "badge-buff" : "badge-nerf"}">${buff ? "▲ BUFF" : "▼ NERF"}</span>
                <span class="patch-name"><strong>${escapeHtml(b.name)}</strong></span>
                <span class="num muted-text">${escapeHtml(b.change)}</span>
              </div>`;
            return `
              <div class="card">
                <div class="card-header-row">
                  <h3 class="card-title">PATCH ${escapeHtml(n.version)}</h3>
                  <span class="pill pill-muted">WEEK ${n.week}</span>
                </div>
                <div class="patch-list">${n.buffs.map((b) => entry(b, true)).join("")}${n.nerfs.map((b) => entry(b, false)).join("")}</div>
              </div>
            `;
          })
          .join("")
      : `<div class="card"><div class="muted-text">아직 밸런스 패치가 없습니다. 짝수 주차(2주·4주) 종료 후 자동 발표됩니다.</div></div>`;
  }
}

function renderDraftScreen(state) {
  const series = state.activeSeries;
  const draft = series.draft;
  const blueSeat = state.seats[series.blueSeat];
  const redSeat = state.seats[series.redSeat];
  const step = DRAFT_SEQUENCE[draft.stepIndex];
  const mySeat = state.seats[state.localSeatIndex];

  dom["draft-series-title"].textContent =
    `${state.playoffs?.active ? "PLAYOFFS" : `WEEK ${state.week}`} · Bo${series.bestOf} · ${teamAbbr(blueSeat.teamName)} vs ${teamAbbr(redSeat.teamName)}`;

  if (step) {
    const side = step.team === "blue" ? "BLUE" : "RED";
    dom["draft-phase-banner"].textContent = `${side} ${step.type === "ban" ? "BAN" : "PICK"} ${draft.stepIndex + 1}/8`;
    dom["draft-phase-banner"].className = `draft-phase-banner ${step.team === "red" ? "is-red" : "is-blue"}`;
  } else {
    dom["draft-phase-banner"].textContent = "DRAFT COMPLETE";
    dom["draft-phase-banner"].className = "draft-phase-banner";
  }

  const slot = (cid) => {
    if (!cid) return `<div class="draft-slot-pill empty">—</div>`;
    const c = getChampionById(cid);
    return `<div class="draft-slot-pill"><span class="slot-swatch" style="background:${c.color}"></span>${escapeHtml(c.shortName)}</div>`;
  };
  const renderSlots = (seat, bans, picks) => `
    <div class="draft-col-head">${teamAbbr(seat.teamName)}</div>
    <div class="draft-slot-pill ban">BAN ${bans[0] ? escapeHtml(getChampionById(bans[0]).shortName) : "—"}</div>
    ${slot(picks[0])}${slot(picks[1])}${slot(picks[2])}
  `;
  dom["draft-blue-slots"].innerHTML = renderSlots(blueSeat, draft.blueBans, draft.bluePicks);
  dom["draft-red-slots"].innerHTML = renderSlots(redSeat, draft.redBans, draft.redPicks);

  const taken = new Set([...draft.blueBans, ...draft.redBans, ...draft.bluePicks, ...draft.redPicks]);
  const bestMastery = (champId) => {
    let best = 1;
    for (const p of (mySeat?.roster || []).slice(0, 3)) {
      const lv = p.mastery?.[champId] || 1;
      if (lv > best) best = lv;
    }
    return best;
  };

  dom["draft-champ-grid"].innerHTML = Object.values(CHAMPIONS)
    .map((c) => {
      const used = taken.has(c.id);
      const pm = c.patchMod || { dmgMult: 1, hpMult: 1 };
      const patchTag = pm.dmgMult > 1.001 ? `<span class="patch-mini buff">▲</span>` : pm.dmgMult < 0.999 ? `<span class="patch-mini nerf">▼</span>` : "";
      return `
        <button class="champ-pick-btn" data-champ-id="${c.id}" ${used ? "disabled" : ""} type="button" style="--champ:${c.color}">
          <div class="champ-card-top">
            <span class="role-svg-badge">${getRoleSvg(c.role, c.color, 12)}</span>
            ${patchTag}
            ${getMasteryRankBadge(bestMastery(c.id))}
          </div>
          <span class="champ-emblem">${getRoleSvg(c.role, "#F8FAFC", 18)}</span>
          <span class="champ-name">${escapeHtml(c.shortName)}</span>
          <span class="champ-role num">${c.role} · ${Math.round(c.baseHp * pm.hpMult)}</span>
        </button>
      `;
    })
    .join("");
}

function renderCombatHUD(state) {
  const combat = state.combat;
  const series = state.activeSeries;
  const blueSeat = state.seats[series.blueSeat];
  const redSeat = state.seats[series.redSeat];
  const myTeamSide = series.redSeat === state.localSeatIndex ? "red" : "blue";
  const neededWins = Math.max(1, Math.ceil((series.bestOf || 1) / 2));
  const pips = (wins, cls) =>
    Array.from({ length: neededWins }, (_, i) => `<i class="set-pip ${i < wins ? cls : ""}"></i>`).join("");

  const t = Math.max(0, combat.timer);
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, "0");
  const orbText = combat.orb.active ? `ORB ${Math.ceil(combat.orb.hp)}` : `ORB ${Math.ceil(combat.orb.respawnTimer)}s`;

  dom["combat-scoreboard"].innerHTML = `
    <div class="sb-team sb-blue">
      <span class="sb-abbr">${teamAbbr(blueSeat?.teamName || "BLUE")}</span>
      <span class="sb-pips">${pips(series.blueWins, "blue-won")}</span>
      <span class="sb-score num">${series.blueWins}</span>
    </div>
    <div class="sb-center ${combat.suddenDeath ? "is-sd" : ""}">
      <div class="sb-time num">${mm}:${ss}</div>
      <div class="sb-meta">${combat.suddenDeath ? "SUDDEN DEATH" : `SET ${series.currentSet} · Bo${series.bestOf}`} · <span class="num">${orbText}</span></div>
    </div>
    <div class="sb-team sb-red">
      <span class="sb-score num">${series.redWins}</span>
      <span class="sb-pips">${pips(series.redWins, "red-won")}</span>
      <span class="sb-abbr">${teamAbbr(redSeat?.teamName || "RED")}</span>
    </div>
  `;

  const bRites = series.blueRites.map((id) => getRiteById(id).name).join(", ") || "—";
  const rRites = series.redRites.map((id) => getRiteById(id).name).join(", ") || "—";
  dom["combat-rites-strip"].innerHTML = `<span class="rite-tag blue">B</span>${escapeHtml(bRites)} <span class="rite-tag red">R</span>${escapeHtml(rRites)}`;
  dom["btn-speed-toggle"].textContent = `${combat.speedMult || 1}x`;
  dom["btn-pause-combat"].textContent = combat.paused ? "재개" : "정지";

  const myCalls = combat.coachCalls[myTeamSide];
  if (myCalls?.activeCall && myCalls.activeTimer > 0) {
    const def = COACH_CALLS[myCalls.activeCall];
    dom["call-banner"].textContent = `${def.icon} ${def.name} · ${myCalls.activeTimer.toFixed(1)}s`;
    dom["call-banner"].classList.remove("hidden");
  } else {
    dom["call-banner"].classList.add("hidden");
  }

  if (combat.winnerTeam) {
    const key = combat.winnerTeam + ":" + series.currentSet;
    if (lastRoundEndShown !== key) {
      lastRoundEndShown = key;
      const winSeat = combat.winnerTeam === "blue" ? blueSeat : redSeat;
      const isExhibition = series.seriesMode === "EXHIBITION";
      dom["round-end-overlay"].innerHTML = `
        <div class="re-kicker">SET ${series.currentSet} RESULT</div>
        <div class="re-title ${combat.winnerTeam === "blue" ? "blue" : "red"}">${teamAbbr(winSeat?.teamName || combat.winnerTeam)} WIN</div>
        <div class="muted-text">${escapeHtml(shortTeamName(winSeat?.teamName || ""))}${isExhibition ? " · 친선전" : ` · 시리즈 <span class="num">${series.blueWins} : ${series.redWins}</span>`}</div>
        <div class="re-actions">
          ${
            isExhibition
              ? `<button class="btn btn-primary" data-exhibition-shuffle="1" type="button">랜덤 조합 재대결</button>
                 <button class="btn btn-ghost" data-back-hub="1" type="button">허브로</button>`
              : `<button class="btn btn-primary" data-round-next="${combat.winnerTeam}" type="button">다음 진행</button>`
          }
        </div>
      `;
      dom["round-end-overlay"].classList.remove("hidden");
    }
  } else {
    lastRoundEndShown = null;
    dom["round-end-overlay"].classList.add("hidden");
  }

  const renderTeamBars = (side, el) => {
    el.innerHTML = combat.fighters
      .filter((f) => f.team === side)
      .map((f) => {
        const pct = Math.max(0, Math.min(100, (f.hp / f.maxHp) * 100));
        const champ = getChampionById(f.champId);
        const segs = Array.from({ length: 4 }, (_, s) => {
          const cls = f.energy >= 100 ? "ult-ready" : f.energy >= (s + 1) * 25 ? "filled" : "";
          return `<span class="energy-pip ${cls}"></span>`;
        }).join("");
        const cc = f.stunTimer > 0 ? `<span class="cc-tag">STUN</span>` : f.counterTimer > 0 ? `<span class="cc-tag gold">Q</span>` : "";
        return `
          <div class="fighter-mini-bar ${f.alive ? "" : "is-dead"} ${side}">
            <div class="fighter-mini-top">
              <span class="fighter-mini-name">${getRoleSvg(f.role, champ.color, 11)}${escapeHtml(f.name || champ.shortName)}${cc}</span>
              <span class="num fighter-mini-stats">${f.alive ? `${Math.ceil(f.hp)}` : "KO"} · K${f.kills || 0} · ${Math.round(f.damageDealt || 0)}</span>
            </div>
            <div class="hp-track"><div class="hp-fill" style="width:${pct}%"></div></div>
            <div class="energy-pips-row">${segs}</div>
          </div>
        `;
      })
      .join("");
  };
  renderTeamBars("blue", dom["blue-team-bars"]);
  renderTeamBars("red", dom["red-team-bars"]);

  // 티커 (엔진은 최신 로그를 앞쪽에 unshift)
  const logs = (combat.tickerLogs || []).slice(0, 2);
  dom["ticker-list"].innerHTML = logs
    .map((l) => `<div class="ticker-item type-${escapeHtml(String(l.type || "INFO").toLowerCase())}"><span class="ticker-time num">${escapeHtml(l.time ?? "")}</span>${escapeHtml(l.text || l.msg || "")}</div>`)
    .join("");

  for (const btn of dom["bottom-tactical-bar"].querySelectorAll("[data-call]")) {
    const callKey = btn.dataset.call;
    const def = COACH_CALLS[callKey];
    const maxCharges = def?.maxCharges || 3;
    const maxCd = def?.cd || 10;
    const charges = myCalls?.charges?.[callKey] ?? 0;
    const cd = myCalls?.cds?.[callKey] ?? 0;
    const isActive = myCalls?.activeCall === callKey && myCalls.activeTimer > 0;
    btn.classList.toggle("active-call", Boolean(isActive));
    btn.disabled = !combat.running || charges <= 0 || cd > 0;

    const pipsEl = document.getElementById(`pips-${callKey}`);
    if (pipsEl) {
      pipsEl.innerHTML = Array.from({ length: maxCharges }, (_, i) => `<i class="charge-pip ${i < charges ? "on" : ""}"></i>`).join("");
    }
    const cdMaskEl = document.getElementById(`cd-${callKey}`);
    if (cdMaskEl) {
      cdMaskEl.style.height = `${cd > 0 ? Math.min(100, (cd / maxCd) * 100) : 0}%`;
    }
    const metaEl = document.getElementById(`meta-${callKey}`);
    if (metaEl) {
      metaEl.textContent = isActive
        ? `ACTIVE ${myCalls.activeTimer.toFixed(1)}s`
        : cd > 0
          ? `CD ${cd.toFixed(1)}s`
          : `${charges}/${maxCharges}`;
    }
  }
}

function renderRiteDraftScreen(state) {
  const series = state.activeSeries;
  const blueSeat = state.seats[series.blueSeat];
  const redSeat = state.seats[series.redSeat];
  const myTeamSide = series.redSeat === state.localSeatIndex ? "red" : "blue";
  const myRites = myTeamSide === "blue" ? series.blueRites : series.redRites;

  dom["rite-series-header"].innerHTML = `
    <span class="sb-abbr blue-text">${teamAbbr(blueSeat.teamName)}</span>
    <span class="num rite-score">${series.blueWins} : ${series.redWins}</span>
    <span class="sb-abbr red-text">${teamAbbr(redSeat.teamName)}</span>
    <span class="muted-text">· Bo${series.bestOf} · NEXT SET ${series.currentSet + 1}</span>
  `;

  dom["rite-cards-list"].innerHTML = (series.riteOptions || [])
    .map((riteId) => {
      const r = getRiteById(riteId);
      return `
        <button class="rite-card-btn cat-${String(r.category).toLowerCase()}" data-rite-id="${r.id}" type="button">
          <div class="rite-card-top">
            <span class="rite-card-cat">${r.category}</span>
            <span class="role-svg-badge">${getCategorySvg(r.category)}</span>
          </div>
          <span class="rite-card-name">${escapeHtml(r.name)}</span>
          <span class="rite-card-desc">${escapeHtml(r.desc)}</span>
        </button>
      `;
    })
    .join("");

  const ownedText = myRites.map((id) => getRiteById(id).name).join(", ") || "없음";
  dom["rite-equipped-summary"].textContent = `보유 증강: ${ownedText}`;
}

function renderPlayoffScreen(state) {
  const po = state.playoffs;
  const champSeat = po.championSeat !== null ? state.seats[po.championSeat] : null;

  dom["playoff-header"].innerHTML = champSeat
    ? `<div class="po-kicker">SEASON CHAMPION</div>
       <div class="po-title gold-text">${teamAbbr(champSeat.teamName)} · ${escapeHtml(shortTeamName(champSeat.teamName))}</div>
       <div class="muted-text">감독 ${escapeHtml(champSeat.coachName)}</div>`
    : `<div class="po-kicker">TOP-4 PLAYOFFS · Bo5</div>
       <div class="po-title">${po.round === "SEMI_1" ? "SEMIFINAL 1 · 1위 vs 4위" : po.round === "SEMI_2" ? "SEMIFINAL 2 · 2위 vs 3위" : "GRAND FINAL"}</div>`;

  const renderMatchCard = (title, m, isCurrent) => {
    const h = m.homeSeat !== null ? state.seats[m.homeSeat] : null;
    const a = m.awaySeat !== null ? state.seats[m.awaySeat] : null;
    const teamRow = (seat, sets, won) => `
      <div class="bracket-team-row ${won ? "winner" : ""}">
        <span class="bracket-team">${seat ? `<i class="team-bar" style="background:${seat.teamColor}"></i><strong>${teamAbbr(seat.teamName)}</strong> <span class="muted-text">${escapeHtml(shortTeamName(seat.teamName))}</span>` : `<span class="muted-text">TBD</span>`}</span>
        <span class="num bracket-sets">${sets}</span>
      </div>`;
    return `
      <div class="bracket-card ${isCurrent ? "active-round" : ""}">
        <div class="card-header-row" style="margin-bottom:2px;">
          <strong class="bracket-title">${title}</strong>
          <span class="status-chip ${m.winnerSeat !== null ? "done" : isCurrent ? "live" : ""}">${m.winnerSeat !== null ? "FINAL" : isCurrent ? "LIVE" : "UPCOMING"}</span>
        </div>
        ${teamRow(h, m.homeSets, m.winnerSeat !== null && m.winnerSeat === m.homeSeat && h)}
        ${teamRow(a, m.awaySets, m.winnerSeat !== null && m.winnerSeat === m.awaySeat && a)}
      </div>
    `;
  };

  dom["playoff-tree-container"].innerHTML = `
    <div class="bracket-semis">
      ${renderMatchCard("SF1 · Bo5", po.semi1, po.round === "SEMI_1")}
      ${renderMatchCard("SF2 · Bo5", po.semi2, po.round === "SEMI_2")}
    </div>
    <div class="bracket-connector"></div>
    ${renderMatchCard("GRAND FINAL · Bo5", po.final, po.round === "FINAL")}
  `;

  const isDone = po.round === "CHAMPION";
  dom["btn-playoff-next-match"].disabled = isDone;
  dom["btn-playoff-quick-sim"].disabled = isDone;
}
