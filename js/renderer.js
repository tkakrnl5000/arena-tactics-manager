/**
 * js/renderer.js
 * 순수 HTML5 Canvas 2D 읽기 전용 렌더러 (360x420 논리 좌표).
 * 다크 택티컬 e스포츠 방송 + 2D 픽셀/기하학 하이브리드 아레나.
 *
 * 원칙:
 *  - state는 절대 변경하지 않는다 (Zero game-state mutations).
 *  - 히트스톱 지터, 카메라 쉐이크, 잔상, 데미지 팝업, 파티클, 잔여 체력바 등
 *    모든 연출은 이 모듈 내부의 로컬 시각 상태(VisualState)가
 *    이전 프레임과 현재 프레임의 state 차이를 감지해 독립적으로 처리한다.
 *  - engine.js의 실제 게임 틱은 절대 멈추거나 늦추지 않는다.
 */

import { getArenaMapById, getChampionById } from "./state.js";

/* ------------------------------------------------------------------ */
/* 1. 팔레트 & 챔피언 스킨 매핑 (프레젠테이션 전용)                    */
/* ------------------------------------------------------------------ */

const PALETTE = {
  bg: "#0B0F17",
  panel: "#131A26",
  line: "#243044",
  outline: "#0B0F17",
  blue: "#38BDF8",
  red: "#F43F5E",
  gold: "#F59E0B",
  crit: "#FACC15",
  heal: "#10B981",
  white: "#F8FAFC"
};

/**
 * 챔피언별 시그니처 배색 & 실루엣 파츠.
 * body: 동체 / trim: 갑주 트림 / accent: 무기·디테일 / core: 에너지 코어 / cape: 망토
 */
const CHAMP_SKINS = {
  kylen: {
    body: "#3B5270", trim: "#F59E0B", accent: "#E2E8F0", core: "#FDE68A",
    cape: "#B91C1C", hair: "#F8FAFC", eye: "#FDE047", skin: "#F1C7A5",
    weapon: "KATANA", arch: "SAMURAI", scale: 1.04
  },
  sylvia: {
    body: "#0F6B4E", trim: "#D97706", accent: "#34D399", core: "#A7F3D0",
    cape: "#064E3B", hair: "#A16207", eye: "#34D399", skin: "#F3D2B8",
    weapon: "BOW", arch: "RANGER", scale: 0.96
  },
  orion: {
    body: "#1E3A8A", trim: "#F59E0B", accent: "#93C5FD", core: "#FFFFFF",
    cape: "#172554", hair: "#C7D2FE", eye: "#60A5FA", skin: "#C7D2FE",
    weapon: "ORB_STAFF", arch: "ASTRAL", scale: 1.00
  },
  balrog: {
    body: "#7F1D1D", trim: "#F97316", accent: "#FDBA74", core: "#FB923C",
    cape: "#450A0A", hair: "#292524", eye: "#FACC15", skin: "#9A3412",
    weapon: "SHIELD_AXE", arch: "JUGGERNAUT", scale: 1.24
  },
  nyx: {
    body: "#1E1B2E", trim: "#8B5CF6", accent: "#C4B5FD", core: "#A78BFA",
    cape: "#3B0764", hair: "#0F172A", eye: "#C084FC", skin: "#D4C2B2",
    weapon: "DAGGERS", arch: "SHINOBI", scale: 0.94
  },
  ignis: {
    body: "#991B1B", trim: "#F59E0B", accent: "#FCD34D", core: "#FDE047",
    cape: "#7C2D12", hair: "#F97316", eye: "#FEF08A", skin: "#57241B",
    weapon: "FLAME_HANDS", arch: "PYRO", scale: 0.98
  },
  vex: {
    body: "#334155", trim: "#06B6D4", accent: "#67E8F9", core: "#22D3EE",
    cape: "#1E293B", hair: "#FDE047", eye: "#22D3EE", skin: "#F1C7A5",
    weapon: "RIFLE", arch: "GUNNER", scale: 0.96
  },
  lyra: {
    body: "#9D2E54", trim: "#FEF3C7", accent: "#FDA4AF", core: "#FFE4E6",
    cape: "#6B1D3B", hair: "#FBCFE8", eye: "#FDE68A", skin: "#F8D8C8",
    weapon: "SCEPTER", arch: "PRIESTESS", scale: 0.95
  },
  solaris: {
    body: "#92400E", trim: "#FDE047", accent: "#FEF3C7", core: "#FFFBEB",
    cape: "#D97706", hair: "#FEF08A", eye: "#FFFBEB", skin: "#EAB68B",
    weapon: "LANCE_SHIELD", arch: "PALADIN", scale: 1.08
  },
  titan: {
    body: "#475569", trim: "#94A3B8", accent: "#2DD4BF", core: "#5EEAD4",
    cape: "#1E293B", hair: "#334155", eye: "#2DD4BF", skin: "#64748B",
    weapon: "GAUNTLET", arch: "GOLEM", scale: 1.28
  },
  shade: {
    body: "#2E2459", trim: "#14B8A6", accent: "#5EEAD4", core: "#99F6E4",
    cape: "#171133", hair: "#0F172A", eye: "#2DD4BF", skin: "#CBD5E1",
    weapon: "SCYTHE", arch: "REAPER", scale: 1.03
  },
  frost: {
    body: "#0369A1", trim: "#E0F2FE", accent: "#7DD3FC", core: "#F0F9FF",
    cape: "#0C4A6E", hair: "#E0F2FE", eye: "#BAE6FD", skin: "#F3E8EE",
    weapon: "ICE_STAFF", arch: "CRYO", scale: 0.97
  }
};

function getSkin(f) {
  return (
    CHAMP_SKINS[f.champId] || {
      body: f.color || "#475569",
      trim: "#CBD5E1",
      accent: "#E2E8F0",
      core: "#FFFFFF",
      cape: "#1B2433",
      hair: "#E2E8F0",
      eye: "#38BDF8",
      skin: "#F1C7A5",
      weapon: "KATANA",
      arch: "SAMURAI",
      scale: 1.0
    }
  );
}

function teamColor(team) {
  return team === "red" ? PALETTE.red : PALETTE.blue;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* 2. 로컬 시각 상태 (VisualState) — state 변이 없이 프레임 차분 추적   */
/* ------------------------------------------------------------------ */

export class ArenaRenderer {
  constructor() {
    this.bgCache = null;
    this.bgKey = "";
    this.hazardPattern = null;
    this.lastNow = 0;
    this.clock = 0;
    this.dt = 0;
    this.reset("");
  }

  reset(rosterSig) {
    this.rosterSig = rosterSig;
    this.lastElapsed = 0;
    this.fighters = new Map();
    this.projectileTrails = new Map();
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.shake = 0;
    this.orbWasActive = null;
  }

  addShake(amount) {
    this.shake = Math.min(9, Math.max(this.shake, amount));
  }

  spawnPopup(x, y, text, color, size, life) {
    this.popups.push({ x, y, text, color, size, life, max: life });
    if (this.popups.length > 40) this.popups.shift();
  }

  spawnRing(x, y, r0, r1, color, width, life) {
    this.rings.push({ x, y, r0, r1, color, width, life, max: life });
    if (this.rings.length > 30) this.rings.shift();
  }

  spawnParticle(p) {
    this.particles.push(p);
    if (this.particles.length > 280) this.particles.shift();
  }

  burst(x, y, count, colors, speed = 120, life = 0.4, size = 2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * rand(0.35, 1);
      this.spawnParticle({
        kind: "spark",
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * rand(0.6, 1),
        max: life,
        size: size * rand(0.7, 1.3),
        color: colors[i % colors.length],
        drag: 5,
        gravity: 0
      });
    }
  }

  smoke(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawnParticle({
        kind: "smoke",
        x: x + Math.cos(a) * rand(0, 8),
        y: y + Math.sin(a) * rand(0, 8),
        vx: Math.cos(a) * rand(10, 35),
        vy: Math.sin(a) * rand(10, 35) - 8,
        life: rand(0.45, 0.75),
        max: 0.75,
        size: rand(5, 9),
        color,
        drag: 2.5,
        gravity: 0
      });
    }
  }

  /**
   * 해저드 사선 스트라이프 패턴 (1회 캐싱)
   */
  getHazardPattern(ctx) {
    if (this.hazardPattern) return this.hazardPattern;
    if (typeof document === "undefined") return null;
    const tile = document.createElement("canvas");
    tile.width = 12;
    tile.height = 12;
    const t = tile.getContext("2d");
    if (!t) return null;
    t.fillStyle = "rgba(244, 63, 94, 0.0)";
    t.fillRect(0, 0, 12, 12);
    t.fillStyle = "rgba(244, 63, 94, 0.32)";
    // 픽셀 사선 스트라이프 (안티앨리어싱 없는 1px 블록)
    for (let i = 0; i < 12; i++) {
      t.fillRect(i, (12 - i) % 12, 1, 3);
    }
    this.hazardPattern = ctx.createPattern(tile, "repeat");
    return this.hazardPattern;
  }

  /**
   * 정적 아레나 배경을 맵 ID별로 오프스크린 캔버스에 캐싱한다.
   */
  getBackground(width, height, cx, cy, mapId = "starlight_sanctum") {
    const key = `${mapId}:${width}x${height}@${cx},${cy}@2x`;
    if (this.bgCache && this.bgKey === key) return this.bgCache;
    if (typeof document === "undefined") return null;

    const cvs = document.createElement("canvas");
    cvs.width = width * 2;
    cvs.height = height * 2;
    const g = cvs.getContext("2d");
    if (!g) return null;
    g.scale(2, 2);
    buildArenaBackground(g, width, height, cx, cy, mapId);
    this.bgCache = cvs;
    this.bgKey = key;
    return cvs;
  }

  /**
   * 이전 프레임과 현재 프레임의 state 차이를 감지해 연출 이벤트를 발생시킨다.
   */
  sync(state) {
    const combat = state.combat;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    let dt = this.lastNow ? (now - this.lastNow) / 1000 : 0;
    this.lastNow = now;
    dt = clamp(dt, 0, 0.05);
    if (combat.paused) dt = 0;
    dt *= combat.speedMult || 1;
    this.dt = dt;
    this.clock += dt;

    // 라운드 재시작 / 조합 변경 감지 시 시각 상태 초기화
    const sig = combat.fighters.map((f) => `${f.unitId}:${f.champId}`).join("|");
    if (sig !== this.rosterSig || combat.elapsed + 0.25 < this.lastElapsed) {
      this.reset(sig);
    }
    this.lastElapsed = combat.elapsed;

    this.syncFighters(combat, dt);
    this.syncProjectiles(combat, dt);
    this.syncOrb(combat);
    this.stepSimulations(dt);
  }

  syncFighters(combat, dt) {
    for (const f of combat.fighters) {
      let fv = this.fighters.get(f.unitId);
      if (!fv) {
        fv = {
          hp: f.hp,
          ghostHp: f.hp,
          ghostHold: 0,
          flash: 0,
          flashColor: "#FFFFFF",
          jitter: 0,
          recoil: 0,
          alive: f.alive,
          stun: f.stunTimer > 0,
          energy: f.energy,
          counters: f.countersTriggered || 0,
          stealth: f.stealthTimer > 0,
          dashing: f.dashTimer > 0,
          afterTimer: 0,
          afterimages: [],
          fxTimer: 0,
          deathTime: 0,
          visualFacing: f.facing || 0,
          prevX: f.x,
          prevY: f.y,
          stridePhase: Math.random() * Math.PI * 2,
          moveSpeed: 0,
          dustTimer: 0,
          prevM1: f.cds?.m1 || 0,
          prevM2: f.cds?.m2 || 0,
          prevEx: f.cds?.ex || 0,
          swingTimer: 0,
          swingDur: 0.24,
          swingType: "M1"
        };
        this.fighters.set(f.unitId, fv);
      }

      // 부드러운 방향 보간 및 이동 보폭 계산
      if (dt > 0 && f.alive) {
        let diff = (f.facing || 0) - fv.visualFacing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        fv.visualFacing += diff * Math.min(1, dt * 16);

        const moved = Math.hypot(f.x - fv.prevX, f.y - fv.prevY);
        fv.moveSpeed = moved / Math.max(0.001, dt);
        if (moved > 0.2 && moved < 45) {
          fv.stridePhase += moved * 0.32;
          fv.dustTimer -= dt;
          if (fv.dustTimer <= 0 && fv.moveSpeed > 55) {
            fv.dustTimer = 0.18;
            this.spawnParticle({
              kind: "smoke",
              x: f.x - Math.cos(fv.visualFacing) * f.radius * 0.5,
              y: f.y + f.radius * 0.55,
              vx: rand(-10, 10),
              vy: rand(-6, 4),
              life: 0.28,
              max: 0.28,
              size: 2.6,
              color: "rgba(148, 163, 184, 0.28)",
              drag: 4,
              gravity: 0
            });
          }
        }
      }
      fv.prevX = f.x;
      fv.prevY = f.y;

      // 스킬/공격 발동 시 무기 스윙 모션 감지
      const curM1 = f.cds?.m1 || 0;
      const curM2 = f.cds?.m2 || 0;
      const curEx = f.cds?.ex || 0;
      if (f.alive && dt > 0) {
        if (curEx > fv.prevEx + 0.15) {
          fv.swingTimer = 0.30;
          fv.swingDur = 0.30;
          fv.swingType = "EX";
        } else if (curM2 > fv.prevM2 + 0.25) {
          fv.swingTimer = 0.26;
          fv.swingDur = 0.26;
          fv.swingType = "M2";
        } else if (curM1 > fv.prevM1 + 0.12) {
          fv.swingTimer = 0.20;
          fv.swingDur = 0.20;
          fv.swingType = "M1";
        }
      }
      fv.prevM1 = curM1;
      fv.prevM2 = curM2;
      fv.prevEx = curEx;

      const skin = getSkin(f);
      const dmg = fv.hp - f.hp;

      // (a) 피격 감지: HP 감소 → 히트 플래시 + 반동 + 데미지 팝업 + 파티클
      if (dmg >= 1 && fv.alive) {
        fv.recoil = 0.14;
        const crit = dmg >= 95;
        fv.flash = crit ? 0.06 : 0.04;
        fv.flashColor = crit ? PALETTE.red : "#FFFFFF";
        fv.ghostHold = 0.32;
        this.spawnPopup(
          f.x + rand(-7, 7),
          f.y - f.radius - 8,
          crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`,
          crit ? PALETTE.crit : PALETTE.white,
          crit ? 15 : 11,
          crit ? 0.9 : 0.65
        );
        this.burst(f.x, f.y, crit ? 14 : 6, crit ? [PALETTE.crit, "#FFFFFF", PALETTE.red] : ["#FFFFFF", skin.accent], crit ? 170 : 110, 0.35, crit ? 2.4 : 1.8);
        if (crit) {
          fv.jitter = 0.05;
          this.addShake(3.5);
        }
      }
      if (f.hp > fv.ghostHp) fv.ghostHp = f.hp;

      // (b) 킬 감지
      if (fv.alive && !f.alive) {
        fv.jitter = 0.06;
        fv.deathTime = this.clock;
        this.addShake(6);
        this.burst(f.x, f.y, 24, [teamColor(f.team), PALETTE.crit, "#FFFFFF"], 200, 0.6, 2.6);
        this.spawnRing(f.x, f.y, 8, 52, PALETTE.crit, 3, 0.45);
      }

      // (c) 궁극기 감지: 에너지 100 → 급감
      if (f.alive && fv.energy >= 99 && f.energy < 20) {
        fv.jitter = 0.04;
        this.addShake(4.5);
        this.spawnRing(f.x, f.y, 10, 80, PALETTE.gold, 3.5, 0.55);
        this.burst(f.x, f.y, 16, [PALETTE.gold, PALETTE.crit], 160, 0.5, 2.2);
      }

      // (d) 기절 진입
      if (!fv.stun && f.stunTimer > 0 && f.alive) {
        this.spawnPopup(f.x, f.y - f.radius - 20, "STUN", PALETTE.crit, 10, 0.7);
      }

      // (e) 반격(Counter) 성공
      if ((f.countersTriggered || 0) > fv.counters) {
        this.spawnPopup(f.x, f.y - f.radius - 22, "COUNTER!", PALETTE.gold, 13, 0.85);
        this.addShake(3);
        this.spawnRing(f.x, f.y, 6, 46, PALETTE.blue, 2.5, 0.35);
        this.burst(f.x, f.y, 12, [PALETTE.gold, PALETTE.blue, "#FFFFFF"], 180, 0.4, 2);
      }

      // (f) 은신 진입 / 그림자 계열 대시 → 스모크
      if (!fv.stealth && f.stealthTimer > 0) {
        this.smoke(f.x, f.y, 10, "rgba(76, 64, 110, 0.55)");
      }
      if (!fv.dashing && f.dashTimer > 0 && (f.champId === "nyx" || f.champId === "shade")) {
        this.smoke(f.x, f.y, 7, "rgba(60, 55, 90, 0.5)");
      }

      // (g) 대시 잔상 (Afterimage)
      if (f.alive && f.dashTimer > 0 && dt > 0) {
        fv.afterTimer -= dt;
        if (fv.afterTimer <= 0) {
          fv.afterTimer = 0.026;
          fv.afterimages.push({ x: f.x, y: f.y, facing: f.facing, life: 0.22, max: 0.22 });
          if (fv.afterimages.length > 8) fv.afterimages.shift();
        }
      }
      for (const a of fv.afterimages) a.life -= dt;
      fv.afterimages = fv.afterimages.filter((a) => a.life > 0);

      // (h) 시그니처 상시 파티클 (이그니스 불티, 프로스트 빙결 입자)
      if (f.alive && dt > 0) {
        fv.fxTimer -= dt;
        if (fv.fxTimer <= 0) {
          if (f.champId === "ignis") {
            fv.fxTimer = 0.07;
            this.spawnParticle({
              kind: "ember",
              x: f.x + rand(-9, 9),
              y: f.y + rand(-4, 6),
              vx: rand(-10, 10),
              vy: rand(-45, -25),
              life: rand(0.4, 0.7),
              max: 0.7,
              size: rand(1.2, 2.2),
              color: Math.random() < 0.5 ? "#FBBF24" : "#F97316",
              drag: 1,
              gravity: -10
            });
          } else if (f.champId === "frost") {
            fv.fxTimer = 0.16;
            this.spawnParticle({
              kind: "shard",
              x: f.x + rand(-12, 12),
              y: f.y + rand(-12, 12),
              vx: rand(-6, 6),
              vy: rand(-12, -4),
              life: 0.6,
              max: 0.6,
              size: 1.6,
              color: "#E0F2FE",
              drag: 1,
              gravity: 0
            });
          } else {
            fv.fxTimer = 0.3;
          }
        }
      }

      // (i) 잔여 데미지 바(흰색) 지연 감소
      if (fv.ghostHold > 0) {
        fv.ghostHold -= dt;
      } else if (fv.ghostHp > f.hp) {
        const step = Math.max(f.maxHp * 0.6 * dt, (fv.ghostHp - f.hp) * 5 * dt);
        fv.ghostHp = Math.max(f.hp, fv.ghostHp - step);
      }

      fv.flash = Math.max(0, fv.flash - dt);
      fv.jitter = Math.max(0, fv.jitter - dt);
      fv.recoil = Math.max(0, fv.recoil - dt);
      fv.swingTimer = Math.max(0, fv.swingTimer - dt);

      fv.hp = f.hp;
      fv.alive = f.alive;
      fv.stun = f.stunTimer > 0;
      fv.energy = f.energy;
      fv.counters = f.countersTriggered || 0;
      fv.stealth = f.stealthTimer > 0;
      fv.dashing = f.dashTimer > 0;
    }
  }

  syncProjectiles(combat, dt) {
    const activeIds = new Set();
    const fighterMap = new Map();
    for (const f of combat.fighters) fighterMap.set(f.unitId, f);

    for (const proj of combat.projectiles) {
      const pid = String(proj.id);
      activeIds.add(pid);
      let entry = this.projectileTrails.get(pid);
      if (!entry) {
        const owner = fighterMap.get(proj.ownerId);
        const isEx =
          proj.radius >= 11 ||
          Boolean(proj.isReflected) ||
          pid.startsWith("riposte_") ||
          Boolean(owner && owner.state === "EX");
        entry = {
          points: [],
          isEx,
          champId: owner ? owner.champId : "",
          startX: proj.x,
          startY: proj.y
        };
        this.projectileTrails.set(pid, entry);
      }
      const pts = entry.points;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(proj.x - last.x, proj.y - last.y) >= 1.2) {
        pts.push({ x: proj.x, y: proj.y });
        if (pts.length > 8) pts.shift();
      }

      // 투사체 시그니처 파티클
      if (dt > 0) {
        if (entry.champId === "ignis" && Math.random() < 0.6) {
          this.spawnParticle({
            kind: "ember",
            x: proj.x + rand(-3, 3),
            y: proj.y + rand(-3, 3),
            vx: -proj.vx * 0.05 + rand(-15, 15),
            vy: -proj.vy * 0.05 + rand(-15, 15),
            life: 0.3,
            max: 0.3,
            size: rand(1.2, 2),
            color: Math.random() < 0.5 ? "#FBBF24" : "#EF4444",
            drag: 3,
            gravity: -20
          });
        } else if (entry.champId === "frost" && Math.random() < 0.35) {
          this.spawnParticle({
            kind: "shard",
            x: proj.x,
            y: proj.y,
            vx: rand(-20, 20),
            vy: rand(-20, 20),
            life: 0.3,
            max: 0.3,
            size: 1.5,
            color: "#E0F2FE",
            drag: 4,
            gravity: 0
          });
        }
      }
    }

    for (const key of this.projectileTrails.keys()) {
      if (!activeIds.has(key)) {
        const entry = this.projectileTrails.get(key);
        const lp = entry.points[entry.points.length - 1];
        if (lp && dt > 0) {
          // 소멸 지점 임팩트 스파크
          this.burst(lp.x, lp.y, entry.isEx ? 10 : 4, entry.isEx ? [PALETTE.gold, "#FFFFFF"] : ["#FFFFFF"], 90, 0.25, 1.6);
        }
        this.projectileTrails.delete(key);
      }
    }
  }

  syncOrb(combat) {
    const orb = combat.orb;
    const active = Boolean(orb.active);
    if (this.orbWasActive === null) {
      this.orbWasActive = active;
      return;
    }
    if (active !== this.orbWasActive) {
      if (active) {
        this.spawnRing(orb.x, orb.y, 6, 60, PALETTE.gold, 2.5, 0.5);
      } else {
        this.spawnRing(orb.x, orb.y, 10, 90, PALETTE.crit, 3.5, 0.6);
        this.burst(orb.x, orb.y, 22, [PALETTE.gold, PALETTE.crit, "#FFFFFF"], 210, 0.6, 2.4);
        this.addShake(2.8);
      }
      this.orbWasActive = active;
    }
  }

  stepSimulations(dt) {
    if (dt <= 0) return;
    for (const p of this.particles) {
      p.life -= dt;
      const damp = Math.exp(-(p.drag || 0) * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const pp of this.popups) pp.life -= dt;
    this.popups = this.popups.filter((pp) => pp.life > 0);

    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);

    // 감쇠 카메라 쉐이크
    this.shake = Math.max(0, this.shake - dt * (this.shake * 9 + 1.5));
  }
}

const VS = new ArenaRenderer();

/* ------------------------------------------------------------------ */
/* 3. 정적 배경 빌드 (오프스크린 캐시)                                 */
/* ------------------------------------------------------------------ */

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const MAP_THEMES = {
  starlight_sanctum: {
    // Orman Temple — 사암 고대 유적 투기장
    outerBg: "#0d120e",
    wallTop: "#3a3528",
    wallSide: "#211d15",
    wallTrim: "#d4a857",
    floorBase: "#24211b",
    tileA: "#2c2820",
    tileB: "#1d1a15",
    tileC: "#26221c",
    seam: "rgba(212, 168, 87, 0.14)",
    rimOuter: "#4b4231",
    rimInner: "rgba(229, 184, 105, 0.45)",
    centerMark: "rgba(229, 184, 105, 0.42)",
    pillarBody: "#3f382b",
    pillarSide: "#252017",
    pillarCap: "#5c513e",
    pillarRune: "#22c55e",
    brazierCol: "#4ade80"
  },
  magma_forge: {
    // Blackstone Arena — 검투장 용암 투기장
    outerBg: "#0c0709",
    wallTop: "#332224",
    wallSide: "#191012",
    wallTrim: "#f97316",
    floorBase: "#1e171b",
    tileA: "#271d22",
    tileB: "#171115",
    tileC: "#21191e",
    seam: "rgba(249, 115, 22, 0.18)",
    rimOuter: "#4a2722",
    rimInner: "rgba(249, 115, 22, 0.45)",
    centerMark: "rgba(249, 115, 22, 0.45)",
    pillarBody: "#372729",
    pillarSide: "#1f1517",
    pillarCap: "#52383a",
    pillarRune: "#fb923c",
    brazierCol: "#f97316"
  },
  frost_citadel: {
    // Mount Araz — 설산 고원 석조 성소
    outerBg: "#070e16",
    wallTop: "#273b4f",
    wallSide: "#14212e",
    wallTrim: "#67e8f9",
    floorBase: "#14202c",
    tileA: "#1b2c3b",
    tileB: "#101924",
    tileC: "#172534",
    seam: "rgba(103, 232, 249, 0.16)",
    rimOuter: "#2b4963",
    rimInner: "rgba(103, 232, 249, 0.45)",
    centerMark: "rgba(103, 232, 249, 0.42)",
    pillarBody: "#274159",
    pillarSide: "#162738",
    pillarCap: "#3c6180",
    pillarRune: "#bae6fd",
    brazierCol: "#38bdf8"
  },
  void_nexus: {
    // Dragon Garden — 황실 청옥·진홍 정원 투기장
    outerBg: "#071012",
    wallTop: "#1f3a3d",
    wallSide: "#102124",
    wallTrim: "#2dd4bf",
    floorBase: "#132225",
    tileA: "#182d31",
    tileB: "#0f1c1f",
    tileC: "#15272b",
    seam: "rgba(45, 212, 191, 0.17)",
    rimOuter: "#284d52",
    rimInner: "rgba(45, 212, 191, 0.48)",
    centerMark: "rgba(245, 158, 11, 0.45)",
    pillarBody: "#224044",
    pillarSide: "#122427",
    pillarCap: "#2d575c",
    pillarRune: "#f59e0b",
    brazierCol: "#f59e0b"
  }
};

function traceColosseumPath(g, width, height, insetX, insetY, chamfer) {
  const x0 = insetX;
  const x1 = width - insetX;
  const y0 = insetY;
  const y1 = height - insetY;
  g.beginPath();
  g.moveTo(x0 + chamfer, y0);
  g.lineTo(x1 - chamfer, y0);
  g.lineTo(x1, y0 + chamfer);
  g.lineTo(x1, y1 - chamfer);
  g.lineTo(x1 - chamfer, y1);
  g.lineTo(x0 + chamfer, y1);
  g.lineTo(x0, y1 - chamfer);
  g.lineTo(x0, y0 + chamfer);
  g.closePath();
}

function getBrazierPoints(width, height) {
  return [
    { x: 52, y: 42 },
    { x: width - 52, y: 42 },
    { x: 52, y: height - 42 },
    { x: width - 52, y: height - 42 }
  ];
}

function buildArenaBackground(g, width, height, cx, cy, mapId = "starlight_sanctum") {
  const theme = MAP_THEMES[mapId] || MAP_THEMES.starlight_sanctum;
  const mapDef = getArenaMapById(mapId);

  // 바깥 투기장 석조 성곽 베이스
  g.fillStyle = theme.outerBg;
  g.fillRect(0, 0, width, height);

  // 외곽 성벽 입체 섀도우 & 두꺼운 성벽 림
  traceColosseumPath(g, width, height, 10, 8, 62);
  g.fillStyle = theme.wallSide;
  g.fill();
  g.strokeStyle = "#06080d";
  g.lineWidth = 3;
  g.stroke();

  traceColosseumPath(g, width, height, 14, 12, 58);
  g.fillStyle = theme.wallTop;
  g.fill();
  g.strokeStyle = theme.rimOuter;
  g.lineWidth = 2;
  g.stroke();

  // 성벽 상단 돌 블록 이음선
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.lineWidth = 1;
  for (let x = 80; x <= width - 80; x += 36) {
    g.beginPath();
    g.moveTo(x, 10);
    g.lineTo(x, 22);
    g.moveTo(x, height - 22);
    g.lineTo(x, height - 10);
    g.stroke();
  }

  // 경기장 내부 바닥 클리핑
  g.save();
  traceColosseumPath(g, width, height, 22, 20, 52);
  g.clip();

  g.fillStyle = theme.floorBase;
  g.fillRect(0, 0, width, height);

  // 배틀라이트식 대형 사각 석판 타일 패턴
  const P = 32;
  const ox = cx % P;
  const oy = cy % P;
  for (let py = -1; py < Math.ceil(height / P) + 1; py++) {
    for (let px = -1; px < Math.ceil(width / P) + 1; px++) {
      const x = ox + px * P;
      const y = oy + py * P;
      const n = hash2(px + 37, py + 83 + mapId.length * 11);
      g.fillStyle = n > 0.68 ? theme.tileA : n < 0.24 ? theme.tileB : theme.tileC;
      g.fillRect(x + 1, y + 1, P - 2, P - 2);
      // 미세 석재 균열 & 베벨 하이라이트
      g.fillStyle = "rgba(255, 255, 255, 0.03)";
      g.fillRect(x + 2, y + 2, P - 4, 1);
      if (n > 0.78) {
        g.strokeStyle = "rgba(0, 0, 0, 0.28)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + 6, y + 8);
        g.lineTo(x + 15, y + 16);
        g.lineTo(x + 19, y + 24);
        g.stroke();
      }
    }
  }

  // 타일 줄눈
  g.strokeStyle = theme.seam;
  g.lineWidth = 1;
  for (let x = ox; x < width; x += P) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, height);
    g.stroke();
  }
  for (let y = oy; y < height; y += P) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(width, y + 0.5);
    g.stroke();
  }

  // 맵별 바닥 고유 문양 & 이끼/균열/황실 장식
  if (mapId === "starlight_sanctum") {
    // Orman Temple: 이끼 패치 + 고대 원형 장식
    for (let i = 0; i < 8; i++) {
      const mx = 75 + hash2(i, 11) * (width - 150);
      const my = 60 + hash2(i, 29) * (height - 120);
      g.fillStyle = "rgba(34, 197, 94, 0.08)";
      g.beginPath();
      g.ellipse(mx, my, 18, 10, hash2(i, 3), 0, Math.PI * 2);
      g.fill();
    }
  } else if (mapId === "magma_forge") {
    // Blackstone Arena: 붉은 카펫 러너 & 용암 틈새
    g.fillStyle = "rgba(185, 28, 28, 0.14)";
    g.fillRect(28, cy - 26, width - 56, 52);
    g.strokeStyle = "rgba(249, 115, 22, 0.25)";
    g.lineWidth = 1.5;
    g.strokeRect(28, cy - 26, width - 56, 52);
  } else if (mapId === "frost_citadel") {
    // Mount Araz: 설산 빙하 결정 라인
    g.strokeStyle = "rgba(186, 230, 253, 0.14)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 230, cy + Math.sin(a) * 230);
      g.stroke();
    }
  } else if (mapId === "void_nexus") {
    // Dragon Garden: 진홍 황실 비단 대각 장식 + 연못 외곽
    g.strokeStyle = "rgba(245, 158, 11, 0.20)";
    g.lineWidth = 1.5;
    g.strokeRect(48, 44, width - 96, height - 88);
    g.strokeStyle = "rgba(45, 212, 191, 0.22)";
    g.setLineDash([5, 5]);
    g.beginPath();
    g.moveTo(110, 114);
    g.lineTo(410, 306);
    g.stroke();
    g.setLineDash([]);
  }

  // 좌우 팀 스폰 성문 아치 & 바닥 진영 틴트
  const blueTint = g.createLinearGradient(20, 0, 135, 0);
  blueTint.addColorStop(0, "rgba(56, 189, 248, 0.18)");
  blueTint.addColorStop(1, "rgba(56, 189, 248, 0)");
  g.fillStyle = blueTint;
  g.fillRect(20, cy - 115, 115, 230);

  const redTint = g.createLinearGradient(width - 20, 0, width - 135, 0);
  redTint.addColorStop(0, "rgba(244, 63, 94, 0.18)");
  redTint.addColorStop(1, "rgba(244, 63, 94, 0)");
  g.fillStyle = redTint;
  g.fillRect(width - 135, cy - 115, 115, 230);

  // 중앙 교전 대시 라인
  g.strokeStyle = "rgba(148, 163, 184, 0.14)";
  g.setLineDash([6, 6]);
  g.beginPath();
  g.moveTo(cx, 24);
  g.lineTo(cx, height - 24);
  g.stroke();
  g.setLineDash([]);

  // 상단 스포트라이트
  const spot = g.createRadialGradient(cx, cy - 25, 20, cx, cy, 260);
  spot.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  spot.addColorStop(0.65, "rgba(255, 255, 255, 0.01)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  g.fillStyle = spot;
  g.fillRect(0, 0, width, height);
  g.restore();

  // 경기장 내부 성벽 테두리 (입체 벽면 단차)
  traceColosseumPath(g, width, height, 22, 20, 52);
  g.strokeStyle = theme.wallSide;
  g.lineWidth = 4;
  g.stroke();
  traceColosseumPath(g, width, height, 22, 20, 52);
  g.strokeStyle = theme.rimInner;
  g.lineWidth = 1.4;
  g.stroke();

  // 좌우 철문 게이트 아치 (Blue / Red Spawn Gates)
  for (const gate of [
    { x: 16, col: "#38bdf8", dir: 1 },
    { x: width - 22, col: "#f43f5e", dir: -1 }
  ]) {
    g.fillStyle = "#0b0f17";
    g.fillRect(gate.x, cy - 58, 8, 116);
    g.strokeStyle = gate.col;
    g.lineWidth = 1.5;
    g.strokeRect(gate.x, cy - 58, 8, 116);
    for (let gy = cy - 46; gy <= cy + 46; gy += 18) {
      g.fillStyle = "rgba(226, 232, 240, 0.45)";
      g.fillRect(gate.x + 1, gy, 6, 2);
    }
  }

  // 중앙 오브 제단 (Battlerite Center Pedestal)
  g.beginPath();
  g.arc(cx, cy, 48, 0, Math.PI * 2);
  g.fillStyle = "rgba(0, 0, 0, 0.22)";
  g.fill();
  g.strokeStyle = theme.centerMark;
  g.lineWidth = 1.8;
  g.stroke();

  g.beginPath();
  g.arc(cx, cy, 32, 0, Math.PI * 2);
  g.strokeStyle = theme.rimInner;
  g.lineWidth = 1.2;
  g.setLineDash([4, 4]);
  g.stroke();
  g.setLineDash([]);

  // 8방향 제단 룬 눈금
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34);
    g.lineTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46);
    g.strokeStyle = theme.centerMark;
    g.lineWidth = i % 2 === 0 ? 2 : 1;
    g.stroke();
  }

  // 4모서리 코너 화로 석조 베이스
  for (const br of getBrazierPoints(width, height)) {
    g.beginPath();
    g.arc(br.x, br.y, 11, 0, Math.PI * 2);
    g.fillStyle = theme.wallSide;
    g.fill();
    g.strokeStyle = theme.wallTrim;
    g.lineWidth = 1.5;
    g.stroke();
    g.beginPath();
    g.arc(br.x, br.y, 6, 0, Math.PI * 2);
    g.fillStyle = "#090d14";
    g.fill();
  }

  // 상단 성벽 중앙 맵 영문 워터마크
  g.font = "800 8px ui-monospace, Consolas, monospace";
  g.textAlign = "center";
  g.fillStyle = "rgba(241, 245, 249, 0.42)";
  g.fillText(String(mapDef.subtitle || mapId).toUpperCase(), cx, 16);
}

function drawArenaBraziers(ctx, width, height, mapId) {
  const theme = MAP_THEMES[mapId] || MAP_THEMES.starlight_sanctum;
  for (const br of getBrazierPoints(width, height)) {
    const flicker = 1 + Math.sin(VS.clock * 11 + br.x) * 0.16;
    const glow = ctx.createRadialGradient(br.x, br.y, 2, br.x, br.y, 24 * flicker);
    glow.addColorStop(0, theme.brazierCol);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(br.x, br.y, 24 * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(br.x, br.y - 1, 4.2 * flicker, 0, Math.PI * 2);
    ctx.fillStyle = "#FEF3C7";
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* 4. 동적 레이어 드로잉                                               */
/* ------------------------------------------------------------------ */

function drawMapHazards(ctx, combat) {
  for (const h of combat.arena.hazards || []) {
    ctx.save();
    const isBuff = h.type === "LEYLINE_HASTE";
    const colRgb =
      h.type === "LAVA_GEYSER" ? "249, 115, 22" :
      h.type === "BLIZZARD_SLOW" ? "103, 232, 249" :
      h.type === "GRAVITY_PULL" ? "168, 85, 247" :
      "56, 189, 248";

    if (h.phase === "DORMANT") {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${colRgb}, 0.20)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (h.phase === "WARNING") {
      const dur = h.warningDur || 2.5;
      const prog = clamp(1 - h.phaseTimer / dur, 0, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colRgb}, ${0.06 + prog * 0.08})`;
      ctx.fill();
      ctx.strokeStyle = isBuff ? `rgba(${colRgb}, 0.7)` : "rgba(250, 204, 21, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(2, h.radius * prog), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${colRgb}, 0.85)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else {
      // ACTIVE
      const pulse = 0.22 + Math.sin(VS.clock * 8) * 0.07;
      const grad = ctx.createRadialGradient(h.x, h.y, 4, h.x, h.y, h.radius);
      grad.addColorStop(0, `rgba(${colRgb}, ${pulse + 0.18})`);
      grad.addColorStop(1, `rgba(${colRgb}, 0.04)`);
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(${colRgb}, 0.9)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 회전 내부 아크
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius * 0.65, VS.clock * 2.5, VS.clock * 2.5 + Math.PI * 0.9);
      ctx.strokeStyle = `rgba(${colRgb}, 0.85)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMapShrines(ctx, combat) {
  for (const s of combat.arena.shrines || []) {
    ctx.save();
    // 배틀라이트 그린 체력 오브 / 오렌지 에너지·공격 오브 / 시안 수호 / 보라 차원문
    const col =
      s.type === "HEAL_SHRINE" ? "#22C55E" :
      s.type === "ATK_SHRINE" || s.type === "ENERGY_SHRINE" ? "#F97316" :
      s.type === "SHIELD_SHRINE" ? "#67E8F9" :
      "#C084FC";

    // 육각 석조 받침대
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const vx = s.x + Math.cos(a) * s.radius;
      const vy = s.y + Math.sin(a) * s.radius * 0.85;
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fillStyle = s.ready ? "rgba(15, 23, 42, 0.9)" : "rgba(11, 15, 23, 0.72)";
    ctx.fill();
    ctx.strokeStyle = s.ready ? col : "rgba(100, 116, 139, 0.45)";
    ctx.lineWidth = s.ready ? 1.8 : 1;
    ctx.stroke();

    if (s.ready) {
      const bob = Math.sin(VS.clock * 3.8 + s.x) * 2.2;
      const oy = s.y - 3 + bob;
      // 글로우
      const glow = ctx.createRadialGradient(s.x, oy, 2, s.x, oy, s.radius + 5);
      glow.addColorStop(0, col);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, oy, s.radius + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (s.type === "WARP_GATE") {
        ctx.beginPath();
        ctx.arc(s.x, oy, 7.5, VS.clock * 3, VS.clock * 3 + Math.PI * 1.55);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      } else {
        // 배틀라이트 구슬 구체
        const orbGrad = ctx.createRadialGradient(s.x - 2, oy - 2, 1, s.x, oy, 7.5);
        orbGrad.addColorStop(0, "#FFFFFF");
        orbGrad.addColorStop(0.45, col);
        orbGrad.addColorStop(1, "#0B0F17");
        ctx.beginPath();
        ctx.arc(s.x, oy, 7.2, 0, Math.PI * 2);
        ctx.fillStyle = orbGrad;
        ctx.fill();
        ctx.strokeStyle = "#06080d";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    } else {
      const frac = 1 - clamp((s.timer || 0) / (s.cooldown || 20), 0, 1);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMapPillars(ctx, combat) {
  const theme = MAP_THEMES[combat.arena.mapId] || MAP_THEMES.starlight_sanctum;
  for (const p of combat.arena.pillars || []) {
    ctx.save();
    const r = p.radius;
    // 2.5D 지면 그림자
    ctx.beginPath();
    ctx.ellipse(p.x + 3, p.y + 8, r * 1.15, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fill();

    // 입체 벽면 베이스 (둥근 사각 블록 압출)
    const bx = p.x - r * 0.88;
    const by = p.y - r * 0.65;
    const bw = r * 1.76;
    const bh = r * 1.48;
    const extrude = 7;

    // 정면/측면 어두운 석벽
    ctx.beginPath();
    ctx.roundRect(bx, by + extrude, bw, bh * 0.9, 6);
    ctx.fillStyle = theme.pillarSide || "#141820";
    ctx.fill();
    ctx.strokeStyle = "#05070c";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 상단 지붕 석판
    ctx.beginPath();
    ctx.roundRect(bx, by - 3, bw, bh * 0.88, 6);
    ctx.fillStyle = p.hitFlash > 0 ? "#e2e8f0" : theme.pillarBody;
    ctx.fill();
    ctx.strokeStyle = "#05070c";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 상단 베벨 하이라이트
    ctx.beginPath();
    ctx.roundRect(bx + 3, by, bw - 6, bh * 0.88 - 6, 4);
    ctx.fillStyle = theme.pillarCap;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 중앙 룬 문양
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x + 6, p.y - 2);
    ctx.lineTo(p.x, p.y + 4);
    ctx.lineTo(p.x - 6, p.y - 2);
    ctx.closePath();
    ctx.fillStyle = theme.pillarRune;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();
  }
}

function drawSuddenDeath(ctx, combat, width, height, cx, cy, safeRadius) {
  const warnStart = Math.max(0, (combat.suddenDeathTime || 55) - 5);
  if (!combat.suddenDeath && combat.elapsed < warnStart) return;
  ctx.save();
  if (combat.suddenDeath) {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(244, 63, 94, 0.16)";
    ctx.fill("evenodd");
    const pat = VS.getHazardPattern(ctx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fill("evenodd");
    }

    const pulse = 0.65 + Math.sin(VS.clock * 8) * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(244, 63, 94, ${pulse})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, safeRadius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -VS.clock * 30;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // 서든데스 직전 경고 링
    ctx.beginPath();
    ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.35 + Math.sin(VS.clock * 6) * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * 텔레그래프: 외곽 테두리 + 내부 차오르는 게이지
 */
function drawTelegraphs(ctx, combat) {
  // (1) 범위형 투사체 착탄 예고
  for (const proj of combat.projectiles) {
    if (!proj.isAoE) continue;
    const speed = Math.hypot(proj.vx, proj.vy) || 1;
    const remaining = Math.max(0, (proj.range || 180) - (proj.traveled || 0));
    const lx = proj.x + (proj.vx / speed) * remaining;
    const ly = proj.y + (proj.vy / speed) * remaining;
    const progress = clamp((proj.traveled || 0) / (proj.range || 180), 0, 1);
    const r = proj.aoeRadius || 48;
    const col = proj.team === "red" ? "244, 63, 94" : "56, 189, 248";

    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${col}, 0.06)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${col}, 0.75)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(1, r * progress), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${col}, ${0.12 + progress * 0.16})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${col}, 0.9)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(lx - 5, ly);
    ctx.lineTo(lx + 5, ly);
    ctx.moveTo(lx, ly - 5);
    ctx.lineTo(lx, ly + 5);
    ctx.strokeStyle = `rgba(${col}, 0.9)`;
    ctx.stroke();
    ctx.restore();
  }

  // (2) 반격 자세 판정 창 (남은 시간 게이지)
  for (const f of combat.fighters) {
    if (!f.alive || f.counterTimer <= 0) continue;
    const dur = getChampionById(f.champId)?.counterSkill?.duration || 1.2;
    const frac = clamp(f.counterTimer / dur, 0, 1);
    const R = f.radius + 11;
    ctx.save();
    ctx.beginPath();
    ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.x, f.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 챔피언 시그니처 지면 이펙트 (오리온 마법진, 이그니스 연소 오라, 저격 조준 표식)
 */
function drawSignatureGround(ctx, combat) {
  for (const f of combat.fighters) {
    if (!f.alive) continue;
    if (f.champId === "orion") {
      const casting = f.state === "SKILL" || f.state === "EX" || f.state === "ULT";
      const R = f.radius + 12;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(VS.clock * 0.8);
      ctx.strokeStyle = casting ? "rgba(248, 250, 252, 0.7)" : "rgba(147, 197, 253, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      // 육각성 마법진
      for (let tri = 0; tri < 2; tri++) {
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI * 2) / 3 + tri * (Math.PI / 3);
          const px = Math.cos(a) * (R - 2);
          const py = Math.sin(a) * (R - 2);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
      // 궤도 파동 점
      for (let i = 0; i < 3; i++) {
        const a = -VS.clock * 2.2 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = "#F8FAFC";
        ctx.fillRect(Math.cos(a) * (R + 4) - 1, Math.sin(a) * (R + 4) - 1, 2, 2);
      }
      ctx.restore();
    } else if (f.champId === "ignis") {
      const aura = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.radius + 14);
      aura.addColorStop(0, "rgba(245, 158, 11, 0.22)");
      aura.addColorStop(1, "rgba(220, 38, 38, 0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius + 14, 0, Math.PI * 2);
      ctx.fill();
    } else if ((f.champId === "sylvia" || f.champId === "vex") && f.stunTimer <= 0) {
      // 정밀 조준 표식: 바라보는 방향의 가장 가까운 적에게 코너 브래킷
      let best = null;
      let bestD = Infinity;
      for (const e of combat.fighters) {
        if (!e.alive || e.team === f.team) continue;
        const ang = Math.atan2(e.y - f.y, e.x - f.x);
        let diff = Math.abs(ang - f.facing) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        const d = Math.hypot(e.x - f.x, e.y - f.y);
        if (diff < 0.3 && d < bestD && d < 270) {
          best = e;
          bestD = d;
        }
      }
      if (best) {
        const col = f.champId === "sylvia" ? "#34D399" : "#22D3EE";
        const s = best.radius + 6;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(best.x + sx * s, best.y + sy * (s - 5));
          ctx.lineTo(best.x + sx * s, best.y + sy * s);
          ctx.lineTo(best.x + sx * (s - 5), best.y + sy * s);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.18;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(best.x, best.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }
}

/**
 * 지면 계열 엔진 이펙트 (NOVA, COUNTER_BURST, DASH_TRAIL) + 지면 균열
 */
function drawGroundEffects(ctx, combat) {
  for (const ef of combat.effects) {
    if (ef.type !== "NOVA" && ef.type !== "COUNTER_BURST" && ef.type !== "DASH_TRAIL") continue;
    const progress = clamp(1 - ef.duration / ef.maxDuration, 0, 1);
    const alpha = 1 - progress;
    ctx.save();
    ctx.globalAlpha = alpha;

    if (ef.type === "COUNTER_BURST") {
      const r1 = ef.radius * (0.3 + progress * 0.8);
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, r1, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3.5 * (1 - progress * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, r1 * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.blue;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(ef.x + Math.cos(a) * r1 * 0.7, ef.y + Math.sin(a) * r1 * 0.7);
        ctx.lineTo(ef.x + Math.cos(a) * (r1 + 9), ef.y + Math.sin(a) * (r1 + 9));
        ctx.strokeStyle = i % 2 ? PALETTE.blue : PALETTE.crit;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    } else if (ef.type === "NOVA") {
      const r = ef.radius * (0.35 + progress * 0.7);
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, r, 0, Math.PI * 2);
      ctx.fillStyle = ef.color;
      ctx.globalAlpha = alpha * 0.12;
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ef.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, r * 0.82, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // 발록/타이탄 지면 균열 충격파
      const c = String(ef.color).toLowerCase();
      if (c === "#f97316" || c === "#64748b") {
        ctx.strokeStyle = c === "#f97316" ? "#FB923C" : "#94A3B8";
        ctx.lineWidth = 1.6;
        const cracks = 7;
        for (let i = 0; i < cracks; i++) {
          const seed = hash2(Math.round(ef.x) + i * 13, Math.round(ef.y) + i * 7);
          let a = (i / cracks) * Math.PI * 2 + seed * 0.6;
          let px = ef.x;
          let py = ef.y;
          ctx.beginPath();
          ctx.moveTo(px, py);
          const len = ef.radius * (0.55 + seed * 0.45) * Math.min(1, progress * 2.2 + 0.2);
          const segs = 4;
          for (let s = 1; s <= segs; s++) {
            a += (hash2(i * 31 + s, Math.round(ef.x)) - 0.5) * 0.8;
            px = ef.x + Math.cos(a) * (len * s) / segs;
            py = ef.y + Math.sin(a) * (len * s) / segs;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
    } else {
      // DASH_TRAIL
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, ef.radius * (1 - progress * 0.4), 0, Math.PI * 2);
      ctx.strokeStyle = ef.color;
      ctx.globalAlpha = alpha * 0.6;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 로컬 충격파 링
  for (const r of VS.rings) {
    const p = 1 - r.life / r.max;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - p, 3)), 0, Math.PI * 2);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * (1 - p * 0.6);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 중앙 에너지 오브 — 골드 크리스탈 코어 + 공전 입자
 */
function drawOrb(ctx, combat) {
  const orb = combat.orb;
  if (orb.active) {
    const bob = Math.sin(VS.clock * 3) * 2;
    const oy = orb.y - 4 + bob;

    // 접지 그림자
    ctx.beginPath();
    ctx.ellipse(orb.x, orb.y + 9, orb.radius * 0.85, orb.radius * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fill();

    const glow = ctx.createRadialGradient(orb.x, oy, 2, orb.x, oy, orb.radius * 2);
    glow.addColorStop(0, "rgba(250, 204, 21, 0.55)");
    glow.addColorStop(1, "rgba(245, 158, 11, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(orb.x, oy, orb.radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // 공전 입자
    for (let i = 0; i < 4; i++) {
      const a = VS.clock * 2.6 + (i * Math.PI) / 2;
      const mx = orb.x + Math.cos(a) * (orb.radius + 8);
      const my = oy + Math.sin(a) * (orb.radius + 8) * 0.55;
      ctx.fillStyle = i % 2 ? "#FFFFFF" : PALETTE.crit;
      ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3);
    }

    // 크리스탈 코어
    const cr = orb.radius * 0.95;
    ctx.save();
    ctx.translate(orb.x, oy);
    ctx.beginPath();
    ctx.moveTo(0, -cr);
    ctx.lineTo(cr * 0.62, -cr * 0.15);
    ctx.lineTo(0, cr * 0.95);
    ctx.lineTo(-cr * 0.62, -cr * 0.15);
    ctx.closePath();
    const cg = ctx.createLinearGradient(-cr, -cr, cr, cr);
    cg.addColorStop(0, "#FEF3C7");
    cg.addColorStop(0.45, PALETTE.gold);
    cg.addColorStop(1, "#92400E");
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -cr);
    ctx.lineTo(0, cr * 0.95);
    ctx.moveTo(-cr * 0.62, -cr * 0.15);
    ctx.lineTo(cr * 0.62, -cr * 0.15);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // HP 링
    const ratio = clamp(orb.hp / orb.maxHp, 0, 1);
    ctx.beginPath();
    ctx.arc(orb.x, oy, orb.radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(11, 15, 23, 0.85)";
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orb.x, oy, orb.radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = PALETTE.crit;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    const ratio = 1 - clamp(orb.respawnTimer / (orb.spawnInterval || 12), 0, 1);
    ctx.save();
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.18)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = "800 9px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(226, 232, 240, 0.8)";
    ctx.fillText(`${Math.ceil(orb.respawnTimer)}`, orb.x, orb.y + 3);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* 5. 배틀라이트 스타일 2.5D 휴머노이드 챔피언 렌더러                   */
/* ------------------------------------------------------------------ */

function drawHeroWeapon(ctx, skin, r, ang, swingProg) {
  const o = "#050811";
  const isRanged = skin.weapon === "BOW" || skin.weapon === "RIFLE" || skin.weapon === "FLAME_HANDS";
  const aimSign = Math.cos(ang) >= 0 ? 1 : -1;
  const swingOff = swingProg > 0
    ? (isRanged ? 0 : Math.sin(swingProg * Math.PI - 0.35) * 1.15 * aimSign)
    : 0;
  const recoilPush = isRanged && swingProg > 0 ? -Math.sin(swingProg * Math.PI) * 3.5 : 0;

  ctx.save();
  // 어깨/손 중심점 (직립 몸통 측면)
  ctx.translate(aimSign * r * 0.15, -r * 0.25);
  ctx.rotate(ang + swingOff);
  ctx.translate(recoilPush, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (skin.weapon) {
    case "KATANA": {
      // 손잡이 + 가드 + 휜 명도 블레이드
      ctx.beginPath();
      ctx.moveTo(r * 0.15, 0);
      ctx.lineTo(r * 0.55, 0);
      ctx.strokeStyle = "#1E293B";
      ctx.lineWidth = 3.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(r * 0.55, -3.8);
      ctx.lineTo(r * 0.55, 3.8);
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(r * 0.58, -1);
      ctx.quadraticCurveTo(r * 1.25, -4, r * 1.85, -1.5);
      ctx.lineTo(r * 1.65, 1.5);
      ctx.lineTo(r * 0.58, 1.4);
      ctx.closePath();
      ctx.fillStyle = skin.accent;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    }
    case "BOW": {
      ctx.beginPath();
      ctx.arc(r * 0.45, 0, r * 0.92, -1.1, 1.1);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4.2;
      ctx.stroke();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      const sx = r * 0.45 + Math.cos(1.1) * r * 0.92;
      const sy = Math.sin(1.1) * r * 0.92;
      const pull = swingProg > 0 ? 4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, -sy);
      ctx.lineTo(sx - pull, 0);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = "rgba(248, 250, 252, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // 화살
      ctx.beginPath();
      ctx.moveTo(sx - pull, 0);
      ctx.lineTo(r * 1.65, 0);
      ctx.strokeStyle = skin.core;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }
    case "ORB_STAFF":
    case "ICE_STAFF":
    case "SCEPTER": {
      const len = skin.weapon === "SCEPTER" ? r * 1.35 : r * 1.65;
      ctx.beginPath();
      ctx.moveTo(r * 0.1, 2);
      ctx.lineTo(len, 0);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = skin.weapon === "ICE_STAFF" ? "#7DD3FC" : skin.trim;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(len + 2, 0);
      if (skin.weapon === "ICE_STAFF") {
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(0, -4.5);
        ctx.lineTo(-3.5, 0);
        ctx.lineTo(0, 4.5);
        ctx.closePath();
        ctx.fillStyle = skin.core;
        ctx.fill();
        ctx.strokeStyle = o;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = skin.core;
        ctx.fill();
        ctx.strokeStyle = skin.accent;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "SHIELD_AXE": {
      // 오른손 거대 전투 도끼 + 전방 흑요석 방패
      ctx.beginPath();
      ctx.moveTo(r * 0.2, 3);
      ctx.lineTo(r * 1.45, 5);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#57534E";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 1);
      ctx.arc(r * 1.25, 5, 6.5, -1.2, 1.3);
      ctx.closePath();
      ctx.fillStyle = skin.trim;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // 전방 타워 실드
      ctx.beginPath();
      ctx.roundRect(r * 0.55, -9.5, 6.5, 14, 2.5);
      ctx.fillStyle = skin.body;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = skin.trim;
      ctx.fillRect(r * 0.68, -6, 2.5, 7);
      break;
    }
    case "DAGGERS": {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.3, s * 4.5);
        ctx.lineTo(r * 1.25, s * 6.5);
        ctx.strokeStyle = o;
        ctx.lineWidth = 3.8;
        ctx.stroke();
        ctx.strokeStyle = skin.accent;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      break;
    }
    case "FLAME_HANDS": {
      for (const s of [-1, 1]) {
        const fx = r * 0.85;
        const fy = s * 5.2;
        const fl = 1 + Math.sin(VS.clock * 16 + s) * 0.22;
        const g = ctx.createRadialGradient(fx, fy, 0.5, fx, fy, 5.2 * fl);
        g.addColorStop(0, "#FFFFFF");
        g.addColorStop(0.45, "#FDE047");
        g.addColorStop(1, "rgba(239, 68, 68, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, 5.2 * fl, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "RIFLE": {
      ctx.beginPath();
      ctx.roundRect(r * 0.05, -2.5, r * 1.65, 5, 1.5);
      ctx.fillStyle = "#334155";
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = skin.core;
      ctx.fillRect(r * 0.45, -1, r * 1.15, 2);
      ctx.fillStyle = skin.trim;
      ctx.fillRect(r * 1.55, -2, 3, 4);
      break;
    }
    case "LANCE_SHIELD": {
      ctx.beginPath();
      ctx.moveTo(r * 0.1, 3);
      ctx.lineTo(r * 1.75, 1.5);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4.2;
      ctx.stroke();
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 2.1, 1.5);
      ctx.lineTo(r * 1.65, -2.5);
      ctx.lineTo(r * 1.65, 5.5);
      ctx.closePath();
      ctx.fillStyle = skin.core;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(r * 0.58, -5.5, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = skin.trim;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }
    case "GAUNTLET": {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(r * 0.45, s * 5.8 - 3.8, 9.5, 7.6, 3);
        ctx.fillStyle = skin.trim;
        ctx.fill();
        ctx.strokeStyle = o;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.fillStyle = skin.core;
        ctx.fillRect(r * 0.72, s * 5.8 - 1.5, 3.5, 3);
      }
      break;
    }
    case "SCYTHE": {
      ctx.beginPath();
      ctx.moveTo(r * 0.05, 4);
      ctx.lineTo(r * 1.45, -4);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#94A3B8";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(r * 1.38, -4);
      ctx.quadraticCurveTo(r * 1.75, 3, r * 1.15, 11);
      ctx.quadraticCurveTo(r * 1.35, 3, r * 1.25, -2.5);
      ctx.closePath();
      ctx.fillStyle = skin.accent;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawHeroHead(ctx, skin, r, aimSign, lookY) {
  const o = "#050811";
  const hy = -r * 0.88;
  const hr = r * 0.46;

  // 뒷머리 / 등 뒤 특수 장식 (솔라리스 태양 광배 / 오리온 천구 링)
  if (skin.arch === "PALADIN") {
    ctx.save();
    ctx.translate(0, hy + 2);
    ctx.rotate(VS.clock * 0.8);
    ctx.strokeStyle = skin.trim;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, hr * 1.7, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * hr * 1.45, Math.sin(a) * hr * 1.45);
      ctx.lineTo(Math.cos(a) * hr * 2.05, Math.sin(a) * hr * 2.05);
      ctx.stroke();
    }
    ctx.restore();
  } else if (skin.arch === "ASTRAL") {
    ctx.save();
    ctx.translate(0, hy + 3);
    ctx.rotate(VS.clock * 1.2);
    ctx.strokeStyle = skin.trim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 2.1, hr * 0.72, 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (skin.arch === "GUNNER") {
    // 벡스 포니테일
    ctx.beginPath();
    ctx.moveTo(-aimSign * hr * 0.5, hy);
    ctx.quadraticCurveTo(-aimSign * hr * 1.6, hy - 2, -aimSign * hr * 1.8, hy + 7);
    ctx.strokeStyle = o;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = skin.hair;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  // 기본 두상
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, Math.PI * 2);
  ctx.fillStyle = (skin.arch === "ASTRAL" || skin.arch === "REAPER" || skin.arch === "GOLEM")
    ? skin.body
    : skin.skin;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 눈 / 안광 / 바이저
  const ex = aimSign * hr * 0.28;
  const ey = hy + lookY * 1.2;
  if (skin.arch === "GOLEM") {
    ctx.fillStyle = "#0F172A";
    ctx.fillRect(-hr * 0.65, hy - 2, hr * 1.3, 4);
    ctx.fillStyle = skin.eye;
    ctx.beginPath();
    ctx.arc(ex * 0.8, ey, 2.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin.arch === "SHINOBI") {
    // 닌자 복면 + 빛나는 두 눈
    ctx.beginPath();
    ctx.arc(0, hy + 1.5, hr * 0.94, 0.15, Math.PI - 0.15);
    ctx.fillStyle = "#0F172A";
    ctx.fill();
    ctx.fillStyle = skin.eye;
    ctx.fillRect(ex - 2.8, ey - 1.5, 2.2, 1.8);
    ctx.fillRect(ex + 1.2, ey - 1.5, 2.2, 1.8);
  } else {
    ctx.fillStyle = "#0F172A";
    ctx.fillRect(ex - 2.6, ey - 1, 2, 2);
    ctx.fillRect(ex + 1.2, ey - 1, 2, 2);
    ctx.fillStyle = skin.eye;
    ctx.fillRect(ex - 2.4, ey - 0.8, 1.5, 1.5);
    ctx.fillRect(ex + 1.4, ey - 0.8, 1.5, 1.5);
  }

  // 아키타입별 투구 / 후드 / 헤어스타일
  switch (skin.arch) {
    case "SAMURAI": {
      // 카일렌: 스파이키 헤어 + 금색 머리띠
      ctx.beginPath();
      ctx.moveTo(-hr * 1.05, hy - 1);
      ctx.lineTo(-hr * 1.2, hy - hr * 1.15);
      ctx.lineTo(-hr * 0.35, hy - hr * 0.85);
      ctx.lineTo(0, hy - hr * 1.45);
      ctx.lineTo(hr * 0.45, hy - hr * 0.95);
      ctx.lineTo(hr * 1.15, hy - hr * 1.15);
      ctx.lineTo(hr * 0.95, hy - 1);
      ctx.closePath();
      ctx.fillStyle = skin.hair;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = skin.trim;
      ctx.fillRect(-hr * 0.9, hy - hr * 0.55, hr * 1.8, 2.2);
      break;
    }
    case "RANGER":
    case "ASTRAL":
    case "REAPER": {
      // 뾰족한 레인저/마법사/사신 후드
      ctx.beginPath();
      ctx.arc(0, hy - 1, hr * 1.08, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(aimSign * hr * 0.2, hy - hr * 1.45);
      ctx.closePath();
      ctx.fillStyle = skin.body;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
    }
    case "JUGGERNAUT": {
      // 발록: 투구 + 양옆 거대 용암 뿔
      ctx.beginPath();
      ctx.arc(0, hy - 1, hr * 1.05, Math.PI, 0);
      ctx.fillStyle = "#292524";
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * hr * 0.75, hy - hr * 0.35);
        ctx.quadraticCurveTo(s * hr * 1.55, hy - hr * 0.65, s * hr * 1.35, hy - hr * 1.45);
        ctx.quadraticCurveTo(s * hr * 0.95, hy - hr * 0.9, s * hr * 0.55, hy - hr * 0.7);
        ctx.closePath();
        ctx.fillStyle = skin.trim;
        ctx.fill();
        ctx.strokeStyle = o;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      break;
    }
    case "PYRO": {
      // 이그니스: 타오르는 화염 왕관 헤어
      ctx.beginPath();
      ctx.moveTo(-hr * 0.95, hy - 2);
      ctx.lineTo(-hr * 0.7, hy - hr * 1.45);
      ctx.lineTo(-hr * 0.2, hy - hr * 1.05);
      ctx.lineTo(0, hy - hr * 1.75);
      ctx.lineTo(hr * 0.25, hy - hr * 1.05);
      ctx.lineTo(hr * 0.75, hy - hr * 1.45);
      ctx.lineTo(hr * 0.95, hy - 2);
      ctx.closePath();
      ctx.fillStyle = "#FACC15";
      ctx.fill();
      ctx.strokeStyle = "#EA580C";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    }
    case "GUNNER": {
      // 벡스: 시안색 전술 고글
      ctx.fillStyle = "#0F172A";
      ctx.fillRect(-hr * 0.95, hy - hr * 0.7, hr * 1.9, 4.5);
      ctx.fillStyle = skin.core;
      ctx.fillRect(ex - 3.5, hy - hr * 0.62, 7.5, 2.8);
      break;
    }
    case "PRIESTESS": {
      // 라이라: 사제 헤어 + 뿔형 머리장식
      ctx.beginPath();
      ctx.arc(0, hy - 1, hr * 1.06, Math.PI * 0.85, Math.PI * 2.15);
      ctx.fillStyle = skin.hair;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * hr * 0.55, hy - hr * 0.7);
        ctx.lineTo(s * hr * 1.1, hy - hr * 1.45);
        ctx.strokeStyle = skin.trim;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      break;
    }
    case "PALADIN": {
      // 솔라리스: 황금 성기사 투구 + T자 바이저
      ctx.beginPath();
      ctx.arc(0, hy - 0.5, hr * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = skin.trim;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = "#1E293B";
      ctx.fillRect(ex - 3.5, hy - 1.5, 7, 2.5);
      ctx.fillRect(ex - 1.2, hy - 1.5, 2.4, 5.5);
      break;
    }
    case "GOLEM": {
      // 타이탄: 평평한 거석 투구 상판
      ctx.beginPath();
      ctx.roundRect(-hr * 1.05, hy - hr * 1.1, hr * 2.1, hr * 0.8, 2);
      ctx.fillStyle = skin.trim;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case "CRYO": {
      // 프로스트: 은발 + 얼음 왕관 티아라
      ctx.beginPath();
      ctx.arc(0, hy - 1, hr * 1.08, Math.PI * 0.85, Math.PI * 2.15);
      ctx.fillStyle = skin.hair;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-hr * 0.65, hy - hr * 0.75);
      ctx.lineTo(0, hy - hr * 1.55);
      ctx.lineTo(hr * 0.65, hy - hr * 0.75);
      ctx.closePath();
      ctx.fillStyle = skin.accent;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

function drawChampionBody(ctx, f, skin, rRaw, alpha) {
  const o = "#050811";
  const r = rRaw * (skin.scale || 1.0);
  const ang = f.visualFacing !== undefined ? f.visualFacing : f.facing;
  const aimSign = Math.cos(ang) >= 0 ? 1 : -1;
  const lookY = Math.sin(ang) * 0.35;
  const moveRatio = clamp((f.moveSpeed || 0) / 80, 0, 1);
  const stride = Math.sin(f.stridePhase || 0) * moveRatio;
  const swingProg = f.swingProg || 0;
  const lunge = swingProg > 0 ? Math.sin(swingProg * Math.PI) * 3.0 : 0;
  const bob = Math.sin(VS.clock * 4.2 + (f.x || 0) * 0.04) * 0.8 + Math.abs(stride) * 1.6;
  const floatOff = (skin.arch === "ASTRAL" || skin.arch === "REAPER")
    ? -3.5 + Math.sin(VS.clock * 5 + (f.x || 0)) * 1.8
    : 0;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(
    f.x + Math.cos(ang) * lunge,
    f.y + Math.sin(ang) * lunge - bob + floatOff
  );
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1. 망토 / 머플러 / 로브 뒷자락 (직립 뒤쪽, 이동·바람 따라 펄럭임)
  const flutter = Math.sin(VS.clock * 7 + (f.x || 0) * 0.06) * (2.2 + moveRatio * 3.5);
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 0.45);
  ctx.lineTo(-aimSign * (r * 1.05 + moveRatio * 4), r * 0.52 + flutter * 0.4);
  ctx.lineTo(-aimSign * r * 0.35, r * 0.65 + flutter * 0.2);
  ctx.lineTo(r * 0.55, -r * 0.45);
  ctx.closePath();
  ctx.fillStyle = skin.cape;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 2. 두 다리 / 부츠 (직립 보행 애니메이션)
  if (skin.arch !== "ASTRAL") {
    for (const s of [-1, 1]) {
      const stepY = stride * s * 3.2;
      const lx = s * r * 0.28 + stride * s * 1.6;
      const ly = r * 0.42 + stepY;
      ctx.beginPath();
      ctx.roundRect(lx - 3.2, ly - 1, 6.4, 6.2, 2);
      ctx.fillStyle = "#0F172A";
      ctx.fill();
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  // 3. 상체 갑주 / 로브 (역삼각형 영웅 체형)
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, -r * 0.52);
  ctx.lineTo(r * 0.62, -r * 0.52);
  ctx.lineTo(r * 0.42, r * 0.42);
  ctx.lineTo(-r * 0.42, r * 0.42);
  ctx.closePath();
  ctx.fillStyle = skin.body;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // 허리띠 & 버클
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(-r * 0.43, r * 0.14, r * 0.86, 3.6);
  ctx.fillStyle = skin.trim;
  ctx.fillRect(-2.5, r * 0.11, 5, 4.2);

  // 가슴 코어 엠블럼 (에너지 비율 발광)
  const coreGlow = 0.55 + clamp((f.energy || 0) / 100, 0, 1) * 0.45;
  ctx.save();
  ctx.globalAlpha *= coreGlow;
  ctx.fillStyle = skin.core;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.36);
  ctx.lineTo(3.4, -r * 0.14);
  ctx.lineTo(0, r * 0.06);
  ctx.lineTo(-3.4, -r * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 4. 양쪽 입체 견갑 (Pauldrons)
  const heavy = skin.arch === "JUGGERNAUT" || skin.arch === "GOLEM" || skin.arch === "PALADIN";
  const pr = heavy ? r * 0.38 : r * 0.28;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.62, -r * 0.42, pr, pr * 0.82, s * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = skin.trim;
    ctx.fill();
    ctx.strokeStyle = o;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(s * r * 0.62 - 1.5, -r * 0.48, 3, 1.5);
  }

  // 5. 조준 방향에 따라 먼저/나중에 무기 렌더링
  if (lookY < 0) drawHeroWeapon(ctx, skin, r, ang, swingProg);
  drawHeroHead(ctx, skin, r, aimSign, lookY);
  if (lookY >= 0) drawHeroWeapon(ctx, skin, r, ang, swingProg);

  ctx.restore();
}

function drawFighter(ctx, f) {
  const fv = VS.fighters.get(f.unitId);
  const skin = getSkin(f);
  const r = f.radius;

  if (!f.alive) {
    const since = fv ? VS.clock - fv.deathTime : 1;
    ctx.save();
    ctx.globalAlpha = clamp(0.55 - since * 0.05, 0.28, 0.55);
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 4, r * 0.95, r * 0.52, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0B0F17";
    ctx.fill();
    ctx.strokeStyle = teamColor(f.team);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#94A3B8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x - 4, f.y);
    ctx.lineTo(f.x + 4, f.y + 7);
    ctx.moveTo(f.x + 4, f.y);
    ctx.lineTo(f.x - 4, f.y + 7);
    ctx.stroke();
    ctx.restore();
    return;
  }

  let jx = 0;
  let jy = 0;
  if (fv && fv.jitter > 0) {
    jx = rand(-2.2, 2.2);
    jy = rand(-2.2, 2.2);
  }
  const recoilAmt = fv && fv.recoil > 0 ? Math.sin((fv.recoil / 0.14) * Math.PI) * 2.2 : 0;
  const visFacing = fv ? fv.visualFacing : f.facing;
  const view = {
    x: f.x + jx - Math.cos(visFacing) * recoilAmt,
    y: f.y + jy - Math.sin(visFacing) * recoilAmt,
    facing: f.facing,
    visualFacing: visFacing,
    stridePhase: fv ? fv.stridePhase : 0,
    moveSpeed: fv ? fv.moveSpeed : 0,
    swingProg: fv && fv.swingTimer > 0 ? 1 - fv.swingTimer / (fv.swingDur || 0.24) : 0,
    energy: f.energy,
    team: f.team
  };

  if (fv) {
    for (const a of fv.afterimages) {
      const t = a.life / a.max;
      drawChampionBody(ctx, { x: a.x, y: a.y, facing: a.facing, visualFacing: a.facing, energy: 0, team: f.team }, skin, r, t * 0.34);
    }
  }

  const stealthAlpha = f.stealthTimer > 0 ? 0.35 : 1;

  ctx.save();
  ctx.globalAlpha = stealthAlpha;

  // 접지 그림자
  ctx.beginPath();
  ctx.ellipse(view.x + 1.5, view.y + r * 0.72, r * 1.15, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.fill();

  // 배틀라이트 팀 발밑 타원 링 & 방향 조준 아크
  ctx.beginPath();
  ctx.ellipse(view.x, view.y + r * 0.45, r + 3, (r + 3) * 0.52, 0, 0, Math.PI * 2);
  ctx.strokeStyle = teamColor(f.team);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.fillStyle = f.team === "red" ? "rgba(244, 63, 94, 0.10)" : "rgba(56, 189, 248, 0.10)";
  ctx.fill();

  const tip = r + 10;
  ctx.beginPath();
  ctx.moveTo(view.x + Math.cos(visFacing) * tip, view.y + r * 0.35 + Math.sin(visFacing) * tip * 0.65);
  ctx.lineTo(view.x + Math.cos(visFacing - 0.24) * (r + 4), view.y + r * 0.35 + Math.sin(visFacing - 0.24) * (r + 4) * 0.65);
  ctx.lineTo(view.x + Math.cos(visFacing + 0.24) * (r + 4), view.y + r * 0.35 + Math.sin(visFacing + 0.24) * (r + 4) * 0.65);
  ctx.closePath();
  ctx.fillStyle = teamColor(f.team);
  ctx.fill();

  if (f.atkBuffTimer > 0) {
    ctx.beginPath();
    ctx.arc(view.x, view.y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(249, 115, 22, 0.8)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  if (f.hasteTimer > 0 || f.leylineBuff) {
    ctx.beginPath();
    ctx.arc(view.x, view.y, r + 8, VS.clock * 4, VS.clock * 4 + Math.PI * 0.85);
    ctx.strokeStyle = "rgba(52, 211, 153, 0.75)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  if (f.energy >= 100) {
    ctx.beginPath();
    ctx.arc(view.x, view.y, r + 7 + Math.sin(VS.clock * 8) * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = stealthAlpha;
  drawChampionBody(ctx, view, skin, r, 1);

  if (f.shield > 0) {
    ctx.beginPath();
    ctx.arc(view.x, view.y - r * 0.25, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(186, 230, 253, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (f.counterTimer > 0) {
    const hexR = r + 9;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = VS.clock * 2 + (i * Math.PI) / 3;
      const hx = view.x + Math.cos(a) * hexR;
      const hy = view.y - r * 0.2 + Math.sin(a) * hexR;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 158, 11, 0.16)";
    ctx.fill();
    ctx.strokeStyle = PALETTE.crit;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  if (fv && fv.flash > 0) {
    ctx.beginPath();
    ctx.arc(view.x, view.y - r * 0.3, r * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = fv.flashColor;
    ctx.globalAlpha = stealthAlpha * 0.78;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 6. 월드 스페이스 미니 HUD                                           */
/* ------------------------------------------------------------------ */

function drawCCIcon(ctx, kind, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(-5, -5, 10, 10);
  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(-5.5, -5.5, 11, 11);
  if (kind === "STUN") {
    ctx.fillStyle = PALETTE.crit;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5 + VS.clock * 3;
      const rr = i % 2 ? 1.6 : 4;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === "SLOW") {
    ctx.strokeStyle = "#7DD3FC";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-3, -2);
    ctx.lineTo(0, 1);
    ctx.lineTo(3, -2);
    ctx.moveTo(-3, 1);
    ctx.lineTo(0, 4);
    ctx.lineTo(3, 1);
    ctx.stroke();
  } else if (kind === "STEALTH") {
    ctx.strokeStyle = "#A78BFA";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.5, 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#A78BFA";
    ctx.fillRect(-1, -1, 2, 2);
  } else if (kind === "COUNTER") {
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(3.5, -2.5);
    ctx.lineTo(3, 1.5);
    ctx.lineTo(0, 4);
    ctx.lineTo(-3, 1.5);
    ctx.lineTo(-3.5, -2.5);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "HASTE") {
    ctx.strokeStyle = "#34D399";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-3, 3);
    ctx.lineTo(0, 0);
    ctx.lineTo(-3, -3);
    ctx.moveTo(0, 3);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, -3);
    ctx.stroke();
  } else if (kind === "ATK") {
    ctx.fillStyle = "#F97316";
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(3, 2);
    ctx.lineTo(0, 4);
    ctx.lineTo(-3, 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawWorldHud(ctx, f) {
  if (!f.alive) return;
  const fv = VS.fighters.get(f.unitId);
  const skin = getSkin(f);
  const champ = getChampionById(f.champId);
  const W = 38;
  const x = Math.round(f.x - W / 2);
  const topScale = skin.scale || 1.0;
  const y = Math.round(f.y - f.radius * topScale - 24);
  const hpRatio = clamp(f.hp / f.maxHp, 0, 1);
  const ghostRatio = fv ? clamp(fv.ghostHp / f.maxHp, 0, 1) : hpRatio;
  // 배틀라이트식 회복 가능 최대 체력(Recovery HP) 표시: 현재 HP + 최대 체력의 12% 한도
  const recCapRatio = clamp((f.hp + f.maxHp * 0.12) / f.maxHp, hpRatio, 1);

  ctx.save();
  ctx.globalAlpha = f.stealthTimer > 0 ? 0.5 : 1;

  // 챔피언명 (배틀라이트 오버헤드 네임태그)
  ctx.font = "800 8px 'Pretendard', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "#050811";
  const label = f.name || champ?.shortName || f.champId;
  ctx.strokeText(label, f.x, y - 3);
  ctx.fillStyle = f.team === "blue" ? "#BAE6FD" : "#FECDD3";
  ctx.fillText(label, f.x, y - 3);

  // 바 외곽 프레임
  ctx.fillStyle = "#050811";
  ctx.fillRect(x - 1, y - 1, W + 2, 10);
  ctx.strokeStyle = "#1E293B";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, W + 3, 11);

  // Recovery HP 음영 (영구 손실 체력은 어둡고, 회복 가능 구간은 은은한 틴트)
  ctx.fillStyle = "#111827";
  ctx.fillRect(x, y, W, 5);
  ctx.fillStyle = f.team === "blue" ? "rgba(56, 189, 248, 0.25)" : "rgba(244, 63, 94, 0.25)";
  ctx.fillRect(x, y, Math.round(W * recCapRatio), 5);

  // 잔여 데미지(흰색) → 현재 HP
  ctx.fillStyle = "#F8FAFC";
  ctx.fillRect(x, y, Math.round(W * ghostRatio), 5);
  ctx.fillStyle = hpRatio < 0.28 ? PALETTE.crit : f.team === "blue" ? "#22C55E" : "#F43F5E";
  ctx.fillRect(x, y, Math.round(W * hpRatio), 5);

  // 100HP 단위 구분선
  ctx.fillStyle = "rgba(5, 8, 17, 0.72)";
  for (let t = 100; t < f.maxHp; t += 100) {
    ctx.fillRect(x + Math.round((t / f.maxHp) * W), y, 1, 5);
  }
  // 실드 오버레이
  if (f.shield > 0) {
    ctx.fillStyle = "rgba(224, 242, 254, 0.92)";
    ctx.fillRect(x, y, Math.round(W * clamp(f.shield / f.maxHp, 0, 1)), 2);
  }

  // 4분할 배틀라이트 에너지 게이지
  const ey = y + 6;
  const segW = (W - 3) / 4;
  for (let s = 0; s < 4; s++) {
    const fill = clamp((f.energy - s * 25) / 25, 0, 1);
    const sx = x + s * (segW + 1);
    ctx.fillStyle = "#162032";
    ctx.fillRect(sx, ey, segW, 2.2);
    if (fill > 0) {
      ctx.fillStyle = f.energy >= 100 ? PALETTE.crit : "#F59E0B";
      ctx.fillRect(sx, ey, segW * fill, 2.2);
    }
  }

  // 반격(Q) 준비/쿨타임 세로 게이지
  const qMax = (champ?.counterSkill?.cd || 8) * (champ?.patchMod?.cdMult || 1);
  const qFrac = 1 - clamp((f.cds?.counter || 0) / qMax, 0, 1);
  ctx.fillStyle = "#050811";
  ctx.fillRect(x + W + 2, y - 1, 4, 10);
  ctx.fillStyle = qFrac >= 1 ? "#38BDF8" : "#334155";
  ctx.fillRect(x + W + 3, y + 8 - Math.round(8 * qFrac), 2, Math.round(8 * qFrac));

  // 숙련도 랭크 배지
  const lv = Number(f.masteryLevel || 1);
  const rank = lv >= 4 ? "S" : lv === 3 ? "A" : lv === 2 ? "B" : "C";
  const rankCol = rank === "S" ? PALETTE.gold : rank === "A" ? PALETTE.crit : rank === "B" ? PALETTE.blue : "#94A3B8";
  ctx.fillStyle = "#050811";
  ctx.fillRect(x - 9, y - 1, 7.5, 10);
  ctx.fillStyle = rankCol;
  ctx.font = "900 7px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(rank, x - 5.2, y + 6.8);

  // CC 및 버프 상태 아이콘
  const icons = [];
  if (f.stunTimer > 0) icons.push("STUN");
  if (f.slowTimer > 0) icons.push("SLOW");
  if (f.stealthTimer > 0) icons.push("STEALTH");
  if (f.counterTimer > 0) icons.push("COUNTER");
  if (f.hasteTimer > 0 || f.leylineBuff) icons.push("HASTE");
  if (f.atkBuffTimer > 0) icons.push("ATK");
  const startX = f.x - ((icons.length - 1) * 12) / 2;
  icons.forEach((k, i) => drawCCIcon(ctx, k, startX + i * 12, y - 14));

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 7. 투사체 (테이퍼드 트레일 + 접지 그림자 + 코어)                    */
/* ------------------------------------------------------------------ */

function drawProjectiles(ctx, combat) {
  for (const proj of combat.projectiles) {
    const entry = VS.projectileTrails.get(String(proj.id));
    const pts = entry ? entry.points.slice() : [];
    const isEx = (entry && entry.isEx) || Boolean(proj.isReflected);
    const isHeal = (proj.healAlly || 0) > 0;
    const baseCol = isHeal ? PALETTE.heal : proj.isReflected ? "#FB923C" : proj.color;
    const trailCol = isEx ? PALETTE.gold : baseCol;
    const r = proj.radius;

    // 접지 그림자
    ctx.beginPath();
    ctx.ellipse(proj.x, proj.y + r + 4, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.fill();

    // 테이퍼드 트레일 폴리곤
    const last = pts[pts.length - 1];
    if (!last || last.x !== proj.x || last.y !== proj.y) pts.push({ x: proj.x, y: proj.y });
    if (pts.length >= 2) {
      const left = [];
      const right = [];
      const n = pts.length;
      const widthScale = proj.pierce ? 0.75 : 1.0;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[Math.min(n - 1, i + 1)];
        const pr = pts[Math.max(0, i - 1)];
        let dx = q.x - pr.x;
        let dy = q.y - pr.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const w = r * widthScale * (i / (n - 1));
        left.push({ x: p.x - dy * w, y: p.y + dx * w });
        right.push({ x: p.x + dy * w, y: p.y - dx * w });
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
      ctx.closePath();
      const tg = ctx.createLinearGradient(pts[0].x, pts[0].y, proj.x, proj.y);
      tg.addColorStop(0, "rgba(0, 0, 0, 0)");
      tg.addColorStop(1, trailCol);
      ctx.fillStyle = tg;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.restore();

      // 관통형 고속 궤적선
      if (proj.pierce) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(proj.x, proj.y);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // EX 플라즈마 헤일로
    if (isEx) {
      const hg = ctx.createRadialGradient(proj.x, proj.y, r * 0.4, proj.x, proj.y, r * 2.2);
      hg.addColorStop(0, "rgba(251, 191, 36, 0.8)");
      hg.addColorStop(1, "rgba(245, 158, 11, 0)");
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 코어
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
    ctx.fillStyle = baseCol;
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, Math.max(1.5, r * 0.45), 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* 8. 근접 슬래시 / 히트 스파크 / 파티클 / 플로팅 텍스트               */
/* ------------------------------------------------------------------ */

function findSourceFighter(combat, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const f of combat.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return bestD < 40 ? best : null;
}

function drawStrikeEffects(ctx, combat) {
  for (const ef of combat.effects) {
    if (ef.type !== "SLASH" && ef.type !== "HIT_SPARK") continue;
    const progress = clamp(1 - ef.duration / ef.maxDuration, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - progress;

    if (ef.type === "SLASH") {
      const src = findSourceFighter(combat, ef.x, ef.y);
      const ang = src ? Math.atan2(ef.y - src.y, ef.x - src.x) : 0;
      const ox = src ? src.x : ef.x;
      const oy = src ? src.y : ef.y;
      const R = (ef.radius || 22) + 18;
      const isDagger = src && (src.champId === "nyx" || src.champId === "shade");
      const edge = src ? getSkin(src).trim : ef.color;

      if (isDagger) {
        // 예리한 단검 섬광 (교차선)
        for (const off of [-0.35, 0.35]) {
          const a = ang + off * (1 - progress);
          ctx.beginPath();
          ctx.moveTo(ox + Math.cos(a) * 8, oy + Math.sin(a) * 8);
          ctx.lineTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R);
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.strokeStyle = edge;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else {
        // 부채꼴 검기 (Slash Arc)
        const sweep = 1.0;
        const a0 = ang - sweep + progress * 0.4;
        const a1 = ang + sweep * (0.4 + progress * 0.6);
        ctx.beginPath();
        ctx.arc(ox, oy, R, a0, a1);
        ctx.arc(ox, oy, R * 0.62, a1, a0, true);
        ctx.closePath();
        const sg = ctx.createRadialGradient(ox, oy, R * 0.6, ox, oy, R);
        sg.addColorStop(0, "rgba(255, 255, 255, 0)");
        sg.addColorStop(0.7, "rgba(255, 255, 255, 0.55)");
        sg.addColorStop(1, "rgba(255, 255, 255, 0.95)");
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ox, oy, R, a0, a1);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      const R = (ef.radius || 14) * (0.5 + progress * 0.8);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + 0.3;
        ctx.beginPath();
        ctx.moveTo(ef.x + Math.cos(a) * R * 0.35, ef.y + Math.sin(a) * R * 0.35);
        ctx.lineTo(ef.x + Math.cos(a) * R, ef.y + Math.sin(a) * R);
        ctx.strokeStyle = i % 2 ? "#FFFFFF" : ef.color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawParticles(ctx) {
  for (const p of VS.particles) {
    const t = clamp(p.life / p.max, 0, 1);
    ctx.save();
    if (p.kind === "smoke") {
      ctx.globalAlpha = t * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else {
      // 픽셀 스퀘어 파티클 (선명한 2D 픽셀 하이브리드)
      ctx.globalAlpha = t;
      const s = Math.max(1, Math.round(p.size * (p.kind === "spark" ? 0.6 + t * 0.6 : 1)));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    ctx.restore();
  }
}

function drawOutlinedText(ctx, text, x, y, size, color, scale, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `900 ${size}px "Pretendard", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = PALETTE.outline;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function popScale(p) {
  // 팝인 오버슈트 이징
  if (p < 0.12) return 0.55 + (p / 0.12) * 0.75;
  if (p < 0.25) return 1.3 - ((p - 0.12) / 0.13) * 0.3;
  return 1;
}

function drawFloatingTexts(ctx, combat) {
  // 엔진 제공 텍스트 (회복, 반격, EX/궁극기명, KO, 오브 피해)
  for (const ef of combat.effects) {
    if (ef.type !== "FLOAT_TEXT") continue;
    const txt = String(ef.text || "");
    const col = String(ef.color || "").toLowerCase();
    // 챔피언 피해 숫자는 HP 차분 기반 로컬 팝업으로 대체 (중복 방지)
    if (txt.startsWith("-") && col === "#ffffff") continue;
    const p = clamp(1 - ef.duration / ef.maxDuration, 0, 1);
    let color = ef.color || PALETTE.white;
    if (txt.startsWith("+")) color = PALETTE.heal;
    else if (txt.includes("KO")) color = PALETTE.crit;
    else if (txt.includes("반격") || txt.includes("★")) color = PALETTE.gold;
    else if (txt.startsWith("EX")) color = PALETTE.blue;
    const alpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
    drawOutlinedText(ctx, txt, ef.x, ef.y - p * 18, ef.radius || 11, color, popScale(p), alpha);
  }

  // 로컬 팝업 (데미지/크리티컬/STUN/COUNTER)
  for (const pp of VS.popups) {
    const p = clamp(1 - pp.life / pp.max, 0, 1);
    const alpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
    drawOutlinedText(ctx, pp.text, pp.x, pp.y - p * 20, pp.size, pp.color, popScale(p), alpha);
  }
}

/* ------------------------------------------------------------------ */
/* 9. 공개 API                                                         */
/* ------------------------------------------------------------------ */

/**
 * 캔버스 논리 해상도를 초기화한다.
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
export function initRenderer(canvas) {
  canvas.width = 1040;
  canvas.height = 840;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }
  return ctx;
}

/**
 * 아레나 전체 프레임을 그리는 메인 읽기 전용 렌더 함수.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function renderArena(ctx, state) {
  const combat = state.combat;
  const width = combat.arena.width || 520;
  const height = combat.arena.height || 420;
  const centerX = combat.arena.centerX || 260;
  const centerY = combat.arena.centerY || 210;
  const safeRadius = combat.arena.safeRadius ?? 210;

  VS.sync(state);

  const engineShake = combat.shakeTimer > 0 ? Math.min(5, combat.shakeTimer * 30) : 0;
  const shake = Math.max(VS.shake, engineShake);

  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (shake > 0.05) {
    ctx.translate(rand(-shake, shake), rand(-shake, shake));
  }

  // 1. 캐싱된 정적 아레나 (맵 테마별 2x HiDPI 캐시)
  const mapId = combat.arena.mapId || "starlight_sanctum";
  const bg = VS.getBackground(width, height, centerX, centerY, mapId);
  if (bg) {
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, width, height);
  }
  drawArenaBraziers(ctx, width, height, mapId);

  // 2. 서든데스 해저드
  drawSuddenDeath(ctx, combat, width, height, centerX, centerY, safeRadius);

  // 3. 지면 레이어 (맵 기믹·성소·장애물 기둥 포함)
  drawSignatureGround(ctx, combat);
  drawMapHazards(ctx, combat);
  drawMapShrines(ctx, combat);
  drawTelegraphs(ctx, combat);
  drawGroundEffects(ctx, combat);
  drawMapPillars(ctx, combat);

  // 4. 중앙 오브
  drawOrb(ctx, combat);

  // 5. 환영 분신
  for (const d of combat.decoys || []) {
    ctx.save();
    ctx.globalAlpha = 0.45 + Math.sin(VS.clock * 10) * 0.1;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + d.radius * 0.7, d.radius, d.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    ctx.fillStyle = d.color || "#0E7A5A";
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#34D399";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 6. 챔피언 (y 정렬로 깊이감)
  const ordered = combat.fighters.slice().sort((a, b) => (a.alive === b.alive ? a.y - b.y : a.alive ? 1 : -1));
  for (const f of ordered) drawFighter(ctx, f);

  // 7. 투사체
  drawProjectiles(ctx, combat);

  // 8. 타격 이펙트 & 파티클
  drawStrikeEffects(ctx, combat);
  drawParticles(ctx);

  // 9. 월드 스페이스 미니 HUD
  for (const f of ordered) drawWorldHud(ctx, f);

  // 10. 플로팅 텍스트
  drawFloatingTexts(ctx, combat);

  ctx.restore();

  // 11. 히트스톱 임팩트 프레임 (쉐이크 영향 없음)
  if (combat.hitstopTimer > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
    ctx.restore();
  }
}
