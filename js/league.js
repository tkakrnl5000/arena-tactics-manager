/**
 * js/league.js
 * 6팀 LCK 스타일 리그 일정(5라운드 15경기), 헤드리스 고속 시뮬레이션,
 * LCK 순위 산정(승수 -> 세트득실 -> 상대전적), Top-4 Bo5 플레이오프,
 * 스네이크 밴픽 드래프트, 세트 간 Rite 카드, 구단 운영 AP(2 AP/라운드), 자동 밸런스 패치.
 */

import { CHAMPIONS, RITE_CARDS, SCREEN_STATES, TRAITS, cloneState, getChampionById } from "./state.js";
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

export function generateSchedule(seatCount = 6) {
  const ids = Array.from({ length: seatCount }, (_, i) => i);
  const fixed = ids[0];
  const rotating = ids.slice(1);
  const weeks = [];

  for (let w = 0; w < seatCount - 1; w++) {
    const roundOrder = [fixed, ...rotating];
    const matches = [];
    for (let m = 0; m < seatCount / 2; m++) {
      const home = roundOrder[m];
      const away = roundOrder[seatCount - 1 - m];
      matches.push({
        matchId: `w${w + 1}_m${m}`,
        homeSeat: home,
        awaySeat: away,
        completed: false,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null
      });
    }
    weeks.push({ week: w + 1, matches });
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

function generateReplacementFA(state) {
  const champKeys = Object.keys(CHAMPIONS);
  const traitKeys = Object.keys(TRAITS);
  const suffixes = ["Nova", "Pulse", "Blade", "Vortex", "Ace", "Zenith", "Flash", "Prime"];
  const prefix = ["K", "L", "S", "J", "H", "M", "R", "T"][Math.floor(Math.random() * 8)];
  const name = `${prefix}${suffixes[Math.floor(Math.random() * suffixes.length)]}${Math.floor(10 + Math.random() * 89)}`;
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
 * 구단 주간 AP 행동 처리 (1 AP 소모 / 주전 교체는 0 AP)
 */
export function executeWeeklyAction(state, seatIndex, actionType, payload = {}) {
  const seat = state.seats[seatIndex];
  if (!seat) return { ok: false, message: "구단을 찾을 수 없습니다." };

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

function chooseBestChampsForSeat(state, seatIdx, count = 3, excludedIds = []) {
  const seat = state.seats[seatIdx];
  const allKeys = Object.keys(CHAMPIONS).filter((k) => !excludedIds.includes(k));
  const scored = allKeys.map((cid) => {
    const c = CHAMPIONS[cid];
    let score = (c.patchMod.dmgMult || 1) * 10 + (c.patchMod.hpMult || 1) * 5;
    if (seat && seat.roster) {
      for (let i = 0; i < 3; i++) {
        const p = seat.roster[i];
        if (p && p.mastery && p.mastery[cid]) score += p.mastery[cid] * 4;
      }
    }
    score += Math.random() * 4;
    return { cid, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((x) => x.cid);
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
 * 헤드리스 고속 AI 매치 시뮬레이터 (< 50ms)
 * 렌더링 없이 engine.js의 initCombatRound + stepCombat 실행
 */
export function simulateMatchHeadless(state, homeSeat, awaySeat, bestOf = 3) {
  const neededWins = Math.ceil(bestOf / 2);
  let homeSets = 0;
  let awaySets = 0;

  const simState = cloneState(state);
  simState.activeSeries.blueSeat = homeSeat;
  simState.activeSeries.redSeat = awaySeat;
  simState.activeSeries.blueRites = [];
  simState.activeSeries.redRites = [];

  let setNum = 1;
  while (homeSets < neededWins && awaySets < neededWins) {
    const picks = chooseBestChampsForSeat(simState, homeSeat, 3, []);
    const redPicks = chooseBestChampsForSeat(simState, awaySeat, 3, picks);
    simState.activeSeries.currentSet = setNum;
    simState.activeSeries.draft.bluePicks = picks;
    simState.activeSeries.draft.redPicks = redPicks;

    initCombatRound(simState);

    let setWinner = null;
    for (let tick = 0; tick < 75; tick++) {
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

    if (setWinner === "blue") {
      homeSets++;
    } else {
      awaySets++;
    }

    // Grant simulated AI Rite card between sets
    const availRites = RITE_CARDS.map((r) => r.id);
    simState.activeSeries.blueRites.push(availRites[Math.floor(Math.random() * availRites.length)]);
    simState.activeSeries.redRites.push(availRites[Math.floor(Math.random() * availRites.length)]);
    setNum++;
  }

  return {
    homeSets,
    awaySets,
    winnerSeat: homeSets > awaySets ? homeSeat : awaySeat
  };
}

function recordMatchToStandings(state, matchObj, homeSets, awaySets, winnerSeat) {
  matchObj.completed = true;
  matchObj.homeSets = homeSets;
  matchObj.awaySets = awaySets;
  matchObj.winnerSeat = winnerSeat;

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
    home.funds += 250;
    away.funds += 120;
  } else {
    away.wins += 1;
    home.losses += 1;
    away.funds += 250;
    home.funds += 120;
  }

  for (const s of [home, away]) {
    for (let i = 0; i < 3; i++) {
      if (s.roster[i]) s.roster[i].condition = Math.max(45, s.roster[i].condition - 4);
    }
  }
}

function beginSeriesDraft(state, matchId, blueSeat, redSeat, bestOf, seriesMode) {
  state.activeSeries = {
    matchId,
    seriesMode,
    bestOf,
    currentSet: 1,
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
 * 주간 경기 시작: AI-vs-AI 경기는 헤드리스 시뮬레이션, 플레이어 경기는 밴픽(DRAFT) 진입
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
      beginSeriesDraft(state, `po_${matchKey}`, bracketMatch.homeSeat, bracketMatch.awaySeat, 5, "PLAYOFF");
      return;
    }

    // AI-vs-AI Playoff Bo5 match
    const res = simulateMatchHeadless(state, bracketMatch.homeSeat, bracketMatch.awaySeat, 5);
    bracketMatch.homeSets = res.homeSets;
    bracketMatch.awaySets = res.awaySets;
    bracketMatch.winnerSeat = res.winnerSeat;
    advancePlayoffRound(state);
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
      const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3);
      recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat);
    }
  }

  if (humanMatch) {
    beginSeriesDraft(state, humanMatch.matchId, humanMatch.homeSeat, humanMatch.awaySeat, 3, "LEAGUE");
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
      const res = simulateMatchHeadless(state, bm.homeSeat, bm.awaySeat, 5);
      bm.homeSets = res.homeSets;
      bm.awaySets = res.awaySets;
      bm.winnerSeat = res.winnerSeat;
      advancePlayoffRound(state);
    }
    return;
  }

  const weekObj = state.schedule[state.week - 1];
  if (!weekObj) return;
  for (const m of weekObj.matches) {
    if (!m.completed) {
      const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3);
      recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat);
    }
  }
  finalizeRegularWeek(state);
}

function getDraftUsedIds(draft) {
  return [...draft.blueBans, ...draft.redBans, ...draft.bluePicks, ...draft.redPicks];
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

    const used = getDraftUsedIds(draft);
    const pick = chooseBestChampsForSeat(state, seatIdx, 1, used)[0];
    if (!pick) break;

    if (step.type === "ban") {
      if (step.team === "blue") draft.blueBans.push(pick);
      else draft.redBans.push(pick);
    } else {
      if (step.team === "blue") draft.bluePicks.push(pick);
      else draft.redPicks.push(pick);
    }
    draft.stepIndex += 1;
  }

  if (draft.stepIndex >= DRAFT_SEQUENCE.length) {
    draft.phase = "COMPLETE";
    initCombatRound(state);
    state.screen = SCREEN_STATES.COMBAT;
  } else {
    draft.phase = DRAFT_SEQUENCE[draft.stepIndex].phase;
  }
}

/**
 * LCK 스네이크 밴픽 단계 진행
 */
export function advanceDraftStep(state, champId) {
  const series = state.activeSeries;
  const draft = series.draft;
  if (draft.stepIndex >= DRAFT_SEQUENCE.length) return;

  const used = getDraftUsedIds(draft);
  if (used.includes(champId)) return;

  const step = DRAFT_SEQUENCE[draft.stepIndex];
  if (step.type === "ban") {
    if (step.team === "blue") draft.blueBans.push(champId);
    else draft.redBans.push(champId);
  } else {
    if (step.team === "blue") draft.bluePicks.push(champId);
    else draft.redPicks.push(champId);
  }

  draft.stepIndex += 1;
  runAutoAIDraftSteps(state);
}

/**
 * 세트 종료 후 Rite 카드 3장 제시
 */
export function offerRiteCards(state) {
  const series = state.activeSeries;
  const humanTeam = series.redSeat === state.localSeatIndex ? "red" : "blue";
  const owned = humanTeam === "blue" ? series.blueRites : series.redRites;

  const pool = RITE_CARDS.filter((r) => !owned.includes(r.id)).map((r) => r.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  series.riteOptions = pool.slice(0, 3);
}

/**
 * Rite 카드 선택 후 다음 세트 전투 개시
 */
export function selectRiteCard(state, team, riteId) {
  const series = state.activeSeries;
  const targetArr = team === "blue" ? series.blueRites : series.redRites;
  if (!targetArr.includes(riteId)) {
    targetArr.push(riteId);
  }

  // AI opponent picks a non-duplicate Rite card
  const oppTeam = team === "blue" ? "red" : "blue";
  const oppArr = oppTeam === "blue" ? series.blueRites : series.redRites;
  const avail = RITE_CARDS.map((r) => r.id).filter((id) => !oppArr.includes(id));
  if (avail.length > 0) {
    oppArr.push(avail[Math.floor(Math.random() * avail.length)]);
  }

  series.currentSet += 1;
  series.riteOptions = [];
  initCombatRound(state);
  state.screen = SCREEN_STATES.COMBAT;
}

/**
 * 세트 종료 시 시리즈 진행 처리 (Rite Draft 또는 시리즈 완료)
 */
export function recordSetWinAndProceed(state, winnerTeam) {
  const series = state.activeSeries;
  if (series.seriesMode === "EXHIBITION") {
    return;
  }

  if (winnerTeam === "blue") series.blueWins += 1;
  else series.redWins += 1;

  const neededWins = Math.ceil(series.bestOf / 2);
  if (series.blueWins >= neededWins || series.redWins >= neededWins) {
    completeSeriesAndAdvance(state);
  } else {
    offerRiteCards(state);
    state.screen = SCREEN_STATES.RITE_DRAFT;
  }
}

function finalizeRegularWeek(state) {
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
    state.playoffs = {
      active: true,
      round: "SEMI_1",
      seeds,
      semi1: { homeSeat: seeds[0], awaySeat: seeds[3], homeSets: 0, awaySets: 0, winnerSeat: null },
      semi2: { homeSeat: seeds[1], awaySeat: seeds[2], homeSets: 0, awaySets: 0, winnerSeat: null },
      final: { homeSeat: null, awaySeat: null, homeSets: 0, awaySets: 0, winnerSeat: null },
      championSeat: null
    };
    state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
  }
}

function advancePlayoffRound(state) {
  const po = state.playoffs;
  if (po.round === "SEMI_1" && po.semi1.winnerSeat !== null) {
    po.round = "SEMI_2";
  } else if (po.round === "SEMI_2" && po.semi2.winnerSeat !== null) {
    po.final.homeSeat = po.semi1.winnerSeat;
    po.final.awaySeat = po.semi2.winnerSeat;
    po.round = "FINAL";
  } else if (po.round === "FINAL" && po.final.winnerSeat !== null) {
    po.championSeat = po.final.winnerSeat;
    po.round = "CHAMPION";
  }
  state.screen = SCREEN_STATES.PLAYOFF_BRACKET;
}

/**
 * 시리즈 완료 반영 & 다음 주차/패치/플레이오프 전환
 */
export function completeSeriesAndAdvance(state) {
  const series = state.activeSeries;
  const winnerSeat = series.blueWins > series.redWins ? series.blueSeat : series.redSeat;

  if (series.seriesMode === "PLAYOFF" && state.playoffs.active) {
    const po = state.playoffs;
    const matchKey = po.round === "SEMI_1" ? "semi1" : po.round === "SEMI_2" ? "semi2" : "final";
    const bm = po[matchKey];
    if (bm) {
      bm.homeSets = series.blueWins;
      bm.awaySets = series.redWins;
      bm.winnerSeat = winnerSeat;
    }
    advancePlayoffRound(state);
    return;
  }

  const weekObj = state.schedule[state.week - 1];
  if (weekObj) {
    const matchObj = weekObj.matches.find((m) => m.matchId === series.matchId);
    if (matchObj && !matchObj.completed) {
      recordMatchToStandings(state, matchObj, series.blueWins, series.redWins, winnerSeat);
    }
    for (const m of weekObj.matches) {
      if (!m.completed) {
        const res = simulateMatchHeadless(state, m.homeSeat, m.awaySeat, 3);
        recordMatchToStandings(state, m, res.homeSets, res.awaySets, res.winnerSeat);
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
