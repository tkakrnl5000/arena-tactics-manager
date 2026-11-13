/**
 * js/league.js
 * 10팀 LCK 스타일 리그 일정(9라운드 45경기), 헤드리스 고속 시뮬레이션,
 * LCK 순위 산정(승수 -> 세트득실 -> 상대전적), Top-4 Bo5 플레이오프,
 * 스네이크 밴픽 드래프트, 세트 간 Rite 카드, 구단 운영 AP(2 AP/라운드), 자동 밸런스 패치.
 */

import {
  CHAMPIONS,
  FACILITY_DEFS,
  HEAD_COACHES,
  LEAGUE_TEAM_COUNT,
  MAP_ORDER,
  RITE_CARDS,
  ROOM_MODES,
  ROUTINE_ACTIVITIES,
  SCHEDULE_MODES,
  SCREEN_STATES,
  SPONSOR_CONTRACTS,
  TRAITS,
  cloneState,
  computeRoundPayroll,
  computeRoundScheduledAt,
  createSeededRng,
  getChampionById,
  getHeadCoachById,
  getRiteById,
  getSponsorById,
  hashSeed
} from "./state.js";
import { initCombatRound, stepCombat } from "./engine.js";

export const DRAFT_SEQUENCE = [
  { phase: "BAN_BLUE", team: "blue", type: "ban", label: "BLUE 1차 밴" },
  { phase: "BAN_RED", team: "red", type: "ban", label: "RED 1차 밴" },
  { phase: "PICK_BLUE_1", team: "blue", type: "pick", label: "BLUE 1픽" },
  { phase: "PICK_RED_1", team: "red", type: "pick", label: "RED 1픽" },
  { phase: "PICK_RED_2", team: "red", type: "pick", label: "RED 2픽" },
  { phase: "PICK_BLUE_2", team: "blue", type: "pick", label: "BLUE 2픽" },
  { phase: "PICK_BLUE_3", team: "blue", type: "pick", label: "BLUE 3픽" },
  { phase: "PICK_RED_3", team: "red", type: "pick", label: "RED 3픽" }
];

export function generateSchedule(seatCount = LEAGUE_TEAM_COUNT, baseTimeMs = Date.now(), scheduleMode = SCHEDULE_MODES.REALTIME_DAILY, roomSeed = "4821") {
  const ids = Array.from({ length: seatCount }, (_, i) => i);
  const fixed = ids[0];
  const rotating = ids.slice(1);
  const weeks = [];

  for (let w = 0; w < seatCount - 1; w++) {
    const roundOrder = [fixed, ...rotating];
    const scheduledAt = computeRoundScheduledAt(baseTimeMs, w, scheduleMode);
    const matches = [];
    for (let m = 0; m < seatCount / 2; m++) {
      const home = roundOrder[m];
      const away = roundOrder[seatCount - 1 - m];
      const matchId = `w${w + 1}_m${m}`;
      matches.push({
        matchId,
        homeSeat: home,
        awaySeat: away,
        completed: false,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt,
        matchSeed: hashSeed(`${roomSeed}_${matchId}_${home}_${away}`)
      });
    }
    weeks.push({ week: w + 1, scheduledAt, matches });
    rotating.unshift(rotating.pop());
  }
  return weeks;
}

function getHeadToHeadDiff(state, seatA, seatB) {
  for (const wk of state.schedule) {
    for (const m of wk.matches) {
      if (!m.completed) continue;
      if ((m.homeSeat === seatA && m.awaySeat === seatB) || (m.homeSeat === seatB && m.awaySeat === seatA)) {
        if (m.winnerSeat === seatA) return -1;
        if (m.winnerSeat === seatB) return 1;
      }
    }
  }
  return 0;
}

/**
 * 순위표 정렬: 승수(Wins) -> 세트 득실(Set Diff) -> 상대전적(Head-to-Head) -> 다득점(Set Wins)
 */
export function getStandings(state) {
  return [...state.seats].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.setWins - a.setLosses;
    const diffB = b.setWins - b.setLosses;
    if (diffB !== diffA) return diffB - diffA;
    const h2h = getHeadToHeadDiff(state, a.seatIndex, b.seatIndex);
    if (h2h !== 0) return h2h;
    if (b.setWins !== a.setWins) return b.setWins - a.setWins;
    return a.seatIndex - b.seatIndex;
  });
}

const FA_CANDIDATE_NAMES = [
  "주민규 (Duro)",
  "오형석 (Career)",
  "오동규 (Pollu)",
  "이정태 (Fisher)",
  "선현빈 (Calix)",
  "남대근 (Diable)",
  "유지명 (Daystar)",
  "이상호 (Effort)",
  "김정민 (Life)",
  "정윤수 (Peter)"
];

function generateReplacementFA(state) {
  const champKeys = Object.keys(CHAMPIONS);
  const traitKeys = Object.keys(TRAITS);
  const name = FA_CANDIDATE_NAMES[Math.floor(Math.random() * FA_CANDIDATE_NAMES.length)];
  const c1 = champKeys[Math.floor(Math.random() * champKeys.length)];
  const c2 = champKeys[Math.floor(Math.random() * champKeys.length)];

  return {
    playerId: `fa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    name,
    condition: 90 + Math.floor(Math.random() * 10),
    stats: {
      mechanics: 72 + Math.floor(Math.random() * 18),
      reflex: 72 + Math.floor(Math.random() * 18),
      teamwork: 72 + Math.floor(Math.random() * 18),
      mental: 72 + Math.floor(Math.random() * 18)
    },
    trait: traitKeys[Math.floor(Math.random() * traitKeys.length)],
    cost: 350 + Math.floor(Math.random() * 250),
    mastery: { [c1]: 3, [c2]: 2 }
  };
}

/**
 * AI 감독 영입 계약 (자금 차감, 0 AP)
 */
export function hireHeadCoach(state, seatIndex, coachId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };
  if (seat.inDebt || seat.funds < 0) {
    return { ok: false, message: "⚠️ 구단이 적자(임금 체불 위기) 상태라 자금을 회수할 때까지 감독 영입이 잠겼습니다!" };
  }
  const coach = HEAD_COACHES.find((c) => c.id === coachId) || getHeadCoachById(coachId);
  if (!coach) return { ok: false, message: "해당 감독을 찾을 수 없습니다." };
  if (seat.headCoachId === coach.id) {
    return { ok: false, message: `${coach.name} 감독은 이미 본 구단을 지휘 중입니다.` };
  }
  if (seat.funds < coach.salary) {
    return { ok: false, message: `구단 자금이 부족합니다. (계약금 ${coach.salary}G / 보유 ${seat.funds}G)` };
  }

  seat.funds -= coach.salary;
  seat.headCoachId = coach.id;
  seat.headCoach = { ...coach, stats: { ...coach.stats } };
  seat.coachName = coach.name;

  let bonusMsg = "";
  if (coach.philosophy === "ROOKIE_MENTOR") {
    for (const p of seat.roster || []) {
      p.condition = Math.min(100, (p.condition || 80) + 5);
      p.stats.teamwork = Math.min(99, (p.stats.teamwork || 70) + 2);
    }
    bonusMsg = " (멘토 효과: 선수단 컨디션 +5, 팀워크 +2)";
  }

  return {
    ok: true,
    message: `📋 [${coach.name}] 감독과 계약을 체결했습니다! (-${coach.salary}G)${bonusMsg}`
  };
}

/**
 * 구단주 사전 밴픽 노트 갱신
 */
export function updateBanPickNote(state, seatIndex, patch = {}) {
  const seat = state.seats[seatIndex];
  if (!seat) return null;
  if (!seat.banPickNote) {
    seat.banPickNote = {
      mustBans: [],
      priorityPicks: [],
      counterStrategy: "AUTO_COUNTER",
      ritePreference: "ORB",
      autoCallTrigger: "ORB_SPAWN"
    };
  }
  const note = seat.banPickNote;
  if (Array.isArray(patch.mustBans)) {
    note.mustBans = [...new Set(patch.mustBans.filter((id) => Boolean(CHAMPIONS[id])))].slice(0, 2);
  }
  if (Array.isArray(patch.priorityPicks)) {
    note.priorityPicks = [...new Set(patch.priorityPicks.filter((id) => Boolean(CHAMPIONS[id])))].slice(0, 2);
  }
  if (patch.counterStrategy) note.counterStrategy = patch.counterStrategy;
  if (patch.ritePreference) note.ritePreference = patch.ritePreference;
  if (patch.autoCallTrigger) note.autoCallTrigger = patch.autoCallTrigger;
  return note;
}

/**
 * 구단 24시간 3슬롯 자동 훈련 루틴 수정
 */
export function updateAutoSchedule(state, seatIndex, slotKey, activityKey, focusStat = null) {
  const seat = state.seats[seatIndex];
  if (!seat) return null;
  if (!seat.autoSchedule) {
    seat.autoSchedule = { MORNING: "SOLO_GRIND", AFTERNOON: "TEAM_SCRIM", NIGHT: "REST_CARE", focusStat: "mechanics" };
  }
  if (slotKey && ["MORNING", "AFTERNOON", "NIGHT"].includes(slotKey) && ROUTINE_ACTIVITIES[activityKey]) {
    seat.autoSchedule[slotKey] = activityKey;
  }
  if (focusStat && ["mechanics", "reflex", "teamwork", "mental"].includes(focusStat)) {
    seat.autoSchedule.focusStat = focusStat;
  }
  return seat.autoSchedule;
}

/**
 * 구단 시설 업그레이드 (Lv.1 ~ Lv.5, 적자 시 잠금)
 */
export function upgradeFacility(state, seatIndex, facilityKey) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };
  if (seat.inDebt || seat.funds < 0) {
    return { ok: false, message: "⚠️ 구단 적자 상태에서는 시설에 투자할 수 없습니다!" };
  }
  const def = FACILITY_DEFS[facilityKey];
  if (!def) return { ok: false, message: "알 수 없는 시설입니다." };
  if (!seat.facilities) {
    seat.facilities = { trainingCenter: 1, analyticsLab: 1, medicalBay: 1 };
  }
  const curLv = seat.facilities[facilityKey] || 1;
  if (curLv >= def.maxLevel) {
    return { ok: false, message: `${def.name}은(는) 이미 최고 레벨(Lv.${def.maxLevel})입니다.` };
  }
  const cost = def.baseCost * curLv;
  if (seat.funds < cost) {
    return { ok: false, message: `자금이 부족합니다. (업그레이드 비용 ${cost}G / 보유 ${seat.funds}G)` };
  }
  seat.funds -= cost;
  seat.inDebt = seat.funds < 0;
  seat.facilities[facilityKey] = curLv + 1;
  return {
    ok: true,
    message: `🏗️ [${def.name}] Lv.${curLv + 1} 증축 완료! (-${cost}G)`
  };
}

/**
 * 구단 스폰서 계약 변경
 */
export function selectSponsorContract(state, seatIndex, sponsorId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };
  const sponsor = getSponsorById(sponsorId);
  if (!sponsor) return { ok: false, message: "유효하지 않은 스폰서 계약입니다." };
  seat.sponsorId = sponsor.id;
  seat.sponsorContract = { ...sponsor, active: true };
  return {
    ok: true,
    message: `🤝 [${sponsor.name}] 스폰서 계약 체결 완료! (${sponsor.conditionDesc})`
  };
}

const ARCADE_ROSTER_NAMES = [
  "이상혁 (Faker)",
  "정지훈 (Chovy)",
  "박도현 (Viper)",
  "최우제 (Zeus)",
  "류민석 (Keria)",
  "허수 (ShowMaker)",
  "김건부 (Canyon)",
  "박재혁 (Ruler)",
  "곽보성 (Bdd)",
  "이민형 (Gumayusi)",
  "김기인 (Kiin)",
  "문현준 (Oner)"
];

/**
 * 2인 아케이드 라이브: 준비 완료 전 주전 3인 로스터를 랜덤 리롤한다.
 */
export function rerollArcadeRoster(state, seatIndex) {
  const seat = state?.seats?.[seatIndex];
  if (!seat) return false;
  seat.ready = false;

  const champKeys = Object.keys(CHAMPIONS);
  const traitKeys = Object.keys(TRAITS);
  const seed = hashSeed(`${state.roomCode || "0000"}_reroll_${seatIndex}_${Date.now()}_${Math.random()}`);
  const rng = createSeededRng(seed);

  const usedNames = new Set();
  for (let i = 0; i < 3; i++) {
    let name = ARCADE_ROSTER_NAMES[Math.floor(rng() * ARCADE_ROSTER_NAMES.length)];
    let guard = 0;
    while (usedNames.has(name) && guard < 12) {
      name = ARCADE_ROSTER_NAMES[Math.floor(rng() * ARCADE_ROSTER_NAMES.length)];
      guard++;
    }
    usedNames.add(name);
    const c1 = champKeys[Math.floor(rng() * champKeys.length)];
    const c2 = champKeys[(champKeys.indexOf(c1) + 3) % champKeys.length];
    const c3 = champKeys[(champKeys.indexOf(c1) + 7) % champKeys.length];
    const m = 72 + Math.floor(rng() * 17);
    const r = 72 + Math.floor(rng() * 17);
    const t = 72 + Math.floor(rng() * 17);
    const mn = 72 + Math.floor(rng() * 17);
    seat.roster[i] = {
      ...(seat.roster[i] || {}),
      playerId: `arc_${seatIndex}_${i}_${Math.floor(rng() * 9999)}`,
      name,
      condition: 100,
      slump: false,
      stats: { mechanics: m, reflex: r, teamwork: t, mental: mn },
      trait: traitKeys[Math.floor(rng() * traitKeys.length)],
      mastery: { [c1]: 3, [c2]: 2, [c3]: 2 }
    };
  }
  return true;
}

/**
 * 2인 아케이드 라이브: 직접 Bo3 LCK 스네이크 밴픽 시작
 */
export function beginArcadeDraft(state, customBlueSeat = null, customRedSeat = null) {
  const rematchCount = state.activeMatch?.rematchCount || 0;
  const blueSeat = customBlueSeat !== null ? customBlueSeat : (state.activeSeries?.blueSeat ?? 0);
  const redSeat = customRedSeat !== null ? customRedSeat : (state.activeSeries?.redSeat ?? 1);
  const initialMap = state.preferredMapId && state.preferredMapId !== "AUTO"
    ? state.preferredMapId
    : MAP_ORDER[rematchCount % MAP_ORDER.length];
  const resolvedSeed = hashSeed(`${state.roomCode || "0000"}_arcade_r${rematchCount + 1}_${blueSeat}_${redSeat}`);

  state.liveOverride = true;
  state.activeMatch = {
    callEvents: [],
    ritePicks: { blue: null, red: null },
    boxscore: null,
    rematchCount,
    setHistory: []
  };
  state.activeSeries = {
    matchId: `arcade_r${rematchCount + 1}`,
    seriesMode: "ARCADE_2P",
    bestOf: 3,
    currentSet: 1,
    matchSeed: resolvedSeed,
    isReplay: false,
    replayMatchId: null,
    coachLogs: ["⚔️ 2인 아케이드 라이브 Bo3 밴픽이 시작되었습니다!"],
    telemetry: null,
    selectedMapId: initialMap,
    mapId: initialMap,
    blueSeat,
    redSeat,
    blueWins: 0,
    redWins: 0,
    draft: {
      phase: DRAFT_SEQUENCE[0].phase,
      stepIndex: 0,
      blueBans: [],
      redBans: [],
      bluePicks: [],
      redPicks: [],
      assignConfirmed: {
        blue: Boolean(state.seats[blueSeat]?.isAI),
        red: Boolean(state.seats[redSeat]?.isAI)
      }
    },
    blueRites: [],
    redRites: [],
    riteOptions: []
  };

  state.screen = SCREEN_STATES.DRAFT;
  runAutoAIDraftSteps(state);
}

/**
 * 2인 아케이드 라이브: 플레이어 전투 준비 토글 (양쪽 준비 시 즉시 밴픽 개시)
 */
export function toggleArcadeReady(state, seatIndex) {
  const seat = state?.seats?.[seatIndex];
  if (!seat) return false;
  seat.isAI = false;
  seat.ready = !seat.ready;
  if (state.seats[0]?.ready && state.seats[1]?.ready) {
    beginArcadeDraft(state, 0, 1);
    return true;
  }
  return false;
}

/**
 * 2인 아케이드 라이브: 솔로 테스트/대전용 AI 라이벌과 즉시 시작
 */
export function startArcadeVsAI(state) {
  if (!state?.seats || state.seats.length < 2) return;
  const humanIdx = state.localSeatIndex === 1 ? 1 : 0;
  const aiIdx = humanIdx === 0 ? 1 : 0;
  state.seats[humanIdx].isAI = false;
  state.seats[humanIdx].ready = true;
  state.seats[aiIdx].isAI = true;
  state.seats[aiIdx].coachName = "Red Rival AI";
  state.seats[aiIdx].ready = true;
  beginArcadeDraft(state, 0, 1);
}

/**
 * 2인 아케이드 라이브: PLAYER_ASSIGN 단계에서 주전 3인 <-> 픽 챔피언 스왑
 */
export function swapArcadeDraftAssignment(state, team, idxA, idxB) {
  const draft = state?.activeSeries?.draft;
  if (!draft || draft.phase !== "PLAYER_ASSIGN") return false;
  const arr = team === "red" ? draft.redPicks : draft.bluePicks;
  if (!Array.isArray(arr) || arr.length < 3) return false;
  if (idxA < 0 || idxA > 2 || idxB < 0 || idxB > 2 || idxA === idxB) return false;
  [arr[idxA], arr[idxB]] = [arr[idxB], arr[idxA]];
  return true;
}

/**
 * 2인 아케이드 라이브: PLAYER_ASSIGN 확정 (양측 확정 또는 상대 AI 시 1세트 개시)
 */
export function confirmArcadePlayerAssignment(state, team) {
  const series = state?.activeSeries;
  const draft = series?.draft;
  if (!draft || draft.phase !== "PLAYER_ASSIGN") return false;
  if (!draft.assignConfirmed) {
    draft.assignConfirmed = { blue: false, red: false };
  }
  draft.assignConfirmed[team] = true;
  const oppTeam = team === "blue" ? "red" : "blue";
  const oppSeatIdx = oppTeam === "blue" ? series.blueSeat : series.redSeat;
  if (state.seats[oppSeatIdx]?.isAI) {
    draft.assignConfirmed[oppTeam] = true;
  }

  if (draft.assignConfirmed.blue && draft.assignConfirmed.red) {
    draft.phase = "COMPLETE";
    initCombatRound(state);
    state.screen = SCREEN_STATES.COMBAT;
    return true;
  }
  return false;
}

/**
 * 2인 아케이드 라이브: 블루/레드 진영 교대 후 즉시 Bo3 재대결 시작
 */
export function rematchArcadeSwapSides(state) {
  if (!state) return;
  const prevBlue = state.activeSeries?.blueSeat ?? 0;
  const prevRed = state.activeSeries?.redSeat ?? 1;
  if (!state.activeMatch) {
    state.activeMatch = { callEvents: [], ritePicks: { blue: null, red: null }, boxscore: null, rematchCount: 0, setHistory: [] };
  }
  state.activeMatch.rematchCount = (state.activeMatch.rematchCount || 0) + 1;
  state.activeMatch.boxscore = null;
  for (const s of state.seats || []) s.ready = false;
  beginArcadeDraft(state, prevRed, prevBlue);
}

/**
 * 구단 주간 AP 행동 처리 (1 AP 소모 / 주전 교체·감독 계약은 0 AP)
 */
export function executeWeeklyAction(state, seatIndex, actionType, payload = {}) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };

  if (actionType === "HIRE_COACH") {
    return hireHeadCoach(state, seatIndex, payload.coachId);
  }

  if (actionType === "SWAP_STARTER") {
    const starterIdx = payload.starterIndex ?? 0;
    if (starterIdx < 0 || starterIdx > 2 || seat.roster.length < 4) {
      return { ok: false, message: "교체할 후보 선수가 없습니다." };
    }
    const temp = seat.roster[starterIdx];
    seat.roster[starterIdx] = seat.roster[3];
    seat.roster[3] = temp;
    return { ok: true, message: `🔄 ${seat.roster[starterIdx].name} 선수를 주전(${starterIdx + 1}번)으로 기용했습니다.` };
  }

  if (seat.ap <= 0) {
    return { ok: false, message: "이번 라운드 행동력(AP)을 모두 소진했습니다." };
  }

  if (actionType === "TRAIN") {
    const pIdx = payload.playerIndex ?? 0;
    const player = seat.roster[pIdx];
    if (!player) return { ok: false, message: "선수를 찾을 수 없습니다." };

    seat.ap -= 1;
    player.stats.mechanics = Math.min(99, player.stats.mechanics + 4);
    player.stats.reflex = Math.min(99, player.stats.reflex + 3);
    player.stats.teamwork = Math.min(99, player.stats.teamwork + 2);
    player.stats.mental = Math.min(99, player.stats.mental + 3);
    player.condition = Math.max(40, player.condition - 6);
    return { ok: true, message: `🎯 ${player.name} 개인 훈련 완료! (피지컬+4, 반응+3, 컨디션-6)` };
  }

  if (actionType === "SCRIM") {
    seat.ap -= 1;
    const champKeys = Object.keys(CHAMPIONS);
    for (let i = 0; i < 3; i++) {
      const p = seat.roster[i];
      if (!p) continue;
      p.stats.teamwork = Math.min(99, p.stats.teamwork + 3);
      p.condition = Math.max(40, p.condition - 5);
      const favKey = Object.keys(p.mastery)[0] || champKeys[(seatIndex + i) % champKeys.length];
      p.mastery[favKey] = Math.min(5, (p.mastery[favKey] || 1) + 1);
    }
    return { ok: true, message: "⚔️ 팀 스크림 완료! 주전 3인 숙련도 +1 & 팀워크 +3 상승!" };
  }

  if (actionType === "REST") {
    seat.ap -= 1;
    for (const p of seat.roster) {
      p.condition = Math.min(100, p.condition + 22);
      p.stats.mental = Math.min(99, p.stats.mental + 3);
    }
    return { ok: true, message: "☕ 휴식 및 멘탈 케어 완료! 전원 컨디션 +22 & 멘탈 +3 회복!" };
  }

  if (actionType === "SCOUT_FA") {
    if (seat.inDebt || seat.funds < 0) {
      return { ok: false, message: "⚠️ 구단 적자 상태라 자금을 회수할 때까지 FA 영입이 잠겼습니다!" };
    }
    const faIdx = payload.faIndex ?? 0;
    const fa = state.faPool[faIdx];
    if (!fa) return { ok: false, message: "FA 선수가 없습니다." };
    if (seat.funds < fa.cost) {
      return { ok: false, message: `자금이 부족합니다. (필요: ${fa.cost}G / 보유: ${seat.funds}G)` };
    }
    seat.ap -= 1;
    seat.funds -= fa.cost;
    const oldSub = seat.roster[3];
    seat.roster[3] = {
      playerId: fa.playerId,
      name: fa.name,
      condition: fa.condition,
      stats: { ...fa.stats },
      trait: fa.trait,
      mastery: { ...fa.mastery }
    };
    state.faPool.splice(faIdx, 1, generateReplacementFA(state));
    return { ok: true, message: `🔍 FA [${fa.name}] 영입 완료! (${oldSub ? oldSub.name : "후보"} 방출, -${fa.cost}G)` };
  }

  return { ok: false, message: "알 수 없는 행동입니다." };
}

function runAIClubActions(state) {
  for (const seat of state.seats) {
    if (!seat.isAI) continue;
    while (seat.ap > 0) {
      const avgCond = seat.roster.slice(0, 3).reduce((s, p) => s + p.condition, 0) / 3;
      if (avgCond < 72) {
        executeWeeklyAction(state, seat.seatIndex, "REST");
      } else if (Math.random() < 0.5) {
        executeWeeklyAction(state, seat.seatIndex, "SCRIM");
      } else {
        executeWeeklyAction(state, seat.seatIndex, "TRAIN", { playerIndex: Math.floor(Math.random() * 3) });
      }
    }
  }
}

function scoreChampForStrategy(champ, strategy, enemyPicks = []) {
  let bonus = 0;
  if (strategy === "DIVE_COMP") {
    if (champ.role === "MELEE" || champ.role === "ASSASSIN" || champ.role === "TANK") bonus += 9;
  } else if (strategy === "POKE_CONTROL") {
    if (champ.role === "RANGED" || champ.role === "MAGE") bonus += 9;
  } else if (strategy === "PROTECT_CARRY") {
    if (champ.role === "TANK" || champ.role === "SUPPORT" || champ.role === "RANGED") bonus += 8;
  } else {
    // AUTO_COUNTER
    const enemyRoles = enemyPicks.map((id) => getChampionById(id).role);
    const hasAssassin = enemyRoles.includes("ASSASSIN") || enemyRoles.includes("MELEE");
    const hasPoke = enemyRoles.includes("RANGED") || enemyRoles.includes("MAGE");
    if (hasAssassin && (champ.role === "TANK" || champ.role === "SUPPORT")) bonus += 10;
    if (hasPoke && (champ.role === "ASSASSIN" || champ.role === "MELEE")) bonus += 10;
  }
  return bonus;
}

function chooseCoachDraftChamp(state, seatIdx, draft, step, enemySeatIdx, rng = Math.random) {
  const seat = state.seats[seatIdx];
  const enemySeat = state.seats[enemySeatIdx];
  const coach = seat?.headCoach || getHeadCoachById(seat?.headCoachId);
  const note = seat?.banPickNote || {};
  const used = getDraftUsedIds(draft);
  const available = Object.keys(CHAMPIONS).filter((id) => !used.includes(id));
  if (available.length === 0) return { champId: null, log: null, egoTriggered: false };

  const coachLabel = (coach?.name || "감독").split(" (")[0];
  const teamTag = step.team === "blue" ? "BLUE" : "RED";

  if (step.type === "ban") {
    for (const banId of note.mustBans || []) {
      if (available.includes(banId)) {
        const c = getChampionById(banId);
        return {
          champId: banId,
          egoTriggered: false,
          log: `📋 [${teamTag} · ${coachLabel}] 밴픽 노트 지정 밴 [${c.shortName}] 실행`
        };
      }
    }

    // Ban highest enemy mastery + patch meta threat weighted by draftInsight
    const insightWeight = ((coach?.stats?.draftInsight || 75) / 100) * 1.4;
    const scored = available.map((cid) => {
      const c = CHAMPIONS[cid];
      let threat = (c.patchMod.dmgMult || 1) * 10 + (c.patchMod.hpMult || 1) * 4;
      for (let i = 0; i < 3; i++) {
        const ep = enemySeat?.roster?.[i];
        if (ep?.mastery?.[cid]) threat += ep.mastery[cid] * 5 * insightWeight;
      }
      threat += rng() * 3;
      return { cid, threat };
    });
    scored.sort((a, b) => b.threat - a.threat);
    const chosen = scored[0].cid;
    const c = getChampionById(chosen);
    return {
      champId: chosen,
      egoTriggered: false,
      log: `🎯 [${teamTag} · ${coachLabel}] 상대 핵심 견제 밴 [${c.shortName}]`
    };
  }

  // PICK phase: Check Coach Ego override for signatureChamp
  const teamPicks = step.team === "blue" ? draft.bluePicks : draft.redPicks;
  const sigId = coach?.signatureChamp;
  const egoChance = (coach?.stats?.ego || 0) * 0.006; // ego 80 -> 48% per pick roll
  if (sigId && available.includes(sigId) && !teamPicks.includes(sigId) && rng() < egoChance) {
    const c = getChampionById(sigId);
    return {
      champId: sigId,
      egoTriggered: true,
      log: `⚡ [독단 픽 · EGO ${coach.stats.ego}%] ${coachLabel}: "${coach.bark}" → [${c.shortName}] 강행!`
    };
  }

  // Check GM priorityPicks
  for (const pickId of note.priorityPicks || []) {
    if (available.includes(pickId)) {
      const c = getChampionById(pickId);
      return {
        champId: pickId,
        egoTriggered: false,
        log: `✅ [${teamTag} · ${coachLabel}] 노트 우선 픽 [${c.shortName}] 확보`
      };
    }
  }

  const enemyPicks = step.team === "blue" ? draft.redPicks : draft.bluePicks;
  const labBonus = ((seat?.facilities?.analyticsLab || 1) - 1) * 0.05;
  const insight = Math.min(1.4, (coach?.stats?.draftInsight || 75) / 100 + labBonus);
  const scored = available.map((cid) => {
    const c = CHAMPIONS[cid];
    let score = (c.patchMod.dmgMult || 1) * 11 + (c.patchMod.hpMult || 1) * 5;
    for (let i = 0; i < 3; i++) {
      const p = seat?.roster?.[i];
      if (p?.mastery?.[cid]) score += p.mastery[cid] * 4.5;
    }
    score += scoreChampForStrategy(c, note.counterStrategy || "AUTO_COUNTER", enemyPicks) * (0.7 + insight * 0.5);
    if (coach?.philosophy === "ORB_MASTER" && (c.role === "MAGE" || c.role === "RANGED")) score += 3;
    if (coach?.philosophy === "JOKER_GAMBLER" && c.role === "ASSASSIN") score += 4;
    if (coach?.philosophy === "ROOKIE_MENTOR" && (c.role === "TANK" || c.role === "SUPPORT")) score += 4;
    score += rng() * 3.5;
    return { cid, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored[0].cid;
  const c = getChampionById(chosen);
  return {
    champId: chosen,
    egoTriggered: false,
    log: `🧠 [${teamTag} · ${coachLabel}] 전략 픽 [${c.shortName}] 선택`
  };
}

function chooseCoachRiteCard(state, team, availIds, rng = Math.random) {
  if (!availIds || availIds.length === 0) return null;
  const series = state.activeSeries;
  const seatIdx = team === "red" ? series.redSeat : series.blueSeat;
  const seat = state.seats[seatIdx];
  const coach = seat?.headCoach || getHeadCoachById(seat?.headCoachId);
  const pref = seat?.banPickNote?.ritePreference || "ORB";
  const sense = (coach?.stats?.riteSense || 75) / 100;

  const prefKeys = {
    COUNTER: ["counterShield", "emergencyShield", "vortexResist", "skillCdMult"],
    ORB: ["orbBonusEnergy", "moveSpeedMult", "projSpeedMult", "coachCdReduction"],
    ENERGY: ["exCostReduction", "skillCdMult", "orbBonusEnergy", "execDmgMult"],
    SURVIVAL: ["maxHpMult", "lifesteal", "emergencyShield", "vortexResist"]
  };
  const preferred = prefKeys[pref] || prefKeys.ORB;

  const scored = availIds.map((rid) => {
    const r = getRiteById(rid);
    let score = 5;
    const rank = preferred.indexOf(r.effectKey);
    if (rank >= 0) score += (14 - rank * 2.5) * (0.65 + sense * 0.6);
    if (coach?.philosophy === "ORB_MASTER" && r.effectKey === "orbBonusEnergy") score += 4;
    score += rng() * 2.5;
    return { rid, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].rid;
}

function getTeamPowerScore(state, seatIdx) {
  const seat = state.seats[seatIdx];
  if (!seat) return 300;
  return seat.roster.slice(0, 3).reduce((sum, p) => {
    const statAvg = (p.stats.mechanics + p.stats.reflex + p.stats.teamwork + p.stats.mental) / 4;
    return sum + statAvg * (0.7 + (p.condition / 100) * 0.3);
  }, 0);
}

/**
 * 결정론적 시드 기반 헤드리스 고속 매치 시뮬레이터 & VOD 페이로드 생성
 */
export function simulateMatchHeadless(state, homeSeat, awaySeat, bestOf = 3, matchSeed = null, matchId = "sim") {
  const seedBase = Number(matchSeed || hashSeed(`${state.roomCode || "0000"}_${matchId}_${homeSeat}_${awaySeat}`)) || 100001;
  const rng = createSeededRng(seedBase);
  const neededWins = Math.ceil(bestOf / 2);
  let homeSets = 0;
  let awaySets = 0;

  const simState = cloneState(state);
  simState.liveOverride = false;
  simState.activeSeries = {
    ...simState.activeSeries,
    matchId,
    seriesMode: "LEAGUE",
    bestOf,
    currentSet: 1,
    matchSeed: seedBase,
    isReplay: false,
    coachLogs: [],
    telemetry: null,
    blueSeat: homeSeat,
    redSeat: awaySeat,
    blueWins: 0,
    redWins: 0,
    blueRites: [],
    redRites: [],
    riteOptions: []
  };

  // Run Coach Snake Draft deterministically for the series
  const seriesDraft = { phase: DRAFT_SEQUENCE[0].phase, stepIndex: 0, blueBans: [], redBans: [], bluePicks: [], redPicks: [] };
  for (const step of DRAFT_SEQUENCE) {
    const seatIdx = step.team === "blue" ? homeSeat : awaySeat;
    const enemySeatIdx = step.team === "blue" ? awaySeat : homeSeat;
    const res = chooseCoachDraftChamp(simState, seatIdx, seriesDraft, step, enemySeatIdx, rng);
    if (!res.champId) break;
    if (step.type === "ban") {
      if (step.team === "blue") seriesDraft.blueBans.push(res.champId);
      else seriesDraft.redBans.push(res.champId);
    } else {
      if (step.team === "blue") seriesDraft.bluePicks.push(res.champId);
      else seriesDraft.redPicks.push(res.champId);
    }
    if (res.log) simState.activeSeries.coachLogs.unshift(res.log);
  }
  simState.activeSeries.draft = seriesDraft;

  const vodSets = [];
  let setNum = 1;
  while (homeSets < neededWins && awaySets < neededWins) {
    const mapId = MAP_ORDER[(setNum - 1) % MAP_ORDER.length];
    simState.activeSeries.currentSet = setNum;
    simState.activeSeries.mapId = mapId;
    simState.activeSeries.selectedMapId = mapId;

    const setSnapshot = {
      setNum,
      mapId,
      matchSeed: seedBase,
      bluePicks: [...seriesDraft.bluePicks],
      redPicks: [...seriesDraft.redPicks],
      blueBans: [...seriesDraft.blueBans],
      redBans: [...seriesDraft.redBans],
      blueRites: [...simState.activeSeries.blueRites],
      redRites: [...simState.activeSeries.redRites],
      coachLogs: [...simState.activeSeries.coachLogs],
      winnerTeam: "blue"
    };

    initCombatRound(simState);

    let setWinner = null;
    for (let tick = 0; tick < 160; tick++) {
      const res = stepCombat(simState, 0.25);
      if (res.roundEnded) {
        setWinner = res.winnerTeam;
        break;
      }
    }

    if (!setWinner) {
      const bluePower = simState.combat.fighters
        .filter((f) => f.alive && f.team === "blue")
        .reduce((s, f) => s + f.hp, 0) + getTeamPowerScore(simState, homeSeat) * 0.6;
      const redPower = simState.combat.fighters
        .filter((f) => f.alive && f.team === "red")
        .reduce((s, f) => s + f.hp, 0) + getTeamPowerScore(simState, awaySeat) * 0.6;
      setWinner = bluePower >= redPower ? "blue" : "red";
    }

    setSnapshot.winnerTeam = setWinner;
    vodSets.push(setSnapshot);

    if (setWinner === "blue") {
      homeSets++;
    } else {
      awaySets++;
    }

    const availBlue = RITE_CARDS.map((r) => r.id).filter((id) => !simState.activeSeries.blueRites.includes(id));
    const availRed = RITE_CARDS.map((r) => r.id).filter((id) => !simState.activeSeries.redRites.includes(id));
    const bRite = chooseCoachRiteCard(simState, "blue", availBlue, rng);
    const rRite = chooseCoachRiteCard(simState, "red", availRed, rng);
    if (bRite) simState.activeSeries.blueRites.push(bRite);
    if (rRite) simState.activeSeries.redRites.push(rRite);
    setNum++;
  }

  return {
    homeSets,
    awaySets,
    winnerSeat: homeSets > awaySets ? homeSeat : awaySeat,
    matchSeed: seedBase,
    vodSets,
    telemetry: simState.activeSeries.telemetry || null,
    coachLogs: [...(simState.activeSeries.coachLogs || [])]
  };
}

function saveVodPayload(state, matchId, blueSeat, redSeat, bestOf, vodSets) {
  if (!state.vodPayloads) state.vodPayloads = {};
  state.vodPayloads[matchId] = {
    matchId,
    blueSeat,
    redSeat,
    bestOf,
    sets: vodSets || []
  };
}

function recordMatchToStandings(state, matchObj, homeSets, awaySets, winnerSeat, vodSets = null, telemetry = null) {
  matchObj.completed = true;
  matchObj.homeSets = homeSets;
  matchObj.awaySets = awaySets;
  matchObj.winnerSeat = winnerSeat;
  if (telemetry) matchObj.telemetry = telemetry;

  if (vodSets && vodSets.length > 0) {
    saveVodPayload(state, matchObj.matchId, matchObj.homeSeat, matchObj.awaySeat, 3, vodSets);
  }

  const home = state.seats[matchObj.homeSeat];
  const away = state.seats[matchObj.awaySeat];
  if (!home || !away) return;

  home.setWins += homeSets;
  home.setLosses += awaySets;
  away.setWins += awaySets;
  away.setLosses += homeSets;

  if (winnerSeat === home.seatIndex) {
    home.wins += 1;
    away.losses += 1;
  } else {
    away.wins += 1;
    home.losses += 1;
  }

  for (const s of [home, away]) {
    const fatigue = Math.max(1, 4 - ((s.facilities?.medicalBay || 1) - 1));
    for (let i = 0; i < 3; i++) {
      if (s.roster[i]) s.roster[i].condition = Math.max(30, s.roster[i].condition - fatigue);
    }
  }
}

function beginSeriesDraft(state, matchId, blueSeat, redSeat, bestOf, seriesMode, matchSeed = null) {
  const initialMap = state.preferredMapId && state.preferredMapId !== "AUTO"
    ? state.preferredMapId
    : MAP_ORDER[0];
  const resolvedSeed = Number(matchSeed || hashSeed(`${state.roomCode || "0000"}_${matchId}_${blueSeat}_${redSeat}`));
  state.activeSeries = {
    matchId,
    seriesMode,
    bestOf,
    currentSet: 1,
    matchSeed: resolvedSeed,
    isReplay: false,
    replayMatchId: null,
    coachLogs: [],
    telemetry: null,
    selectedMapId: initialMap,
    mapId: initialMap,
    blueSeat,
    redSeat,
    blueWins: 0,
    redWins: 0,
    draft: {
      phase: DRAFT_SEQUENCE[0].phase,
      stepIndex: 0,
      blueBans: [],
      redBans: [],
      bluePicks: [],
      redPicks: []
    },
    blueRites: [],
    redRites: [],
    riteOptions: []
  };

  state.screen = SCREEN_STATES.DRAFT;
  runAutoAIDraftSteps(state);
}

/**
 * 주간 경기 시작: AI-vs-AI 경기는 결정론적 시드 헤드리스 시뮬레이션, 플레이어 경기는 밴픽(DRAFT) 진입
 */
export function startPlayerMatchOrSimWeek(state) {
  runAIClubActions(state);

  if (state.playoffs.active) {
    const po = state.playoffs;
    if (po.round === "CHAMPION") return;

    const matchKey = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bracketMatch = po[matchKey];
    if (!bracketMatch || bracketMatch.winnerSeat !== null) return;

    const involvesHuman =
      bracketMatch.homeSeat === state.localSeatIndex ||
      bracketMatch.awaySeat === state.localSeatIndex ||
      !state.seats[bracketMatch.homeSeat]?.isAI ||
      !state.seats[bracketMatch.awaySeat]?.isAI;

    if (involvesHuman) {
      beginSeriesDraft(state, `po_${matchKey}`, bracketMatch.homeSeat, bracketMatch.awaySeat, 5, "PLAYOFF", bracketMatch.matchSeed);
      return;
    }

    const res = simulateMatchHeadless(state, bracketMatch.homeSeat, bracketMatch.awaySeat, 5, bracketMatch.matchSeed, `po_${matchKey}`);
    bracketMatch.homeSets = res.homeSets;
    bracketMatch.awaySets = res.awaySets;
    bracketMatch.winnerSeat = res.winnerSeat;
    bracketMatch.telemetry = res.telemetry || null;
    saveVodPayload(state, `po_${matchKey}`, bracketMatch.homeSeat, bracketMatch.awaySeat, 5, res.vodSets);
    onPlayoffMatchSettled(state, matchKey, bracketMatch, res.coachLogs || []);
    return;
  }

  const weekObj = state.schedule[state.week - 1];
  if (!weekObj) return;

  let humanMatch = null;
  for (const m of weekObj.matches) {
    if (m.completed) continue;
    if (m.homeSeat === state.localSeatIndex || m.awaySeat === state.localSeatIndex) {
      humanMatch = m;
    } else {
      const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3, m.matchSeed, m.matchId);
      m.coachLogs = res.coachLogs || [];
      recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat, res.vodSets, res.telemetry);
    }
  }

  if (humanMatch) {
    beginSeriesDraft(state, humanMatch.matchId, humanMatch.homeSeat, humanMatch.awaySeat, 3, "LEAGUE", humanMatch.matchSeed);
  } else {
    finalizeRegularWeek(state);
  }
}

/**
 * 테스트 편의용: 현재 라운드 전체(플레이어 경기 포함) 빠르게 헤드리스 시뮬레이션
 */
export function quickSimulateFullRound(state) {
  if (state.playoffs.active) {
    const po = state.playoffs;
    if (po.round === "CHAMPION") return;
    const matchKey = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bm = po[matchKey];
    if (bm && bm.winnerSeat === null) {
      const res = simulateMatchHeadless(state, bm.homeSeat, bm.awaySeat, 5, bm.matchSeed, `po_${matchKey}`);
      bm.homeSets = res.homeSets;
      bm.awaySets = res.awaySets;
      bm.winnerSeat = res.winnerSeat;
      bm.telemetry = res.telemetry || null;
      saveVodPayload(state, `po_${matchKey}`, bm.homeSeat, bm.awaySeat, 5, res.vodSets);
      onPlayoffMatchSettled(state, matchKey, bm, res.coachLogs || []);
    }
    return;
  }

  const weekObj = state.schedule[state.week - 1];
  if (!weekObj) return;
  for (const m of weekObj.matches) {
    if (!m.completed) {
      const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3, m.matchSeed, m.matchId);
      m.coachLogs = res.coachLogs || [];
      recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat, res.vodSets, res.telemetry);
    }
  }
  finalizeRegularWeek(state);
}

function getDraftUsedIds(draft) {
  return [...draft.blueBans, ...draft.redBans, ...draft.bluePicks, ...draft.redPicks];
}

function applyDraftPick(state, champId, logMsg = null) {
  const series = state.activeSeries;
  const draft = series.draft;
  if (draft.stepIndex >= DRAFT_SEQUENCE.length) return false;
  const used = getDraftUsedIds(draft);
  if (used.includes(champId)) return false;

  const step = DRAFT_SEQUENCE[draft.stepIndex];
  if (step.type === "ban") {
    if (step.team === "blue") draft.blueBans.push(champId);
    else draft.redBans.push(champId);
  } else {
    if (step.team === "blue") draft.bluePicks.push(champId);
    else draft.redPicks.push(champId);
  }
  if (logMsg) {
    if (!series.coachLogs) series.coachLogs = [];
    series.coachLogs.unshift(logMsg);
    if (series.coachLogs.length > 10) series.coachLogs.length = 10;
  }
  draft.stepIndex += 1;

  if (draft.stepIndex >= DRAFT_SEQUENCE.length) {
    if (state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P") {
      draft.phase = "PLAYER_ASSIGN";
      if (!draft.assignConfirmed) {
        draft.assignConfirmed = {
          blue: Boolean(state.seats[series.blueSeat]?.isAI),
          red: Boolean(state.seats[series.redSeat]?.isAI)
        };
      }
      state.screen = SCREEN_STATES.DRAFT;
    } else {
      draft.phase = "COMPLETE";
      initCombatRound(state);
      state.screen = SCREEN_STATES.COMBAT;
    }
  } else {
    draft.phase = DRAFT_SEQUENCE[draft.stepIndex].phase;
  }
  return true;
}

/**
 * 현재 차례의 AI 감독이 구단주 밴픽 노트 & Ego 확률을 반영하여 1스텝 수행한다.
 */
export function runCoachDraftStep(state) {
  const series = state.activeSeries;
  const draft = series.draft;
  if (draft.stepIndex >= DRAFT_SEQUENCE.length) return false;

  const step = DRAFT_SEQUENCE[draft.stepIndex];
  const seatIdx = step.team === "blue" ? series.blueSeat : series.redSeat;
  const enemySeatIdx = step.team === "blue" ? series.redSeat : series.blueSeat;
  const stepSeed = hashSeed(`${series.matchSeed || 100001}_draft_${draft.stepIndex}`);
  const rng = createSeededRng(stepSeed);

  const res = chooseCoachDraftChamp(state, seatIdx, draft, step, enemySeatIdx, rng);
  if (!res.champId) return false;
  return applyDraftPick(state, res.champId, res.log);
}

/**
 * 구단주 관전 모드에서 남은 모든 밴픽 단계를 양 팀 감독이 한 번에 완성한다.
 */
export function autoCompleteCoachDraft(state) {
  let guard = 0;
  while (state?.activeSeries?.draft?.stepIndex < DRAFT_SEQUENCE.length && guard < 12) {
    if (!runCoachDraftStep(state)) break;
    guard++;
  }
}

function runAutoAIDraftSteps(state) {
  const series = state.activeSeries;
  const draft = series.draft;

  while (draft.stepIndex < DRAFT_SEQUENCE.length) {
    const step = DRAFT_SEQUENCE[draft.stepIndex];
    const seatIdx = step.team === "blue" ? series.blueSeat : series.redSeat;
    const seat = state.seats[seatIdx];
    const isHumanControlled = seatIdx === state.localSeatIndex || (seat && !seat.isAI);
    if (isHumanControlled) break;

    if (!runCoachDraftStep(state)) break;
  }
}

/**
 * LCK 스네이크 밴픽 수동 단계 진행 (긴급 개입 / 직접 클릭 시)
 */
export function advanceDraftStep(state, champId) {
  const series = state.activeSeries;
  const draft = series.draft;
  if (draft.stepIndex >= DRAFT_SEQUENCE.length) return;

  const c = getChampionById(champId);
  const step = DRAFT_SEQUENCE[draft.stepIndex];
  const ok = applyDraftPick(
    state,
    champId,
    `✋ [구단주 직접 개입] ${step.team.toUpperCase()} ${step.type === "ban" ? "밴" : "픽"} → [${c.shortName}]`
  );
  if (ok) {
    runAutoAIDraftSteps(state);
  }
}

/**
 * 세트 종료 후 Rite 카드 3장 제시
 */
export function offerRiteCards(state) {
  const series = state.activeSeries;
  const humanTeam = series.redSeat === state.localSeatIndex ? "red" : "blue";
  const owned = humanTeam === "blue" ? series.blueRites : series.redRites;

  const rng = createSeededRng(hashSeed(`${series.matchSeed || 100001}_rite_${series.currentSet}`));
  const pool = RITE_CARDS.filter((r) => !owned.includes(r.id)).map((r) => r.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  series.riteOptions = pool.slice(0, 3);
}

/**
 * AI 감독의 ritePreference / riteSense 기반 최적 Rite 선택
 */
export function autoSelectCoachRiteCard(state, team) {
  const series = state.activeSeries;
  const avail = series.riteOptions && series.riteOptions.length > 0 ? series.riteOptions : RITE_CARDS.map((r) => r.id);
  const rng = createSeededRng(hashSeed(`${series.matchSeed || 100001}_ritepick_${team}_${series.currentSet}`));
  const chosen = chooseCoachRiteCard(state, team, avail, rng);
  if (chosen) selectRiteCard(state, team, chosen);
  return chosen;
}

/**
 * Rite 카드 선택 후 다음 세트 전투 개시
 */
export function selectRiteCard(state, team, riteId) {
  const series = state.activeSeries;
  const isArcade = state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P";
  const oppTeam = team === "blue" ? "red" : "blue";
  const oppSeatIdx = oppTeam === "blue" ? series.blueSeat : series.redSeat;
  const oppIsAI = Boolean(state.seats[oppSeatIdx]?.isAI);

  if (isArcade && !oppIsAI) {
    if (!state.activeMatch) {
      state.activeMatch = { callEvents: [], ritePicks: { blue: null, red: null }, boxscore: null, rematchCount: 0, setHistory: [] };
    }
    if (!state.activeMatch.ritePicks) {
      state.activeMatch.ritePicks = { blue: null, red: null };
    }
    state.activeMatch.ritePicks[team] = riteId;

    const bPick = state.activeMatch.ritePicks.blue;
    const rPick = state.activeMatch.ritePicks.red;
    if (!bPick || !rPick) {
      state.screen = SCREEN_STATES.RITE_DRAFT;
      return;
    }
    if (!series.blueRites.includes(bPick)) series.blueRites.push(bPick);
    if (!series.redRites.includes(rPick)) series.redRites.push(rPick);
    state.activeMatch.ritePicks = { blue: null, red: null };
  } else {
    const targetArr = team === "blue" ? series.blueRites : series.redRites;
    if (!targetArr.includes(riteId)) {
      targetArr.push(riteId);
    }

    // AI opponent coach picks optimal Rite card
    const oppArr = oppTeam === "blue" ? series.blueRites : series.redRites;
    const avail = RITE_CARDS.map((r) => r.id).filter((id) => !oppArr.includes(id));
    if (avail.length > 0) {
      const rng = createSeededRng(hashSeed(`${series.matchSeed || 100001}_opprite_${series.currentSet}`));
      const oppPick = chooseCoachRiteCard(state, oppTeam, avail, rng);
      if (oppPick) oppArr.push(oppPick);
    }
  }

  series.currentSet += 1;
  series.riteOptions = [];
  if (!state.preferredMapId || state.preferredMapId === "AUTO") {
    const nextMap = MAP_ORDER[(series.currentSet - 1) % MAP_ORDER.length];
    series.mapId = nextMap;
    series.selectedMapId = nextMap;
  } else {
    series.mapId = state.preferredMapId;
    series.selectedMapId = state.preferredMapId;
  }
  initCombatRound(state);
  state.screen = SCREEN_STATES.COMBAT;
}

/**
 * 실시간 VOD 리플레이 개시 (1x / 2x / 4x 배속 시청)
 */
export function startVodReplay(state, matchId, setIndex = 0) {
  const vod = state.vodPayloads?.[matchId];
  if (!vod || !vod.sets || vod.sets.length === 0) return false;
  const idx = Math.max(0, Math.min(setIndex, vod.sets.length - 1));
  const setSnap = vod.sets[idx];

  state.activeSeries = {
    matchId: vod.matchId,
    seriesMode: "VOD_REPLAY",
    bestOf: vod.bestOf || 3,
    currentSet: setSnap.setNum || (idx + 1),
    matchSeed: setSnap.matchSeed,
    isReplay: true,
    replayMatchId: vod.matchId,
    replaySetIndex: idx,
    replayTotalSets: vod.sets.length,
    coachLogs: [...(setSnap.coachLogs || [])],
    selectedMapId: setSnap.mapId,
    mapId: setSnap.mapId,
    blueSeat: vod.blueSeat,
    redSeat: vod.redSeat,
    blueWins: vod.sets.slice(0, idx).filter((s) => s.winnerTeam === "blue").length,
    redWins: vod.sets.slice(0, idx).filter((s) => s.winnerTeam === "red").length,
    draft: {
      phase: "COMPLETE",
      stepIndex: DRAFT_SEQUENCE.length,
      blueBans: [...(setSnap.blueBans || [])],
      redBans: [...(setSnap.redBans || [])],
      bluePicks: [...(setSnap.bluePicks || [])],
      redPicks: [...(setSnap.redPicks || [])]
    },
    blueRites: [...(setSnap.blueRites || [])],
    redRites: [...(setSnap.redRites || [])],
    riteOptions: []
  };

  initCombatRound(state);
  state.combat.speedMult = state.combat.speedMult >= 2 ? state.combat.speedMult : 2;
  state.screen = SCREEN_STATES.COMBAT;
  return true;
}

/**
 * 세트 종료 시 시리즈 진행 처리 (VOD 다음 세트 / Rite Draft / 시리즈 완료)
 */
export function recordSetWinAndProceed(state, winnerTeam) {
  const series = state.activeSeries;
  if (series.seriesMode === "EXHIBITION") {
    return;
  }

  if (series.isReplay || series.seriesMode === "VOD_REPLAY") {
    const nextIdx = (series.replaySetIndex || 0) + 1;
    if (nextIdx < (series.replayTotalSets || 0)) {
      startVodReplay(state, series.replayMatchId, nextIdx);
    } else {
      state.combat.running = false;
      state.screen = state.playoffs?.active ? SCREEN_STATES.PLAYOFF_BRACKET : SCREEN_STATES.WEEKLY_HUB;
    }
    return;
  }

  if (winnerTeam === "blue") series.blueWins += 1;
  else series.redWins += 1;

  if (state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P") {
    if (!state.activeMatch) {
      state.activeMatch = { callEvents: [], ritePicks: { blue: null, red: null }, boxscore: null, rematchCount: 0, setHistory: [] };
    }
    if (!Array.isArray(state.activeMatch.setHistory)) state.activeMatch.setHistory = [];
    state.activeMatch.setHistory.push({
      setNum: series.currentSet,
      winnerTeam,
      mapId: series.mapId,
      mvp: state.combat?.matchTelemetry?.mvpUnit || null,
      blueWins: series.blueWins,
      redWins: series.redWins
    });
  }

  // Live played set snapshot stored into vodPayloads
  const setRecord = {
    setNum: series.currentSet,
    mapId: series.mapId,
    matchSeed: series.matchSeed,
    bluePicks: [...series.draft.bluePicks],
    redPicks: [...series.draft.redPicks],
    blueBans: [...series.draft.blueBans],
    redBans: [...series.draft.redBans],
    blueRites: [...series.blueRites],
    redRites: [...series.redRites],
    coachLogs: [...(series.coachLogs || [])],
    winnerTeam
  };
  if (!state.vodPayloads) state.vodPayloads = {};
  if (!state.vodPayloads[series.matchId]) {
    state.vodPayloads[series.matchId] = {
      matchId: series.matchId,
      blueSeat: series.blueSeat,
      redSeat: series.redSeat,
      bestOf: series.bestOf,
      sets: []
    };
  }
  state.vodPayloads[series.matchId].sets.push(setRecord);

  const neededWins = Math.ceil(series.bestOf / 2);
  if (series.blueWins >= neededWins || series.redWins >= neededWins) {
    completeSeriesAndAdvance(state);
  } else {
    offerRiteCards(state);
    state.screen = SCREEN_STATES.RITE_DRAFT;
  }
}

/**
 * 스케줄 모드 변경 및 미완료 경기 타임스탬프 재계산
 */
export function setScheduleMode(state, mode, baseTimeMs = Date.now()) {
  const valid = SCHEDULE_MODES[mode] || SCHEDULE_MODES.REALTIME_DAILY;
  state.scheduleMode = valid;
  state.seasonBaseTimeMs = baseTimeMs;

  for (let w = 0; w < (state.schedule || []).length; w++) {
    const wk = state.schedule[w];
    const t = computeRoundScheduledAt(baseTimeMs, w, valid);
    wk.scheduledAt = t;
    for (const m of wk.matches || []) {
      if (!m.completed) m.scheduledAt = t;
    }
  }
  const totalWeeks = Math.max(1, (state.schedule || []).length || state.maxWeeks || LEAGUE_TEAM_COUNT - 1);
  if (state.playoffs) {
    if (state.playoffs.semi1 && state.playoffs.semi1.winnerSeat === null) {
      state.playoffs.semi1.scheduledAt = computeRoundScheduledAt(baseTimeMs, totalWeeks, valid);
    }
    if (state.playoffs.semi2 && state.playoffs.semi2.winnerSeat === null) {
      state.playoffs.semi2.scheduledAt = computeRoundScheduledAt(baseTimeMs, totalWeeks, valid);
    }
    if (state.playoffs.final && state.playoffs.final.winnerSeat === null) {
      state.playoffs.final.scheduledAt = computeRoundScheduledAt(baseTimeMs, totalWeeks + 1, valid);
    }
  }
}

function formatDurationHHMMSS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSec / 3600).toString().padStart(2, "0");
  const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * 다음 예정 경기까지의 실시간 카운트다운 계산
 */
export function getNextMatchCountdown(state, nowMs = Date.now()) {
  const mode = state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
  let targetAt = nowMs;
  let label = "SEASON COMPLETE";

  if (state.playoffs?.active) {
    const po = state.playoffs;
    if (po.round === "CHAMPION") {
      return { label: "CHAMPION CROWNED", remainingMs: 0, hhmmss: "00:00:00", scheduledAt: nowMs, isDue: false, mode };
    }
    const key = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bm = po[key];
    targetAt = bm?.scheduledAt || nowMs;
    label = po.round === "FINAL" ? "결승 Bo5" : "플레이오프 Bo5";
  } else {
    const wk = state.schedule?.[state.week - 1];
    targetAt = wk?.scheduledAt || nowMs;
    label = `WEEK ${state.week} 개막`;
  }

  if (mode === SCHEDULE_MODES.INSTANT_TEST) {
    return { label, remainingMs: 0, hhmmss: "INSTANT READY", scheduledAt: nowMs, isDue: true, mode };
  }

  const remainingMs = Math.max(0, targetAt - nowMs);
  return {
    label,
    remainingMs,
    hhmmss: remainingMs <= 0 ? "00:00:00 (ON AIR)" : formatDurationHHMMSS(remainingMs),
    scheduledAt: targetAt,
    isDue: remainingMs <= 0,
    mode
  };
}

/**
 * 오프라인 동안 예정 시각(scheduledAt)이 지난 라운드를 결정론적 시드로 자동 정산한다.
 */
export function checkAndResolveDueMatches(state, nowMs = Date.now()) {
  const mode = state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
  if (mode === SCHEDULE_MODES.INSTANT_TEST) return 0;
  if (state.screen === SCREEN_STATES.DRAFT || state.screen === SCREEN_STATES.COMBAT || state.screen === SCREEN_STATES.RITE_DRAFT) {
    return 0;
  }

  let resolvedCount = 0;
  while (!state.playoffs?.active && state.week <= state.maxWeeks) {
    const wk = state.schedule?.[state.week - 1];
    if (!wk || (wk.scheduledAt || Infinity) > nowMs) break;
    runAIClubActions(state);
    for (const m of wk.matches) {
      if (!m.completed) {
        const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3, m.matchSeed, m.matchId);
        m.coachLogs = res.coachLogs || [];
        recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat, res.vodSets, res.telemetry);
        resolvedCount++;
      }
    }
    finalizeRegularWeek(state);
  }

  while (state.playoffs?.active && state.playoffs.round !== "CHAMPION") {
    const po = state.playoffs;
    const matchKey = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bm = po[matchKey];
    if (!bm || bm.winnerSeat !== null || (bm.scheduledAt || Infinity) > nowMs) break;
    const res = simulateMatchHeadless(state, bm.homeSeat, bm.awaySeat, 5, bm.matchSeed, `po_${matchKey}`);
    bm.homeSets = res.homeSets;
    bm.awaySets = res.awaySets;
    bm.winnerSeat = res.winnerSeat;
    bm.telemetry = res.telemetry || null;
    saveVodPayload(state, `po_${matchKey}`, bm.homeSeat, bm.awaySeat, 5, res.vodSets);
    resolvedCount++;
    onPlayoffMatchSettled(state, matchKey, bm, res.coachLogs || []);
  }

  return resolvedCount;
}

function applySlumpCheck(player) {
  if (!player) return;
  if (player.condition <= 35) player.slump = true;
  else if (player.condition >= 60) player.slump = false;
}

/**
 * 24시간 3슬롯 자동 훈련 루틴 실행 (단일 구단, 지정 슬롯)
 */
export function runDailyRoutineForSeat(state, seat, slotKeys = ["MORNING", "AFTERNOON", "NIGHT"]) {
  if (!seat) return "";
  if (!seat.autoSchedule) {
    seat.autoSchedule = { MORNING: "SOLO_GRIND", AFTERNOON: "TEAM_SCRIM", NIGHT: "REST_CARE", focusStat: "mechanics" };
  }
  const focusStat = seat.autoSchedule.focusStat || "mechanics";
  const tcLv = seat.facilities?.trainingCenter || 1;
  const medLv = seat.facilities?.medicalBay || 1;
  const champKeys = Object.keys(CHAMPIONS);

  // AI 구단은 체력 저하 시 야간 슬롯을 자동 휴식으로 보정
  const avgCond = (seat.roster || []).slice(0, 3).reduce((s, p) => s + (p.condition || 80), 0) / 3;
  const logs = [];

  for (const slot of slotKeys) {
    let act = seat.autoSchedule[slot] || "REST_CARE";
    if (seat.isAI && slot === "NIGHT" && avgCond < 65) {
      act = "REST_CARE";
    }

    if (act === "SOLO_GRIND") {
      const bonus = tcLv >= 3 ? 1 : 0;
      for (let i = 0; i < Math.min(3, seat.roster.length); i++) {
        const p = seat.roster[i];
        p.stats[focusStat] = Math.min(99, (p.stats[focusStat] || 70) + 2 + bonus);
        p.condition = Math.max(25, (p.condition || 80) - 8);
        applySlumpCheck(p);
      }
      logs.push(`${slot === "MORNING" ? "오전" : slot === "AFTERNOON" ? "오후" : "야간"}: 개인훈련(${focusStat}+${2 + bonus})`);
    } else if (act === "TEAM_SCRIM") {
      const xpGain = 25 + (tcLv - 1) * 5;
      let lvUps = 0;
      for (let i = 0; i < Math.min(3, seat.roster.length); i++) {
        const p = seat.roster[i];
        const favKey = Object.keys(p.mastery || {})[0] || champKeys[(seat.seatIndex + i) % champKeys.length];
        if (!p.masteryXp || typeof p.masteryXp !== "object") {
          p.masteryXp = { [favKey]: Number(p.masteryXp) || 0 };
        }
        p.masteryXp[favKey] = (p.masteryXp[favKey] || 0) + xpGain;
        if (p.masteryXp[favKey] >= 100) {
          p.masteryXp[favKey] -= 100;
          const prevLv = p.mastery?.[favKey] || 1;
          if (!p.mastery) p.mastery = {};
          if (prevLv < 5) {
            p.mastery[favKey] = prevLv + 1;
            lvUps += 1;
          }
        }
        p.condition = Math.max(25, (p.condition || 80) - 10);
        applySlumpCheck(p);
      }
      logs.push(`${slot === "MORNING" ? "오전" : slot === "AFTERNOON" ? "오후" : "야간"}: 팀스크림(숙련XP+${xpGain}${lvUps > 0 ? `, Lv+${lvUps}` : ""})`);
    } else if (act === "STREAMING") {
      seat.funds = (seat.funds || 0) + 250;
      seat.inDebt = seat.funds < 0;
      for (let i = 0; i < Math.min(3, seat.roster.length); i++) {
        const p = seat.roster[i];
        p.condition = Math.max(25, (p.condition || 80) - 12);
        applySlumpCheck(p);
      }
      logs.push(`${slot === "MORNING" ? "오전" : slot === "AFTERNOON" ? "오후" : "야간"}: 개인방송(+250G)`);
    } else {
      const heal = 25 + (medLv - 1) * 4;
      for (const p of seat.roster || []) {
        p.condition = Math.min(100, (p.condition || 80) + heal);
        p.stats.mental = Math.min(99, (p.stats.mental || 70) + 1);
        p.slump = false;
      }
      logs.push(`${slot === "MORNING" ? "오전" : slot === "AFTERNOON" ? "오후" : "야간"}: 휴식(+${heal}%)`);
    }
  }

  return logs.join(" · ");
}

/**
 * 전체 6개 구단 24시간 루틴 1일 사이클 실행
 */
export function runDailyRoutineForAllClubs(state, slotKeys = ["MORNING", "AFTERNOON", "NIGHT"]) {
  let localSummary = "";
  const now = Date.now();
  for (const seat of state.seats || []) {
    const summary = runDailyRoutineForSeat(state, seat, slotKeys);
    seat.lastRoutineTickAt = now;
    if (seat.seatIndex === state.localSeatIndex) {
      localSummary = summary;
    }
  }
  return localSummary;
}

/**
 * 실시간 모드(DAILY/HOURLY)에서 경과 시간에 따라 루틴 슬롯 자동 실행
 */
export function tickRealTimeRoutineIfDue(state, nowMs = Date.now()) {
  const mode = state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
  if (mode === SCHEDULE_MODES.INSTANT_TEST) return 0;
  const intervalMs = mode === SCHEDULE_MODES.REALTIME_HOURLY ? 20 * 60 * 1000 : 8 * 3600 * 1000;
  const slots = ["MORNING", "AFTERNOON", "NIGHT"];
  let executed = 0;

  for (const seat of state.seats || []) {
    const last = seat.lastRoutineTickAt || nowMs;
    const elapsed = Math.max(0, nowMs - last);
    const steps = Math.min(3, Math.floor(elapsed / intervalMs));
    if (steps <= 0) continue;
    const startIdx = seat.routineCursor || 0;
    const dueSlots = [];
    for (let i = 0; i < steps; i++) {
      dueSlots.push(slots[(startIdx + i) % 3]);
    }
    runDailyRoutineForSeat(state, seat, dueSlots);
    seat.routineCursor = (startIdx + steps) % 3;
    seat.lastRoutineTickAt = last + steps * intervalMs;
    executed += steps;
  }
  return executed;
}

/**
 * 라운드 종료 시 구단별 재정 정산 (승리 500G / 패배 150G + 스폰서 미션 - 라운드 인건비)
 */
export function settleRoundFinances(state, matchResults = [], roundLabel = "") {
  const reports = [];
  for (const seat of state.seats || []) {
    const match = matchResults.find((m) => m.homeSeat === seat.seatIndex || m.awaySeat === seat.seatIndex);
    let prize = 0;
    let sponsorBonus = 0;
    let sponsorCleared = false;
    const sponsor = getSponsorById(seat.sponsorId);

    if (match) {
      const won = match.winnerSeat === seat.seatIndex;
      prize = won ? 500 : 150;
      const side = match.homeSeat === seat.seatIndex ? "blue" : "red";
      const sideTel = match.telemetry?.[side] || { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 };

      const condKey = sponsor.targetKey || sponsor.conditionKey;
      const targetVal = sponsor.targetValue ?? sponsor.targetCount ?? 1;
      if (condKey === "orbsDestroyed" && (sideTel.orbsDestroyed || 0) >= targetVal) {
        sponsorBonus = sponsor.bonusGold;
        sponsorCleared = true;
      } else if (condKey === "countersLanded" && (sideTel.countersLanded || 0) >= targetVal) {
        sponsorBonus = sponsor.bonusGold;
        sponsorCleared = true;
      } else if (condKey === "matchWin" && won) {
        sponsorBonus = sponsor.bonusGold;
        sponsorCleared = true;
      }
    }

    const payroll = computeRoundPayroll(seat);
    const net = prize + sponsorBonus - payroll;
    seat.funds = (seat.funds || 0) + net;
    seat.roundPayroll = payroll;
    seat.inDebt = seat.funds < 0;
    seat.lastSettlement = {
      roundLabel,
      prize,
      sponsorName: sponsor.name,
      sponsorBonus,
      sponsorCleared,
      payroll,
      net,
      balanceAfter: seat.funds,
      inDebt: seat.inDebt
    };
    reports.push({ seatIndex: seat.seatIndex, teamName: seat.teamName, ...seat.lastSettlement });
  }
  return reports;
}

/**
 * 매 라운드 종료 후 e스포츠 '아레나 데일리 뉴스' 발행
 */
export function generateDailyNews(state, matchResults = [], roundLabel = "", routineSummary = "") {
  const localSeat = state.seats[state.localSeatIndex] || state.seats[0];
  const featured =
    matchResults.find((m) => m.homeSeat === state.localSeatIndex || m.awaySeat === state.localSeatIndex) ||
    matchResults[0];

  let headline = `📰 [${roundLabel}] 아레나 프로리그 열기 고조`;
  let matchOfTheDay = "이번 라운드 모든 구단이 치열한 접전을 펼쳤습니다.";
  let mvpLine = "MVP 집계 데이터를 불러오는 중입니다.";
  let coachDrama = "감독진의 치열한 수싸움이 빛났습니다.";

  if (featured) {
    const home = state.seats[featured.homeSeat];
    const away = state.seats[featured.awaySeat];
    const winner = featured.winnerSeat === home.seatIndex ? home : away;
    const scoreStr = `${featured.homeSets}:${featured.awaySets}`;
    const isClose = Math.abs(featured.homeSets - featured.awaySets) === 1;
    headline = isClose
      ? `🔥 ${winner.teamName}, 혈투 끝 ${away.seatIndex === winner.seatIndex ? home.teamName : away.teamName} 제압! (${scoreStr})`
      : `⚡ ${winner.teamName}, 압도적 경기력으로 ${roundLabel} 완승 (${scoreStr})`;

    matchOfTheDay = `${home.teamName} vs ${away.teamName} (${scoreStr}) — ${winner.teamName} 승리`;

    const mvp = featured.telemetry?.mvpUnit;
    if (mvp) {
      mvpLine = `🏆 POG: ${mvp.playerName} (${mvp.champName}) · 피해량 ${mvp.damageDealt} · 반격 ${mvp.countersTriggered}회 · 오브 ${mvp.orbsDestroyed}회`;
    }

    const logs = featured.coachLogs || [];
    const egoLog = logs.find((l) => l.includes("독단 픽") || l.includes("긴급 개입"));
    const winnerBarks = winner.headCoach?.matchBarks || [];
    const sampleBark = winnerBarks.length > 0 ? winnerBarks[Math.floor((featured.homeSets + featured.awaySets + state.week) % winnerBarks.length)] : null;
    if (egoLog) {
      coachDrama = `🎙️ 밴픽 화제: ${egoLog}`;
    } else if (sampleBark) {
      coachDrama = `🎙️ ${winner.headCoach?.name || winner.coachName} 감독 "${sampleBark}"`;
    } else if (logs[0]) {
      coachDrama = `🎙️ 코치 코멘트: ${logs[0]}`;
    } else {
      coachDrama = `🎙️ ${winner.headCoach?.name || winner.coachName} 감독 "구단주의 노트를 믿고 준비한 조합이 적중했다."`;
    }
  }

  const s = localSeat?.lastSettlement;
  const clubBrief = s
    ? `💰 ${localSeat.teamName} 정산: 상금 +${s.prize}G${s.sponsorCleared ? ` · 스폰서 달성 +${s.sponsorBonus}G` : ` · 스폰서(${s.sponsorName}) 미달성`} · 인건비 -${s.payroll}G → 순수익 ${s.net >= 0 ? "+" : ""}${s.net}G (잔액 ${s.balanceAfter}G)`
    : "";

  const slumpPlayers = (localSeat?.roster || []).filter((p) => p.slump).map((p) => p.name);
  const financialAlert = localSeat?.inDebt
    ? `🚨 재정 적자 경보! 잔액 ${localSeat.funds}G — 선수단 전 능력치 -10% 패널티 & 영입/증축 동결!`
    : slumpPlayers.length > 0
      ? `⚠️ 컨디션 난조 주의: ${slumpPlayers.join(", ")} 선수 슬럼프 진입 (능력치 -10%)`
      : routineSummary
        ? `🏋️ 루틴 리포트: ${routineSummary}`
        : "";

  const news = {
    id: `news_s${state.seasonNumber || 1}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    season: state.seasonNumber || 1,
    roundLabel,
    headline,
    matchOfTheDay,
    mvpLine,
    coachDrama,
    clubBrief,
    financialAlert,
    createdAt: Date.now()
  };

  state.latestDailyNews = news;
  if (!state.dailyNewsHistory) state.dailyNewsHistory = [];
  state.dailyNewsHistory.unshift(news);
  if (state.dailyNewsHistory.length > 15) state.dailyNewsHistory.length = 15;
  return news;
}

function generateSuperRookies(state) {
  const rng = createSeededRng(hashSeed(`${state.roomCode || "0000"}_stove_s${state.seasonNumber || 1}`));
  const names = [
    "김신우 (Apex)",
    "박준혁 (Zenith)",
    "이하늘 (Skyline)",
    "최도윤 (Vortex)",
    "강민재 (Nova)",
    "한서준 (Blaze)"
  ];
  const traitKeys = Object.keys(TRAITS);
  const champKeys = Object.keys(CHAMPIONS);
  const rookies = [];

  for (let i = 0; i < 3; i++) {
    const pickName = names[(Math.floor(rng() * names.length) + i) % names.length];
    const m = 78 + Math.floor(rng() * 13);
    const r = 78 + Math.floor(rng() * 13);
    const t = 75 + Math.floor(rng() * 14);
    const mn = 76 + Math.floor(rng() * 14);
    const favChamp = champKeys[Math.floor(rng() * champKeys.length)];
    rookies.push({
      playerId: `rookie_s${state.seasonNumber || 1}_${i}`,
      name: pickName,
      condition: 96,
      salary: 220,
      slump: false,
      masteryXp: 0,
      stats: { mechanics: m, reflex: r, teamwork: t, mental: mn },
      trait: traitKeys[Math.floor(rng() * traitKeys.length)],
      mastery: { [favChamp]: 3 },
      cost: 1200 + Math.floor(rng() * 5) * 150
    });
  }
  return rookies;
}

/**
 * 시즌 결승 종료 후 스토브리그(명예의 전당 등록, 우승 상금 지급, 신인 3명 공개) 진입
 */
export function enterStoveLeague(state) {
  const po = state.playoffs;
  if (!po || po.championSeat === null) return;
  const champ = state.seats[po.championSeat];
  const finalRunnerUpSeat =
    po.final?.homeSeat === po.championSeat ? po.final?.awaySeat : po.final?.homeSeat;
  const semiLosers = [po.semi1, po.semi2]
    .map((m) => (m?.winnerSeat === m?.homeSeat ? m?.awaySeat : m?.homeSeat))
    .filter((s) => s !== null && s !== undefined);

  // 중복 지급 방지
  const existingHof = (state.hallOfFame || []).find((h) => h.season === (state.seasonNumber || 1));
  if (!existingHof && champ) {
    champ.funds += 3000;
    champ.inDebt = champ.funds < 0;
    if (finalRunnerUpSeat !== null && finalRunnerUpSeat !== undefined && state.seats[finalRunnerUpSeat]) {
      state.seats[finalRunnerUpSeat].funds += 1500;
      state.seats[finalRunnerUpSeat].inDebt = state.seats[finalRunnerUpSeat].funds < 0;
    }
    for (const sIdx of semiLosers) {
      if (state.seats[sIdx]) {
        state.seats[sIdx].funds += 800;
        state.seats[sIdx].inDebt = state.seats[sIdx].funds < 0;
      }
    }

    const mvp = po.final?.telemetry?.mvpUnit;
    if (!state.hallOfFame) state.hallOfFame = [];
    state.hallOfFame.unshift({
      season: state.seasonNumber || 1,
      championSeat: champ.seatIndex,
      teamName: champ.teamName,
      teamColor: champ.teamColor,
      coachName: champ.headCoach?.name || champ.coachName,
      record: `${champ.wins}승 ${champ.losses}패 (세트 ${champ.setWins}:${champ.setLosses})`,
      mvpName: mvp ? `${mvp.playerName} (${mvp.champName})` : champ.roster[0]?.name || "-"
    });
  }

  // AI 구단 오프시즌 시설 투자 또는 감독 교체 시뮬레이션
  for (const seat of state.seats || []) {
    if (!seat.isAI) continue;
    if (seat.funds >= 1200) {
      const fKeys = Object.keys(FACILITY_DEFS);
      const fk = fKeys[seat.seatIndex % fKeys.length];
      if ((seat.facilities?.[fk] || 1) < 5) {
        upgradeFacility(state, seat.seatIndex, fk);
      }
    }
  }

  state.stoveRookies = generateSuperRookies(state);
  state.screen = SCREEN_STATES.STOVE_LEAGUE;
}

/**
 * 스토브리그 초특급 신인 영입
 */
export function signStoveRookie(state, seatIndex, rookieIndex) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };
  if (seat.inDebt || seat.funds < 0) {
    return { ok: false, message: "⚠️ 구단 적자 상태라 신인 계약이 잠겼습니다!" };
  }
  const rookie = state.stoveRookies?.[rookieIndex];
  if (!rookie) return { ok: false, message: "이미 영입된 신인입니다." };
  if (seat.funds < rookie.cost) {
    return { ok: false, message: `자금이 부족합니다. (계약금 ${rookie.cost}G / 보유 ${seat.funds}G)` };
  }

  seat.funds -= rookie.cost;
  seat.inDebt = seat.funds < 0;
  seat.roundPayroll = computeRoundPayroll(seat);
  const oldSub = seat.roster[3];
  seat.roster[3] = {
    playerId: rookie.playerId,
    name: rookie.name,
    condition: rookie.condition,
    salary: rookie.salary,
    slump: false,
    masteryXp: 0,
    stats: { ...rookie.stats },
    trait: rookie.trait,
    mastery: { ...rookie.mastery }
  };
  state.stoveRookies.splice(rookieIndex, 1);
  return {
    ok: true,
    message: `🌟 초특급 신인 [${rookie.name}] 영입 완료! (${oldSub ? oldSub.name : "후보"} 교체, -${rookie.cost}G)`
  };
}

/**
 * 다음 시즌(Season N+1) 개막: AI 구단 스탯 +3 스케일링, 일정 리셋, 시설/자산/명예의 전당 유지
 */
export function startNextSeason(state) {
  state.seasonNumber = (state.seasonNumber || 1) + 1;
  state.week = 1;
  state.vodPayloads = {};
  state.stoveRookies = [];

  for (const seat of state.seats || []) {
    seat.wins = 0;
    seat.losses = 0;
    seat.setWins = 0;
    seat.setLosses = 0;
    seat.ap = seat.maxAp;
    seat.lastSettlement = null;
    if (seat.isAI) {
      seat.funds = Math.max(seat.funds, 2000);
      for (const p of seat.roster || []) {
        p.stats.mechanics = Math.min(99, p.stats.mechanics + 3);
        p.stats.reflex = Math.min(99, p.stats.reflex + 3);
        p.stats.teamwork = Math.min(99, p.stats.teamwork + 3);
        p.stats.mental = Math.min(99, p.stats.mental + 3);
      }
    }
    seat.inDebt = seat.funds < 0;
    for (const p of seat.roster || []) {
      p.condition = 92;
      p.slump = false;
    }
    seat.roundPayroll = computeRoundPayroll(seat);
  }

    const teamCount = Math.max(2, state.seats?.length || LEAGUE_TEAM_COUNT);
    state.maxWeeks = teamCount - 1;
    state.schedule = generateSchedule(teamCount, Date.now(), state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY, state.roomCode || "4821");
    setScheduleMode(state, state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY, Date.now());
  state.playoffs = {
    active: false,
    round: "SEMI_1",
    seeds: [],
    semi1: { homeSeat: null, awaySeat: null, homeSets: 0, awaySets: 0, winnerSeat: null },
    semi2: { homeSeat: null, awaySeat: null, homeSets: 0, awaySets: 0, winnerSeat: null },
    final: { homeSeat: null, awaySeat: null, homeSets: 0, awaySets: 0, winnerSeat: null },
    championSeat: null
  };
  state.screen = SCREEN_STATES.WEEKLY_HUB;
}

function finalizeRegularWeek(state) {
  const weekNum = state.week;
  const weekObj = state.schedule[weekNum - 1];
  const matchResults = (weekObj?.matches || []).map((m) => ({
    matchId: m.matchId,
    homeSeat: m.homeSeat,
    awaySeat: m.awaySeat,
    homeSets: m.homeSets,
    awaySets: m.awaySets,
    winnerSeat: m.winnerSeat,
    telemetry: m.telemetry || null,
    coachLogs: m.coachLogs || []
  }));

  const routineSummary = runDailyRoutineForAllClubs(state, ["MORNING", "AFTERNOON", "NIGHT"]);
  settleRoundFinances(state, matchResults, `W${weekNum}`);
  generateDailyNews(state, matchResults, `정규리그 ${weekNum}주차`, routineSummary);

  for (const seat of state.seats) {
    seat.ap = seat.maxAp;
  }

  // Balance patch every 2 rounds (after Week 2 and Week 4)
  if (state.week % 2 === 0) {
    applyBalancePatch(state);
  }

  if (state.week < state.maxWeeks) {
    state.week += 1;
    state.screen = SCREEN_STATES.WEEKLY_HUB;
  } else {
    // Seed Top 4 into Bo5 Playoffs
    const ranked = getStandings(state);
    const seeds = ranked.slice(0, 4).map((s) => s.seatIndex);
    const mode = state.scheduleMode || SCHEDULE_MODES.REALTIME_DAILY;
    const baseMs = state.seasonBaseTimeMs || Date.now();
    const semiOffset = state.maxWeeks || (state.seats?.length || LEAGUE_TEAM_COUNT) - 1;
    const semiTime = computeRoundScheduledAt(baseMs, semiOffset, mode);
    const finalTime = computeRoundScheduledAt(baseMs, semiOffset + 1, mode);
    state.playoffs = {
      active: true,
      round: "SEMI_1",
      seeds,
      semi1: {
        homeSeat: seeds[0],
        awaySeat: seeds[3],
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: semiTime,
        matchSeed: hashSeed(`${state.roomCode || "0000"}_po_semi1_${seeds[0]}_${seeds[3]}`)
      },
      semi2: {
        homeSeat: seeds[1],
        awaySeat: seeds[2],
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: semiTime,
        matchSeed: hashSeed(`${state.roomCode || "0000"}_po_semi2_${seeds[1]}_${seeds[2]}`)
      },
      final: {
        homeSeat: null,
        awaySeat: null,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: finalTime,
        matchSeed: hashSeed(`${state.roomCode || "0000"}_po_final`)
      },
      championSeat: null
    };
    state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
  }
}

function onPlayoffMatchSettled(state, matchKey, bm, coachLogs = []) {
  const label = matchKey === "final" ? "플레이오프 결승" : matchKey === "semi1" ? "플레이오프 4강 1경기" : "플레이오프 4강 2경기";
  const results = [{
    matchId: `po_${matchKey}`,
    homeSeat: bm.homeSeat,
    awaySeat: bm.awaySeat,
    homeSets: bm.homeSets,
    awaySets: bm.awaySets,
    winnerSeat: bm.winnerSeat,
    telemetry: bm.telemetry || null,
    coachLogs
  }];
  const routineSummary = runDailyRoutineForAllClubs(state, ["MORNING", "AFTERNOON", "NIGHT"]);
  settleRoundFinances(state, results, matchKey.toUpperCase());
  generateDailyNews(state, results, label, routineSummary);
  advancePlayoffRound(state);
}

function advancePlayoffRound(state) {
  const po = state.playoffs;
  if (po.round === "SEMI_1" && po.semi1.winnerSeat !== null) {
    po.round = "SEMI_2";
    state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
  } else if (po.round === "SEMI_2" && po.semi2.winnerSeat !== null) {
    po.final.homeSeat = po.semi1.winnerSeat;
    po.final.awaySeat = po.semi2.winnerSeat;
    po.final.matchSeed = hashSeed(`${state.roomCode || "0000"}_po_final_${po.final.homeSeat}_${po.final.awaySeat}`);
    po.round = "FINAL";
    state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
  } else if (po.round === "FINAL" && po.final.winnerSeat !== null) {
    po.championSeat = po.final.winnerSeat;
    po.round = "CHAMPION";
    enterStoveLeague(state);
  } else {
    state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
  }
}

/**
 * 시리즈 완료 반영 & 다음 주차/패치/플레이오프/스토브리그 전환
 */
export function completeSeriesAndAdvance(state) {
  const series = state.activeSeries;
  const winnerSeat = series.blueWins > series.redWins ? series.blueSeat : series.redSeat;

  if (state.roomMode === ROOM_MODES.ARCADE_2P || series.seriesMode === "ARCADE_2P") {
    const loserSeat = winnerSeat === series.blueSeat ? series.redSeat : series.blueSeat;
    if (state.seats[winnerSeat]) state.seats[winnerSeat].wins = (state.seats[winnerSeat].wins || 0) + 1;
    if (state.seats[loserSeat]) state.seats[loserSeat].losses = (state.seats[loserSeat].losses || 0) + 1;
    if (!state.activeMatch) {
      state.activeMatch = { callEvents: [], ritePicks: { blue: null, red: null }, boxscore: null, rematchCount: 0, setHistory: [] };
    }
    const blueSeatObj = state.seats[series.blueSeat];
    const redSeatObj = state.seats[series.redSeat];
    state.activeMatch.boxscore = {
      id: `arc_box_${Date.now()}_${series.blueWins}_${series.redWins}`,
      winnerSeat,
      winnerTeam: series.blueWins >= series.redWins ? "blue" : "red",
      blueSeat: series.blueSeat,
      redSeat: series.redSeat,
      blueTeamName: blueSeatObj?.teamName || "BLUE",
      redTeamName: redSeatObj?.teamName || "RED",
      blueWins: series.blueWins,
      redWins: series.redWins,
      setHistory: [...(state.activeMatch.setHistory || [])],
      fighters: (state.combat?.fighters || []).map((f) => ({
        unitId: f.unitId,
        team: f.team,
        playerName: f.playerName,
        champId: f.champId,
        damageDealt: Math.round(f.damageDealt || 0),
        kills: f.kills || 0,
        countersTriggered: f.countersTriggered || 0,
        orbsDestroyed: f.orbsDestroyed || 0
      })),
      mvpUnit: state.combat?.matchTelemetry?.mvpUnit || series.telemetry?.mvpUnit || null
    };
    for (const s of state.seats || []) s.ready = false;
    state.combat.running = false;
    state.screen = SCREEN_STATES.ARCADE_LOBBY;
    return;
  }

  if (series.seriesMode === "PLAYOFF" && state.playoffs.active) {
    const po = state.playoffs;
    const matchKey = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bm = po[matchKey];
    if (bm) {
      bm.homeSets = series.blueWins;
      bm.awaySets = series.redWins;
      bm.winnerSeat = winnerSeat;
      bm.telemetry = series.telemetry || null;
      onPlayoffMatchSettled(state, matchKey, bm, series.coachLogs || []);
      return;
    }
    advancePlayoffRound(state);
    return;
  }

  const weekObj = state.schedule[state.week - 1];
  if (weekObj) {
    const matchObj = weekObj.matches.find((m) => m.matchId === series.matchId);
    if (matchObj && !matchObj.completed) {
      matchObj.coachLogs = [...(series.coachLogs || [])];
      recordMatchToStandings(state, matchObj, series.blueWins, series.redWins, winnerSeat, null, series.telemetry);
    }
    for (const m of weekObj.matches) {
      if (!m.completed) {
        const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3, m.matchSeed, m.matchId);
        m.coachLogs = res.coachLogs || [];
        recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat, res.vodSets, res.telemetry);
      }
    }
  }

  finalizeRegularWeek(state);
}

/**
 * 2주마다 자동 밸런스 패치 생성 (하위권 2명 버프, 상위권 2명 너프)
 */
export function applyBalancePatch(state) {
  const keys = Object.keys(CHAMPIONS);
  const sorted = [...keys].sort((a, b) => CHAMPIONS[a].patchMod.dmgMult - CHAMPIONS[b].patchMod.dmgMult);
  const buffIds = [sorted[0], sorted[1]];
  const nerfIds = [sorted[sorted.length - 1], sorted[sorted.length - 2]];

  const nextVer = (parseFloat(state.patchVersion) + 0.2).toFixed(1);
  state.patchVersion = nextVer;

  const changes = [];
  for (const id of buffIds) {
    const c = CHAMPIONS[id];
    c.patchMod.dmgMult = Number((c.patchMod.dmgMult * 1.10).toFixed(2));
    c.patchMod.hpMult = Number((c.patchMod.hpMult * 1.06).toFixed(2));
    changes.push(`▲ ${c.shortName}: 피해량 +10%, 체력 +6% 상향`);
  }
  for (const id of nerfIds) {
    const c = CHAMPIONS[id];
    c.patchMod.dmgMult = Number((c.patchMod.dmgMult * 0.91).toFixed(2));
    c.patchMod.cdMult = Number((c.patchMod.cdMult * 1.08).toFixed(2));
    changes.push(`▼ ${c.shortName}: 피해량 -9%, 쿨타임 +8% 하향`);
  }

  const patchEntry = {
    version: nextVer,
    week: state.week,
    changes
  };
  state.patchNotes.unshift(patchEntry);
  return patchEntry;
}
