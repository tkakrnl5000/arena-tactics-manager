// js/hud.js
// 순수 DOM UI 렌더링 모듈 (물리/전투 계산 금지, 상태 읽기 및 콜백 전달만 수행)
// 다크 택티컬 e스포츠 방송 스타일 HUD

import {
  SCREEN_STATES,
  CHAMPIONS,
  ARENA_MAPS,
  MAP_ORDER,
  TRAITS,
  COACH_CALLS,
  HEAD_COACHES,
  COACH_PHILOSOPHIES,
  BAN_PICK_STRATEGIES,
  RITE_PREFERENCES,
  AUTO_CALL_TRIGGERS,
  SCHEDULE_MODES,
  ROOM_MODES,
  ROUTINE_ACTIVITIES,
  FACILITY_DEFS,
  SPONSOR_CONTRACTS,
  computeRoundPayroll,
  getArenaMapById,
  getChampionById,
  getHeadCoachById,
  getRiteById,
  getSponsorById
} from "./state.js";
import { DRAFT_SEQUENCE, getNextMatchCountdown, getStandings } from "./league.js";
import { getNetworkMode } from "./network.js";
import { playSfx } from "./audio.js";

let hudCallbacks = {};
let activeHubTab = "STANDINGS";
let lastRenderedNonCombatSig = "";
let lastRoundEndShown = null;
let lastNewsShownId = null;
let lastArcadeBoxId = null;
let toastTimer = null;

// 주요 DOM 요소 캐시
const dom = {};

function cacheDom() {
  const ids = [
    "top-week-badge",
    "top-patch-badge",
    "top-room-badge",
    "top-net-badge",
    "btn-sfx-toggle",
    "btn-go-hub",
    "btn-create-arcade-room",
    "btn-create-room",
    "arcade-lobby-header",
    "arcade-versus-board",
    "btn-arcade-reroll",
    "btn-arcade-vs-ai",
    "btn-arcade-ready",
    "btn-arcade-exit-lobby",
    "input-room-code",
    "input-coach-name",
    "btn-join-room",
    "btn-quick-exhibition",
    "btn-open-neon-modal",
    "btn-copy-room",
    "lobby-schedule-mode",
    "lobby-map-selector",
    "lobby-room-status",
    "lobby-seats-list",
    "hub-club-banner",
    "hub-schedule-bar",
    "hub-tabs",
    "hub-tab-content",
    "btn-start-round-match",
    "btn-open-news",
    "btn-open-coach-market",
    "btn-quick-sim-week",
    "btn-open-seats-modal",
    "draft-series-title",
    "draft-phase-banner",
    "draft-map-banner",
    "draft-coach-bar",
    "draft-blue-slots",
    "draft-red-slots",
    "draft-champ-grid",
    "draft-assign-panel",
    "draft-hint-bar",
    "combat-scoreboard",
    "combat-rites-strip",
    "btn-live-override",
    "btn-speed-toggle",
    "btn-pause-combat",
    "vod-timeline-bar",
    "call-banner",
    "round-end-overlay",
    "blue-team-bars",
    "red-team-bars",
    "ticker-list",
    "bottom-tactical-bar",
    "rite-series-header",
    "rite-coach-actions",
    "rite-cards-list",
    "rite-equipped-summary",
    "playoff-header",
    "playoff-tree-container",
    "btn-playoff-next-match",
    "btn-playoff-quick-sim",
    "btn-new-season",
    "stove-header",
    "stove-content",
    "btn-start-next-season",
    "btn-open-stove-news",
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

/**
 * 아레나 4종 전술 미니맵 인라인 SVG 생성
 */
function renderMapMiniSvg(mapDef) {
  const pillars = (mapDef.pillars || [])
    .map((p) => `<circle cx="${Math.round(p.x / 6)}" cy="${Math.round(p.y / 6)}" r="2.8" fill="#64748b" stroke="#0b0f17" stroke-width="0.9"/>`)
    .join("");
  const shrines = (mapDef.shrines || [])
    .map((s) => {
      const col = s.type === "HEAL_SHRINE" ? "#10b981" : s.type === "ATK_SHRINE" ? "#f97316" : s.type === "SHIELD_SHRINE" ? "#67e8f9" : "#c084fc";
      return `<rect x="${Math.round(s.x / 6) - 1.8}" y="${Math.round(s.y / 6) - 1.8}" width="3.6" height="3.6" transform="rotate(45 ${Math.round(s.x / 6)} ${Math.round(s.y / 6)})" fill="${col}"/>`;
    })
    .join("");
  const hazards = (mapDef.hazards || [])
    .map((h) => `<circle cx="${Math.round(h.x / 6)}" cy="${Math.round(h.y / 6)}" r="${Math.max(4, Math.round(h.radius / 6))}" fill="none" stroke="${mapDef.ambientColor}" stroke-width="1" stroke-dasharray="2 1.5"/>`)
    .join("");

  return `
    <svg class="map-mini-svg" viewBox="0 0 60 70" width="42" height="49" aria-hidden="true">
      <rect x="1" y="1" width="58" height="68" rx="6" fill="${mapDef.floorColor}" stroke="${mapDef.accentColor}" stroke-opacity="0.55" stroke-width="1.2"/>
      <circle cx="30" cy="35" r="26" fill="none" stroke="${mapDef.accentColor}" stroke-opacity="0.28" stroke-width="0.9"/>
      ${hazards}
      ${shrines}
      ${pillars}
    </svg>
  `;
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
  const curMode = getNetworkMode() === "NEON" ? "🟢 Neon 온라인" : "🟡 로컬 모드";
  const html = `
    <div class="muted-text small" style="margin:0 0 6px;">현재 상태: <strong>${curMode}</strong></div>
    <p class="muted-text" style="margin:0 0 8px;">
      Neon Serverless Postgres 연결 URI(<code>postgresql://...</code>)를 입력하면 다른 기기·모바일 간 실시간 4초 동기화 및 자동 테이블 생성이 작동합니다. 비워두면 로컬 멀티탭 모드로 동작합니다.
    </p>
    <input id="modal-neon-input" class="input-field" type="text" placeholder="postgresql://user:pass@host/db?sslmode=require" value="${escapeHtml(saved)}" />
    <div id="modal-neon-status" class="neon-test-status muted-text small">연결 테스트 버튼으로 DB 응답을 확인할 수 있습니다.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
      <button id="modal-neon-test" class="btn btn-accent btn-sm" type="button">🔌 연결 테스트</button>
      <button id="modal-neon-save" class="btn btn-primary flex-1 btn-sm" type="button">💾 저장 및 적용</button>
      <button id="modal-neon-clear" class="btn btn-ghost btn-sm" type="button">🟡 로컬 모드</button>
    </div>
  `;
  showModal("☁️ 온라인 서버 설정 (Neon Postgres)", html);
}

function renderCoachCardHtml(coach, mySeat, isCompact = false) {
  const phil = COACH_PHILOSOPHIES[coach.philosophy] || { name: coach.philosophy, desc: "" };
  const sigChamp = getChampionById(coach.signatureChamp);
  const hired = mySeat?.headCoachId === coach.id;
  const canAfford = (mySeat?.funds || 0) >= coach.salary;
  const statBar = (label, v, isEgo = false) => `
    <div class="stat-line ${isEgo ? "is-ego" : ""}">
      <span>${label}</span>
      <div class="stat-track"><div class="stat-fill" style="width:${v}%"></div></div>
      <strong>${v}</strong>
    </div>`;

  return `
    <div class="coach-card ${hired ? "is-hired" : ""}">
      <div class="coach-card-top">
        <div>
          <div class="coach-name-row">
            <strong>${escapeHtml(coach.name)}</strong>
            <span class="pill pill-muted">${escapeHtml(phil.name)}</span>
          </div>
          <div class="muted-text small">${escapeHtml(coach.title)} · 시그니처: <span style="color:${sigChamp.color};font-weight:700;">${escapeHtml(sigChamp.shortName)}</span></div>
        </div>
        ${
          hired
            ? `<span class="seat-badge badge-human">고용 중</span>`
            : `<button class="btn btn-accent btn-sm" data-hire-coach="${coach.id}" ${canAfford ? "" : "disabled"} type="button">영입 <span class="num">${coach.salary}G</span></button>`
        }
      </div>
      <div class="stat-grid num">
        ${statBar("밴픽", coach.stats.draftInsight)}
        ${statBar("콜감각", coach.stats.callSense)}
        ${statBar("증강", coach.stats.riteSense)}
        ${statBar("EGO", coach.stats.ego, true)}
      </div>
      ${isCompact ? "" : `<div class="coach-bark-quote">“${escapeHtml(coach.bark)}”</div>`}
    </div>
  `;
}

function openCoachMarketModal(state) {
  const mySeat = state.seats[state.localSeatIndex] || state.seats[0];
  const cards = HEAD_COACHES.map((c) => renderCoachCardHtml(c, mySeat, true)).join("");
  const html = `
    <div class="coach-market-header">
      <span class="muted-text">보유 구단 자금: <strong class="gold-text num">${mySeat.funds}G</strong></span>
      <span class="muted-text">감독은 밴픽 노트 실행 및 EGO 독단 픽을 수행합니다</span>
    </div>
    <div class="stack-7">${cards}</div>
  `;
  showModal("AI 감독 영입 시장 (8 Coaches)", html);
}

/**
 * 주간 허브 상단 실시간 스케줄 카운트다운 바 갱신 (1초 주기 호출 지원)
 */
export function updateScheduleCountdownHUD(state) {
  const el = dom["hub-schedule-bar"];
  if (!el || !state) return;
  const cd = getNextMatchCountdown(state, Date.now());
  const modeLabels = {
    [SCHEDULE_MODES.REALTIME_DAILY]: "DAILY 21:00",
    [SCHEDULE_MODES.HOURLY_BLITZ]: "1H BLITZ",
    [SCHEDULE_MODES.INSTANT_TEST]: "INSTANT TEST"
  };

  const modeBtns = Object.values(SCHEDULE_MODES)
    .map((m) => `<button class="sched-mode-chip ${cd.mode === m ? "is-active" : ""}" data-schedule-mode="${m}" type="button">${modeLabels[m]}</button>`)
    .join("");

  const actionBtn =
    cd.mode === SCHEDULE_MODES.INSTANT_TEST
      ? `<button class="btn btn-accent btn-sm" data-instant-start="1" type="button">테스트: 다음 경기 즉시 개막</button>`
      : cd.isDue
        ? `<button class="btn btn-primary btn-sm" data-instant-start="1" type="button">ON AIR · 지금 개막</button>`
        : `<span class="sched-wait-tag">예정 개막 대기</span>`;

  el.innerHTML = `
    <div class="sched-bar-top">
      <div>
        <div class="sched-bar-label">${escapeHtml(cd.label)}</div>
        <div class="sched-countdown num">다음 경기까지 <strong>${escapeHtml(cd.hhmmss)}</strong></div>
      </div>
      ${actionBtn}
    </div>
    <div class="sched-bar-modes">${modeBtns}</div>
  `;
}

/**
 * HUD 이벤트 리스너를 초기화한다.
 * @param {object} callbacks
 */
export function initHUD(callbacks) {
  hudCallbacks = callbacks || {};
  cacheDom();

  document.getElementById("app-shell")?.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("#btn-sfx-toggle")) return;
      if (
        e.target.closest(
          ".btn, .hub-tab, .champ-pick-btn, .rite-card-btn, .sponsor-card-btn, .routine-act-btn, .note-pill-btn, .vod-pill-btn, .vod-tab-btn, .mini-btn, .icon-pill, .sched-mode-chip, .map-select-card"
        )
      ) {
        playSfx("CARD_CLICK");
      }
    },
    true
  );

  dom["modal-close-btn"]?.addEventListener("click", hideModal);
  dom["app-modal"]?.addEventListener("click", (e) => {
    if (e.target === dom["app-modal"]) hideModal();
  });

  dom["modal-body"]?.addEventListener("click", (e) => {
    const hireBtn = e.target.closest("[data-hire-coach]");
    if (hireBtn) {
      hideModal();
      hudCallbacks.onHireCoach?.(hireBtn.dataset.hireCoach);
      return;
    }
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
    if (e.target.id === "modal-neon-test") {
      const val = document.getElementById("modal-neon-input")?.value || "";
      const statusEl = document.getElementById("modal-neon-status");
      if (statusEl) statusEl.textContent = "⏳ Neon HTTP SQL 연결 테스트 중...";
      if (hudCallbacks.onTestNeon) {
        hudCallbacks.onTestNeon(val).then((res) => {
          if (!statusEl) return;
          statusEl.textContent = res?.message || "테스트 완료";
          statusEl.className = `neon-test-status small ${res?.ok ? "heal-text" : "red-text"}`;
        });
      }
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
      return;
    }
    if (e.target.closest("[data-arcade-rematch]")) {
      hideModal();
      hudCallbacks.onArcadeRematch?.();
      return;
    }
    if (e.target.closest("[data-arcade-exit]")) {
      hideModal();
      hudCallbacks.onExitToLobby?.();
    }
  });

  dom["top-room-badge"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openSeatsModal(hudCallbacks.getState());
  });
  dom["btn-sfx-toggle"]?.addEventListener("click", () => hudCallbacks.onToggleSfx?.());
  dom["btn-go-hub"]?.addEventListener("click", () => hudCallbacks.onGoHub?.());
  dom["btn-copy-room"]?.addEventListener("click", copyRoomCode);

  dom["lobby-map-selector"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-select-map]");
    if (!btn) return;
    hudCallbacks.onSelectMap?.(btn.dataset.selectMap);
  });

  dom["lobby-schedule-mode"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-mode]");
    if (!btn) return;
    hudCallbacks.onSetScheduleMode?.(btn.dataset.scheduleMode);
  });

  dom["hub-schedule-bar"]?.addEventListener("click", (e) => {
    const modeBtn = e.target.closest("[data-schedule-mode]");
    if (modeBtn) {
      hudCallbacks.onSetScheduleMode?.(modeBtn.dataset.scheduleMode);
      return;
    }
    if (e.target.closest("[data-instant-start]")) {
      hudCallbacks.onStartRoundMatch?.();
    }
  });

  dom["btn-create-arcade-room"]?.addEventListener("click", () => hudCallbacks.onCreateArcadeRoom?.());
  dom["btn-create-room"]?.addEventListener("click", () => hudCallbacks.onCreateRoom?.());
  dom["btn-arcade-reroll"]?.addEventListener("click", () => hudCallbacks.onArcadeReroll?.());
  dom["btn-arcade-vs-ai"]?.addEventListener("click", () => hudCallbacks.onArcadeStartVsAI?.());
  dom["btn-arcade-ready"]?.addEventListener("click", () => hudCallbacks.onArcadeToggleReady?.());
  dom["btn-arcade-exit-lobby"]?.addEventListener("click", () => hudCallbacks.onExitToLobby?.());

  dom["draft-assign-panel"]?.addEventListener("click", (e) => {
    const swapBtn = e.target.closest("[data-assign-swap]");
    if (swapBtn) {
      const idxA = Number(swapBtn.dataset.assignSwap);
      const idxB = (idxA + 1) % 3;
      hudCallbacks.onArcadeSwapAssign?.(idxA, idxB);
      return;
    }
    if (e.target.closest("[data-assign-confirm]")) {
      hudCallbacks.onArcadeConfirmAssign?.();
    }
  });
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
      return;
    }
    const hireBtn = e.target.closest("[data-hire-coach]");
    if (hireBtn) {
      hudCallbacks.onHireCoach?.(hireBtn.dataset.hireCoach);
      return;
    }
    if (e.target.closest("[data-open-coach-market]")) {
      if (hudCallbacks.getState) openCoachMarketModal(hudCallbacks.getState());
      return;
    }
    const vodBtn = e.target.closest("[data-vod-match]");
    if (vodBtn) {
      hudCallbacks.onWatchVod?.(vodBtn.dataset.vodMatch);
      return;
    }
    const banBtn = e.target.closest("[data-note-ban]");
    if (banBtn) {
      hudCallbacks.onToggleNoteChamp?.("mustBans", banBtn.dataset.noteBan);
      return;
    }
    const pickBtn = e.target.closest("[data-note-pick]");
    if (pickBtn) {
      hudCallbacks.onToggleNoteChamp?.("priorityPicks", pickBtn.dataset.notePick);
      return;
    }
    const stratBtn = e.target.closest("[data-note-strategy]");
    if (stratBtn) {
      hudCallbacks.onUpdateBanPickNote?.({ counterStrategy: stratBtn.dataset.noteStrategy });
      return;
    }
    const ritePrefBtn = e.target.closest("[data-note-rite]");
    if (ritePrefBtn) {
      hudCallbacks.onUpdateBanPickNote?.({ ritePreference: ritePrefBtn.dataset.noteRite });
      return;
    }
    const callPrefBtn = e.target.closest("[data-note-call]");
    if (callPrefBtn) {
      hudCallbacks.onUpdateBanPickNote?.({ autoCallTrigger: callPrefBtn.dataset.noteCall });
      return;
    }
    const rSlotBtn = e.target.closest("[data-routine-slot]");
    if (rSlotBtn) {
      hudCallbacks.onUpdateRoutine?.(rSlotBtn.dataset.routineSlot, rSlotBtn.dataset.routineAct, null);
      return;
    }
    const rFocusBtn = e.target.closest("[data-routine-focus]");
    if (rFocusBtn) {
      hudCallbacks.onUpdateRoutine?.(null, null, rFocusBtn.dataset.routineFocus);
      return;
    }
    const facBtn = e.target.closest("[data-upgrade-facility]");
    if (facBtn) {
      hudCallbacks.onUpgradeFacility?.(facBtn.dataset.upgradeFacility);
      return;
    }
    const spBtn = e.target.closest("[data-select-sponsor]");
    if (spBtn) {
      hudCallbacks.onSelectSponsor?.(spBtn.dataset.selectSponsor);
      return;
    }
    if (e.target.closest("[data-open-daily-news]")) {
      if (hudCallbacks.getState) openDailyNewsModal(hudCallbacks.getState());
    }
  });

  dom["btn-start-round-match"]?.addEventListener("click", () => hudCallbacks.onStartRoundMatch?.());
  dom["btn-open-news"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openDailyNewsModal(hudCallbacks.getState());
  });
  dom["btn-open-stove-news"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openDailyNewsModal(hudCallbacks.getState());
  });
  dom["btn-open-coach-market"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openCoachMarketModal(hudCallbacks.getState());
  });
  dom["btn-quick-sim-week"]?.addEventListener("click", () => hudCallbacks.onQuickSimRound?.());
  dom["btn-open-seats-modal"]?.addEventListener("click", () => {
    if (hudCallbacks.getState) openSeatsModal(hudCallbacks.getState());
  });

  dom["draft-coach-bar"]?.addEventListener("click", (e) => {
    if (e.target.closest("[data-toggle-override]")) {
      hudCallbacks.onToggleLiveOverride?.();
      return;
    }
    if (e.target.closest("[data-coach-step]")) {
      hudCallbacks.onCoachDraftStep?.();
    }
  });

  dom["draft-champ-grid"]?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-champ-id]");
    if (!btn || btn.disabled) return;
    hudCallbacks.onDraftSelectChamp?.(btn.dataset.champId);
  });

  dom["btn-live-override"]?.addEventListener("click", () => hudCallbacks.onToggleLiveOverride?.());
  dom["btn-speed-toggle"]?.addEventListener("click", () => hudCallbacks.onToggleSpeed?.());
  dom["btn-pause-combat"]?.addEventListener("click", () => hudCallbacks.onTogglePause?.());
  dom["vod-timeline-bar"]?.addEventListener("click", (e) => {
    const setBtn = e.target.closest("[data-vod-set]");
    if (setBtn) {
      hudCallbacks.onVodSelectSet?.(Number(setBtn.dataset.vodSet));
      return;
    }
    if (e.target.closest("[data-vod-skip]")) {
      hudCallbacks.onVodSkipHighlight?.();
      return;
    }
    if (e.target.closest("[data-vod-pause]")) {
      hudCallbacks.onTogglePause?.();
      return;
    }
    if (e.target.closest("[data-vod-speed]")) {
      hudCallbacks.onToggleSpeed?.();
    }
  });
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

  dom["rite-coach-actions"]?.addEventListener("click", (e) => {
    if (e.target.closest("[data-coach-rite]")) {
      hudCallbacks.onCoachSelectRite?.();
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
  dom["btn-start-next-season"]?.addEventListener("click", () => hudCallbacks.onStartNextSeason?.());
  dom["stove-content"]?.addEventListener("click", (e) => {
    const rBtn = e.target.closest("[data-sign-rookie]");
    if (rBtn) {
      hudCallbacks.onSignStoveRookie?.(Number(rBtn.dataset.signRookie));
    }
  });
}

/**
 * 전체 HUD를 현재 게임 상태에 맞춰 갱신한다.
 * @param {object} state
 */
export function renderHUD(state) {
  if (!state || !dom.screens) return;

  const netMode = getNetworkMode();
  const sNum = state.seasonNumber || 1;
  const isArcade = state.roomMode === ROOM_MODES.ARCADE_2P;
  dom["top-week-badge"].textContent = state.screen === SCREEN_STATES.LOBBY
    ? "LOBBY"
    : isArcade
      ? "ARCADE Bo3"
      : state.screen === SCREEN_STATES.STOVE_LEAGUE
        ? `S${sNum} STOVE`
        : state.playoffs?.active
          ? `S${sNum} · PO Bo5`
          : `S${sNum} · W${state.week}/${state.maxWeeks}`;
  dom["top-patch-badge"].textContent = `PATCH ${state.patchVersion}`;
  dom["top-room-badge"].textContent = `ROOM ${state.roomCode || "----"}`;
  dom["top-net-badge"].textContent = netMode === "NEON" ? "🟢 Neon 온라인" : "🟡 로컬 모드";
  dom["top-net-badge"].className = `pill ${netMode === "NEON" ? "pill-neon" : "pill-local"}`;

  if (dom["btn-sfx-toggle"] && hudCallbacks.isSfxEnabled) {
    const sfxOn = hudCallbacks.isSfxEnabled();
    dom["btn-sfx-toggle"].textContent = sfxOn ? "🔊" : "🔇";
    dom["btn-sfx-toggle"].classList.toggle("is-on", sfxOn);
  }

  const showGoHub = isArcade
    ? state.screen !== SCREEN_STATES.LOBBY && state.screen !== SCREEN_STATES.ARCADE_LOBBY
    : state.screen !== SCREEN_STATES.LOBBY && state.screen !== SCREEN_STATES.WEEKLY_HUB;
  dom["btn-go-hub"].textContent = isArcade ? "대기실" : "허브";
  dom["btn-go-hub"].classList.toggle("hidden", !showGoHub);

  for (const scr of dom.screens) {
    scr.classList.toggle("active", scr.dataset.screen === state.screen);
  }

  if (state.screen === SCREEN_STATES.COMBAT) {
    renderCombatHUD(state);
    return;
  }

  if (dom["round-end-overlay"]) {
    dom["round-end-overlay"].classList.add("hidden");
    dom["round-end-overlay"].innerHTML = "";
  }
  lastRoundEndShown = null;

  const sig = JSON.stringify({
    screen: state.screen,
    roomMode: state.roomMode || ROOM_MODES.LEAGUE_6P,
    version: state.version,
    seasonNumber: state.seasonNumber || 1,
    tab: activeHubTab,
    week: state.week,
    room: state.roomCode,
    localSeat: state.localSeatIndex,
    seatsAI: state.seats.map((s) => (s.isAI ? 1 : 0)).join(""),
    seatsReady: state.seats.map((s) => (s.ready ? 1 : 0)).join(""),
    ap: state.seats[state.localSeatIndex]?.ap,
    funds: state.seats[state.localSeatIndex]?.funds,
    inDebt: Boolean(state.seats[state.localSeatIndex]?.inDebt),
    sponsorId: state.seats[state.localSeatIndex]?.sponsorId,
    routineSig: JSON.stringify(state.seats[state.localSeatIndex]?.autoSchedule || {}),
    facSig: JSON.stringify(state.seats[state.localSeatIndex]?.facilities || {}),
    newsId: state.latestDailyNews?.id || "",
    stoveCount: state.stoveRookies?.length || 0,
    hofCount: state.hallOfFame?.length || 0,
    headCoachId: state.seats[state.localSeatIndex]?.headCoachId,
    noteSig: JSON.stringify(state.seats[state.localSeatIndex]?.banPickNote || {}),
    schedMode: state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY,
    liveOverride: Boolean(state.liveOverride),
    coachLogsLen: state.activeSeries?.coachLogs?.length || 0,
    vodCount: Object.keys(state.vodPayloads || {}).length,
    draftStep: state.activeSeries?.draft?.stepIndex,
    draftPhase: state.activeSeries?.draft?.phase,
    assignSig: JSON.stringify(state.activeSeries?.draft?.assignConfirmed || {}),
    bluePicksSig: (state.activeSeries?.draft?.bluePicks || []).join(","),
    redPicksSig: (state.activeSeries?.draft?.redPicks || []).join(","),
    ritePicksSig: JSON.stringify(state.activeMatch?.ritePicks || {}),
    arcadeBoxId: state.activeMatch?.boxscore?.id || "",
    prefMap: state.preferredMapId || "AUTO",
    activeMap: state.activeSeries?.mapId || "starlight_sanctum",
    riteLen: state.activeSeries?.riteOptions?.length,
    poRound: state.playoffs?.round,
    poChamp: state.playoffs?.championSeat,
    rosterSig: state.seats[state.localSeatIndex]?.roster
      ?.map((p) => `${p.playerId}:${p.condition}:${p.stats.mechanics}:${p.slump ? 1 : 0}`)
      .join(",")
  });
  if (sig === lastRenderedNonCombatSig) return;
  lastRenderedNonCombatSig = sig;

  if (state.screen === SCREEN_STATES.LOBBY) renderLobbyScreen(state);
  else if (state.screen === SCREEN_STATES.ARCADE_LOBBY) renderArcadeLobbyScreen(state);
  else if (state.screen === SCREEN_STATES.WEEKLY_HUB) renderWeeklyHub(state);
  else if (state.screen === SCREEN_STATES.DRAFT) renderDraftScreen(state);
  else if (state.screen === SCREEN_STATES.RITE_DRAFT) renderRiteDraftScreen(state);
  else if (state.screen === SCREEN_STATES.PLAYOFF_BRACKET) renderPlayoffScreen(state);
  else if (state.screen === SCREEN_STATES.STOVE_LEAGUE) renderStoveLeagueScreen(state);

  if (
    state.latestDailyNews?.id &&
    state.latestDailyNews.id !== lastNewsShownId &&
    [SCREEN_STATES.WEEKLY_HUB, SCREEN_STATES.PLAYOFF_BRACKET, SCREEN_STATES.STOVE_LEAGUE].includes(state.screen)
  ) {
    lastNewsShownId = state.latestDailyNews.id;
    openDailyNewsModal(state);
  }
}

export const updateHUD = renderHUD;

function renderLobbyScreen(state) {
  dom["lobby-room-status"].textContent = state.roomCode
    ? `ROOM ${state.roomCode} · SEAT #${state.localSeatIndex + 1}`
    : "방 대기 중";

  if (dom["lobby-schedule-mode"]) {
    const curMode = state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
    const items = [
      { id: SCHEDULE_MODES.REALTIME_DAILY, title: "데일리 21:00", sub: "매일 1R (월~일)" },
      { id: SCHEDULE_MODES.HOURLY_BLITZ, title: "1시간 블리츠", sub: "매 정시 1R" },
      { id: SCHEDULE_MODES.INSTANT_TEST, title: "즉시 테스트", sub: "즉시 개막 가능" }
    ];
    dom["lobby-schedule-mode"].innerHTML = items
      .map(
        (it) => `
        <button class="sched-mode-btn ${curMode === it.id ? "is-selected" : ""}" data-schedule-mode="${it.id}" type="button">
          <strong>${it.title}</strong>
          <span>${it.sub}</span>
        </button>`
      )
      .join("");
  }

  if (dom["lobby-map-selector"]) {
    const pref = state.preferredMapId || "AUTO";
    const cardsHtml = MAP_ORDER.map((mid) => {
      const m = ARENA_MAPS[mid];
      const active = pref === mid;
      return `
        <button class="map-pick-card ${active ? "is-selected" : ""}" data-select-map="${m.id}" type="button" style="--map-accent:${m.accentColor}">
          ${renderMapMiniSvg(m)}
          <div class="map-pick-info">
            <div class="map-pick-name">${escapeHtml(m.name)}</div>
            <div class="map-pick-tag">${escapeHtml(m.tag)}</div>
          </div>
        </button>
      `;
    }).join("");
    dom["lobby-map-selector"].innerHTML = `
      <button class="map-auto-btn ${pref === "AUTO" ? "is-selected" : ""}" data-select-map="AUTO" type="button">
        <strong>세트별 자동 로테이션 (AUTO)</strong>
        <span>4개 아레나 전장 순환</span>
      </button>
      ${cardsHtml}
    `;
  }

  dom["lobby-seats-list"].innerHTML = state.seats
    .map((seat) => renderSeatRow(state, seat, { self: "조종 중" }))
    .join("");
}

function renderWeeklyHub(state) {
  const mySeat = state.seats[state.localSeatIndex] || state.seats[0];
  updateScheduleCountdownHUD(state);
  const myCoach = mySeat.headCoach || getHeadCoachById(mySeat.headCoachId);
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
        <div>
          <div class="hub-team-title">${escapeHtml(shortTeamName(mySeat.teamName))}</div>
          <div class="muted-text small">GM ${escapeHtml(mySeat.gmName || "Owner")} · 감독 ${escapeHtml(myCoach.name)} (EGO ${myCoach.stats.ego}%)</div>
        </div>
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
      <span>시그니처: ${escapeHtml(getChampionById(myCoach.signatureChamp).shortName)}</span>
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

    const completedWithVod = [];
    for (const wk of state.schedule || []) {
      for (const m of wk.matches || []) {
        if (m.completed && state.vodPayloads?.[m.matchId]) {
          completedWithVod.push({ week: wk.week, match: m });
        }
      }
    }

    const matchesHtml = (weekObj?.matches || [])
      .map((m) => {
        const h = state.seats[m.homeSeat];
        const a = state.seats[m.awaySeat];
        const isMine = m.homeSeat === mySeat.seatIndex || m.awaySeat === mySeat.seatIndex;
        const hasVod = Boolean(m.completed && state.vodPayloads?.[m.matchId]);
        const score = m.completed
          ? `<span class="sched-score-wrap"><strong class="num">${m.homeSets} : ${m.awaySets}</strong>${hasVod ? `<button class="vod-pill-btn" data-vod-match="${m.matchId}" type="button">VOD</button>` : ""}</span>`
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

    const recentVodHtml = completedWithVod
      .slice(-4)
      .reverse()
      .map(({ week, match }) => {
        const h = state.seats[match.homeSeat];
        const a = state.seats[match.awaySeat];
        return `
          <div class="schedule-item">
            <span class="sched-team">W${week} · ${teamAbbr(h.teamName)}</span>
            <span class="sched-score-wrap"><strong class="num">${match.homeSets}:${match.awaySets}</strong><button class="vod-pill-btn" data-vod-match="${match.matchId}" type="button">VOD 재생</button></span>
            <span class="sched-team right">${teamAbbr(a.teamName)}</span>
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
      ${
        recentVodHtml
          ? `<div class="card">
               <div class="card-header-row"><h3 class="card-title">MATCH VOD ARCHIVE</h3><span class="muted-text">1x/2x/4x 시드 재현</span></div>
               <div class="schedule-list">${recentVodHtml}</div>
             </div>`
          : ""
      }
    `;
  } else if (activeHubTab === "COACH") {
    const note = mySeat.banPickNote || { mustBans: [], priorityPicks: [], counterStrategy: "AUTO_COUNTER", ritePreference: "ORB", autoCallTrigger: "ORB_SPAWN" };
    const champList = Object.values(CHAMPIONS);

    const mustBanChips = champList
      .map((c) => {
        const on = (note.mustBans || []).includes(c.id);
        return `<button class="champ-mini-chip ${on ? "is-ban" : ""}" data-note-ban="${c.id}" type="button" style="--champ:${c.color}">${escapeHtml(c.shortName)}</button>`;
      })
      .join("");
    const prioPickChips = champList
      .map((c) => {
        const on = (note.priorityPicks || []).includes(c.id);
        return `<button class="champ-mini-chip ${on ? "is-pick" : ""}" data-note-pick="${c.id}" type="button" style="--champ:${c.color}">${escapeHtml(c.shortName)}</button>`;
      })
      .join("");

    const strategyBtns = Object.values(BAN_PICK_STRATEGIES)
      .map(
        (s) => `
        <button class="note-opt-btn ${note.counterStrategy === s.id ? "is-selected" : ""}" data-note-strategy="${s.id}" type="button">
          <strong>${escapeHtml(s.name)}</strong>
          <span>${escapeHtml(s.desc)}</span>
        </button>`
      )
      .join("");

    const ritePrefBtns = Object.values(RITE_PREFERENCES)
      .map(
        (r) => `
        <button class="note-opt-btn ${note.ritePreference === r.id ? "is-selected" : ""}" data-note-rite="${r.id}" type="button">
          <strong>${escapeHtml(r.name)}</strong>
          <span>${escapeHtml(r.desc)}</span>
        </button>`
      )
      .join("");

    const callTriggerBtns = Object.values(AUTO_CALL_TRIGGERS)
      .map(
        (t) => `
        <button class="note-opt-btn ${note.autoCallTrigger === t.id ? "is-selected" : ""}" data-note-call="${t.id}" type="button">
          <strong>${escapeHtml(t.name)}</strong>
          <span>${escapeHtml(t.desc)}</span>
        </button>`
      )
      .join("");

    const marketCards = HEAD_COACHES.map((c) => renderCoachCardHtml(c, mySeat, true)).join("");

    dom["hub-tab-content"].innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">HEAD COACH BRIEFING</h3>
          <button class="btn btn-accent btn-sm" data-open-coach-market="1" type="button">감독 영입 시장</button>
        </div>
        ${renderCoachCardHtml(myCoach, mySeat, false)}
      </div>

      <div class="card banpick-note-card">
        <div class="card-header-row">
          <h3 class="card-title">PRE-MATCH BAN/PICK NOTE</h3>
          <span class="muted-text">감독 위임 지시서</span>
        </div>

        <div class="note-section">
          <div class="note-sec-head"><span>1차 필수 밴 (최대 2명)</span><strong class="num">${(note.mustBans || []).length}/2</strong></div>
          <div class="champ-mini-grid">${mustBanChips}</div>
        </div>

        <div class="note-section">
          <div class="note-sec-head"><span>최우선 확보 픽 (최대 2명)</span><strong class="num">${(note.priorityPicks || []).length}/2</strong></div>
          <div class="champ-mini-grid">${prioPickChips}</div>
        </div>

        <div class="note-section">
          <div class="note-sec-head"><span>조합 · 카운터 기조</span></div>
          <div class="note-opt-grid">${strategyBtns}</div>
        </div>

        <div class="note-section">
          <div class="note-sec-head"><span>증강(Rite) 선택 성향</span></div>
          <div class="note-opt-grid">${ritePrefBtns}</div>
        </div>

        <div class="note-section">
          <div class="note-sec-head"><span>감독 자동 전술 콜 타이밍</span></div>
          <div class="note-opt-grid cols-3">${callTriggerBtns}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">AI HEAD COACH MARKET (8)</h3>
          <span class="gold-text num">${mySeat.funds}G</span>
        </div>
        <div class="stack-7">${marketCards}</div>
      </div>
    `;
  } else if (activeHubTab === "MANAGEMENT") {
    const autoSched = mySeat.autoSchedule || { MORNING: "SOLO_GRIND", AFTERNOON: "TEAM_SCRIM", NIGHT: "REST_CARE", focusStat: "mechanics" };
    const focusStat = autoSched.focusStat || "mechanics";
    const payroll = computeRoundPayroll(mySeat);
    const activeSponsor = getSponsorById(mySeat.sponsorId);
    const fac = mySeat.facilities || { trainingCenter: 1, analyticsLab: 1, medicalBay: 1 };
    const lastSettle = mySeat.lastSettlement;

    const slotDefs = [
      { key: "MORNING", label: "오전 (09:00)", icon: "🌅" },
      { key: "AFTERNOON", label: "오후 (15:00)", icon: "☀️" },
      { key: "NIGHT", label: "야간 (22:00)", icon: "🌙" }
    ];
    const actEntries = Object.values(ROUTINE_ACTIVITIES);
    const routineRowsHtml = slotDefs.map((slot) => {
      const curAct = autoSched[slot.key] || "REST_CARE";
      const btns = actEntries.map((a) => `
        <button class="routine-act-btn ${curAct === a.id ? "is-selected" : ""}" data-routine-slot="${slot.key}" data-routine-act="${a.id}" type="button" title="${escapeHtml(a.desc)}">
          <span>${escapeHtml(a.short || a.name)}</span>
        </button>`).join("");
      return `
        <div class="routine-slot-row">
          <div class="routine-slot-label"><strong>${slot.icon} ${slot.label}</strong><span class="muted-text small">${escapeHtml(ROUTINE_ACTIVITIES[curAct]?.desc || "")}</span></div>
          <div class="routine-act-grid">${btns}</div>
        </div>`;
    }).join("");

    const focusOptions = [
      { key: "mechanics", label: "MEC 피지컬" },
      { key: "reflex", label: "REF 반응" },
      { key: "teamwork", label: "TMW 팀워크" },
      { key: "mental", label: "MNT 멘탈" }
    ];
    const focusHtml = focusOptions.map((f) => `
      <button class="note-pill-btn ${focusStat === f.key ? "is-selected" : ""}" data-routine-focus="${f.key}" type="button">${f.label}</button>`).join("");

    const sponsorHtml = SPONSOR_CONTRACTS.map((sp) => {
      const active = mySeat.sponsorId === sp.id;
      return `
        <button class="sponsor-card-btn ${active ? "is-selected" : ""}" data-select-sponsor="${sp.id}" type="button">
          <div class="card-header-row" style="margin-bottom:2px;">
            <strong>${escapeHtml(sp.name)}</strong>
            <span class="gold-text num">+${sp.bonusGold}G</span>
          </div>
          <div class="muted-text small">${escapeHtml(sp.conditionDesc)}</div>
        </button>`;
    }).join("");

    const facilityHtml = Object.values(FACILITY_DEFS).map((def) => {
      const lv = fac[def.key] || 1;
      const isMax = lv >= def.maxLevel;
      const cost = def.baseCost * lv;
      const canBuy = !isMax && !mySeat.inDebt && mySeat.funds >= cost;
      return `
        <div class="facility-row">
          <div class="facility-info">
            <strong>${escapeHtml(def.name)} <span class="gold-text num">Lv.${lv}/${def.maxLevel}</span></strong>
            <div class="muted-text small">${escapeHtml(def.bonusDesc)}</div>
          </div>
          <button class="btn ${canBuy ? "btn-accent" : "btn-ghost"} btn-sm" data-upgrade-facility="${def.key}" ${canBuy ? "" : "disabled"} type="button">
            ${isMax ? "MAX" : `증축 ${cost}G`}
          </button>
        </div>`;
    }).join("");

    const debtBanner = mySeat.inDebt
      ? `<div class="debt-alert-banner">🚨 <strong>구단 적자(임금 체불) 경보!</strong> 보유 자금 <span class="num">${mySeat.funds}G</span> — 전 선수 능력치 <strong>-10%</strong> &amp; 영입/시설 증축 잠금!</div>`
      : "";

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
      ${debtBanner}
      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">24H 자동 훈련 루틴</h3>
          <button class="btn btn-ghost btn-sm" data-open-daily-news="1" type="button">📰 데일리 뉴스</button>
        </div>
        <div class="stack-7">${routineRowsHtml}</div>
        <div class="note-sub-label" style="margin-top:8px;">개인 훈련 집중 스탯</div>
        <div class="note-pills-wrap">${focusHtml}</div>
      </div>

      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">구단 재정 &amp; 스폰서 계약</h3>
          <span class="num ${mySeat.inDebt ? "red-text" : "gold-text"}">잔액 ${mySeat.funds}G · 인건비 -${payroll}G/R</span>
        </div>
        ${lastSettle ? `<div class="settlement-strip num">직전 정산(${escapeHtml(lastSettle.roundLabel)}): 상금 +${lastSettle.prize}G · 스폰서 +${lastSettle.sponsorBonus}G · 인건비 -${lastSettle.payroll}G → <strong class="${lastSettle.net >= 0 ? "heal-text" : "red-text"}">${lastSettle.net >= 0 ? "+" : ""}${lastSettle.net}G</strong></div>` : ""}
        <div class="muted-text small" style="margin:4px 0 6px;">현재 스폰서: <strong>${escapeHtml(activeSponsor.name)}</strong> (${escapeHtml(activeSponsor.conditionDesc)})</div>
        <div class="stack-6">${sponsorHtml}</div>
      </div>

      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">구단 시설 증축 (Lv.1~5)</h3>
          <span class="muted-text">${mySeat.inDebt ? "적자 잠금" : "영구 보너스"}</span>
        </div>
        <div class="stack-7">${facilityHtml}</div>
      </div>

      <div class="card">
        <div class="card-header-row">
          <h3 class="card-title">긴급 수동 지시 (${mySeat.ap} AP)</h3>
          <span class="muted-text">즉시 반영</span>
        </div>
        <div class="action-grid" style="margin-bottom:8px;">
          <div class="ap-card">
            <div class="ap-card-title">긴급 팀 스크림</div>
            <div class="ap-card-desc">숙련도 +1 · 팀워크 +3</div>
            <button class="btn btn-primary btn-sm" data-action-scrim="1" ${disabled} type="button">실행 · 1 AP</button>
          </div>
          <div class="ap-card">
            <div class="ap-card-title">긴급 휴식 케어</div>
            <div class="ap-card-desc">전원 컨디션 +22 · 멘탈 +3</div>
            <button class="btn btn-accent btn-sm" data-action-rest="1" ${disabled} type="button">실행 · 1 AP</button>
          </div>
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
      const canSignFa = !mySeat.inDebt && mySeat.ap > 0 && mySeat.funds >= p.cost;
      const actionArea = isFA
        ? `<button class="btn btn-accent btn-sm" data-action-fa="${idx}" ${canSignFa ? "" : "disabled"} type="button">${mySeat.inDebt ? "적자 잠금" : `영입 <span class="num">${p.cost}G</span> · 1 AP`}</button>`
        : isStarter
          ? `<button class="btn btn-ghost btn-sm" data-action-swap="${idx}" type="button">후보와 교체 · 0 AP</button>`
          : `<span class="seat-badge badge-ai">SUB</span>`;
      const slumpTag = p.slump ? `<span class="slump-pill">SLUMP -10%</span>` : "";

      return `
        <div class="player-card ${isFA ? "is-fa" : isStarter ? "is-starter" : "is-sub"}">
          <div class="player-top-row">
            <div class="player-identity">
              <span class="role-svg-badge">${getRoleSvg(topChamp.role, topChamp.color, 14)}</span>
              <div>
                <strong class="player-name">${isFA ? "FA" : isStarter ? `ST${idx + 1}` : "SUB"} · ${escapeHtml(p.name)} ${slumpTag}</strong>
                <div class="muted-text small">${escapeHtml(traitObj.name)} · COND <span class="num">${p.condition}%</span> · 급여 <span class="num">${p.salary || 180}G</span></div>
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
          .map((n) => {
            const entry = (b, buff) => `
              <div class="patch-entry">
                <span class="patch-pill ${buff ? "badge-buff" : "badge-nerf"}">${buff ? "▲ BUFF" : "▼ NERF"}</span>
                <span class="patch-name"><strong>${escapeHtml(b.name || "")}</strong></span>
                <span class="num muted-text">${escapeHtml(b.change || "")}</span>
              </div>`;
            const changeItems = Array.isArray(n.changes)
              ? n.changes
                  .map((line) => {
                    const isNerf = String(line).startsWith("▼");
                    const clean = String(line).replace(/^[▲▼]\s*/, "");
                    const parts = clean.split(":");
                    return entry(
                      { name: (parts[0] || clean).trim(), change: (parts.slice(1).join(":") || "").trim() },
                      !isNerf
                    );
                  })
                  .join("")
              : "";
            const structuredItems =
              (Array.isArray(n.buffs) ? n.buffs.map((b) => entry(b, true)).join("") : "") +
              (Array.isArray(n.nerfs) ? n.nerfs.map((b) => entry(b, false)).join("") : "");
            return `
              <div class="card">
                <div class="card-header-row">
                  <h3 class="card-title">PATCH ${escapeHtml(n.version)}</h3>
                  <span class="pill pill-muted">WEEK ${n.week}</span>
                </div>
                <div class="patch-list">${changeItems || structuredItems}</div>
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

  const isArcade = state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P";
  const myTeamSide = series.redSeat === state.localSeatIndex ? "red" : "blue";

  dom["draft-series-title"].textContent = isArcade
    ? `⚔️ ARCADE LIVE · Bo3 · ${teamAbbr(blueSeat.teamName)} vs ${teamAbbr(redSeat.teamName)}`
    : `${state.playoffs?.active ? "PLAYOFFS" : `WEEK ${state.week}`} · Bo${series.bestOf} · ${teamAbbr(blueSeat.teamName)} vs ${teamAbbr(redSeat.teamName)}`;

  if (dom["draft-map-banner"]) {
    const mapDef = getArenaMapById(series.mapId || series.selectedMapId || "starlight_sanctum");
    dom["draft-map-banner"].innerHTML = `
      ${renderMapMiniSvg(mapDef)}
      <div class="draft-map-info">
        <div class="draft-map-title">전장: <strong>${escapeHtml(mapDef.name)}</strong> <span class="muted-text">(${escapeHtml(mapDef.tag)})</span></div>
        <div class="muted-text">${escapeHtml(mapDef.desc)}</div>
      </div>
    `;
  }

  if (dom["draft-coach-bar"]) {
    if (isArcade) {
      const turnTeam = step ? step.team.toUpperCase() : "ASSIGN";
      const isMyTurn = step
        ? step.team === myTeamSide
        : !(draft.assignConfirmed?.[myTeamSide]);
      dom["draft-coach-bar"].innerHTML = `
        <div class="draft-coach-top">
          <span class="draft-coach-status">${draft.phase === "PLAYER_ASSIGN" ? "🧩 주전 3인 챔피언 배정" : `🎮 2인 직접 밴픽 (${turnTeam})`}</span>
          <span class="pill ${isMyTurn ? "pill-neon" : "pill-muted"}">${isMyTurn ? "내 차례" : "상대 차례"}</span>
        </div>
        <div class="draft-coach-log">${draft.phase === "PLAYER_ASSIGN" ? "선수별 챔피언 배정을 확인·교대한 뒤 [배정 확정]을 누르세요." : "내 턴에 전술 카드를 탭하여 직접 밴/픽을 확정합니다."}</div>
      `;
    } else {
      const myCoach = mySeat?.headCoach || getHeadCoachById(mySeat?.headCoachId);
      const logs = series.coachLogs || [];
      const latestLog = logs[0] || `🎙️ [${myCoach.name}] 구단주님의 밴픽 노트에 따라 드래프트를 집행합니다.`;
      const overrideOn = Boolean(state.liveOverride);
      dom["draft-coach-bar"].innerHTML = `
        <div class="draft-coach-top">
          <span class="draft-coach-status">${overrideOn ? "✋ 구단주 긴급 개입 중" : `🤖 ${escapeHtml(myCoach.name)} 자동 지휘 중`}</span>
          <div class="draft-coach-btns">
            <button class="mini-btn ${overrideOn ? "is-override" : ""}" data-toggle-override="1" type="button">${overrideOn ? "감독위임 복귀" : "긴급 개입"}</button>
            <button class="mini-btn" data-coach-step="1" type="button">감독 진행</button>
          </div>
        </div>
        <div class="draft-coach-log">${escapeHtml(latestLog)}</div>
      `;
    }
  }

  if (step) {
    const side = step.team === "blue" ? "BLUE" : "RED";
    dom["draft-phase-banner"].textContent = `${side} ${step.type === "ban" ? "BAN" : "PICK"} ${draft.stepIndex + 1}/8`;
    dom["draft-phase-banner"].className = `draft-phase-banner ${step.team === "red" ? "is-red" : "is-blue"}`;
  } else if (draft.phase === "PLAYER_ASSIGN") {
    dom["draft-phase-banner"].textContent = "PLAYER ASSIGNMENT";
    dom["draft-phase-banner"].className = "draft-phase-banner";
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

  if (draft.phase === "PLAYER_ASSIGN") {
    dom["draft-champ-grid"].classList.add("hidden");
    if (dom["draft-assign-panel"]) {
      dom["draft-assign-panel"].classList.remove("hidden");
      const myPicks = myTeamSide === "red" ? draft.redPicks : draft.bluePicks;
      const confirmed = Boolean(draft.assignConfirmed?.[myTeamSide]);
      const assignRows = (mySeat?.roster || []).slice(0, 3).map((p, idx) => {
        const cid = myPicks[idx] || "kylen";
        const c = getChampionById(cid);
        return `
          <div class="assign-slot-row">
            <div>
              <strong>ST${idx + 1} · ${escapeHtml(p.name)}</strong>
              <div class="muted-text small">MEC ${p.stats.mechanics} · REF ${p.stats.reflex}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="mastery-chip" style="border-color:${c.color}">${getRoleSvg(c.role, c.color, 12)} ${escapeHtml(c.shortName)}</span>
              <button class="btn btn-ghost btn-sm" data-assign-swap="${idx}" ${confirmed ? "disabled" : ""} type="button">⇅ 교대</button>
            </div>
          </div>`;
      }).join("");
      dom["draft-assign-panel"].innerHTML = `
        <div class="card">
          <div class="card-header-row">
            <h3 class="card-title">${myTeamSide.toUpperCase()} 팀 주전 챔피언 배정</h3>
            <span class="muted-text">${confirmed ? "상대 확정 대기 중..." : "포지션 스왑 가능"}</span>
          </div>
          <div class="stack-7">${assignRows}</div>
          <button class="btn btn-primary btn-block" style="margin-top:10px;" data-assign-confirm="1" ${confirmed ? "disabled" : ""} type="button">
            ${confirmed ? "✅ 배정 확정 완료 (대기 중)" : "⚔️ 선수 배정 확정 · 1세트 개시"}
          </button>
        </div>`;
    }
    return;
  }

  dom["draft-champ-grid"].classList.remove("hidden");
  if (dom["draft-assign-panel"]) dom["draft-assign-panel"].classList.add("hidden");

  const isMyTurnPick = !isArcade || !step || step.team === myTeamSide;
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
      const used = taken.has(c.id) || !isMyTurnPick;
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

  const mapDef = getArenaMapById(combat.arena?.mapId || series.mapId || "starlight_sanctum");
  const modeTag = series.isReplay || series.seriesMode === "VOD_REPLAY"
    ? "VOD REPLAY"
    : combat.suddenDeath
      ? "SUDDEN DEATH"
      : `${escapeHtml(mapDef.name)} · SET ${series.currentSet}/${series.bestOf}`;
  dom["combat-scoreboard"].innerHTML = `
    <div class="sb-team sb-blue">
      <span class="sb-abbr">${teamAbbr(blueSeat?.teamName || "BLUE")}</span>
      <span class="sb-pips">${pips(series.blueWins, "blue-won")}</span>
      <span class="sb-score num">${series.blueWins}</span>
    </div>
    <div class="sb-center ${combat.suddenDeath ? "is-sd" : ""}">
      <div class="sb-time num">${mm}:${ss}</div>
      <div class="sb-meta">${modeTag} · <span class="num">${orbText}</span></div>
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
  if (dom["btn-live-override"]) {
    const ov = Boolean(state.liveOverride);
    dom["btn-live-override"].textContent = series.isReplay ? "VOD" : ov ? "긴급개입" : "감독위임";
    dom["btn-live-override"].classList.toggle("is-override", ov);
    dom["btn-live-override"].disabled = Boolean(series.isReplay);
  }
  dom["btn-speed-toggle"].textContent = `${combat.speedMult || 1}x`;
  dom["btn-pause-combat"].textContent = combat.paused ? "재개" : "정지";

  if (dom["vod-timeline-bar"]) {
    const isVod = Boolean(series.isReplay || series.seriesMode === "VOD_REPLAY");
    dom["vod-timeline-bar"].classList.toggle("hidden", !isVod);
    if (isVod) {
      const totalSets = Math.max(1, series.replayTotalSets || 1);
      const curSetIdx = Number(series.replaySetIndex || 0);
      const setTabsHtml = Array.from({ length: totalSets }, (_, idx) => `
        <button class="vod-tab-btn ${idx === curSetIdx ? "is-active" : ""}" data-vod-set="${idx}" type="button">${idx + 1}세트</button>
      `).join("");

      const dur = Math.max(1, combat.duration || 45);
      const elapsed = Math.max(0, Math.min(dur, combat.elapsed ?? (dur - combat.timer)));
      const pct = Math.max(0, Math.min(100, (elapsed / dur) * 100));

      dom["vod-timeline-bar"].innerHTML = `
        <div class="vod-tl-top">
          <div class="vod-set-tabs">${setTabsHtml}</div>
          <div class="vod-ctrl-btns">
            <button class="mini-btn" data-vod-pause="1" type="button">${combat.paused ? "▶" : "⏸"}</button>
            <button class="mini-btn" data-vod-speed="1" type="button">${combat.speedMult || 1}x</button>
            <button class="mini-btn vod-skip-btn" data-vod-skip="1" type="button">⏭ 다음 교전/킬 스킵</button>
          </div>
        </div>
        <div class="vod-progress-row">
          <div class="vod-progress-track"><div class="vod-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="vod-time-label num">${elapsed.toFixed(1)}s / ${dur.toFixed(0)}s</span>
        </div>
      `;
    }
  }

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
    const isReplay = Boolean(series.isReplay || series.seriesMode === "VOD_REPLAY");
    if (lastRoundEndShown !== key) {
      lastRoundEndShown = key;
      const winSeat = combat.winnerTeam === "blue" ? blueSeat : redSeat;
      const isExhibition = series.seriesMode === "EXHIBITION";
      dom["round-end-overlay"].innerHTML = `
        <div class="re-kicker">${isReplay ? `VOD SET ${series.currentSet}` : `SET ${series.currentSet} RESULT`}</div>
        <div class="re-title ${combat.winnerTeam === "blue" ? "blue" : "red"}">${teamAbbr(winSeat?.teamName || combat.winnerTeam)} WIN</div>
        <div class="muted-text">${escapeHtml(shortTeamName(winSeat?.teamName || ""))}${isExhibition ? " · 친선전" : isReplay ? ` · 리플레이 (${series.replaySetIndex + 1}/${series.replayTotalSets})` : ` · 시리즈 <span class="num">${series.blueWins} : ${series.redWins}</span>`}</div>
        <div class="re-actions">
          ${
            isExhibition
              ? `<button class="btn btn-primary" data-exhibition-shuffle="1" type="button">랜덤 조합 재대결</button>
                 <button class="btn btn-ghost" data-back-hub="1" type="button">허브로</button>`
              : `<button class="btn btn-primary" data-round-next="${combat.winnerTeam}" type="button">${isReplay ? "다음 세트 VOD / 허브" : "다음 진행"}</button>`
          }
        </div>
      `;
      dom["round-end-overlay"].classList.remove("hidden");
    }
  } else {
    lastRoundEndShown = null;
    dom["round-end-overlay"].classList.add("hidden");
    dom["round-end-overlay"].innerHTML = "";
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
  const mySeat = state.seats[state.localSeatIndex];
  const myCoach = mySeat?.headCoach || getHeadCoachById(mySeat?.headCoachId);
  const myRites = myTeamSide === "blue" ? series.blueRites : series.redRites;

  dom["rite-series-header"].innerHTML = `
    <span class="sb-abbr blue-text">${teamAbbr(blueSeat.teamName)}</span>
    <span class="num rite-score">${series.blueWins} : ${series.redWins}</span>
    <span class="sb-abbr red-text">${teamAbbr(redSeat.teamName)}</span>
    <span class="muted-text">· Bo${series.bestOf} · NEXT SET ${series.currentSet + 1}</span>
  `;

  const isArcade = state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P";
  const myRitePicked = isArcade ? state.activeMatch?.ritePicks?.[myTeamSide] : null;

  if (dom["rite-coach-actions"]) {
    if (isArcade) {
      dom["rite-coach-actions"].innerHTML = myRitePicked
        ? `<span class="gold-text">⏳ <strong>${escapeHtml(getRiteById(myRitePicked).name)}</strong> 선택 완료 · 상대 플레이어 선택 대기 중...</span>`
        : `<span class="muted-text">2인 라이브 Bo3 · 다음 세트에 사용할 증강 1장을 선택하세요</span>`;
    } else {
      const prefDef = RITE_PREFERENCES[mySeat?.banPickNote?.ritePreference || "ORB"];
      dom["rite-coach-actions"].innerHTML = `
        <span class="muted-text">${escapeHtml(myCoach.name)} 성향: <strong>${escapeHtml(prefDef?.name || "오브·기동")}</strong></span>
        <button class="btn btn-accent btn-sm" data-coach-rite="1" type="button">감독 추천 자동 선택</button>
      `;
    }
  }

  dom["rite-cards-list"].innerHTML = (series.riteOptions || [])
    .map((riteId) => {
      const r = getRiteById(riteId);
      const isSelected = myRitePicked === r.id;
      return `
        <button class="rite-card-btn cat-${String(r.category).toLowerCase()} ${isSelected ? "is-selected" : ""}" data-rite-id="${r.id}" ${myRitePicked ? "disabled" : ""} type="button">
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

export function openDailyNewsModal(state) {
  const news = state?.latestDailyNews;
  if (!news) {
    showModal("아레나 데일리 뉴스", `<p class="muted-text">아직 발행된 경기 뉴스가 없습니다. 라운드가 종료되면 첫 브리핑이 발행됩니다!</p>`);
    return;
  }
  const historyHtml = (state.dailyNewsHistory || []).slice(1, 4).map((n) => `
    <div class="news-hist-item">
      <span class="muted-text small">S${n.season} · ${escapeHtml(n.roundLabel)}</span>
      <div>${escapeHtml(n.headline)}</div>
    </div>`).join("");

  showModal(
    `📰 아레나 데일리 · S${news.season} ${news.roundLabel}`,
    `<div class="daily-news-sheet">
      <div class="news-headline">${escapeHtml(news.headline)}</div>
      <div class="news-section">
        <div class="news-label">MATCH OF THE DAY &amp; POG</div>
        <div class="news-text">${escapeHtml(news.matchOfTheDay)}</div>
        <div class="news-mvp">${escapeHtml(news.mvpLine)}</div>
      </div>
      <div class="news-section">
        <div class="news-label">HEAD COACH DRAMA</div>
        <div class="news-text">${escapeHtml(news.coachDrama)}</div>
      </div>
      ${news.clubBrief ? `<div class="news-section"><div class="news-label">CLUB FINANCE REPORT</div><div class="news-text num">${escapeHtml(news.clubBrief)}</div></div>` : ""}
      ${news.financialAlert ? `<div class="news-alert">${escapeHtml(news.financialAlert)}</div>` : ""}
      ${historyHtml ? `<div class="news-section"><div class="news-label">ARCHIVE</div><div class="stack-6">${historyHtml}</div></div>` : ""}
    </div>`
  );
}

function renderStoveLeagueScreen(state) {
  const po = state.playoffs || {};
  const champSeat = po.championSeat !== null && po.championSeat !== undefined ? state.seats[po.championSeat] : null;
  const mySeat = state.seats[state.localSeatIndex];

  if (dom["stove-header"]) {
    dom["stove-header"].innerHTML = champSeat
      ? `<div class="po-kicker">SEASON ${state.seasonNumber || 1} STOVE LEAGUE</div>
         <div class="po-title gold-text">🏆 ${teamAbbr(champSeat.teamName)} · ${escapeHtml(shortTeamName(champSeat.teamName))} CHAMPION!</div>
         <div class="muted-text">우승 상금 +3,000G 정산 · 보유 자금 <span class="gold-text num">${mySeat.funds}G</span></div>`
      : `<div class="po-kicker">STOVE LEAGUE</div><div class="po-title">오프시즌 이적 시장</div>`;
  }

  if (!dom["stove-content"]) return;

  const hofHtml = (state.hallOfFame || []).map((h) => `
    <div class="hof-row">
      <span class="hof-season num">S${h.season}</span>
      <span class="hof-team"><i class="team-bar" style="background:${h.teamColor}"></i><strong>${escapeHtml(h.teamName)}</strong></span>
      <span class="muted-text small">${escapeHtml(h.record)} · MVP ${escapeHtml(h.mvpName)}</span>
    </div>`).join("") || `<div class="muted-text small">기록된 시즌 우승이 없습니다.</div>`;

  const rookies = state.stoveRookies || [];
  const rookieHtml = rookies.length > 0
    ? rookies.map((rk, idx) => {
        const traitName = TRAITS[rk.trait]?.name || rk.trait;
        const ovr = Math.round((rk.stats.mechanics + rk.stats.reflex + rk.stats.teamwork + rk.stats.mental) / 4);
        const canSign = !mySeat.inDebt && mySeat.funds >= rk.cost;
        return `
          <div class="player-card is-fa">
            <div class="player-top-row">
              <div>
                <strong class="player-name">🌟 신인 · ${escapeHtml(rk.name)}</strong>
                <div class="muted-text small">${escapeHtml(traitName)} · MEC ${rk.stats.mechanics} / REF ${rk.stats.reflex} / TMW ${rk.stats.teamwork} / MNT ${rk.stats.mental}</div>
              </div>
              <div class="ovr-badge num">${ovr}</div>
            </div>
            <button class="btn btn-accent btn-sm" data-sign-rookie="${idx}" ${canSign ? "" : "disabled"} type="button">
              ${mySeat.inDebt ? "적자 잠금" : `특급 신인 계약 (${rk.cost}G)`}
            </button>
          </div>`;
      }).join("")
    : `<div class="muted-text small">이번 오프시즌 모든 특급 신인이 계약되었습니다.</div>`;

  dom["stove-content"].innerHTML = `
    <div class="card">
      <div class="card-header-row"><h3 class="card-title">🏛️ 명예의 전당 (HALL OF FAME)</h3><span class="gold-text num">${(state.hallOfFame || []).length}회</span></div>
      <div class="stack-6">${hofHtml}</div>
    </div>
    <div class="card">
      <div class="card-header-row"><h3 class="card-title">🌟 초특급 신인 드래프트 (SUPER ROOKIES)</h3><span class="muted-text">SUB 슬롯 영입</span></div>
      <div class="stack-7">${rookieHtml}</div>
    </div>
    <div class="card">
      <div class="muted-text small">다음 시즌(Season ${(state.seasonNumber || 1) + 1}) 개막 시 현재 로스터·시설·자산·명예의 전당이 승계되며, AI 구단은 스탯 +3 성장 스케일링이 적용됩니다!</div>
    </div>
  `;
}

export function openArcadeBoxscoreModal(state) {
  const box = state?.activeMatch?.boxscore;
  if (!box) return;
  const winTeam = box.winnerTeam === "blue" ? box.blueTeamName : box.redTeamName;
  const fighterRows = (box.fighters || []).map((f) => `
    <tr>
      <td><span class="${f.team === "blue" ? "blue-text" : "red-text"}">${f.team.toUpperCase()}</span> ${escapeHtml(f.playerName)}</td>
      <td>${escapeHtml(getChampionById(f.champId).shortName)}</td>
      <td class="num">${f.damageDealt}</td>
      <td class="num">${f.kills}</td>
      <td class="num">${f.countersTriggered}/${f.orbsDestroyed}</td>
    </tr>`).join("");

  const mvpHtml = box.mvpUnit
    ? `<div class="news-mvp">🏆 SERIES POG: ${escapeHtml(box.mvpUnit.playerName)} (${escapeHtml(box.mvpUnit.champName)}) · 피해량 ${box.mvpUnit.damageDealt}</div>`
    : "";

  showModal(
    `⚔️ Bo3 시리즈 종료 · ${box.blueWins} : ${box.redWins}`,
    `<div class="daily-news-sheet">
      <div class="news-headline">🏆 ${escapeHtml(winTeam)} 최종 승리!</div>
      ${mvpHtml}
      <table class="boxscore-table">
        <thead><tr><th>선수</th><th>챔피언</th><th>딜량</th><th>킬</th><th>반격/오브</th></tr></thead>
        <tbody>${fighterRows}</tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="btn-arcade-rematch" class="btn btn-primary flex-1" data-arcade-rematch="1" type="button">🔄 진영 교대 재대결</button>
        <button id="btn-arcade-exit" class="btn btn-ghost" data-arcade-exit="1" type="button">🏠 로비로 나가기</button>
      </div>
    </div>`
  );
}

function renderArcadeLobbyScreen(state) {
  const blueIdx = state.activeSeries?.blueSeat ?? 0;
  const redIdx = state.activeSeries?.redSeat ?? 1;
  const blueSeat = state.seats[blueIdx] || state.seats[0];
  const redSeat = state.seats[redIdx] || state.seats[1];
  const mySeat = state.seats[state.localSeatIndex] || state.seats[0];

  if (dom["arcade-lobby-header"]) {
    dom["arcade-lobby-header"].innerHTML = `
      <div class="po-kicker">2인 아케이드 라이브 · ROOM <span class="num">${escapeHtml(state.roomCode || "----")}</span></div>
      <div class="po-title">⚔️ HEAD-TO-HEAD Bo3 대기실</div>
      <div class="muted-text">코드 <strong class="gold-text num">${escapeHtml(state.roomCode || "----")}</strong> 공유 시 2인 실시간 밴픽·교전 가능 (전적 <span class="num">${blueSeat.wins}:${redSeat.wins}</span>)</div>
    `;
  }

  const renderArcadeTeam = (seat, sideCls, sideLabel) => {
    const isMine = seat.seatIndex === state.localSeatIndex;
    const statusBadge = seat.isAI
      ? `<span class="seat-badge badge-ai">🤖 AI 라이벌</span>`
      : seat.ready
        ? `<span class="seat-badge badge-human">✅ READY</span>`
        : `<span class="seat-badge badge-ai">⏳ 대기 중</span>`;

    const rosterRows = (seat.roster || []).slice(0, 3).map((p, idx) => {
      const traitName = TRAITS[p.trait]?.name || p.trait;
      const favId = Object.keys(p.mastery || {})[0] || "kylen";
      const favC = getChampionById(favId);
      const ovr = Math.round((p.stats.mechanics + p.stats.reflex + p.stats.teamwork + p.stats.mental) / 4);
      return `
        <div class="arcade-roster-row">
          <div>
            <strong>ST${idx + 1} · ${escapeHtml(p.name)}</strong>
            <div class="muted-text small">${escapeHtml(traitName)} · 주력 ${escapeHtml(favC.shortName)}</div>
          </div>
          <span class="ovr-badge num">${ovr}</span>
        </div>`;
    }).join("");

    return `
      <div class="arcade-team-card ${sideCls}">
        <div class="card-header-row">
          <div>
            <span class="pill ${sideCls === "is-blue" ? "pill-neon" : "pill-accent"}">${sideLabel}${isMine ? " · 내 진영" : ""}</span>
            <strong style="margin-left:6px;">${escapeHtml(shortTeamName(seat.teamName))}</strong>
          </div>
          ${statusBadge}
        </div>
        <div class="stack-6">${rosterRows}</div>
      </div>`;
  };

  if (dom["arcade-versus-board"]) {
    dom["arcade-versus-board"].innerHTML = `
      ${renderArcadeTeam(blueSeat, "is-blue", "BLUE")}
      ${renderArcadeTeam(redSeat, "is-red", "RED")}
    `;
  }

  if (dom["btn-arcade-ready"]) {
    dom["btn-arcade-ready"].textContent = mySeat?.ready ? "⏸ 준비 취소" : "✅ 전투 준비 완료";
  }

  const box = state.activeMatch?.boxscore;
  if (box?.id && box.id !== lastArcadeBoxId) {
    lastArcadeBoxId = box.id;
    openArcadeBoxscoreModal(state);
  }
}
