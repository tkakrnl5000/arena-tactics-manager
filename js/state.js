/**
 * js/state.js
 * 순수 JSON 직렬화 가능 상태 트리, 12종 챔피언, 12종 Rite 카드, 5종 특성, 3종 감독 전술 콜 정의.
 * DOM, Canvas, Network 의존성 없음.
 */

export const SCREEN_STATES = Object.freeze({
  LOBBY: "LOBBY",
  ARCADE_LOBBY: "ARCADE_LOBBY",
  WEEKLY_HUB: "WEEKLY_HUB",
  DRAFT: "DRAFT",
  COMBAT: "COMBAT",
  RITE_DRAFT: "RITE_DRAFT",
  PLAYOFF_BRACKET: "PLAYOFF_BRACKET",
  STOVE_LEAGUE: "STOVE_LEAGUE"
});

export const ROOM_MODES = Object.freeze({
  ARCADE_2P: "ARCADE_2P",
  LEAGUE_6P: "LEAGUE_6P"
});

/**
 * 전체 전투 템포 조절 상수 (체감 약 30~40% 더 신중하고 전술적인 호흡 유지)
 */
export const TEMPO_CONFIG = Object.freeze({
  moveSpeedMult: 0.72,
  projSpeedMult: 0.74,
  cooldownMult: 1.36,
  damageMult: 0.82,
  roundDuration: 85.0,
  suddenDeathTime: 55.0,
  vortexShrinkRate: 4.2,
  orbSpawnInterval: 18.0,
  coachCallDurationMult: 1.30
});

/**
 * 4개 특색 아레나 맵 정의 (기둥 장애물 / 상호작용 성소 / 주기적 위험·기믹 지대)
 */
export const MAP_ORDER = ["starlight_sanctum", "magma_forge", "frost_citadel", "void_nexus"];

export const ARENA_MAPS = Object.freeze({
  starlight_sanctum: {
    id: "starlight_sanctum",
    name: "성운의 성소",
    subtitle: "Starlight Sanctum",
    tag: "균형 · 치유 샘 & 가속 성운",
    desc: "쌍둥이 오벨리스크가 중앙 시야를 가르고, 상하 치유 샘과 중앙 가속 링이 18초 주기로 교전 구도를 바꿉니다.",
    floorColor: "#0e1525",
    accentColor: "#38bdf8",
    ambientColor: "#f59e0b",
    pillars: [
      { id: "p_ss_1", x: 108, y: 210, radius: 17, label: "서쪽 오벨리스크" },
      { id: "p_ss_2", x: 252, y: 210, radius: 17, label: "동쪽 오벨리스크" }
    ],
    shrines: [
      { id: "s_ss_top", x: 180, y: 96, radius: 15, type: "HEAL_SHRINE", label: "성소의 치유 샘", cooldown: 22.0, timer: 4.0 },
      { id: "s_ss_bot", x: 180, y: 324, radius: 15, type: "HEAL_SHRINE", label: "성소의 치유 샘", cooldown: 22.0, timer: 4.0 }
    ],
    hazards: [
      {
        id: "h_ss_mid",
        x: 180,
        y: 210,
        radius: 44,
        type: "LEYLINE_HASTE",
        label: "성운 가속 링",
        dormantDur: 10.0,
        warningDur: 3.0,
        activeDur: 5.0
      }
    ]
  },
  magma_forge: {
    id: "magma_forge",
    name: "용암 제련소",
    subtitle: "Magma Crucible",
    tag: "화력전 · 모루 엄폐 & 간헐천",
    desc: "4개의 흑요석 모루 사이에서 화염 증폭 제단을 차지하세요. 상하 용암 분출구가 주기적으로 폭발합니다.",
    floorColor: "#1a1012",
    accentColor: "#f97316",
    ambientColor: "#ef4444",
    pillars: [
      { id: "p_mf_1", x: 116, y: 146, radius: 15, label: "북서 모루" },
      { id: "p_mf_2", x: 244, y: 146, radius: 15, label: "북동 모루" },
      { id: "p_mf_3", x: 116, y: 274, radius: 15, label: "남서 모루" },
      { id: "p_mf_4", x: 244, y: 274, radius: 15, label: "남동 모루" }
    ],
    shrines: [
      { id: "s_mf_left", x: 76, y: 210, radius: 15, type: "ATK_SHRINE", label: "화염 증폭 제단", cooldown: 24.0, timer: 5.0 },
      { id: "s_mf_right", x: 284, y: 210, radius: 15, type: "ATK_SHRINE", label: "화염 증폭 제단", cooldown: 24.0, timer: 5.0 }
    ],
    hazards: [
      {
        id: "h_mf_top",
        x: 180,
        y: 128,
        radius: 28,
        type: "LAVA_GEYSER",
        label: "북부 용암 분출구",
        dormantDur: 7.0,
        warningDur: 2.8,
        activeDur: 4.0
      },
      {
        id: "h_mf_bot",
        x: 180,
        y: 292,
        radius: 28,
        type: "LAVA_GEYSER",
        label: "남부 용암 분출구",
        dormantDur: 7.0,
        warningDur: 2.8,
        activeDur: 4.0
      }
    ]
  },
  frost_citadel: {
    id: "frost_citadel",
    name: "영구동토 성채",
    subtitle: "Frostspire Citadel",
    tag: "수성전 · 빙결 성물 & 눈보라",
    desc: "삼각 빙하 모놀리스가 진형을 가릅니다. 빙결 성물은 보호막과 정화를 부여하며, 측면 눈보라 지대는 적을 둔화시킵니다.",
    floorColor: "#0c1824",
    accentColor: "#67e8f9",
    ambientColor: "#38bdf8",
    pillars: [
      { id: "p_fc_1", x: 180, y: 124, radius: 16, label: "북방 빙하 첨탑" },
      { id: "p_fc_2", x: 112, y: 266, radius: 16, label: "남서 빙하 첨탑" },
      { id: "p_fc_3", x: 248, y: 266, radius: 16, label: "남동 빙하 첨탑" }
    ],
    shrines: [
      { id: "s_fc_l", x: 96, y: 134, radius: 15, type: "SHIELD_SHRINE", label: "빙결 수호 성물", cooldown: 22.0, timer: 4.5 },
      { id: "s_fc_r", x: 264, y: 134, radius: 15, type: "SHIELD_SHRINE", label: "빙결 수호 성물", cooldown: 22.0, timer: 4.5 }
    ],
    hazards: [
      {
        id: "h_fc_l",
        x: 112,
        y: 194,
        radius: 29,
        type: "BLIZZARD_SLOW",
        label: "서부 눈보라 지대",
        dormantDur: 6.5,
        warningDur: 2.5,
        activeDur: 4.5
      },
      {
        id: "h_fc_r",
        x: 248,
        y: 194,
        radius: 29,
        type: "BLIZZARD_SLOW",
        label: "동부 눈보라 지대",
        dormantDur: 6.5,
        warningDur: 2.5,
        activeDur: 4.5
      }
    ]
  },
  void_nexus: {
    id: "void_nexus",
    name: "심연의 균열",
    subtitle: "Void Rift Nexus",
    tag: "기동전 · 차원 도약문 & 중력장",
    desc: "대각 차원 도약문으로 적의 후방을 기습하고 심연의 수정으로 궁극기를 채우세요. 중앙 중력 왜곡장이 주기적으로 열립니다.",
    floorColor: "#120f24",
    accentColor: "#a855f7",
    ambientColor: "#10b981",
    pillars: [
      { id: "p_vn_1", x: 142, y: 162, radius: 16, label: "북서 공허 석주" },
      { id: "p_vn_2", x: 218, y: 258, radius: 16, label: "남동 공허 석주" }
    ],
    shrines: [
      { id: "s_vn_w1", x: 78, y: 118, radius: 15, type: "WARP_GATE", pairId: "s_vn_w2", label: "북서 차원 도약문", cooldown: 16.0, timer: 3.0 },
      { id: "s_vn_w2", x: 282, y: 302, radius: 15, type: "WARP_GATE", pairId: "s_vn_w1", label: "남동 차원 도약문", cooldown: 16.0, timer: 3.0 },
      { id: "s_vn_e1", x: 78, y: 302, radius: 14, type: "ENERGY_SHRINE", label: "심연의 수정", cooldown: 20.0, timer: 5.0 },
      { id: "s_vn_e2", x: 282, y: 118, radius: 14, type: "ENERGY_SHRINE", label: "심연의 수정", cooldown: 20.0, timer: 5.0 }
    ],
    hazards: [
      {
        id: "h_vn_mid",
        x: 180,
        y: 210,
        radius: 46,
        type: "GRAVITY_PULL",
        label: "중력 왜곡장",
        dormantDur: 8.0,
        warningDur: 2.5,
        activeDur: 3.5
      }
    ]
  }
});

export function getArenaMapById(mapId) {
  return ARENA_MAPS[mapId] || ARENA_MAPS.starlight_sanctum;
}

export const TRAITS = Object.freeze({
  clutch_gene: {
    id: "clutch_gene",
    name: "클러치 유전자",
    desc: "서든 데스 또는 최종 세트에서 피해량 +20%, 에너지 획득 +15%"
  },
  counter_master: {
    id: "counter_master",
    name: "반격의 달인",
    desc: "반격(Q) 재사용 대기시간 -25%, 반격 기절 시간 +0.4초"
  },
  orb_hunter: {
    id: "orb_hunter",
    name: "오브 사냥꾼",
    desc: "중앙 에너지 오브 피해량 +35% 및 오브 우선 타격"
  },
  lone_wolf: {
    id: "lone_wolf",
    name: "고독한 늑대",
    desc: "반경 100px 내 아군이 없을 때 피해량 +15%"
  },
  glass_cannon: {
    id: "glass_cannon",
    name: "유리대포",
    desc: "가하는 피해량 +25%, 받는 피해량 +15%"
  }
});

export const RITE_CARDS = [
  { id: "rite_crimson_edge", name: "핏빛 칼날", category: "OFFENSE", desc: "팀 전원 기본 공격 및 스킬 적중 시 피해량의 10% 체력 회복", effectKey: "lifesteal", value: 0.10 },
  { id: "rite_reflex_shield", name: "반사의 문장", category: "DEFENSE", desc: "반격(Q) 성공 시 120 보호막 획득", effectKey: "counterShield", value: 120 },
  { id: "rite_orb_synergy", name: "오브 공명", category: "UTILITY", desc: "중앙 에너지 오브 막타 시 에너지 +15 추가 획득", effectKey: "orbBonusEnergy", value: 15 },
  { id: "rite_ex_overcharge", name: "EX 과충전", category: "OFFENSE", desc: "EX 스킬 소모 에너지 -5 (25 -> 20)", effectKey: "exCostReduction", value: 5 },
  { id: "rite_sudden_valor", name: "종말의 결의", category: "DEFENSE", desc: "서든 데스 자기장 피해 40% 감소", effectKey: "vortexResist", value: 0.40 },
  { id: "rite_tactical_echo", name: "전술 메아리", category: "UTILITY", desc: "감독 전술 콜 재사용 대기시간 30% 감소", effectKey: "coachCdReduction", value: 0.30 },
  { id: "rite_swift_boots", name: "신속의 전투화", category: "UTILITY", desc: "팀 전원 이동 속도 +15%", effectKey: "moveSpeedMult", value: 1.15 },
  { id: "rite_piercing_bolts", name: "관통 탄환", category: "OFFENSE", desc: "투사체 속도 +20%", effectKey: "projSpeedMult", value: 1.20 },
  { id: "rite_iron_bastion", name: "강철 요새", category: "DEFENSE", desc: "팀 전원 최대 체력 +15%", effectKey: "maxHpMult", value: 1.15 },
  { id: "rite_executioner", name: "처형자의 본능", category: "OFFENSE", desc: "체력 35% 이하 적 공격 시 피해량 +25%", effectKey: "execDmgMult", value: 1.25 },
  { id: "rite_arcane_flow", name: "비전 순환", category: "UTILITY", desc: "주력 스킬(M2/Space/Q) 쿨타임 20% 감소", effectKey: "skillCdMult", value: 0.80 },
  { id: "rite_guardian_grace", name: "수호자의 은총", category: "DEFENSE", desc: "체력 20% 미만 시 라운드당 1회 160 보호막 발동", effectKey: "emergencyShield", value: 160 }
];

export const COACH_CALLS = Object.freeze({
  ORB_FOCUS: {
    id: "ORB_FOCUS",
    name: "오브 집결",
    icon: "🔮",
    desc: "4초간 아군 전원 중앙 오브 최우선 타격 & 이속 +25%",
    duration: 4.0,
    cd: 8.0,
    maxCharges: 3
  },
  COUNTER_STANCE: {
    id: "COUNTER_STANCE",
    name: "전원 반격",
    icon: "🛡️",
    desc: "아군 전원 즉시 반격(Q) 자세 발동 & 보호막 +40 부여",
    duration: 4.0,
    cd: 10.0,
    maxCharges: 3
  },
  EX_RUSH: {
    id: "EX_RUSH",
    name: "EX 총공세",
    icon: "⚡",
    desc: "전원 에너지 +25 즉시 충전 & 4초간 공격력 +20% · EX 난사",
    duration: 4.0,
    cd: 10.0,
    maxCharges: 3
  }
});

/**
 * 12종 챔피언 풀 정의
 */
export const CHAMPIONS = {
  kylen: {
    id: "kylen",
    name: "카일렌 (Kylen)",
    shortName: "카일렌",
    role: "MELEE",
    color: "#ef4444",
    baseHp: 680,
    moveSpeed: 135,
    radius: 15,
    preferredRange: 42,
    m1: { name: "섬광베기", dmg: 44, cd: 0.62, range: 48, projSpeed: 0, radius: 22, isMelee: true, energyGain: 7 },
    m2: { name: "질풍참", dmg: 85, cd: 4.2, range: 165, projSpeed: 400, radius: 9, isMelee: false, pierce: false, energyGain: 14 },
    space: { name: "검기 도약", cd: 5.5, dashDist: 105, duration: 0.22, dmg: 35, aoeRadius: 42 },
    counterSkill: { name: "검기 반격", cd: 7.5, duration: 1.2, stunDuration: 0.9, effectType: "BLADE_RIPOSTE", retaliateDmg: 65 },
    exSkill: { name: "EX 혈풍섬", cost: 25, dmg: 105, cd: 1.5, range: 140, projSpeed: 450, effectType: "EX_DASH_LIFESTEAL", healSelf: 55 },
    ultSkill: { name: "무쌍난무", cost: 100, dmg: 190, range: 160, aoeRadius: 70 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  sylvia: {
    id: "sylvia",
    name: "실비아 (Sylvia)",
    shortName: "실비아",
    role: "RANGED",
    color: "#22c55e",
    baseHp: 520,
    moveSpeed: 145,
    radius: 15,
    preferredRange: 145,
    m1: { name: "바람 화살", dmg: 38, cd: 0.58, range: 190, projSpeed: 390, radius: 5, isMelee: false, energyGain: 7 },
    m2: { name: "관통 폭풍시", dmg: 92, cd: 4.5, range: 240, projSpeed: 480, radius: 8, isMelee: false, pierce: true, energyGain: 15 },
    space: { name: "질풍 구르기", cd: 5.5, dashDist: 100, duration: 0.2, shield: 30 },
    counterSkill: { name: "환영 은신", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "DECOY_STEALTH", stealthDur: 1.5, dashDist: 75 },
    exSkill: { name: "EX 연쇄 폭풍시", cost: 25, dmg: 52, cd: 1.5, range: 220, projSpeed: 460, effectType: "EX_TRIPLE_SHOT" },
    ultSkill: { name: "천공의 화살비", cost: 100, dmg: 180, range: 210, aoeRadius: 75 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  orion: {
    id: "orion",
    name: "오리온 (Orion)",
    shortName: "오리온",
    role: "MAGE",
    color: "#8b5cf6",
    baseHp: 540,
    moveSpeed: 125,
    radius: 15,
    preferredRange: 140,
    m1: { name: "플라즈마 탄", dmg: 40, cd: 0.68, range: 185, projSpeed: 350, radius: 6, isMelee: false, energyGain: 8 },
    m2: { name: "성운 폭발", dmg: 88, cd: 4.8, range: 190, projSpeed: 330, radius: 10, isMelee: false, isAoE: true, aoeRadius: 52, energyGain: 15 },
    space: { name: "공간 도약", cd: 6.0, dashDist: 110, duration: 0.16, dmg: 30, aoeRadius: 45 },
    counterSkill: { name: "중력 왜곡", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "KNOCKBACK_HEAL", knockbackDist: 85, healSelf: 65, retaliateDmg: 45 },
    exSkill: { name: "EX 초신성 붕괴", cost: 25, dmg: 115, cd: 1.5, range: 190, projSpeed: 370, effectType: "EX_GRAVITY_NOVA", aoeRadius: 68 },
    ultSkill: { name: "블랙홀", cost: 100, dmg: 200, range: 180, aoeRadius: 80 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  balrog: {
    id: "balrog",
    name: "발록 (Balrog)",
    shortName: "발록",
    role: "TANK",
    color: "#f97316",
    baseHp: 820,
    moveSpeed: 118,
    radius: 16,
    preferredRange: 44,
    m1: { name: "용암 철퇴", dmg: 46, cd: 0.72, range: 50, projSpeed: 0, radius: 24, isMelee: true, energyGain: 8 },
    m2: { name: "화산 강타", dmg: 82, cd: 4.6, range: 110, projSpeed: 310, radius: 11, isMelee: false, isAoE: true, aoeRadius: 55, energyGain: 14 },
    space: { name: "마그마 도약", cd: 5.8, dashDist: 105, duration: 0.25, dmg: 45, aoeRadius: 55, shield: 50 },
    counterSkill: { name: "용암 반사벽", cd: 7.5, duration: 1.2, stunDuration: 0.9, effectType: "REFLECT_PROJ", reflectMult: 1.4, retaliateDmg: 60 },
    exSkill: { name: "EX 용암 분출", cost: 25, dmg: 95, cd: 1.5, range: 95, projSpeed: 0, effectType: "EX_TAUNT_SHIELD", healSelf: 45, aoeRadius: 70 },
    ultSkill: { name: "대지 분쇄", cost: 100, dmg: 210, range: 140, aoeRadius: 80 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  nyx: {
    id: "nyx",
    name: "닉스 (Nyx)",
    shortName: "닉스",
    role: "ASSASSIN",
    color: "#a855f7",
    baseHp: 500,
    moveSpeed: 155,
    radius: 14,
    preferredRange: 45,
    m1: { name: "그림자 단검", dmg: 42, cd: 0.52, range: 48, projSpeed: 0, radius: 20, isMelee: true, energyGain: 7 },
    m2: { name: "암흑 쿠나이", dmg: 78, cd: 3.8, range: 180, projSpeed: 460, radius: 6, isMelee: false, energyGain: 14 },
    space: { name: "그림자 밟기", cd: 5.0, dashDist: 120, duration: 0.16, dmg: 35, aoeRadius: 36 },
    counterSkill: { name: "안개 그림자", cd: 7.5, duration: 1.2, stunDuration: 0.9, effectType: "SHADOW_BACKSTAB", retaliateDmg: 75, stealthDur: 1.1 },
    exSkill: { name: "EX 처형 일섬", cost: 25, dmg: 112, cd: 1.5, range: 140, projSpeed: 480, effectType: "EX_EXECUTE_SLASH" },
    ultSkill: { name: "절멸의 춤", cost: 100, dmg: 215, range: 150, aoeRadius: 65 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  ignis: {
    id: "ignis",
    name: "이그니스 (Ignis)",
    shortName: "이그니스",
    role: "MAGE",
    color: "#fb7185",
    baseHp: 510,
    moveSpeed: 128,
    radius: 15,
    preferredRange: 145,
    m1: { name: "화염탄", dmg: 41, cd: 0.64, range: 185, projSpeed: 370, radius: 6, isMelee: false, energyGain: 7 },
    m2: { name: "메테오 화구", dmg: 96, cd: 4.8, range: 200, projSpeed: 340, radius: 11, isMelee: false, isAoE: true, aoeRadius: 56, energyGain: 16 },
    space: { name: "불꽃 추진", cd: 5.8, dashDist: 95, duration: 0.2, dmg: 40, aoeRadius: 48 },
    counterSkill: { name: "화염 거울", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "FLAME_NOVA", retaliateDmg: 70, aoeRadius: 75 },
    exSkill: { name: "EX 폭염 연사", cost: 25, dmg: 55, cd: 1.5, range: 205, projSpeed: 400, effectType: "EX_TRIPLE_SHOT" },
    ultSkill: { name: "인페르노", cost: 100, dmg: 225, range: 190, aoeRadius: 82 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  vex: {
    id: "vex",
    name: "벡스 (Vex)",
    shortName: "벡스",
    role: "RANGED",
    color: "#06b6d4",
    baseHp: 530,
    moveSpeed: 132,
    radius: 15,
    preferredRange: 155,
    m1: { name: "펄스 소총", dmg: 37, cd: 0.55, range: 200, projSpeed: 420, radius: 5, isMelee: false, energyGain: 7 },
    m2: { name: "레일건 저격", dmg: 102, cd: 5.0, range: 260, projSpeed: 560, radius: 7, isMelee: false, pierce: true, energyGain: 16 },
    space: { name: "제트 회피", cd: 5.6, dashDist: 105, duration: 0.18, shield: 35 },
    counterSkill: { name: "전자기장", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "EM_SHIELD_PULSE", shieldSelf: 95, knockbackDist: 80 },
    exSkill: { name: "EX 이온 캐논", cost: 25, dmg: 120, cd: 1.5, range: 250, projSpeed: 540, effectType: "EX_PIERCE_BEAM" },
    ultSkill: { name: "궤도 폭격", cost: 100, dmg: 210, range: 230, aoeRadius: 75 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  lyra: {
    id: "lyra",
    name: "라이라 (Lyra)",
    shortName: "라이라",
    role: "SUPPORT",
    color: "#f472b6",
    baseHp: 580,
    moveSpeed: 135,
    radius: 15,
    preferredRange: 130,
    m1: { name: "별빛 탄환", dmg: 34, cd: 0.65, range: 175, projSpeed: 350, radius: 5, isMelee: false, energyGain: 8 },
    m2: { name: "천상의 치유", dmg: 70, cd: 4.2, range: 190, projSpeed: 380, radius: 9, isMelee: false, healAlly: 85, energyGain: 14 },
    space: { name: "성운 활공", cd: 5.5, dashDist: 95, duration: 0.2, shield: 45 },
    counterSkill: { name: "별빛 성역", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "TEAM_ASTRAL_HEAL", healTeam: 55 },
    exSkill: { name: "EX 은하수 축복", cost: 25, dmg: 65, cd: 1.5, range: 180, projSpeed: 0, effectType: "EX_TEAM_HEAL_WAVE", healTeam: 75, aoeRadius: 130 },
    ultSkill: { name: "여신의 빛", cost: 100, dmg: 140, range: 200, aoeRadius: 110 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  solaris: {
    id: "solaris",
    name: "솔라리스 (Solaris)",
    shortName: "솔라리스",
    role: "SUPPORT",
    color: "#eab308",
    baseHp: 660,
    moveSpeed: 130,
    radius: 15,
    preferredRange: 95,
    m1: { name: "태양의 창", dmg: 39, cd: 0.66, range: 130, projSpeed: 360, radius: 6, isMelee: false, energyGain: 8 },
    m2: { name: "여명의 축복", dmg: 76, cd: 4.5, range: 175, projSpeed: 370, radius: 10, isMelee: false, healAlly: 70, isAoE: true, aoeRadius: 48, energyGain: 15 },
    space: { name: "광휘 돌진", cd: 5.8, dashDist: 95, duration: 0.22, shield: 60 },
    counterSkill: { name: "태양의 방패", cd: 7.5, duration: 1.2, stunDuration: 0.9, effectType: "RADIANT_AEGIS", shieldTeam: 70, retaliateDmg: 50 },
    exSkill: { name: "EX 태양의 심판", cost: 25, dmg: 90, cd: 1.5, range: 165, projSpeed: 390, effectType: "EX_TEAM_SHIELD_BLAST", healTeam: 50, aoeRadius: 75 },
    ultSkill: { name: "솔라 플레어", cost: 100, dmg: 185, range: 170, aoeRadius: 90 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  titan: {
    id: "titan",
    name: "타이탄 (Titan)",
    shortName: "타이탄",
    role: "TANK",
    color: "#64748b",
    baseHp: 850,
    moveSpeed: 115,
    radius: 16,
    preferredRange: 40,
    m1: { name: "거인 주먹", dmg: 47, cd: 0.74, range: 48, projSpeed: 0, radius: 24, isMelee: true, energyGain: 8 },
    m2: { name: "대지 파동", dmg: 84, cd: 4.7, range: 140, projSpeed: 320, radius: 11, isMelee: false, isAoE: true, aoeRadius: 58, energyGain: 14 },
    space: { name: "지진 돌진", cd: 5.8, dashDist: 100, duration: 0.24, dmg: 45, aoeRadius: 52, shield: 65 },
    counterSkill: { name: "충격파 가드", cd: 7.5, duration: 1.2, stunDuration: 0.9, effectType: "SEISMIC_GUARD", shieldSelf: 110, retaliateDmg: 55 },
    exSkill: { name: "EX 강철 분쇄", cost: 25, dmg: 105, cd: 1.5, range: 100, projSpeed: 0, effectType: "EX_TAUNT_SHIELD", healSelf: 50, aoeRadius: 75 },
    ultSkill: { name: "타이탄 슬램", cost: 100, dmg: 210, range: 140, aoeRadius: 85 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  shade: {
    id: "shade",
    name: "셰이드 (Shade)",
    shortName: "셰이드",
    role: "ASSASSIN",
    color: "#6366f1",
    baseHp: 560,
    moveSpeed: 148,
    radius: 14,
    preferredRange: 46,
    m1: { name: "공허의 낫", dmg: 43, cd: 0.56, range: 52, projSpeed: 0, radius: 22, isMelee: true, energyGain: 7 },
    m2: { name: "영혼 베기", dmg: 86, cd: 4.0, range: 170, projSpeed: 420, radius: 8, isMelee: false, energyGain: 14 },
    space: { name: "공허 이동", cd: 5.2, dashDist: 115, duration: 0.16, dmg: 35, aoeRadius: 42 },
    counterSkill: { name: "차원 변이", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "VOID_DRAIN", retaliateDmg: 60, healSelf: 60 },
    exSkill: { name: "EX 영혼 착취", cost: 25, dmg: 105, cd: 1.5, range: 135, projSpeed: 430, effectType: "EX_DASH_LIFESTEAL", healSelf: 70 },
    ultSkill: { name: "사신의 선고", cost: 100, dmg: 220, range: 150, aoeRadius: 70 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  },
  frost: {
    id: "frost",
    name: "프로스트 (Frost)",
    shortName: "프로스트",
    role: "MAGE",
    color: "#38bdf8",
    baseHp: 550,
    moveSpeed: 126,
    radius: 15,
    preferredRange: 145,
    m1: { name: "얼음 파편", dmg: 39, cd: 0.62, range: 185, projSpeed: 375, radius: 6, isMelee: false, energyGain: 7 },
    m2: { name: "혹한의 창", dmg: 90, cd: 4.5, range: 215, projSpeed: 430, radius: 9, isMelee: false, slow: 1.5, energyGain: 15 },
    space: { name: "빙결 활주", cd: 5.6, dashDist: 95, duration: 0.2, shield: 45 },
    counterSkill: { name: "얼음 프리즘", cd: 8.0, duration: 1.2, stunDuration: 0.9, effectType: "ICE_PRISM", retaliateDmg: 55, extraStun: 0.5 },
    exSkill: { name: "EX 절대 영도", cost: 25, dmg: 100, cd: 1.5, range: 195, projSpeed: 410, effectType: "EX_FROST_NOVA", aoeRadius: 68 },
    ultSkill: { name: "블리자드", cost: 100, dmg: 195, range: 190, aoeRadius: 85 },
    patchMod: { dmgMult: 1.0, hpMult: 1.0, cdMult: 1.0 }
  }
};

for (const champ of Object.values(CHAMPIONS)) {
  champ.basicAtk = champ.m1;
  champ.skillPrimary = champ.m2;
}

export const SCHEDULE_MODES = Object.freeze({
  REALTIME_DAILY: "REALTIME_DAILY",
  HOURLY_BLITZ: "HOURLY_BLITZ",
  INSTANT_TEST: "INSTANT_TEST"
});

export const COACH_PHILOSOPHIES = Object.freeze({
  DATA_ANALYST: { id: "DATA_ANALYST", name: "데이터 분석가", desc: "상대 숙련도·패치 지표 기반 저격 밴픽" },
  JOKER_GAMBLER: { id: "JOKER_GAMBLER", name: "조커 갬블러", desc: "변칙 픽과 높은 아집으로 깜짝 승부" },
  ORB_MASTER: { id: "ORB_MASTER", name: "오브 마스터", desc: "중앙 에너지 오브 교전 및 전술 콜 특화" },
  ROOKIE_MENTOR: { id: "ROOKIE_MENTOR", name: "유망주 멘토", desc: "안정적 성장과 팀 합·생존 중심 운영" }
});

export const BAN_PICK_STRATEGIES = Object.freeze({
  AUTO_COUNTER: { id: "AUTO_COUNTER", name: "맞춤 카운터", desc: "상대 조합을 보고 상성 우위 픽 선택" },
  DIVE_COMP: { id: "DIVE_COMP", name: "돌진 암살", desc: "근접·암살자 위주 초전박살 조합" },
  POKE_CONTROL: { id: "POKE_CONTROL", name: "포킹 제압", desc: "원거리·마법사 사거리 압박 조합" },
  PROTECT_CARRY: { id: "PROTECT_CARRY", name: "캐리 보호", desc: "탱커·서포터 중심 후반 유지력 조합" }
});

export const RITE_PREFERENCES = Object.freeze({
  COUNTER: { id: "COUNTER", name: "반격·방어", desc: "반격 보호막·초자연 생존 증강 선호" },
  ORB: { id: "ORB", name: "오브·기동", desc: "오브 공명·이동속도·투사체 증강 선호" },
  ENERGY: { id: "ENERGY", name: "EX·쿨감", desc: "EX 과충전·비전 순환 증강 선호" },
  SURVIVAL: { id: "SURVIVAL", name: "유지력·체력", desc: "강철 요새·흡혈·수호자 증강 선호" }
});

export const AUTO_CALL_TRIGGERS = Object.freeze({
  ORB_SPAWN: { id: "ORB_SPAWN", name: "오브 타이밍", desc: "중앙 오브 출현 직후 오브 집중 콜 자동 발동" },
  LOW_HP_DEFENSE: { id: "LOW_HP_DEFENSE", name: "위기 방어", desc: "아군 체력 저하·투사체 근접 시 반격 태세 우선" },
  EARLY_EX_RUSH: { id: "EARLY_EX_RUSH", name: "조기 EX 총공세", desc: "초반 에너지 25+ 확보 즉시 EX 총공세 전개" }
});

export const HEAD_COACHES = [
  {
    id: "coach_koma",
    name: "코마 (Koma)",
    title: "황금 왕조 설계자",
    philosophy: "ORB_MASTER",
    signatureChamp: "orion",
    salary: 420,
    bark: "오브 타이밍은 오리온이 지배합니다. 구단주님, 지금 판은 내게 맡기시죠!",
    stats: { draftInsight: 88, callSense: 92, riteSense: 86, ego: 20 }
  },
  {
    id: "coach_cvmax",
    name: "씨맥 (cvMax)",
    title: "광기의 천재 전술가",
    philosophy: "JOKER_GAMBLER",
    signatureChamp: "nyx",
    salary: 380,
    bark: "정석은 깨라고 있는 겁니다! 내 시그니처 닉스로 판을 뒤집겠습니다!",
    stats: { draftInsight: 90, callSense: 80, riteSense: 76, ego: 78 }
  },
  {
    id: "coach_hirai",
    name: "히라이 (Hirai)",
    title: "철벽 데이터 감독",
    philosophy: "DATA_ANALYST",
    signatureChamp: "vex",
    salary: 350,
    bark: "확률 68.4% 우위! 데이터는 거짓말을 하지 않습니다.",
    stats: { draftInsight: 86, callSense: 79, riteSense: 88, ego: 25 }
  },
  {
    id: "coach_score",
    name: "스코어 (Score)",
    title: "정글러 출신 베테랑",
    philosophy: "ORB_MASTER",
    signatureChamp: "kylen",
    salary: 360,
    bark: "한타 각이 보였습니다. 카일렌으로 선봉을 찢고 들어갑니다!",
    stats: { draftInsight: 82, callSense: 89, riteSense: 82, ego: 35 }
  },
  {
    id: "coach_daeny",
    name: "대니 (Daeny)",
    title: "밴픽 신의 손",
    philosophy: "DATA_ANALYST",
    signatureChamp: "frost",
    salary: 390,
    bark: "상대 조합의 약점을 읽었습니다. 프로스트로 아레나를 얼려버리죠.",
    stats: { draftInsight: 94, callSense: 81, riteSense: 90, ego: 52 }
  },
  {
    id: "coach_edgar",
    name: "에드가 (Edgar)",
    title: "후반 수성의 명장",
    philosophy: "ROOKIE_MENTOR",
    signatureChamp: "balrog",
    salary: 320,
    bark: "서두르지 않습니다. 발록을 앞세워 끝까지 버티면 이깁니다.",
    stats: { draftInsight: 78, callSense: 84, riteSense: 85, ego: 18 }
  },
  {
    id: "coach_noffe",
    name: "노페 (NoFe)",
    title: "변칙 카운터 장인",
    philosophy: "JOKER_GAMBLER",
    signatureChamp: "sylvia",
    salary: 300,
    bark: "지금 각엔 실비아 조커 픽이 무조건 먹힙니다. 믿으세요!",
    stats: { draftInsight: 81, callSense: 76, riteSense: 80, ego: 64 }
  },
  {
    id: "coach_mad",
    name: "매드라이프 (Mad)",
    title: "수호와 반격의 스승",
    philosophy: "ROOKIE_MENTOR",
    signatureChamp: "lyra",
    salary: 280,
    bark: "라이라의 별빛 수호로 우리 딜러진은 단 한 명도 내주지 않습니다!",
    stats: { draftInsight: 75, callSense: 88, riteSense: 83, ego: 30 }
  }
];

const TEAM_PRESETS = [
  { teamName: "서울 노바 (Seoul Nova)", teamColor: "#3b82f6", coachName: "Host Coach", isAI: false },
  { teamName: "부산 타이탄즈 (Busan Titans)", teamColor: "#ef4444", coachName: "AI Coach Kang", isAI: true },
  { teamName: "인천 스톰 (Incheon Storm)", teamColor: "#22c55e", coachName: "AI Coach Park", isAI: true },
  { teamName: "대구 블레이즈 (Daegu Blaze)", teamColor: "#f97316", coachName: "AI Coach Kim", isAI: true },
  { teamName: "대전 미라지 (Daejeon Mirage)", teamColor: "#a855f7", coachName: "AI Coach Lee", isAI: true },
  { teamName: "광주 발키리 (Gwangju Valkyrie)", teamColor: "#06b6d4", coachName: "AI Coach Choi", isAI: true }
];

const PLAYER_NAMES = [
  ["FakerLite", "KeriaJr", "ZeusPeak", "OnerAce"],
  ["ChovyEcho", "CanyonX", "KiinWall", "PeyzShot"],
  ["DeftArc", "BerylMind", "ShowMake", "LucidSky"],
  ["ViperFang", "ZekaDash", "DoranShield", "DelightK"],
  ["GumayusiV", "RulerAim", "KuroBlade", "LehendsG"],
  ["BddSpark", "AimingPro", "PyosikW", "KellInS"]
];

const FA_PRESETS = [
  { name: "ClozerNova", stats: { mechanics: 84, reflex: 82, teamwork: 75, mental: 78 }, trait: "clutch_gene", cost: 450, fav: ["kylen", "nyx", "shade"] },
  { name: "GhostWall", stats: { mechanics: 76, reflex: 80, teamwork: 88, mental: 86 }, trait: "counter_master", cost: 400, fav: ["balrog", "titan", "solaris"] },
  { name: "TeddyArc", stats: { mechanics: 86, reflex: 77, teamwork: 78, mental: 81 }, trait: "orb_hunter", cost: 500, fav: ["sylvia", "vex", "orion"] },
  { name: "LifeSpark", stats: { mechanics: 75, reflex: 84, teamwork: 85, mental: 80 }, trait: "lone_wolf", cost: 380, fav: ["lyra", "solaris", "frost"] },
  { name: "MorganFlame", stats: { mechanics: 88, reflex: 79, teamwork: 71, mental: 74 }, trait: "glass_cannon", cost: 550, fav: ["ignis", "orion", "kylen"] }
];

const TRAIT_KEYS = Object.keys(TRAITS);
const CHAMP_KEYS = Object.keys(CHAMPIONS);

function createRosterForTeam(teamIdx) {
  const names = PLAYER_NAMES[teamIdx] || ["Player1", "Player2", "Player3", "Sub1"];
  return names.map((name, pIdx) => {
    const c1 = CHAMP_KEYS[(teamIdx * 2 + pIdx) % CHAMP_KEYS.length];
    const c2 = CHAMP_KEYS[(teamIdx * 2 + pIdx + 3) % CHAMP_KEYS.length];
    const c3 = CHAMP_KEYS[(teamIdx * 2 + pIdx + 6) % CHAMP_KEYS.length];
    const mech = 72 + ((teamIdx * 3 + pIdx * 5) % 16);
    const ref = 70 + ((teamIdx * 5 + pIdx * 3) % 18);
    const tmw = 70 + ((teamIdx * 2 + pIdx * 7) % 15);
    const mnt = 74 + ((teamIdx * 4 + pIdx * 2) % 16);
    const ovr = Math.round((mech + ref + tmw + mnt) / 4);
    return {
      playerId: `p_${teamIdx}_${pIdx}`,
      name,
      condition: 88 + ((teamIdx + pIdx) % 10),
      slump: false,
      salary: pIdx < 3 ? 65 + Math.max(0, ovr - 70) * 2 : 45,
      stats: {
        mechanics: mech,
        reflex: ref,
        teamwork: tmw,
        mental: mnt
      },
      trait: TRAIT_KEYS[(teamIdx + pIdx) % TRAIT_KEYS.length],
      mastery: {
        [c1]: 3,
        [c2]: 2,
        [c3]: 2
      },
      masteryXp: {
        [c1]: 0,
        [c2]: 0,
        [c3]: 0
      }
    };
  });
}

function createInitialFAPool() {
  return FA_PRESETS.map((fa, idx) => ({
    playerId: `fa_${idx}_${Date.now().toString().slice(-4)}`,
    name: fa.name,
    condition: 94,
    slump: false,
    salary: 75,
    stats: { ...fa.stats },
    trait: fa.trait,
    cost: fa.cost,
    mastery: {
      [fa.fav[0]]: 3,
      [fa.fav[1]]: 2,
      [fa.fav[2]]: 2
    },
    masteryXp: {}
  }));
}

export const ROUTINE_ACTIVITIES = Object.freeze({
  SOLO_GRIND: {
    id: "SOLO_GRIND",
    name: "개인 집중 훈련",
    short: "집중훈련",
    desc: "지정 집중 스탯 +2 · 컨디션 -8%",
    icon: "🎯"
  },
  TEAM_SCRIM: {
    id: "TEAM_SCRIM",
    name: "팀 합숙 스크림",
    short: "팀스크림",
    desc: "주전 숙련도 XP +25 · 컨디션 -10%",
    icon: "⚔️"
  },
  STREAMING: {
    id: "STREAMING",
    name: "개인 방송·팬미팅",
    short: "팬방송",
    desc: "구단 자금 +150G · 컨디션 -5%",
    icon: "📺"
  },
  REST_CARE: {
    id: "REST_CARE",
    name: "휴식·멘탈 케어",
    short: "휴식케어",
    desc: "전원 컨디션 +18% · 유리멘탈 해제",
    icon: "☕"
  }
});

export const FACILITY_DEFS = Object.freeze({
  trainingCenter: {
    key: "trainingCenter",
    name: "트레이닝 센터",
    bonusDesc: "레벨당 개인 스탯 훈련 효율 +15%",
    baseCost: 500,
    maxLevel: 5
  },
  analyticsLab: {
    key: "analyticsLab",
    name: "전력분석 연구소",
    bonusDesc: "레벨당 숙련도 XP +15% · 감독 통찰 +5%",
    baseCost: 550,
    maxLevel: 5
  },
  medicalBay: {
    key: "medicalBay",
    name: "메디컬 베이",
    bonusDesc: "레벨당 컨디션 회복 +15%",
    baseCost: 480,
    maxLevel: 5
  }
});

export const SPONSOR_CONTRACTS = [
  {
    id: "sponsor_orb_hunter",
    name: "넥서스 에너지 (오브 헌터)",
    badge: "ORB",
    conditionDesc: "매치당 중앙 오브 3회 이상 파괴",
    bonusGold: 350,
    targetKey: "orbsDestroyed",
    targetValue: 3
  },
  {
    id: "sponsor_iron_shield",
    name: "이지스 방산 (철벽의 방패)",
    badge: "COUNTER",
    conditionDesc: "매치당 반격 4회 이상 성공",
    bonusGold: 300,
    targetKey: "countersLanded",
    targetValue: 4
  },
  {
    id: "sponsor_victory_roar",
    name: "하이퍼 기어 (승리의 함성)",
    badge: "WIN",
    conditionDesc: "매치 승리 시 즉시 승리 보너스",
    bonusGold: 400,
    targetKey: "matchWin",
    targetValue: 1
  }
];

export function getSponsorById(sponsorId) {
  return SPONSOR_CONTRACTS.find((s) => s.id === sponsorId) || SPONSOR_CONTRACTS[0];
}

export function computeRoundPayroll(seat) {
  if (!seat) return 320;
  const rosterSalary = (seat.roster || []).reduce((sum, p) => sum + Number(p.salary || 60), 0);
  const coachRoundPay = Math.round(Number(seat.headCoach?.salary || 320) * 0.35);
  return rosterSalary + coachRoundPay;
}

export function getHeadCoachById(coachId) {
  return HEAD_COACHES.find((c) => c.id === coachId) || HEAD_COACHES[0];
}

export function createDefaultBanPickNote(seatIdx = 0) {
  const presets = [
    { mustBans: ["nyx", "frost"], priorityPicks: ["kylen", "orion"], counterStrategy: "AUTO_COUNTER", ritePreference: "ORB", autoCallTrigger: "ORB_SPAWN" },
    { mustBans: ["orion", "sylvia"], priorityPicks: ["balrog", "ignis"], counterStrategy: "DIVE_COMP", ritePreference: "SURVIVAL", autoCallTrigger: "LOW_HP_DEFENSE" },
    { mustBans: ["kylen", "nyx"], priorityPicks: ["sylvia", "vex"], counterStrategy: "POKE_CONTROL", ritePreference: "ORB", autoCallTrigger: "ORB_SPAWN" },
    { mustBans: ["balrog", "titan"], priorityPicks: ["ignis", "shade"], counterStrategy: "DIVE_COMP", ritePreference: "ENERGY", autoCallTrigger: "EARLY_EX_RUSH" },
    { mustBans: ["vex", "sylvia"], priorityPicks: ["orion", "frost"], counterStrategy: "POKE_CONTROL", ritePreference: "ENERGY", autoCallTrigger: "EARLY_EX_RUSH" },
    { mustBans: ["ignis", "kylen"], priorityPicks: ["lyra", "solaris"], counterStrategy: "PROTECT_CARRY", ritePreference: "COUNTER", autoCallTrigger: "LOW_HP_DEFENSE" }
  ];
  const base = presets[seatIdx % presets.length] || presets[0];
  return {
    mustBans: [...base.mustBans],
    priorityPicks: [...base.priorityPicks],
    counterStrategy: base.counterStrategy,
    ritePreference: base.ritePreference,
    autoCallTrigger: base.autoCallTrigger
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || "atm");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 100001;
}

export function createSeededRng(seed) {
  let a = (Number(seed) >>> 0) || 100001;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextRandom(state) {
  if (!state || !state.combat) return Math.random();
  let a = ((Number(state.combat.rngState) >>> 0) || 100001);
  a = (a + 0x6D2B79F5) >>> 0;
  state.combat.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function computeRoundScheduledAt(baseTimeMs, roundIndex, scheduleMode = SCHEDULE_MODES.REALTIME_DAILY) {
  const base = Number(baseTimeMs || Date.now());
  if (scheduleMode === SCHEDULE_MODES.INSTANT_TEST) {
    return base;
  }
  if (scheduleMode === SCHEDULE_MODES.HOURLY_BLITZ) {
    const d = new Date(base);
    d.setMinutes(0, 0, 0);
    return d.getTime() + (roundIndex + 1) * 3600000;
  }
  // REALTIME_DAILY: 매일 로컬 21:00 기준 (월~금 정규 1~5R, 토 4강, 일 결승)
  const d = new Date(base);
  const firstSlot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 0, 0, 0);
  if (firstSlot.getTime() <= base) {
    firstSlot.setDate(firstSlot.getDate() + 1);
  }
  return firstSlot.getTime() + roundIndex * 86400000;
}

function buildInitialSchedule(seatCount = 6, baseTimeMs = Date.now(), scheduleMode = SCHEDULE_MODES.REALTIME_DAILY, roomSeed = "4821") {
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

export function createInitialState(roomCode = "", scheduleMode = SCHEDULE_MODES.REALTIME_DAILY, roomMode = ROOM_MODES.LEAGUE_6P) {
  const code = roomCode ? String(roomCode) : String(Math.floor(1000 + Math.random() * 9000));
  const nowMs = Date.now();
  const validMode = SCHEDULE_MODES[scheduleMode] || SCHEDULE_MODES.REALTIME_DAILY;
  const validRoomMode = ROOM_MODES[roomMode] || ROOM_MODES.LEAGUE_6P;
  const isArcade = validRoomMode === ROOM_MODES.ARCADE_2P;

  const basePresets = isArcade
    ? [
        { teamName: "블루 아케인 (Blue Arcane)", teamColor: "#38bdf8", coachName: "Blue Challenger", isAI: false },
        { teamName: "레드 크림슨 (Red Crimson)", teamColor: "#f43f5e", coachName: "Red Rival AI", isAI: true }
      ]
    : TEAM_PRESETS;

  const seats = basePresets.map((preset, idx) => {
    const coach = HEAD_COACHES[idx % HEAD_COACHES.length];
    const sponsor = SPONSOR_CONTRACTS[idx % SPONSOR_CONTRACTS.length];
    const roster = createRosterForTeam(idx);
    const seatObj = {
      seatIndex: idx,
      teamId: `team_${idx}`,
      teamName: preset.teamName,
      teamColor: preset.teamColor,
      gmName: preset.isAI ? `GM #${idx + 1}` : preset.coachName,
      coachName: isArcade ? preset.coachName : coach.name,
      headCoachId: coach.id,
      headCoach: { ...coach, stats: { ...coach.stats } },
      banPickNote: createDefaultBanPickNote(idx),
      isAI: preset.isAI,
      ready: false,
      ap: 2,
      maxAp: 2,
      funds: 3000,
      inDebt: false,
      roundPayroll: 0,
      sponsorId: sponsor.id,
      sponsorContract: { ...sponsor },
      facilities: {
        trainingCenter: 1,
        analyticsLab: 1,
        medicalBay: 1
      },
      autoSchedule: {
        MORNING: "SOLO_GRIND",
        AFTERNOON: "TEAM_SCRIM",
        NIGHT: "REST_CARE",
        focusStat: "mechanics",
        lastTickAt: nowMs
      },
      lastSettlement: null,
      wins: 0,
      losses: 0,
      setWins: 0,
      setLosses: 0,
      roster
    };
    seatObj.roundPayroll = computeRoundPayroll(seatObj);
    return seatObj;
  });

  return {
    version: 1,
    roomCode: code,
    roomMode: validRoomMode,
    localSeatIndex: 0,
    screen: SCREEN_STATES.LOBBY,
    seasonNumber: 1,
    week: 1,
    maxWeeks: 5,
    scheduleMode: isArcade ? SCHEDULE_MODES.INSTANT_TEST : validMode,
    seasonBaseTimeMs: nowMs,
    liveOverride: isArcade,
    patchVersion: "1.0",
    patchNotes: [],
    hallOfFame: [],
    stoveRookies: [],
    latestDailyNews: null,
    dailyNewsHistory: [],
    seats,
    faPool: createInitialFAPool(),
    schedule: isArcade ? [] : buildInitialSchedule(6, nowMs, validMode, code),
    activeMatch: {
      callEvents: [],
      ritePicks: { blue: null, red: null },
      boxscore: null,
      rematchCount: 0,
      setHistory: []
    },
    playoffs: {
      active: false,
      round: "SEMI_1",
      seeds: [0, 1, 2, 3],
      semi1: {
        homeSeat: 0,
        awaySeat: 3,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: computeRoundScheduledAt(nowMs, 5, validMode),
        matchSeed: hashSeed(`${code}_po_semi1`)
      },
      semi2: {
        homeSeat: 1,
        awaySeat: 2,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: computeRoundScheduledAt(nowMs, 5, validMode),
        matchSeed: hashSeed(`${code}_po_semi2`)
      },
      final: {
        homeSeat: null,
        awaySeat: null,
        homeSets: 0,
        awaySets: 0,
        winnerSeat: null,
        scheduledAt: computeRoundScheduledAt(nowMs, 6, validMode),
        matchSeed: hashSeed(`${code}_po_final`)
      },
      championSeat: null
    },
    vodPayloads: {},
    preferredMapId: "AUTO",
    activeSeries: {
      matchId: isArcade ? "arcade_m1" : "w1_m0",
      seriesMode: isArcade ? "ARCADE_2P" : "LEAGUE",
      bestOf: 3,
      currentSet: 1,
      matchSeed: hashSeed(`${code}_w1_m0`),
      isReplay: false,
      replayMatchId: null,
      coachLogs: [],
      telemetry: {
        blue: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
        red: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
        mvpUnit: null
      },
      selectedMapId: "starlight_sanctum",
      mapId: "starlight_sanctum",
      blueSeat: 0,
      redSeat: 1,
      blueWins: 0,
      redWins: 0,
      draft: {
        phase: "BAN_BLUE",
        stepIndex: 0,
        blueBans: [],
        redBans: [],
        bluePicks: ["kylen", "sylvia", "orion"],
        redPicks: ["balrog", "nyx", "lyra"]
      },
      blueRites: [],
      redRites: [],
      riteOptions: []
    },
    combat: {
      rngState: 100001,
      running: false,
      paused: false,
      speedMult: 1,
      duration: TEMPO_CONFIG.roundDuration,
      elapsed: 0.0,
      timer: TEMPO_CONFIG.roundDuration,
      suddenDeath: false,
      suddenDeathTime: TEMPO_CONFIG.suddenDeathTime,
      winnerTeam: null,
      matchTelemetry: {
        blue: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
        red: { orbsDestroyed: 0, countersLanded: 0, totalDamage: 0 },
        mvpUnit: null
      },
      arena: {
        width: 360,
        height: 420,
        centerX: 180,
        centerY: 210,
        safeRadius: 175,
        minRadius: 55,
        mapId: "starlight_sanctum",
        mapName: "성운의 성소",
        pillars: [],
        shrines: [],
        hazards: []
      },
      hitstopTimer: 0,
      hitstopFrames: 0,
      shakeTimer: 0,
      shakeFrames: 0,
      orb: {
        active: false,
        x: 180,
        y: 210,
        hp: 60,
        maxHp: 60,
        radius: 18,
        respawnTimer: TEMPO_CONFIG.orbSpawnInterval,
        spawnInterval: TEMPO_CONFIG.orbSpawnInterval
      },
      fighters: [],
      projectiles: [],
      effects: [],
      decoys: [],
      coachCalls: {
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
      },
      tickerLogs: []
    }
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function getChampionById(champId) {
  return CHAMPIONS[champId] || CHAMPIONS.kylen;
}

export function getRiteById(riteId) {
  return RITE_CARDS.find((r) => r.id === riteId) || RITE_CARDS[0];
}
