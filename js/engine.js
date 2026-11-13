/**
 * js/engine.js
 * 60fps 3v3 배틀라이트 스타일 아레나 전투 엔진.
 * 논타겟 투사체 물리, 스티어링 벡터 Utility AI, Q 반격(55ms 히트스톱/0.9s 기절/M2 초기화),
 * 중앙 에너지 오브(12s/60HP), EX(25 에너지)/궁극기(100), 서든 데스(35s+), 감독 전술 콜 3종 구현.
 */

import { CHAMPIONS, COACH_CALLS, TEMPO_CONFIG, getArenaMapById, getChampionById, getRiteById, nextRandom } from "./state.js";

const LEGACY_CALL_MAP = {
  CALL_ORB_CONTEST: "ORB_FOCUS",
  CALL_BAIT_COUNTER: "COUNTER_STANCE",
  CALL_FOCUS: "EX_RUSH"
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function addTicker(state, text, type = "INFO") {
  const logs = state.combat.tickerLogs;
  logs.unshift({
    id: `${Math.round((state.combat.elapsed || 0) * 1000)}_${logs.length}`,
    time: state.combat.elapsed.toFixed(1),
    text,
    type
  });
  if (logs.length > 24) logs.length = 24;
}

function spawnEffect(state, type, x, y, color, radius = 24, duration = 0.35, text = "") {
  state.combat.effects.push({
    type,
    x,
    y,
    color,
    radius,
    duration,
    maxDuration: duration,
    text
  });
}

function getTeamRiteModifiers(state, team) {
  const riteIds = team === "blue" ? state.activeSeries.blueRites : state.activeSeries.redRites;
  const mods = {
    lifesteal: 0,
    counterShield: 0,
    orbBonusEnergy: 0,
    exCostReduction: 0,
    vortexResist: 0,
    coachCdReduction: 0,
    moveSpeedMult: 1,
    projSpeedMult: 1,
    maxHpMult: 1,
    execDmgMult: 1,
    skillCdMult: 1,
    emergencyShield: 0
  };
  for (const id of riteIds) {
    const rite = getRiteById(id);
    if (!rite) continue;
    if (rite.effectKey === "moveSpeedMult" || rite.effectKey === "projSpeedMult" || rite.effectKey === "maxHpMult" || rite.effectKey === "execDmgMult") {
      mods[rite.effectKey] *= rite.value;
    } else if (rite.effectKey === "skillCdMult") {
      mods.skillCdMult *= rite.value;
    } else {
      mods[rite.effectKey] += rite.value;
    }
  }
  return mods;
}

function getPlayerProfile(state, seatIdx, slotIdx) {
  const seat = state.seats[seatIdx];
  if (seat && seat.roster && seat.roster[slotIdx]) {
    return seat.roster[slotIdx];
  }
  return {
    name: `Player_${slotIdx + 1}`,
    condition: 90,
    stats: { mechanics: 75, reflex: 75, teamwork: 75, mental: 75 },
    trait: "clutch_gene",
    mastery: {}
  };
}

function buildFighter(state, team, seatIdx, slotIdx, champId, x, y, facing) {
  const champ = getChampionById(champId);
  const player = getPlayerProfile(state, seatIdx, slotIdx);
  const seat = state.seats?.[seatIdx];
  const mods = getTeamRiteModifiers(state, team);
  const masteryLevel = (player.mastery && player.mastery[champId]) || 1;
  const maxHp = Math.round(champ.baseHp * champ.patchMod.hpMult * mods.maxHpMult);

  const debtMult = (seat?.inDebt || (seat && seat.funds < 0)) ? 0.90 : 1.0;
  const slumpMult = player.slump ? 0.90 : 1.0;
  const statPenaltyMult = debtMult * slumpMult;
  const effStats = {
    mechanics: Math.max(10, Math.round((player.stats?.mechanics || 75) * statPenaltyMult)),
    reflex: Math.max(10, Math.round((player.stats?.reflex || 75) * statPenaltyMult)),
    teamwork: Math.max(10, Math.round((player.stats?.teamwork || 75) * statPenaltyMult)),
    mental: Math.max(10, Math.round((player.stats?.mental || 75) * statPenaltyMult))
  };

  return {
    unitId: `${team}_${slotIdx}`,
    team,
    champId: champ.id,
    name: champ.shortName || champ.name,
    fullName: champ.name,
    playerName: player.name,
    role: champ.role,
    color: champ.color,
    x,
    y,
    vx: 0,
    vy: 0,
    facing,
    radius: champ.radius || 15,
    hp: maxHp,
    maxHp,
    shield: 0,
    energy: 0,
    maxEnergy: 100,
    alive: true,
    state: "IDLE",
    stunTimer: 0,
    counterTimer: 0,
    stealthTimer: 0,
    hasteTimer: 0,
    slowTimer: 0,
    atkBuffTimer: 0,
    warpCooldown: 0,
    leylineBuff: false,
    dashTimer: 0,
    dashVx: 0,
    dashVy: 0,
    cds: {
      m1: 0.25 + slotIdx * 0.12,
      m2: 1.2 + slotIdx * 0.25,
      space: 1.8 + slotIdx * 0.3,
      counter: 1.0 + slotIdx * 0.2,
      ex: 0,
      basic: 0.25,
      primary: 1.2
    },
    emergencyUsed: false,
    stats: effStats,
    trait: player.trait || "clutch_gene",
    masteryLevel,
    damageDealt: 0,
    kills: 0,
    countersTriggered: 0,
    orbsDestroyed: 0,
    lastHitByUnitId: null
  };
}

/**
 * 3v3 전투 라운드 초기화
 */
export function initCombatRound(state) {
  const combat = state.combat;
  const draft = state.activeSeries.draft;
  const bluePicks = draft.bluePicks.length === 3 ? draft.bluePicks : ["kylen", "sylvia", "orion"];
  const redPicks = draft.redPicks.length === 3 ? draft.redPicks : ["balrog", "nyx", "lyra"];

  const chosenMapId = state.activeSeries.mapId || state.activeSeries.selectedMapId || (state.preferredMapId && state.preferredMapId !== "AUTO" ? state.preferredMapId : "starlight_sanctum");
  const mapDef = getArenaMapById(chosenMapId);
  state.activeSeries.mapId = mapDef.id;

  const baseSeed = Number(state.activeSeries.matchSeed || 100001);
  const setNum = Number(state.activeSeries.currentSet || 1);
  combat.rngState = ((baseSeed + Math.imul(setNum, 7919)) >>> 0) || 100001;

  const blueSpawns = [
    { x: 74, y: 120 },
    { x: 58, y: 210 },
    { x: 74, y: 300 }
  ];
  const redSpawns = [
    { x: 446, y: 120 },
    { x: 462, y: 210 },
    { x: 446, y: 300 }
  ];

  const fighters = [];
  for (let i = 0; i < 3; i++) {
    fighters.push(buildFighter(state, "blue", state.activeSeries.blueSeat, i, bluePicks[i], blueSpawns[i].x, blueSpawns[i].y, 0));
  }
  for (let i = 0; i < 3; i++) {
    fighters.push(buildFighter(state, "red", state.activeSeries.redSeat, i, redPicks[i], redSpawns[i].x, redSpawns[i].y, Math.PI));
  }

  combat.running = true;
  combat.paused = false;
  combat.duration = TEMPO_CONFIG.roundDuration;
  combat.elapsed = 0.0;
  combat.timer = TEMPO_CONFIG.roundDuration;
  combat.suddenDeath = false;
  combat.suddenDeathTime = TEMPO_CONFIG.suddenDeathTime;
  combat.winnerTeam = null;
  combat.sfxQueue = [];
  combat.fastForwarding = false;
  combat.matchTelemetry = {
    blue: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
    red: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
    mvpUnit: null
  };
  if (!state.activeSeries.telemetry || Number(state.activeSeries.currentSet || 1) === 1) {
    state.activeSeries.telemetry = {
      blue: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
      red: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
      mvpUnit: null
    };
  }
  combat.arena.width = 520;
  combat.arena.height = 420;
  combat.arena.centerX = 260;
  combat.arena.centerY = 210;
  combat.arena.safeRadius = 210;
  combat.arena.minRadius = 68;
  combat.arena.mapId = mapDef.id;
  combat.arena.mapName = mapDef.name;
  combat.arena.pillars = mapDef.pillars.map((p) => ({ ...p, hitFlash: 0 }));
  combat.arena.shrines = mapDef.shrines.map((s) => ({ ...s, timer: s.timer ?? 4.0, ready: false }));
  combat.arena.hazards = mapDef.hazards.map((h) => ({ ...h, phase: "DORMANT", phaseTimer: h.dormantDur }));
  combat.hitstopTimer = 0;
  combat.hitstopFrames = 0;
  combat.shakeTimer = 0;
  combat.shakeFrames = 0;
  combat.orb = {
    active: false,
    x: combat.arena.centerX,
    y: combat.arena.centerY,
    hp: 60,
    maxHp: 60,
    radius: 18,
    respawnTimer: TEMPO_CONFIG.orbSpawnInterval,
    spawnInterval: TEMPO_CONFIG.orbSpawnInterval
  };
  combat.fighters = fighters;
  combat.projectiles = [];
  combat.effects = [];
  combat.decoys = [];
  combat.coachCalls = {
    blue: {
      activeCall: null,
      activeTimer: 0,
      charges: { ORB_FOCUS: 3, COUNTER_STANCE: 3, EX_RUSH: 3 },
      cds: { ORB_FOCUS: 0, COUNTER_STANCE: 0, EX_RUSH: 0 }
    },
    red: {
      activeCall: null,
      activeTimer: 0,
      charges: { ORB_FOCUS: 3, COUNTER_STANCE: 3, EX_RUSH: 3 },
      cds: { ORB_FOCUS: 0, COUNTER_STANCE: 0, EX_RUSH: 0 }
    }
  };
  combat.tickerLogs = [];
  addTicker(state, `⚔️ [${mapDef.name}] 3v3 전투 개시! 중앙 오브는 ${Math.round(TEMPO_CONFIG.orbSpawnInterval)}초 후 출현합니다.`, "INFO");
}

function resolvePillarCollision(fighter, arena) {
  if (!arena.pillars) return;
  for (const p of arena.pillars) {
    const dx = fighter.x - p.x;
    const dy = fighter.y - p.y;
    const d = Math.hypot(dx, dy);
    const minDist = fighter.radius + p.radius;
    if (d < minDist) {
      const nx = d > 0.001 ? dx / d : 1;
      const ny = d > 0.001 ? dy / d : 0;
      fighter.x = clamp(p.x + nx * (minDist + 0.5), fighter.radius + 6, arena.width - fighter.radius - 6);
      fighter.y = clamp(p.y + ny * (minDist + 0.5), fighter.radius + 6, arena.height - fighter.radius - 6);
    }
  }
}

function applyHazardDamage(state, fighter, amount, sourceLabel) {
  if (!fighter.alive || amount <= 0) return;
  fighter.hp = Math.max(0, fighter.hp - amount);
  if (fighter.hp <= 0) {
    fighter.alive = false;
    fighter.state = "DEAD";
    spawnEffect(state, "NOVA", fighter.x, fighter.y, "#ef4444", 34, 0.45);
    spawnEffect(state, "FLOAT_TEXT", fighter.x, fighter.y - 16, "#f87171", 13, 0.9, "KO!");
    addTicker(state, `☠️ ${fighter.name} ${sourceLabel} 피해로 탈락!`, "KO");
  }
}

function getAlliedProximityCount(state, fighter, radius = 100) {
  let count = 0;
  for (const f of state.combat.fighters) {
    if (!f.alive || f.team !== fighter.team || f.unitId === fighter.unitId) continue;
    if (dist(fighter.x, fighter.y, f.x, f.y) <= radius) count++;
  }
  return count;
}

function computeDamageMultiplier(state, attacker, target, isOrb = false) {
  const champ = getChampionById(attacker.champId);
  let mult = (champ.patchMod.dmgMult || 1.0) * TEMPO_CONFIG.damageMult;
  mult *= 1 + (attacker.stats.mechanics * 0.003);
  mult *= 1 + ((attacker.masteryLevel - 1) * 0.03);

  const activeCall = state.combat.coachCalls[attacker.team].activeCall;
  if (activeCall === "EX_RUSH") {
    mult *= 1.20;
  }
  if (attacker.atkBuffTimer > 0) {
    mult *= 1.25;
  }

  if (attacker.trait === "clutch_gene" && (state.combat.suddenDeath || state.activeSeries.currentSet >= 3)) {
    mult *= 1.20;
  }
  if (attacker.trait === "orb_hunter" && isOrb) {
    mult *= 1.35;
  }
  if (attacker.trait === "lone_wolf" && getAlliedProximityCount(state, attacker, 100) === 0) {
    mult *= 1.15;
  }
  if (attacker.trait === "glass_cannon") {
    mult *= 1.25;
  }

  if (target) {
    const atkMods = getTeamRiteModifiers(state, attacker.team);
    if (atkMods.execDmgMult > 1 && target.hp / target.maxHp <= 0.35) {
      mult *= atkMods.execDmgMult;
    }
    if (target.trait === "glass_cannon") {
      mult *= 1.15;
    }
  }

  return mult;
}

function healFighter(fighter, amount, state, showText = true) {
  if (!fighter.alive || amount <= 0) return;
  const actual = Math.min(fighter.maxHp - fighter.hp, Math.round(amount));
  fighter.hp += actual;
  if (showText && actual >= 5) {
    spawnEffect(state, "FLOAT_TEXT", fighter.x, fighter.y - 22, "#4ade80", 12, 0.6, `+${actual}`);
  }
}

function grantEnergy(state, fighter, amount) {
  if (!fighter.alive || amount <= 0) return;
  let gain = amount;
  if (fighter.trait === "clutch_gene" && state.combat.suddenDeath) {
    gain *= 1.15;
  }
  const enemyTeam = fighter.team === "blue" ? "red" : "blue";
  const myHp = state.combat.fighters.filter(f => f.alive && f.team === fighter.team).reduce((s, f) => s + f.hp, 0);
  const enHp = state.combat.fighters.filter(f => f.alive && f.team === enemyTeam).reduce((s, f) => s + f.hp, 0);
  if (myHp < enHp) {
    gain *= 1 + (fighter.stats.mental * 0.004);
  }
  fighter.energy = clamp(fighter.energy + Math.round(gain), 0, fighter.maxEnergy);
}

function pushCombatSfx(state, sfxType) {
  if (!state?.combat || state.combat.fastForwarding) return;
  if (!Array.isArray(state.combat.sfxQueue)) state.combat.sfxQueue = [];
  if (state.combat.sfxQueue.length < 16) {
    state.combat.sfxQueue.push(sfxType);
  }
}

function applyRawDamage(state, target, amount, attacker = null) {
  if (!target.alive || amount <= 0) return 0;
  let remaining = Math.round(amount);

  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }

  target.hp = Math.max(0, target.hp - remaining);
  if (remaining > 0) {
    pushCombatSfx(state, "HIT_IMPACT");
  }
  if (attacker) {
    attacker.damageDealt += remaining;
    target.lastHitByUnitId = attacker.unitId;
    if (state.combat.matchTelemetry?.[attacker.team]) {
      state.combat.matchTelemetry[attacker.team].totalDamage += remaining;
    }
    if (state.activeSeries?.telemetry?.[attacker.team]) {
      state.activeSeries.telemetry[attacker.team].totalDamage += remaining;
    }
  }

  // Guardian Grace Rite emergency shield
  const defMods = getTeamRiteModifiers(state, target.team);
  if (defMods.emergencyShield > 0 && !target.emergencyUsed && target.hp > 0 && target.hp / target.maxHp < 0.20) {
    target.emergencyUsed = true;
    target.shield += defMods.emergencyShield;
    spawnEffect(state, "FLOAT_TEXT", target.x, target.y - 28, "#fbbf24", 12, 0.8, `수호자 +${defMods.emergencyShield}`);
  }

  if (target.hp <= 0) {
    target.alive = false;
    target.state = "DEAD";
    spawnEffect(state, "NOVA", target.x, target.y, "#ef4444", 36, 0.45);
    spawnEffect(state, "FLOAT_TEXT", target.x, target.y - 16, "#f87171", 14, 0.9, "KO!");
    if (attacker) attacker.kills += 1;
    addTicker(state, `💀 ${target.name}(${target.team === "blue" ? "BLUE" : "RED"}) 탈락!`, "KO");
  }

  return remaining;
}

function handleCounterSuccess(state, defender, attacker, proj = null) {
  const champ = getChampionById(defender.champId);
  const cSkill = champ.counterSkill;
  const defMods = getTeamRiteModifiers(state, defender.team);

  defender.countersTriggered += 1;
  pushCombatSfx(state, "COUNTER_PARRY");
  if (state.combat.matchTelemetry?.[defender.team]) {
    state.combat.matchTelemetry[defender.team].countersLanded += 1;
  }
  if (state.activeSeries?.telemetry?.[defender.team]) {
    state.activeSeries.telemetry[defender.team].countersLanded += 1;
  }
  defender.counterTimer = 0; // Consumed on successful counter trigger
  defender.cds.m2 = 0;
  defender.cds.primary = 0;
  grantEnergy(state, defender, 20);

  if (defMods.counterShield > 0) {
    defender.shield += defMods.counterShield;
  }

  // Hitstop 55ms + Screen shake
  state.combat.hitstopTimer = 0.055;
  state.combat.hitstopFrames = 4;
  state.combat.shakeTimer = 0.22;
  state.combat.shakeFrames = 12;

  spawnEffect(state, "COUNTER_BURST", defender.x, defender.y, "#fbbf24", 46, 0.45);
  spawnEffect(state, "FLOAT_TEXT", defender.x, defender.y - 28, "#fde047", 14, 0.85, "반격! M2 초기화");

  let stunDur = cSkill.stunDuration || 0.9;
  if (defender.trait === "counter_master") stunDur += 0.4;
  if (cSkill.extraStun) stunDur += cSkill.extraStun;

  if (attacker && attacker.alive) {
    attacker.stunTimer = Math.max(attacker.stunTimer, stunDur);
    attacker.state = "STUNNED";
    spawnEffect(state, "FLOAT_TEXT", attacker.x, attacker.y - 24, "#facc15", 13, 0.75, `STUN ${stunDur.toFixed(1)}s`);
  }

  // Champion-specific Counter Effects
  switch (cSkill.effectType) {
    case "REFLECT_PROJ": {
      // 발록: 투사체 반사 (또는 근접 시 화염 충격파)
      if (proj) {
        proj.team = defender.team;
        proj.ownerId = defender.unitId;
        proj.vx = -proj.vx * 1.4;
        proj.vy = -proj.vy * 1.4;
        proj.dmg = Math.round(proj.dmg * (cSkill.reflectMult || 1.4));
        proj.color = "#f97316";
        proj.traveled = 0;
        proj.isReflected = true;
        spawnEffect(state, "FLOAT_TEXT", defender.x, defender.y - 42, "#fb923c", 13, 0.8, "투사체 반사!");
      } else if (attacker && attacker.alive && dist(defender.x, defender.y, attacker.x, attacker.y) <= 85) {
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 60, defender);
      }
      break;
    }
    case "DECOY_STEALTH": {
      // 실비아: 환영 분신 남기고 은신 도약
      state.combat.decoys.push({
        x: defender.x,
        y: defender.y,
        team: defender.team,
        radius: defender.radius,
        color: defender.color,
        name: `${defender.name} 환영`,
        timer: 2.0
      });
      const angle = attacker ? Math.atan2(defender.y - attacker.y, defender.x - attacker.x) : defender.facing + Math.PI;
      const jump = cSkill.dashDist || 75;
      defender.x = clamp(defender.x + Math.cos(angle) * jump, 24, state.combat.arena.width - 24);
      defender.y = clamp(defender.y + Math.sin(angle) * jump, 24, state.combat.arena.height - 24);
      defender.stealthTimer = cSkill.stealthDur || 1.5;
      defender.hasteTimer = 2.0;
      spawnEffect(state, "FLOAT_TEXT", defender.x, defender.y - 40, "#4ade80", 12, 0.75, "환영 은신!");
      break;
    }
    case "KNOCKBACK_HEAL": {
      // 오리온: 주변 적 넉백 + 자가 회복
      const kbDist = cSkill.knockbackDist || 85;
      for (const enemy of state.combat.fighters) {
        if (!enemy.alive || enemy.team === defender.team) continue;
        const d = dist(defender.x, defender.y, enemy.x, enemy.y);
        if (d <= 95) {
          const ang = Math.atan2(enemy.y - defender.y, enemy.x - defender.x);
          enemy.x = clamp(enemy.x + Math.cos(ang) * kbDist, 22, state.combat.arena.width - 22);
          enemy.y = clamp(enemy.y + Math.sin(ang) * kbDist, 22, state.combat.arena.height - 22);
          applyRawDamage(state, enemy, cSkill.retaliateDmg || 45, defender);
        }
      }
      healFighter(defender, cSkill.healSelf || 65, state);
      spawnEffect(state, "NOVA", defender.x, defender.y, "#a78bfa", 90, 0.4);
      break;
    }
    case "SHADOW_BACKSTAB": {
      // 닉스: 은신 및 공격자 배후 기습
      defender.stealthTimer = cSkill.stealthDur || 1.1;
      if (attacker && attacker.alive) {
        const behindAng = attacker.facing + Math.PI;
        defender.x = clamp(attacker.x + Math.cos(behindAng) * 28, 22, state.combat.arena.width - 22);
        defender.y = clamp(attacker.y + Math.sin(behindAng) * 28, 22, state.combat.arena.height - 22);
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 75, defender);
      }
      break;
    }
    case "FLAME_NOVA": {
      // 이그니스: 화염 폭발
      const rad = cSkill.aoeRadius || 75;
      spawnEffect(state, "NOVA", defender.x, defender.y, "#fb7185", rad, 0.4);
      for (const enemy of state.combat.fighters) {
        if (enemy.alive && enemy.team !== defender.team && dist(defender.x, defender.y, enemy.x, enemy.y) <= rad) {
          applyRawDamage(state, enemy, cSkill.retaliateDmg || 70, defender);
        }
      }
      break;
    }
    case "EM_SHIELD_PULSE": {
      // 벡스: 전자기 보호막 + 넉백
      defender.shield += cSkill.shieldSelf || 95;
      for (const enemy of state.combat.fighters) {
        if (!enemy.alive || enemy.team === defender.team) continue;
        if (dist(defender.x, defender.y, enemy.x, enemy.y) <= 85) {
          const ang = Math.atan2(enemy.y - defender.y, enemy.x - defender.x);
          enemy.x = clamp(enemy.x + Math.cos(ang) * 70, 22, state.combat.arena.width - 22);
          enemy.y = clamp(enemy.y + Math.sin(ang) * 70, 22, state.combat.arena.height - 22);
        }
      }
      break;
    }
    case "TEAM_ASTRAL_HEAL": {
      // 라이라: 아군 전원 회복
      for (const ally of state.combat.fighters) {
        if (ally.alive && ally.team === defender.team) {
          healFighter(ally, cSkill.healTeam || 55, state);
        }
      }
      spawnEffect(state, "NOVA", defender.x, defender.y, "#f472b6", 110, 0.4);
      break;
    }
    case "RADIANT_AEGIS": {
      // 솔라리스: 아군 보호막 + 반격 피해
      for (const ally of state.combat.fighters) {
        if (ally.alive && ally.team === defender.team) {
          ally.shield += cSkill.shieldTeam || 70;
        }
      }
      if (attacker && attacker.alive && dist(defender.x, defender.y, attacker.x, attacker.y) <= 95) {
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 50, defender);
      }
      break;
    }
    case "SEISMIC_GUARD": {
      // 타이탄: 대형 보호막 + 충격파
      defender.shield += cSkill.shieldSelf || 110;
      if (attacker && attacker.alive && dist(defender.x, defender.y, attacker.x, attacker.y) <= 90) {
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 55, defender);
      }
      break;
    }
    case "VOID_DRAIN": {
      // 셰이드: 공허 흡수 회복
      if (attacker && attacker.alive) {
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 60, defender);
      }
      healFighter(defender, cSkill.healSelf || 60, state);
      break;
    }
    case "ICE_PRISM": {
      // 프로스트: 빙결 추가 기절 및 피해
      if (attacker && attacker.alive) {
        applyRawDamage(state, attacker, cSkill.retaliateDmg || 55, defender);
      }
      spawnEffect(state, "NOVA", defender.x, defender.y, "#38bdf8", 70, 0.35);
      break;
    }
    case "BLADE_RIPOSTE":
    default: {
      // 카일렌: 반격 검기 투사체 발사
      const ang = attacker ? Math.atan2(attacker.y - defender.y, attacker.x - defender.x) : defender.facing;
      state.combat.projectiles.push({
        id: `riposte_${Date.now()}_${Math.random()}`,
        ownerId: defender.unitId,
        team: defender.team,
        x: defender.x + Math.cos(ang) * 16,
        y: defender.y + Math.sin(ang) * 16,
        vx: Math.cos(ang) * 440,
        vy: Math.sin(ang) * 440,
        radius: 9,
        dmg: cSkill.retaliateDmg || 65,
        range: 185,
        traveled: 0,
        color: "#fde047",
        pierce: true,
        hitIds: [],
        energyGain: 8
      });
      break;
    }
  }

  addTicker(state, `🛡️ ${defender.name} [${cSkill.name}] 반격 성공!`, "COUNTER");
}

function hitCenterOrb(state, attacker, dmg) {
  const orb = state.combat.orb;
  if (!orb.active || orb.hp <= 0) return;
  const mult = computeDamageMultiplier(state, attacker, null, true);
  const finalDmg = Math.max(1, Math.round(dmg * mult));
  orb.hp = Math.max(0, orb.hp - finalDmg);
  spawnEffect(state, "FLOAT_TEXT", orb.x + (nextRandom(state) * 16 - 8), orb.y - 18, "#67e8f9", 11, 0.45, `-${finalDmg}`);

  if (orb.hp <= 0) {
    orb.active = false;
    orb.respawnTimer = orb.spawnInterval || 12.0;
    pushCombatSfx(state, "ORB_SHATTER");
    if (attacker) {
      attacker.orbsDestroyed = (attacker.orbsDestroyed || 0) + 1;
      if (state.combat.matchTelemetry?.[attacker.team]) {
        state.combat.matchTelemetry[attacker.team].orbsDestroyed += 1;
      }
      if (state.activeSeries?.telemetry?.[attacker.team]) {
        state.activeSeries.telemetry[attacker.team].orbsDestroyed += 1;
      }
    }

    const mods = getTeamRiteModifiers(state, attacker.team);
    const energyReward = 25 + mods.orbBonusEnergy;
    const hpReward = 15;

    for (const f of state.combat.fighters) {
      if (f.alive && f.team === attacker.team) {
        grantEnergy(state, f, energyReward);
        healFighter(f, hpReward, state, false);
      }
    }

    spawnEffect(state, "NOVA", orb.x, orb.y, "#22d3ee", 85, 0.55);
    spawnEffect(state, "FLOAT_TEXT", orb.x, orb.y - 26, "#22d3ee", 14, 0.9, `+${energyReward}EN +${hpReward}HP!`);
    addTicker(state, `🔮 ${attacker.name}(${attacker.team.toUpperCase()}) 중앙 오브 막타! 팀 전원 +${energyReward}EN / +${hpReward}HP`, "ORB");
  }
}

function handleFighterHit(state, attacker, target, rawDmg, proj = null, extraOptions = {}) {
  if (!target.alive) return;

  // Check Q Counter stance!
  if (target.counterTimer > 0) {
    handleCounterSuccess(state, target, attacker, proj);
    return;
  }

  const mult = computeDamageMultiplier(state, attacker, target, false);
  const finalDmg = Math.max(1, Math.round(rawDmg * mult));
  const dealt = applyRawDamage(state, target, finalDmg, attacker);

  if (extraOptions.slow && target.alive) {
    target.slowTimer = Math.max(target.slowTimer, extraOptions.slow);
  }

  const atkMods = getTeamRiteModifiers(state, attacker.team);
  if (atkMods.lifesteal > 0 && dealt > 0) {
    healFighter(attacker, dealt * atkMods.lifesteal, state, false);
  }

  grantEnergy(state, attacker, extraOptions.energyGain || 6);
  spawnEffect(state, "HIT_SPARK", target.x, target.y, proj ? proj.color : attacker.color, 18, 0.2);
  spawnEffect(state, "FLOAT_TEXT", target.x + (nextRandom(state) * 14 - 7), target.y - 16, "#ffffff", 11, 0.5, `-${dealt}`);
}

function spawnProjectile(state, owner, opts) {
  const mods = getTeamRiteModifiers(state, owner.team);
  const speedMult = (mods.projSpeedMult || 1) * (1 + owner.stats.mechanics * 0.002) * TEMPO_CONFIG.projSpeedMult;
  const speed = (opts.speed || 380) * speedMult;
  const angle = opts.angle !== undefined ? opts.angle : owner.facing;

  state.combat.projectiles.push({
    id: `p_${state.combat.projectiles.length}_${Math.round(nextRandom(state) * 99999)}`,
    ownerId: owner.unitId,
    team: owner.team,
    x: owner.x + Math.cos(angle) * (owner.radius + 4),
    y: owner.y + Math.sin(angle) * (owner.radius + 4),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: opts.radius || 7,
    dmg: opts.dmg || 40,
    range: opts.range || 180,
    traveled: 0,
    color: opts.color || owner.color,
    isAoE: !!opts.isAoE,
    aoeRadius: opts.aoeRadius || 48,
    pierce: !!opts.pierce,
    healAlly: opts.healAlly || 0,
    slow: opts.slow || 0,
    energyGain: opts.energyGain || 8,
    hitIds: [],
    isReflected: false
  });
}

function executeM1(state, fighter, target, targetIsOrb) {
  const champ = getChampionById(fighter.champId);
  const m1 = champ.m1;
  const leyMult = fighter.leylineBuff ? 0.85 : 1.0;
  fighter.cds.m1 = m1.cd * champ.patchMod.cdMult * TEMPO_CONFIG.cooldownMult * leyMult;
  fighter.cds.basic = fighter.cds.m1;
  fighter.state = "ATTACK";

  if (m1.isMelee) {
    spawnEffect(state, "SLASH", fighter.x + Math.cos(fighter.facing) * 22, fighter.y + Math.sin(fighter.facing) * 22, champ.color, m1.radius, 0.18);
    if (targetIsOrb && state.combat.orb.active) {
      if (dist(fighter.x, fighter.y, state.combat.orb.x, state.combat.orb.y) <= m1.range + state.combat.orb.radius) {
        hitCenterOrb(state, fighter, m1.dmg);
        grantEnergy(state, fighter, m1.energyGain);
      }
    } else if (target && target.alive && dist(fighter.x, fighter.y, target.x, target.y) <= m1.range + target.radius) {
      handleFighterHit(state, fighter, target, m1.dmg, null, { energyGain: m1.energyGain });
    }
  } else {
    spawnProjectile(state, fighter, {
      speed: m1.projSpeed,
      radius: m1.radius,
      dmg: m1.dmg,
      range: m1.range,
      color: champ.color,
      energyGain: m1.energyGain
    });
  }
}

function executeM2(state, fighter, target, targetIsOrb) {
  const champ = getChampionById(fighter.champId);
  const m2 = champ.m2;
  const mods = getTeamRiteModifiers(state, fighter.team);
  const leyMult = fighter.leylineBuff ? 0.85 : 1.0;

  fighter.cds.m2 = m2.cd * champ.patchMod.cdMult * mods.skillCdMult * TEMPO_CONFIG.cooldownMult * leyMult;
  fighter.cds.primary = fighter.cds.m2;
  fighter.state = "SKILL";

  // Support M2 heal ally if injured ally exists
  if (m2.healAlly && !targetIsOrb) {
    const injured = state.combat.fighters
      .filter((f) => f.alive && f.team === fighter.team)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (injured && injured.hp / injured.maxHp < 0.80) {
      const ang = Math.atan2(injured.y - fighter.y, injured.x - fighter.x);
      fighter.facing = ang;
      spawnProjectile(state, fighter, {
        speed: m2.projSpeed,
        radius: m2.radius + 2,
        dmg: m2.dmg,
        range: m2.range,
        color: "#4ade80",
        healAlly: m2.healAlly,
        energyGain: m2.energyGain
      });
      return;
    }
  }

  spawnProjectile(state, fighter, {
    speed: m2.projSpeed,
    radius: m2.radius,
    dmg: m2.dmg,
    range: m2.range,
    color: champ.color,
    isAoE: m2.isAoE,
    aoeRadius: m2.aoeRadius,
    pierce: m2.pierce,
    slow: m2.slow,
    energyGain: m2.energyGain
  });
}

function executeSpaceMobility(state, fighter, angle) {
  const champ = getChampionById(fighter.champId);
  const sp = champ.space;
  const mods = getTeamRiteModifiers(state, fighter.team);
  const leyMult = fighter.leylineBuff ? 0.85 : 1.0;

  fighter.cds.space = sp.cd * champ.patchMod.cdMult * mods.skillCdMult * TEMPO_CONFIG.cooldownMult * leyMult;
  fighter.dashTimer = sp.duration || 0.2;
  const speed = (sp.dashDist || 100) / fighter.dashTimer;
  fighter.dashVx = Math.cos(angle) * speed;
  fighter.dashVy = Math.sin(angle) * speed;
  fighter.facing = angle;
  fighter.state = "DASH";

  if (sp.shield) {
    fighter.shield += sp.shield;
  }
  spawnEffect(state, "DASH_TRAIL", fighter.x, fighter.y, champ.color, fighter.radius, 0.28);

  if (sp.dmg && sp.aoeRadius) {
    for (const enemy of state.combat.fighters) {
      if (enemy.alive && enemy.team !== fighter.team && dist(fighter.x, fighter.y, enemy.x, enemy.y) <= sp.aoeRadius) {
        handleFighterHit(state, fighter, enemy, sp.dmg, null, { energyGain: 6 });
      }
    }
  }
}

function executeCounterStance(state, fighter) {
  const champ = getChampionById(fighter.champId);
  const cSkill = champ.counterSkill;
  const mods = getTeamRiteModifiers(state, fighter.team);

  let cd = cSkill.cd * champ.patchMod.cdMult * mods.skillCdMult * TEMPO_CONFIG.cooldownMult;
  if (fighter.trait === "counter_master") cd *= 0.75;

  fighter.cds.counter = cd;
  fighter.counterTimer = cSkill.duration || 1.2;
  fighter.state = "COUNTER";
  spawnEffect(state, "FLOAT_TEXT", fighter.x, fighter.y - 22, "#facc15", 10, 0.45, "Q 반격");
}

function executeEXSkill(state, fighter, target, targetIsOrb) {
  const champ = getChampionById(fighter.champId);
  const ex = champ.exSkill;
  const mods = getTeamRiteModifiers(state, fighter.team);
  const cost = Math.max(15, (ex.cost || 25) - mods.exCostReduction);

  if (fighter.energy < cost) return false;
  fighter.energy -= cost;
  fighter.cds.ex = ex.cd || 1.5;
  fighter.state = "EX";
  pushCombatSfx(state, "EX_SURGE");

  spawnEffect(state, "FLOAT_TEXT", fighter.x, fighter.y - 26, "#38bdf8", 13, 0.7, ex.name);

  switch (ex.effectType) {
    case "EX_TRIPLE_SHOT": {
      const spreads = [-0.20, 0, 0.20];
      for (const offset of spreads) {
        spawnProjectile(state, fighter, {
          angle: fighter.facing + offset,
          speed: ex.projSpeed,
          radius: 8,
          dmg: ex.dmg,
          range: ex.range,
          color: "#22d3ee",
          pierce: false,
          energyGain: 0
        });
      }
      break;
    }
    case "EX_DASH_LIFESTEAL": {
      fighter.dashTimer = 0.16;
      fighter.dashVx = Math.cos(fighter.facing) * 460;
      fighter.dashVy = Math.sin(fighter.facing) * 460;
      spawnProjectile(state, fighter, {
        speed: ex.projSpeed || 440,
        radius: 12,
        dmg: ex.dmg,
        range: ex.range,
        color: "#f43f5e",
        pierce: true,
        energyGain: 0
      });
      healFighter(fighter, ex.healSelf || 55, state);
      break;
    }
    case "EX_GRAVITY_NOVA":
    case "EX_FROST_NOVA": {
      spawnProjectile(state, fighter, {
        speed: ex.projSpeed,
        radius: 13,
        dmg: ex.dmg,
        range: ex.range,
        color: "#38bdf8",
        isAoE: true,
        aoeRadius: ex.aoeRadius || 68,
        slow: ex.effectType === "EX_FROST_NOVA" ? 1.8 : 0,
        energyGain: 0
      });
      break;
    }
    case "EX_TAUNT_SHIELD": {
      fighter.shield += 85;
      healFighter(fighter, ex.healSelf || 45, state);
      spawnEffect(state, "NOVA", fighter.x, fighter.y, "#f97316", ex.aoeRadius || 72, 0.4);
      if (targetIsOrb && state.combat.orb.active && dist(fighter.x, fighter.y, state.combat.orb.x, state.combat.orb.y) <= (ex.aoeRadius || 72)) {
        hitCenterOrb(state, fighter, ex.dmg);
      }
      for (const enemy of state.combat.fighters) {
        if (enemy.alive && enemy.team !== fighter.team && dist(fighter.x, fighter.y, enemy.x, enemy.y) <= (ex.aoeRadius || 72)) {
          handleFighterHit(state, fighter, enemy, ex.dmg, null, { energyGain: 0 });
        }
      }
      break;
    }
    case "EX_TEAM_HEAL_WAVE": {
      spawnEffect(state, "NOVA", fighter.x, fighter.y, "#f472b6", ex.aoeRadius || 130, 0.5);
      for (const ally of state.combat.fighters) {
        if (ally.alive && ally.team === fighter.team) {
          healFighter(ally, ex.healTeam || 75, state);
        }
      }
      for (const enemy of state.combat.fighters) {
        if (enemy.alive && enemy.team !== fighter.team && dist(fighter.x, fighter.y, enemy.x, enemy.y) <= 100) {
          handleFighterHit(state, fighter, enemy, ex.dmg, null, { energyGain: 0 });
        }
      }
      break;
    }
    case "EX_TEAM_SHIELD_BLAST": {
      for (const ally of state.combat.fighters) {
        if (ally.alive && ally.team === fighter.team) {
          ally.shield += 60;
          healFighter(ally, ex.healTeam || 40, state);
        }
      }
      spawnProjectile(state, fighter, {
        speed: ex.projSpeed,
        radius: 12,
        dmg: ex.dmg,
        range: ex.range,
        color: "#facc15",
        isAoE: true,
        aoeRadius: ex.aoeRadius || 75,
        energyGain: 0
      });
      break;
    }
    case "EX_EXECUTE_SLASH":
    case "EX_PIERCE_BEAM":
    default: {
      spawnProjectile(state, fighter, {
        speed: ex.projSpeed || 500,
        radius: 11,
        dmg: ex.dmg,
        range: ex.range || 220,
        color: "#22d3ee",
        pierce: true,
        energyGain: 0
      });
      break;
    }
  }
  return true;
}

function executeUltimate(state, fighter) {
  const champ = getChampionById(fighter.champId);
  const ult = champ.ultSkill;
  if (fighter.energy < 100) return false;

  fighter.energy = 0;
  fighter.state = "ULT";
  pushCombatSfx(state, "EX_SURGE");
  spawnEffect(state, "NOVA", fighter.x, fighter.y, "#fde047", ult.aoeRadius || 75, 0.55);
  spawnEffect(state, "FLOAT_TEXT", fighter.x, fighter.y - 32, "#fde047", 15, 0.9, `★ ${ult.name}!`);
  addTicker(state, `🔥 ${fighter.name} 궁극기 [${ult.name}] 발동!`, "ULT");

  const tx = fighter.x + Math.cos(fighter.facing) * Math.min(80, ult.range * 0.5);
  const ty = fighter.y + Math.sin(fighter.facing) * Math.min(80, ult.range * 0.5);
  spawnEffect(state, "NOVA", tx, ty, champ.color, ult.aoeRadius || 75, 0.5);

  for (const enemy of state.combat.fighters) {
    if (enemy.alive && enemy.team !== fighter.team && dist(tx, ty, enemy.x, enemy.y) <= (ult.aoeRadius || 75) + enemy.radius) {
      handleFighterHit(state, fighter, enemy, ult.dmg, null, { energyGain: 0 });
    }
  }
  if (state.combat.orb.active && dist(tx, ty, state.combat.orb.x, state.combat.orb.y) <= (ult.aoeRadius || 75)) {
    hitCenterOrb(state, fighter, ult.dmg);
  }
  return true;
}

/**
 * 스티어링 벡터 Utility AI 평가
 */
export function evaluateUtilityAI(state, fighter, dt = 1 / 60) {
  const champ = getChampionById(fighter.champId);
  const arena = state.combat.arena;
  const orb = state.combat.orb;
  const teamCall = state.combat.coachCalls[fighter.team].activeCall;
  const mods = getTeamRiteModifiers(state, fighter.team);

  // 1. Incoming Projectile Threat Detection -> Counter (Q) or Space Dodge
  let incomingProj = null;
  let minProjDist = 78;
  for (const proj of state.combat.projectiles) {
    if (proj.team === fighter.team) continue;
    const d = dist(fighter.x, fighter.y, proj.x, proj.y);
    if (d < minProjDist) {
      const toFighterX = fighter.x - proj.x;
      const toFighterY = fighter.y - proj.y;
      const dot = toFighterX * proj.vx + toFighterY * proj.vy;
      if (dot > 0) {
        minProjDist = d;
        incomingProj = proj;
      }
    }
  }

  if (incomingProj) {
    if (fighter.cds.counter <= 0) {
      const triggerChance = 0.04 + fighter.stats.reflex * 0.004;
      if (nextRandom(state) < triggerChance || fighter.hp / fighter.maxHp < 0.45) {
        executeCounterStance(state, fighter);
        return;
      }
    }
    if (fighter.cds.space <= 0 && (fighter.hp / fighter.maxHp < 0.5 || champ.role === "RANGED" || champ.role === "MAGE")) {
      const perpAngle = Math.atan2(incomingProj.vy, incomingProj.vx) + (nextRandom(state) < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      executeSpaceMobility(state, fighter, perpAngle);
      return;
    }
  }

  // 2. Target Selection (Enemies, Decoys, or Center Energy Orb)
  const enemies = state.combat.fighters.filter((f) => f.alive && f.team !== fighter.team && f.stealthTimer <= 0);
  const enemyDecoys = state.combat.decoys.filter((d) => d.team !== fighter.team);
  let target = null;
  let targetIsOrb = false;

  if (orb.active && (teamCall === "ORB_FOCUS" || (fighter.trait === "orb_hunter" && orb.hp <= 55) || (enemies.length === 0))) {
    target = orb;
    targetIsOrb = true;
  } else if (orb.active && dist(fighter.x, fighter.y, orb.x, orb.y) < 110 && orb.hp <= 35) {
    target = orb;
    targetIsOrb = true;
  } else if (enemyDecoys.length > 0 && nextRandom(state) < 0.35) {
    target = enemyDecoys[0];
  } else if (enemies.length > 0) {
    let bestScore = -Infinity;
    for (const en of enemies) {
      const d = dist(fighter.x, fighter.y, en.x, en.y);
      const hpMissingRatio = 1 - en.hp / en.maxHp;
      const score = 300 - d + hpMissingRatio * 140;
      if (score > bestScore) {
        bestScore = score;
        target = en;
      }
    }
  } else if (orb.active) {
    target = orb;
    targetIsOrb = true;
  }

  if (!target) {
    fighter.state = "IDLE";
    return;
  }

  const dTarget = dist(fighter.x, fighter.y, target.x, target.y);
  fighter.facing = Math.atan2(target.y - fighter.y, target.x - fighter.x);

  // 3. Steering Vector Movement (Chasing / Kiting / Vortex Avoidance / Ally Separation)
  let moveX = 0;
  let moveY = 0;
  const desiredRange = targetIsOrb ? Math.min(champ.preferredRange, 95) : champ.preferredRange;

  if (dTarget > desiredRange + 14) {
    moveX += Math.cos(fighter.facing) * 1.0;
    moveY += Math.sin(fighter.facing) * 1.0;
  } else if (dTarget < desiredRange - 22 && !targetIsOrb) {
    // Kite away
    moveX -= Math.cos(fighter.facing) * 0.9;
    moveY -= Math.sin(fighter.facing) * 0.9;
  }

  // Slight circular strafing for dynamic arena movement
  const strafeDir = fighter.unitId.endsWith("1") ? -1 : 1;
  moveX += Math.cos(fighter.facing + (Math.PI / 2) * strafeDir) * 0.35;
  moveY += Math.sin(fighter.facing + (Math.PI / 2) * strafeDir) * 0.35;

  // Dodge incoming projectile laterally
  if (incomingProj) {
    const dodgeAngle = Math.atan2(incomingProj.vy, incomingProj.vx) + Math.PI / 2;
    moveX += Math.cos(dodgeAngle) * 1.1;
    moveY += Math.sin(dodgeAngle) * 1.1;
  }

  // Separation from allies
  for (const ally of state.combat.fighters) {
    if (!ally.alive || ally.unitId === fighter.unitId) continue;
    const da = dist(fighter.x, fighter.y, ally.x, ally.y);
    if (da > 0 && da < 36) {
      moveX += ((fighter.x - ally.x) / da) * 0.8;
      moveY += ((fighter.y - ally.y) / da) * 0.8;
    }
  }

  // Avoid Arena Pillars smoothly with tangential slide
  if (arena.pillars) {
    for (const p of arena.pillars) {
      const dp = dist(fighter.x, fighter.y, p.x, p.y);
      const avoidDist = p.radius + fighter.radius + 22;
      if (dp > 0 && dp < avoidDist) {
        const pushStrength = ((avoidDist - dp) / avoidDist) * 1.9;
        const nx = (fighter.x - p.x) / dp;
        const ny = (fighter.y - p.y) / dp;
        moveX += (nx - ny * 0.65 * strafeDir) * pushStrength;
        moveY += (ny + nx * 0.65 * strafeDir) * pushStrength;
      }
    }
  }

  // Avoid Warning/Active Harmful Hazards, Seek Ready Shrines
  if (arena.hazards) {
    for (const h of arena.hazards) {
      if (h.type === "LEYLINE_HASTE") continue;
      if (h.phase === "WARNING" || h.phase === "ACTIVE") {
        const dh = dist(fighter.x, fighter.y, h.x, h.y);
        if (dh < h.radius + 16) {
          const awayAng = Math.atan2(fighter.y - h.y, fighter.x - h.x);
          const urgency = h.phase === "ACTIVE" ? 2.4 : 1.5;
          moveX += Math.cos(awayAng) * urgency;
          moveY += Math.sin(awayAng) * urgency;
        }
      }
    }
  }

  if (arena.shrines) {
    let bestShrine = null;
    let bestShrineWeight = 0;
    const hpRatio = fighter.hp / fighter.maxHp;
    for (const s of arena.shrines) {
      if (!s.ready) continue;
      if (s.type === "WARP_GATE" && fighter.warpCooldown > 0) continue;
      const ds = dist(fighter.x, fighter.y, s.x, s.y);
      let desire = 0;
      if ((s.type === "HEAL_SHRINE" || s.type === "SHIELD_SHRINE") && hpRatio < 0.72 && ds < 195) {
        desire = (1 - hpRatio) * 1.6;
      } else if (s.type === "ATK_SHRINE" && fighter.atkBuffTimer <= 0 && ds < 135) {
        desire = 0.85;
      } else if (s.type === "ENERGY_SHRINE" && fighter.energy < 85 && ds < 140) {
        desire = 0.9;
      } else if (s.type === "WARP_GATE" && hpRatio < 0.45 && ds < 105) {
        desire = 0.8;
      }
      if (desire > bestShrineWeight) {
        bestShrineWeight = desire;
        bestShrine = s;
      }
    }
    if (bestShrine) {
      const shAng = Math.atan2(bestShrine.y - fighter.y, bestShrine.x - fighter.x);
      moveX += Math.cos(shAng) * bestShrineWeight;
      moveY += Math.sin(shAng) * bestShrineWeight;
    }
  }

  // Sudden Death / Arena boundary pull
  const distFromCenter = dist(fighter.x, fighter.y, arena.centerX, arena.centerY);
  if (distFromCenter > arena.safeRadius - 22) {
    const inwardAngle = Math.atan2(arena.centerY - fighter.y, arena.centerX - fighter.x);
    moveX += Math.cos(inwardAngle) * 2.2;
    moveY += Math.sin(inwardAngle) * 2.2;
  }

  const mag = Math.hypot(moveX, moveY);
  if (mag > 0.01) {
    let speed = champ.moveSpeed * mods.moveSpeedMult * TEMPO_CONFIG.moveSpeedMult;
    if (fighter.hasteTimer > 0 || fighter.leylineBuff || teamCall === "ORB_FOCUS") speed *= 1.24;
    if (fighter.slowTimer > 0) speed *= 0.65;
    fighter.vx = (moveX / mag) * speed;
    fighter.vy = (moveY / mag) * speed;
    fighter.x = clamp(fighter.x + fighter.vx * dt, fighter.radius + 6, arena.width - fighter.radius - 6);
    fighter.y = clamp(fighter.y + fighter.vy * dt, fighter.radius + 6, arena.height - fighter.radius - 6);
    resolvePillarCollision(fighter, arena);
    fighter.state = "MOVE";
  }

  // 4. Ability Execution Priority
  if (fighter.energy >= 100 && dTarget <= champ.ultSkill.range) {
    if (executeUltimate(state, fighter)) return;
  }

  const exCost = Math.max(15, (champ.exSkill.cost || 25) - mods.exCostReduction);
  if (fighter.energy >= exCost && fighter.cds.ex <= 0 && dTarget <= champ.exSkill.range) {
    const shouldCastEx = teamCall === "EX_RUSH" || fighter.energy >= 50 || (champ.role === "SUPPORT" && fighter.hp / fighter.maxHp < 0.7) || nextRandom(state) < 0.35;
    if (shouldCastEx && executeEXSkill(state, fighter, target, targetIsOrb)) {
      return;
    }
  }

  if (fighter.cds.space <= 0 && (champ.role === "MELEE" || champ.role === "TANK" || champ.role === "ASSASSIN") && dTarget > 115 && dTarget < 190) {
    executeSpaceMobility(state, fighter, fighter.facing);
    return;
  }

  if (fighter.cds.m2 <= 0 && dTarget <= champ.m2.range) {
    pushCombatSfx(state, "M2_SKILLSHOT");
    executeM2(state, fighter, target, targetIsOrb);
    return;
  }

  if (fighter.cds.m1 <= 0 && dTarget <= champ.m1.range + (targetIsOrb ? state.combat.orb.radius : target.radius || 15)) {
    pushCombatSfx(state, "M1_FIRE");
    executeM1(state, fighter, target, targetIsOrb);
  }
}

/**
 * 감독 실시간 전술 콜 발동 (ORB_FOCUS | COUNTER_STANCE | EX_RUSH)
 */
export function triggerCoachCall(state, team, callType) {
  const normalized = LEGACY_CALL_MAP[callType] || callType;
  const def = COACH_CALLS[normalized];
  const slot = state.combat.coachCalls[team];
  if (!def || !slot) return false;
  if (!state.combat.running || state.combat.winnerTeam) return false;
  if ((slot.charges[normalized] || 0) <= 0 || (slot.cds[normalized] || 0) > 0) return false;

  const mods = getTeamRiteModifiers(state, team);
  const avgTeamwork = state.combat.fighters
    .filter((f) => f.alive && f.team === team)
    .reduce((sum, f, _, arr) => sum + f.stats.teamwork / Math.max(1, arr.length), 0);

  slot.charges[normalized] -= 1;
  slot.cds[normalized] = def.cd * (1 - mods.coachCdReduction);
  slot.activeCall = normalized;
  slot.activeTimer = def.duration * (1 + avgTeamwork * 0.002) * TEMPO_CONFIG.coachCallDurationMult;

  for (const f of state.combat.fighters) {
    if (!f.alive || f.team !== team) continue;
    if (normalized === "ORB_FOCUS") {
      f.hasteTimer = Math.max(f.hasteTimer, 4.0);
    } else if (normalized === "COUNTER_STANCE") {
      f.counterTimer = Math.max(f.counterTimer, 1.2);
      f.shield += 40;
      f.state = "COUNTER";
    } else if (normalized === "EX_RUSH") {
      grantEnergy(state, f, 25);
    }
  }

  addTicker(state, `${def.icon} [${team.toUpperCase()}] 감독 콜: ${def.name} 발동! (${slot.charges[normalized]}회 남음)`, "CALL");
  pushCombatSfx(state, "COACH_CALL");
  return true;
}

function updateProjectiles(state, dt) {
  const combat = state.combat;
  const nextProjectiles = [];

  for (const proj of combat.projectiles) {
    const stepX = proj.vx * dt;
    const stepY = proj.vy * dt;
    proj.x += stepX;
    proj.y += stepY;
    proj.traveled += Math.hypot(stepX, stepY);

    if (
      proj.traveled >= proj.range ||
      proj.x < 0 || proj.x > combat.arena.width ||
      proj.y < 0 || proj.y > combat.arena.height
    ) {
      if (proj.isAoE) {
        triggerAoEImpact(state, proj);
      }
      continue;
    }

    let consumed = false;
    const owner = combat.fighters.find((f) => f.unitId === proj.ownerId) || combat.fighters[0];

    // Check Arena Pillar Obstacles (non-piercing projectiles stop at pillars)
    if (!proj.pierce && combat.arena.pillars) {
      for (const pillar of combat.arena.pillars) {
        if (dist(proj.x, proj.y, pillar.x, pillar.y) <= proj.radius + pillar.radius) {
          pillar.hitFlash = 0.16;
          if (proj.isAoE) {
            triggerAoEImpact(state, proj);
          } else {
            spawnEffect(state, "HIT_SPARK", proj.x, proj.y, proj.color, 13, 0.18);
          }
          consumed = true;
          break;
        }
      }
    }

    // Check Heal Ally Projectile
    if (!consumed && proj.healAlly > 0) {
      for (const ally of combat.fighters) {
        if (!ally.alive || ally.team !== proj.team || ally.unitId === proj.ownerId) continue;
        if (dist(proj.x, proj.y, ally.x, ally.y) <= proj.radius + ally.radius) {
          healFighter(ally, proj.healAlly, state);
          grantEnergy(state, owner, 6);
          consumed = true;
          break;
        }
      }
      if (!consumed) nextProjectiles.push(proj);
      continue;
    }

    // Check Center Energy Orb Collision
    if (combat.orb.active && dist(proj.x, proj.y, combat.orb.x, combat.orb.y) <= proj.radius + combat.orb.radius) {
      hitCenterOrb(state, owner, proj.dmg);
      if (!proj.pierce) {
        consumed = true;
      }
    }

    // Check Decoys
    if (!consumed) {
      for (const decoy of combat.decoys) {
        if (decoy.team !== proj.team && dist(proj.x, proj.y, decoy.x, decoy.y) <= proj.radius + decoy.radius) {
          spawnEffect(state, "FLOAT_TEXT", decoy.x, decoy.y - 16, "#86efac", 11, 0.5, "환영 명중!");
          consumed = true;
          break;
        }
      }
    }

    // Check Enemy Fighters
    if (!consumed) {
      for (const target of combat.fighters) {
        if (!target.alive || target.team === proj.team || proj.hitIds.includes(target.unitId)) continue;
        if (dist(proj.x, proj.y, target.x, target.y) <= proj.radius + target.radius) {
          proj.hitIds.push(target.unitId);

          if (target.counterTimer > 0) {
            handleCounterSuccess(state, target, owner, proj);
            if (proj.isReflected) {
              // Balrog reflected it! Keep projectile alive for return flight
              consumed = false;
              break;
            }
            consumed = true;
            break;
          }

          if (proj.isAoE) {
            triggerAoEImpact(state, proj);
            consumed = true;
            break;
          } else {
            handleFighterHit(state, owner, target, proj.dmg, proj, {
              slow: proj.slow,
              energyGain: proj.energyGain
            });
            if (!proj.pierce) {
              consumed = true;
              break;
            }
          }
        }
      }
    }

    if (!consumed) {
      nextProjectiles.push(proj);
    }
  }

  combat.projectiles = nextProjectiles;
}

function triggerAoEImpact(state, proj) {
  const owner = state.combat.fighters.find((f) => f.unitId === proj.ownerId) || state.combat.fighters[0];
  const aoeRad = proj.aoeRadius || 52;
  spawnEffect(state, "NOVA", proj.x, proj.y, proj.color, aoeRad, 0.35);

  for (const target of state.combat.fighters) {
    if (!target.alive || target.team === proj.team) continue;
    if (dist(proj.x, proj.y, target.x, target.y) <= aoeRad + target.radius) {
      handleFighterHit(state, owner, target, proj.dmg, proj, { slow: proj.slow, energyGain: 6 });
    }
  }

  if (state.combat.orb.active && dist(proj.x, proj.y, state.combat.orb.x, state.combat.orb.y) <= aoeRad + state.combat.orb.radius) {
    hitCenterOrb(state, owner, proj.dmg);
  }
}

function getSeatForTeam(state, teamKey) {
  const series = state.activeSeries || {};
  const seatIdx = teamKey === "red" ? series.redSeat : series.blueSeat;
  return state.seats?.[seatIdx] || null;
}

/**
 * AI 감독 자동 전술 콜 평가
 * - 양 팀(blue/red)의 고용 감독 스탯(callSense)과 구단주의 banPickNote(autoCallTrigger)를 반영한다.
 * - 로컬 구단주가 [긴급 개입](liveOverride: true)을 켠 경우에는 로컬 팀 자동 콜을 일시 중지한다.
 */
export function evaluateHeadCoachAutoCalls(state) {
  const combat = state.combat;
  if (!combat.running || combat.winnerTeam) return;

  for (const teamKey of ["blue", "red"]) {
    const slot = combat.coachCalls[teamKey];
    if (!slot || slot.activeCall) continue;

    const seat = getSeatForTeam(state, teamKey);
    const series = state.activeSeries || {};
    const seatIdx = teamKey === "red" ? series.redSeat : series.blueSeat;
    if (state.roomMode === "ARCADE_2P" && seat && !seat.isAI) continue;
    const isLocalTeam = seatIdx === state.localSeatIndex && series.seriesMode !== "EXHIBITION";
    if (isLocalTeam && state.liveOverride) continue;

    const coach = seat?.headCoach;
    const note = seat?.banPickNote || {};
    const triggerPref = note.autoCallTrigger || "ORB_SPAWN";
    const callSense = coach?.stats?.callSense || 75;
    const senseRate = 0.015 + (callSense / 100) * 0.045;

    const allies = combat.fighters.filter((f) => f.alive && f.team === teamKey);
    if (allies.length === 0) continue;

    const minHpRatio = allies.reduce((minR, f) => Math.min(minR, f.hp / Math.max(1, f.maxHp)), 1);
    const maxEnergy = allies.reduce((m, f) => Math.max(m, f.energy || 0), 0);
    const orbSoon = !combat.orb.active && combat.orb.respawnTimer <= 1.5;

    let incomingDanger = false;
    for (const proj of combat.projectiles) {
      if (proj.team === teamKey) continue;
      for (const ally of allies) {
        if (dist(ally.x, ally.y, proj.x, proj.y) < 75) {
          incomingDanger = true;
          break;
        }
      }
      if (incomingDanger) break;
    }

    const canUse = (callId) => (slot.charges?.[callId] || 0) > 0 && (slot.cds?.[callId] || 0) <= 0;
    let chosenCall = null;
    let reasonLabel = "";

    if (triggerPref === "ORB_SPAWN") {
      if ((combat.orb.active || orbSoon) && canUse("ORB_FOCUS") && nextRandom(state) < senseRate * 2.2) {
        chosenCall = "ORB_FOCUS";
        reasonLabel = "오브 타이밍";
      } else if ((minHpRatio < 0.45 || incomingDanger) && canUse("COUNTER_STANCE") && nextRandom(state) < senseRate) {
        chosenCall = "COUNTER_STANCE";
        reasonLabel = "위기 대응";
      } else if (combat.elapsed > 14 && maxEnergy >= 30 && canUse("EX_RUSH") && nextRandom(state) < senseRate * 0.8) {
        chosenCall = "EX_RUSH";
        reasonLabel = "EX 결전";
      }
    } else if (triggerPref === "LOW_HP_DEFENSE") {
      if ((minHpRatio <= 0.58 || incomingDanger) && canUse("COUNTER_STANCE") && nextRandom(state) < senseRate * 2.4) {
        chosenCall = "COUNTER_STANCE";
        reasonLabel = "위기 방어";
      } else if (combat.orb.active && canUse("ORB_FOCUS") && nextRandom(state) < senseRate * 1.1) {
        chosenCall = "ORB_FOCUS";
        reasonLabel = "오브 견제";
      } else if (maxEnergy >= 40 && canUse("EX_RUSH") && nextRandom(state) < senseRate * 0.7) {
        chosenCall = "EX_RUSH";
        reasonLabel = "역습 총공세";
      }
    } else {
      // EARLY_EX_RUSH
      if (combat.elapsed >= 5 && maxEnergy >= 25 && canUse("EX_RUSH") && nextRandom(state) < senseRate * 2.2) {
        chosenCall = "EX_RUSH";
        reasonLabel = "조기 EX 총공세";
      } else if (combat.orb.active && canUse("ORB_FOCUS") && nextRandom(state) < senseRate * 1.2) {
        chosenCall = "ORB_FOCUS";
        reasonLabel = "오브 확보";
      } else if (minHpRatio < 0.50 && canUse("COUNTER_STANCE") && nextRandom(state) < senseRate) {
        chosenCall = "COUNTER_STANCE";
        reasonLabel = "생존 반격";
      }
    }

    if (chosenCall && triggerCoachCall(state, teamKey, chosenCall)) {
      const coachLabel = coach?.name ? coach.name.split(" (")[0] : `${teamKey.toUpperCase()} 감독`;
      const callDef = COACH_CALLS[chosenCall];
      addTicker(state, `🎙️ [${coachLabel} 감독 · ${reasonLabel}] ${callDef?.name || chosenCall} 자동 지시!`, "CALL");
    }
  }
}

/**
 * 1프레임(dt) 전투 스텝 진행
 */
export function stepCombat(state, dt) {
  const combat = state.combat;
  if (!combat.running || combat.paused || combat.winnerTeam) {
    return { roundEnded: !!combat.winnerTeam, winnerTeam: combat.winnerTeam };
  }

  // Update visual effects even during hitstop
  combat.effects = combat.effects.filter((ef) => {
    ef.duration -= dt;
    return ef.duration > 0;
  });

  if (combat.shakeTimer > 0) {
    combat.shakeTimer = Math.max(0, combat.shakeTimer - dt);
    combat.shakeFrames = Math.max(0, combat.shakeFrames - 1);
  }

  // Hitstop freeze frames (55ms on Counter!)
  if (combat.hitstopTimer > 0) {
    combat.hitstopTimer = Math.max(0, combat.hitstopTimer - dt);
    combat.hitstopFrames = Math.max(0, combat.hitstopFrames - 1);
    return { roundEnded: false, winnerTeam: null };
  }

  combat.elapsed += dt;
  combat.timer = Math.max(0, combat.duration - combat.elapsed);

  // Sudden Death shrinking arena
  if (combat.elapsed >= (combat.suddenDeathTime || TEMPO_CONFIG.suddenDeathTime)) {
    if (!combat.suddenDeath) {
      combat.suddenDeath = true;
      addTicker(state, "🔥 서든 데스 발동! 안전 구역이 서서히 축소됩니다!", "SUDDEN_DEATH");
    }
    combat.arena.safeRadius = Math.max(combat.arena.minRadius, combat.arena.safeRadius - TEMPO_CONFIG.vortexShrinkRate * dt);

    for (const f of combat.fighters) {
      if (!f.alive) continue;
      const dCenter = dist(f.x, f.y, combat.arena.centerX, combat.arena.centerY);
      if (dCenter > combat.arena.safeRadius) {
        const mods = getTeamRiteModifiers(state, f.team);
        const burn = 30 * (1 - mods.vortexResist) * dt;
        f.hp = Math.max(0, f.hp - burn);
        if (f.hp <= 0) {
          f.alive = false;
          f.state = "DEAD";
          addTicker(state, `☠️ ${f.name} 자기장 피해로 탈락!`, "KO");
        }
      }
    }
  }

  // Update Arena Pillars, Shrines & Hazards
  if (combat.arena.pillars) {
    for (const p of combat.arena.pillars) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
    }
  }

  if (combat.arena.shrines) {
    for (const s of combat.arena.shrines) {
      if (s.timer > 0) {
        s.timer = Math.max(0, s.timer - dt);
        s.ready = s.timer <= 0;
      } else {
        s.ready = true;
      }

      if (!s.ready) continue;
      for (const f of combat.fighters) {
        if (!f.alive) continue;
        if (s.type === "WARP_GATE" && f.warpCooldown > 0) continue;
        if (dist(f.x, f.y, s.x, s.y) <= s.radius + f.radius + 4) {
          if (s.type === "HEAL_SHRINE") {
            healFighter(f, 95, state);
            grantEnergy(state, f, 15);
            spawnEffect(state, "NOVA", s.x, s.y, "#10b981", 42, 0.45);
            addTicker(state, `🌿 ${f.name} [${s.label}] 점령! (+95 HP, +15 EN)`, "INFO");
          } else if (s.type === "ATK_SHRINE") {
            f.atkBuffTimer = 8.0;
            f.shield += 45;
            spawnEffect(state, "NOVA", s.x, s.y, "#f97316", 44, 0.45);
            spawnEffect(state, "FLOAT_TEXT", f.x, f.y - 24, "#fb923c", 12, 0.75, "화염 증폭 +25%!");
            addTicker(state, `🔥 ${f.name} [${s.label}] 점령! (공격력 +25%)`, "INFO");
          } else if (s.type === "SHIELD_SHRINE") {
            f.shield += 120;
            f.slowTimer = 0;
            f.hasteTimer = Math.max(f.hasteTimer, 4.0);
            spawnEffect(state, "NOVA", s.x, s.y, "#67e8f9", 44, 0.45);
            spawnEffect(state, "FLOAT_TEXT", f.x, f.y - 24, "#67e8f9", 12, 0.75, "수호 성물 +120!");
            addTicker(state, `❄️ ${f.name} [${s.label}] 점령! (+120 보호막)`, "INFO");
          } else if (s.type === "ENERGY_SHRINE") {
            grantEnergy(state, f, 28);
            healFighter(f, 45, state);
            spawnEffect(state, "NOVA", s.x, s.y, "#a855f7", 42, 0.45);
            spawnEffect(state, "FLOAT_TEXT", f.x, f.y - 24, "#c084fc", 12, 0.75, "+28 EN!");
            addTicker(state, `🔮 ${f.name} [${s.label}] 흡수! (+28 에너지)`, "INFO");
          } else if (s.type === "WARP_GATE") {
            const pair = combat.arena.shrines.find((o) => o.id === s.pairId);
            spawnEffect(state, "NOVA", s.x, s.y, "#a855f7", 36, 0.4);
            if (pair) {
              f.x = pair.x;
              f.y = pair.y;
              resolvePillarCollision(f, combat.arena);
              pair.timer = pair.cooldown;
              pair.ready = false;
              spawnEffect(state, "NOVA", pair.x, pair.y, "#10b981", 44, 0.45);
            }
            f.hasteTimer = Math.max(f.hasteTimer, 3.0);
            f.shield += 40;
            f.warpCooldown = 3.0;
            spawnEffect(state, "FLOAT_TEXT", f.x, f.y - 24, "#c084fc", 12, 0.75, "차원 도약!");
            addTicker(state, `🌀 ${f.name} 차원 도약문으로 순간 이동!`, "INFO");
          }
          s.timer = s.cooldown;
          s.ready = false;
          break;
        }
      }
    }
  }

  for (const f of combat.fighters) {
    f.leylineBuff = false;
  }

  if (combat.arena.hazards) {
    for (const h of combat.arena.hazards) {
      h.phaseTimer -= dt;
      if (h.phaseTimer <= 0) {
        if (h.phase === "DORMANT") {
          h.phase = "WARNING";
          h.phaseTimer = h.warningDur;
        } else if (h.phase === "WARNING") {
          h.phase = "ACTIVE";
          h.phaseTimer = h.activeDur;
        } else {
          h.phase = "DORMANT";
          h.phaseTimer = h.dormantDur;
        }
      }

      if (h.phase !== "ACTIVE") continue;
      for (const f of combat.fighters) {
        if (!f.alive) continue;
        const dh = dist(f.x, f.y, h.x, h.y);
        if (dh <= h.radius + f.radius * 0.35) {
          if (h.type === "LEYLINE_HASTE") {
            f.leylineBuff = true;
            f.hasteTimer = Math.max(f.hasteTimer, 0.25);
          } else if (h.type === "LAVA_GEYSER") {
            f.slowTimer = Math.max(f.slowTimer, 0.35);
            applyHazardDamage(state, f, 32 * dt, "용암 분출");
          } else if (h.type === "BLIZZARD_SLOW") {
            f.slowTimer = Math.max(f.slowTimer, 1.2);
            applyHazardDamage(state, f, 14 * dt, "혹한의 눈보라");
          } else if (h.type === "GRAVITY_PULL") {
            const ang = Math.atan2(h.y - f.y, h.x - f.x);
            if (dh > 8) {
              f.x = clamp(f.x + Math.cos(ang) * 48 * dt, f.radius + 6, combat.arena.width - f.radius - 6);
              f.y = clamp(f.y + Math.sin(ang) * 48 * dt, f.radius + 6, combat.arena.height - f.radius - 6);
              resolvePillarCollision(f, combat.arena);
            }
            applyHazardDamage(state, f, 18 * dt, "중력 왜곡장");
          }
        }
      }
    }
  }

  // Center Energy Orb spawn
  if (!combat.orb.active) {
    combat.orb.respawnTimer -= dt;
    if (combat.orb.respawnTimer <= 0) {
      combat.orb.active = true;
      combat.orb.hp = combat.orb.maxHp;
      spawnEffect(state, "NOVA", combat.orb.x, combat.orb.y, "#22d3ee", 55, 0.5);
      addTicker(state, "🔮 중앙 에너지 오브(60 HP)가 생성되었습니다!", "ORB");
    }
  }

  // Update Decoys
  combat.decoys = combat.decoys.filter((d) => {
    d.timer -= dt;
    return d.timer > 0;
  });

  // Update Coach Call Timers & Cooldowns + AI Coach decisions for Red team
  for (const teamKey of ["blue", "red"]) {
    const slot = combat.coachCalls[teamKey];
    if (slot.activeTimer > 0) {
      slot.activeTimer = Math.max(0, slot.activeTimer - dt);
      if (slot.activeTimer <= 0) slot.activeCall = null;
    }
    for (const key of Object.keys(slot.cds)) {
      if (slot.cds[key] > 0) slot.cds[key] = Math.max(0, slot.cds[key] - dt);
    }
  }

  // AI 감독(양 팀) 자동 전술 콜 평가 (긴급 개입 OFF 시 로컬 팀도 감독이 자동 실행)
  evaluateHeadCoachAutoCalls(state);

  // Update Fighters
  for (const fighter of combat.fighters) {
    if (!fighter.alive) continue;

    for (const k of Object.keys(fighter.cds)) {
      if (fighter.cds[k] > 0) fighter.cds[k] = Math.max(0, fighter.cds[k] - dt);
    }
    if (fighter.stunTimer > 0) fighter.stunTimer = Math.max(0, fighter.stunTimer - dt);
    if (fighter.counterTimer > 0) fighter.counterTimer = Math.max(0, fighter.counterTimer - dt);
    if (fighter.stealthTimer > 0) fighter.stealthTimer = Math.max(0, fighter.stealthTimer - dt);
    if (fighter.hasteTimer > 0) fighter.hasteTimer = Math.max(0, fighter.hasteTimer - dt);
    if (fighter.slowTimer > 0) fighter.slowTimer = Math.max(0, fighter.slowTimer - dt);
    if (fighter.atkBuffTimer > 0) fighter.atkBuffTimer = Math.max(0, fighter.atkBuffTimer - dt);
    if (fighter.warpCooldown > 0) fighter.warpCooldown = Math.max(0, fighter.warpCooldown - dt);

    if (fighter.stunTimer > 0) {
      fighter.state = "STUNNED";
      continue;
    }

    if (fighter.dashTimer > 0) {
      fighter.dashTimer = Math.max(0, fighter.dashTimer - dt);
      fighter.x = clamp(fighter.x + fighter.dashVx * dt, fighter.radius + 6, combat.arena.width - fighter.radius - 6);
      fighter.y = clamp(fighter.y + fighter.dashVy * dt, fighter.radius + 6, combat.arena.height - fighter.radius - 6);
      resolvePillarCollision(fighter, combat.arena);
      fighter.state = "DASH";
      continue;
    }

    if (fighter.counterTimer > 0) {
      fighter.state = "COUNTER";
      continue;
    }

    evaluateUtilityAI(state, fighter, dt);
  }

  updateProjectiles(state, dt);

  // Check Round End
  const recordRoundMvp = () => {
    const fighters = combat.fighters || [];
    if (fighters.length === 0) return;
    let best = fighters[0];
    let bestScore = -1;
    for (const f of fighters) {
      const score =
        (f.damageDealt || 0) +
        (f.countersTriggered || 0) * 140 +
        (f.orbsDestroyed || 0) * 120 +
        (f.kills || 0) * 150;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const mvpInfo = {
      unitId: best.unitId,
      playerName: best.playerName,
      champName: best.name || best.champId,
      team: best.team,
      damageDealt: Math.round(best.damageDealt || 0),
      countersTriggered: best.countersTriggered || 0,
      orbsDestroyed: best.orbsDestroyed || 0,
      kills: best.kills || 0
    };
    if (combat.matchTelemetry) {
      combat.matchTelemetry.mvpUnit = mvpInfo;
    }
    if (state.activeSeries?.telemetry) {
      state.activeSeries.telemetry.mvpUnit = mvpInfo;
    }
  };

  const blueAlive = combat.fighters.filter((f) => f.alive && f.team === "blue");
  const redAlive = combat.fighters.filter((f) => f.alive && f.team === "red");

  if (blueAlive.length === 0 || redAlive.length === 0) {
    const winner = blueAlive.length > 0 ? "blue" : "red";
    combat.running = false;
    combat.winnerTeam = winner;
    recordRoundMvp();
    addTicker(state, `🏆 ${winner === "blue" ? "BLUE" : "RED"} 팀 라운드 승리!`, "WIN");
    return { roundEnded: true, winnerTeam: winner };
  }

  if (combat.timer <= 0) {
    const blueHp = blueAlive.reduce((s, f) => s + f.hp, 0);
    const redHp = redAlive.reduce((s, f) => s + f.hp, 0);
    const winner = blueHp >= redHp ? "blue" : "red";
    combat.running = false;
    combat.winnerTeam = winner;
    recordRoundMvp();
    addTicker(state, `⏱️ 시간 종료! 잔여 체력 판정으로 ${winner.toUpperCase()} 팀 승리!`, "WIN");
    return { roundEnded: true, winnerTeam: winner };
  }

  return { roundEnded: false, winnerTeam: null };
}

/**
 * 빠른 테스트용 12챔피언 랜덤 조합 셔플
 */
export function shuffleRandomComp(state) {
  const keys = Object.keys(CHAMPIONS);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  state.activeSeries.matchSeed = Math.floor(100000 + Math.random() * 899999);
  state.activeSeries.draft.bluePicks = keys.slice(0, 3);
  state.activeSeries.draft.redPicks = keys.slice(3, 6);
  initCombatRound(state);
}

/**
 * 커스텀 3v3 조합 적용
 */
export function setCustomComp(state, bluePicks, redPicks) {
  if (Array.isArray(bluePicks) && bluePicks.length === 3) {
    state.activeSeries.draft.bluePicks = [...bluePicks];
  }
  if (Array.isArray(redPicks) && redPicks.length === 3) {
    state.activeSeries.draft.redPicks = [...redPicks];
  }
  initCombatRound(state);
}

/**
 * VOD 리플레이에서 다음 킬, 반격 적중, 오브 파괴, 또는 라운드 종료 시점까지 결정론적 시뮬레이션을 빠르게 스킵한다.
 * @param {object} state
 * @param {number} [maxTicks]
 * @returns {{ hit: string | null, ticksAdvanced: number, roundEnded: boolean, winnerTeam: "blue" | "red" | null }}
 */
export function fastForwardToNextHighlight(state, maxTicks = 600) {
  const combat = state?.combat;
  if (!combat || combat.winnerTeam) {
    return { hit: null, ticksAdvanced: 0, roundEnded: Boolean(combat?.winnerTeam), winnerTeam: combat?.winnerTeam || null };
  }

  const prevPaused = combat.paused;
  combat.running = true;
  combat.paused = false;
  combat.fastForwarding = true;

  const baseAlive = combat.fighters.filter((f) => f.alive).length;
  const sumCounter = () => (combat.matchTelemetry?.blue?.countersLanded || 0) + (combat.matchTelemetry?.red?.countersLanded || 0);
  const sumOrbs = () => (combat.matchTelemetry?.blue?.orbsDestroyed || 0) + (combat.matchTelemetry?.red?.orbsDestroyed || 0);
  const baseCounters = sumCounter();
  const baseOrbs = sumOrbs();

  let hit = null;
  let ticks = 0;
  let roundResult = { roundEnded: false, winnerTeam: null };

  try {
    for (let i = 0; i < maxTicks; i++) {
      roundResult = stepCombat(state, 1 / 60);
      ticks += 1;

      if (roundResult.roundEnded) {
        hit = "ROUND_END";
        break;
      }
      if (combat.fighters.filter((f) => f.alive).length < baseAlive) {
        hit = "KILL";
        break;
      }
      if (sumOrbs() > baseOrbs) {
        hit = "ORB";
        break;
      }
      if (sumCounter() > baseCounters) {
        hit = "COUNTER";
        break;
      }
    }
  } finally {
    combat.fastForwarding = false;
    combat.sfxQueue = [];
    combat.paused = prevPaused && !roundResult.roundEnded;
  }

  return {
    hit,
    ticksAdvanced: ticks,
    roundEnded: roundResult.roundEnded,
    winnerTeam: roundResult.winnerTeam
  };
}
