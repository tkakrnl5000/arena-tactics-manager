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

import { getChampionById } from "./state.js";

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
  kylen: { body: "#4B6584", trim: "#F59E0B", accent: "#CBD5E1", core: "#FDE68A", cape: "#22324A", weapon: "SWORD", heavy: false },
  sylvia: { body: "#0E7A5A", trim: "#D1D5DB", accent: "#34D399", core: "#A7F3D0", cape: "#064E3B", weapon: "BOW", heavy: false },
  orion: { body: "#1E40AF", trim: "#F8FAFC", accent: "#93C5FD", core: "#FFFFFF", cape: "#172554", weapon: "STAFF_STAR", heavy: false },
  balrog: { body: "#7F1D1D", trim: "#F97316", accent: "#FDBA74", core: "#FB923C", cape: "#450A0A", weapon: "SHIELD", heavy: true },
  nyx: { body: "#151B26", trim: "#8B5CF6", accent: "#C4B5FD", core: "#A78BFA", cape: "#05070B", weapon: "DAGGERS", heavy: false },
  ignis: { body: "#B91C1C", trim: "#F59E0B", accent: "#FCD34D", core: "#FBBF24", cape: "#6B1414", weapon: "FLAME", heavy: false },
  vex: { body: "#334155", trim: "#22D3EE", accent: "#67E8F9", core: "#22D3EE", cape: "#1B2433", weapon: "RIFLE", heavy: false },
  lyra: { body: "#A23B5A", trim: "#F5F0E6", accent: "#FDA4AF", core: "#FFE4E6", cape: "#5E1F33", weapon: "WAND", heavy: false },
  solaris: { body: "#A16207", trim: "#FEF3C7", accent: "#FDE047", core: "#FFFBEB", cape: "#5C3310", weapon: "LANCE", heavy: false },
  titan: { body: "#475569", trim: "#94A3B8", accent: "#2DD4BF", core: "#5EEAD4", cape: "#1B2433", weapon: "GAUNTLET", heavy: true },
  shade: { body: "#2E2A6B", trim: "#14B8A6", accent: "#5EEAD4", core: "#99F6E4", cape: "#16133A", weapon: "SCYTHE", heavy: false },
  frost: { body: "#0369A1", trim: "#E0F2FE", accent: "#7DD3FC", core: "#F0F9FF", cape: "#0C3A5A", weapon: "ICE_STAFF", heavy: false }
};

function getSkin(f) {
  return (
    CHAMP_SKINS[f.champId] || {
      body: f.color || "#475569",
      trim: "#CBD5E1",
      accent: "#E2E8F0",
      core: "#FFFFFF",
      cape: "#1B2433",
      weapon: "SWORD",
      heavy: false
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
   * 정적 아레나 배경을 오프스크린 캔버스로 캐싱한다.
   */
  getBackground(width, height, cx, cy) {
    const key = `${width}x${height}@${cx},${cy}`;
    if (this.bgCache && this.bgKey === key) return this.bgCache;
    if (typeof document === "undefined") return null;

    const cvs = document.createElement("canvas");
    cvs.width = width;
    cvs.height = height;
    const g = cvs.getContext("2d");
    if (!g) return null;
    buildArenaBackground(g, width, height, cx, cy);
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
          alive: f.alive,
          stun: f.stunTimer > 0,
          energy: f.energy,
          counters: f.countersTriggered || 0,
          stealth: f.stealthTimer > 0,
          dashing: f.dashTimer > 0,
          afterTimer: 0,
          afterimages: [],
          fxTimer: 0,
          deathTime: 0
        };
        this.fighters.set(f.unitId, fv);
      }

      const skin = getSkin(f);
      const dmg = fv.hp - f.hp;

      // (a) 피격 감지: HP 감소 → 히트 플래시 + 데미지 팝업 + 파티클
      if (dmg >= 1 && fv.alive) {
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

function buildArenaBackground(g, width, height, cx, cy) {
  const R = 176;

  // 바깥 딥 슬레이트 + 픽셀 타일 노이즈
  g.fillStyle = PALETTE.bg;
  g.fillRect(0, 0, width, height);
  const T = 12;
  for (let ty = 0; ty < Math.ceil(height / T); ty++) {
    for (let tx = 0; tx < Math.ceil(width / T); tx++) {
      const n = hash2(tx, ty);
      if (n > 0.55) {
        g.fillStyle = n > 0.88 ? "#121926" : "#0E131D";
        g.fillRect(tx * T, ty * T, T - 1, T - 1);
      }
    }
  }

  // 단상 그림자
  g.beginPath();
  g.arc(cx, cy + 5, R + 3, 0, Math.PI * 2);
  g.fillStyle = "rgba(0, 0, 0, 0.6)";
  g.fill();

  // 경기장 바닥 (패널 타일)
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();

  g.fillStyle = PALETTE.panel;
  g.fillRect(0, 0, width, height);

  const P = 24;
  const ox = cx % P;
  const oy = cy % P;
  for (let py = -1; py < Math.ceil(height / P) + 1; py++) {
    for (let px = -1; px < Math.ceil(width / P) + 1; px++) {
      const x = ox + px * P;
      const y = oy + py * P;
      const n = hash2(px + 50, py + 90);
      g.fillStyle = n > 0.7 ? "#16202F" : n < 0.2 ? "#111826" : "#141C29";
      g.fillRect(x + 1, y + 1, P - 2, P - 2);
      // 픽셀 리벳 디테일
      if (n > 0.82) {
        g.fillStyle = "#1E293B";
        g.fillRect(x + 3, y + 3, 2, 2);
        g.fillRect(x + P - 5, y + P - 5, 2, 2);
      }
    }
  }

  // 전술 그리드 심(Seam)
  g.strokeStyle = "rgba(36, 48, 68, 0.9)";
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

  // 진영 스폰 존 틴트
  const blueTint = g.createLinearGradient(cx - R, 0, cx - 40, 0);
  blueTint.addColorStop(0, "rgba(56, 189, 248, 0.10)");
  blueTint.addColorStop(1, "rgba(56, 189, 248, 0)");
  g.fillStyle = blueTint;
  g.fillRect(cx - R, 0, R - 40, height);

  const redTint = g.createLinearGradient(cx + R, 0, cx + 40, 0);
  redTint.addColorStop(0, "rgba(244, 63, 94, 0.10)");
  redTint.addColorStop(1, "rgba(244, 63, 94, 0)");
  g.fillStyle = redTint;
  g.fillRect(cx + 40, 0, R - 40, height);

  // 중앙 분할선
  g.strokeStyle = "rgba(148, 163, 184, 0.16)";
  g.setLineDash([6, 6]);
  g.beginPath();
  g.moveTo(cx + 0.5, cy - R);
  g.lineTo(cx + 0.5, cy + R);
  g.stroke();
  g.setLineDash([]);

  // 스포트라이트 (상단 조명)
  const spot = g.createRadialGradient(cx, cy - 40, 10, cx, cy, R);
  spot.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  spot.addColorStop(0.6, "rgba(255, 255, 255, 0.02)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0.35)");
  g.fillStyle = spot;
  g.fillRect(0, 0, width, height);
  g.restore();

  // 진영별 스폰 아크
  const drawSpawnArc = (startDeg, endDeg, color) => {
    const a0 = (startDeg * Math.PI) / 180;
    const a1 = (endDeg * Math.PI) / 180;
    g.beginPath();
    g.arc(cx, cy, 132, a0, a1);
    g.arc(cx, cy, 108, a1, a0, true);
    g.closePath();
    g.fillStyle = color.replace("1)", "0.07)");
    g.fill();
    g.beginPath();
    g.arc(cx, cy, 132, a0, a1);
    g.strokeStyle = color.replace("1)", "0.65)");
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 108, a0, a1);
    g.strokeStyle = color.replace("1)", "0.3)");
    g.lineWidth = 1;
    g.stroke();
    // 끝단 브래킷
    for (const a of [a0, a1]) {
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 104, cy + Math.sin(a) * 104);
      g.lineTo(cx + Math.cos(a) * 136, cy + Math.sin(a) * 136);
      g.strokeStyle = color.replace("1)", "0.8)");
      g.lineWidth = 2;
      g.stroke();
    }
  };
  drawSpawnArc(145, 215, "rgba(56, 189, 248, 1)");
  drawSpawnArc(-35, 35, "rgba(244, 63, 94, 1)");

  // 중앙 오브젝트 구역 마킹
  g.beginPath();
  g.arc(cx, cy, 55, 0, Math.PI * 2);
  g.strokeStyle = "rgba(245, 158, 11, 0.32)";
  g.lineWidth = 1.5;
  g.setLineDash([3, 5]);
  g.stroke();
  g.setLineDash([]);

  g.beginPath();
  g.moveTo(cx, cy - 26);
  g.lineTo(cx + 26, cy);
  g.lineTo(cx, cy + 26);
  g.lineTo(cx - 26, cy);
  g.closePath();
  g.strokeStyle = "rgba(245, 158, 11, 0.22)";
  g.lineWidth = 1;
  g.stroke();

  // 대각 L-브래킷
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const bx = cx + Math.cos(a) * 66;
    const by = cy + Math.sin(a) * 66;
    const sx = Math.sign(Math.cos(a));
    const sy = Math.sign(Math.sin(a));
    g.beginPath();
    g.moveTo(bx - sx * 9, by);
    g.lineTo(bx, by);
    g.lineTo(bx, by - sy * 9);
    g.strokeStyle = "rgba(245, 158, 11, 0.55)";
    g.lineWidth = 2;
    g.stroke();
  }

  // 외곽 링 + 눈금
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.strokeStyle = PALETTE.line;
  g.lineWidth = 4;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R - 6, 0, Math.PI * 2);
  g.strokeStyle = "rgba(46, 59, 82, 0.9)";
  g.lineWidth = 1;
  g.stroke();
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180;
    const major = d % 90 === 0;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (R - (major ? 12 : 8)), cy + Math.sin(a) * (R - (major ? 12 : 8)));
    g.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3));
    g.strokeStyle = major ? "rgba(245, 158, 11, 0.6)" : "rgba(100, 116, 139, 0.5)";
    g.lineWidth = major ? 2 : 1;
    g.stroke();
  }

  // 비네팅
  const vig = g.createRadialGradient(cx, cy, R * 0.75, cx, cy, Math.max(width, height) * 0.75);
  vig.addColorStop(0, "rgba(0, 0, 0, 0)");
  vig.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  g.fillStyle = vig;
  g.fillRect(0, 0, width, height);
}

/* ------------------------------------------------------------------ */
/* 4. 동적 레이어 드로잉                                               */
/* ------------------------------------------------------------------ */

function drawSuddenDeath(ctx, combat, width, height, cx, cy, safeRadius) {
  if (!combat.suddenDeath && combat.elapsed < 30) return;
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
/* 5. 챔피언 실루엣 (다층 파츠: 망토·동체·견갑·머리·무기·에너지 코어)  */
/* ------------------------------------------------------------------ */

function drawWeapon(ctx, skin, r, layer) {
  const o = PALETTE.outline;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (skin.weapon) {
    case "SWORD": {
      if (layer !== "front") return;
      ctx.beginPath();
      ctx.moveTo(r * 0.35, r * 0.62);
      ctx.lineTo(r * 1.55, r * 0.42);
      ctx.strokeStyle = o;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.42, r * 0.38);
      ctx.lineTo(r * 0.5, r * 0.88);
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      break;
    }
    case "BOW": {
      if (layer !== "front") return;
      ctx.beginPath();
      ctx.arc(r * 0.35, 0, r * 0.95, -1.05, 1.05);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.35 + Math.cos(-1.05) * r * 0.95, Math.sin(-1.05) * r * 0.95);
      ctx.lineTo(r * 0.35 + Math.cos(1.05) * r * 0.95, Math.sin(1.05) * r * 0.95);
      ctx.strokeStyle = "rgba(226, 232, 240, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case "STAFF_STAR":
    case "ICE_STAFF":
    case "WAND": {
      if (layer !== "front") return;
      const len = skin.weapon === "WAND" ? r * 1.1 : r * 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, r * 0.72);
      ctx.lineTo(len, r * 0.72);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = skin.weapon === "ICE_STAFF" ? "#BAE6FD" : "#CBD5E1";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(len, r * 0.72);
      if (skin.weapon === "ICE_STAFF") {
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(0, -4);
        ctx.lineTo(-3, 0);
        ctx.lineTo(0, 4);
        ctx.closePath();
        ctx.fillStyle = skin.core;
        ctx.fill();
        ctx.strokeStyle = o;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + VS.clock * 2;
          const rr = i % 2 ? 1.6 : 4;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = skin.core;
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "SHIELD": {
      if (layer !== "front") return;
      ctx.beginPath();
      ctx.moveTo(r * 0.62, -r * 1.0);
      ctx.lineTo(r * 1.08, -r * 0.7);
      ctx.lineTo(r * 1.08, r * 0.35);
      ctx.lineTo(r * 0.62, r * 0.55);
      ctx.closePath();
      ctx.fillStyle = skin.body;
      ctx.fill();
      ctx.strokeStyle = o;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.85, -r * 0.75);
      ctx.lineTo(r * 0.85, r * 0.3);
      ctx.strokeStyle = skin.trim;
      ctx.lineWidth = 2;
      ctx.stroke();
      // 마그마 균열 디테일
      ctx.fillStyle = skin.core;
      ctx.fillRect(r * 0.9, -r * 0.25, 2, 2);
      break;
    }
    case "DAGGERS": {
      if (layer !== "front") return;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.5, s * r * 0.62);
        ctx.lineTo(r * 1.25, s * r * 0.78);
        ctx.strokeStyle = o;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = skin.trim;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      break;
    }
    case "FLAME": {
      if (layer !== "front") return;
      for (const s of [-1, 1]) {
        const fl = 1 + Math.sin(VS.clock * 18 + s) * 0.2;
        const fx = r * 0.78;
        const fy = s * r * 0.62;
        const g = ctx.createRadialGradient(fx, fy, 0.5, fx, fy, 4.5 * fl);
        g.addColorStop(0, "#FFFBEB");
        g.addColorStop(0.45, "#FBBF24");
        g.addColorStop(1, "rgba(220, 38, 38, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, 4.5 * fl, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "RIFLE": {
      if (layer !== "front") return;
      ctx.fillStyle = o;
      ctx.fillRect(-r * 0.15, r * 0.18, r * 1.75, 5);
      ctx.fillStyle = "#64748B";
      ctx.fillRect(-r * 0.1, r * 0.22, r * 1.65, 3);
      ctx.fillStyle = skin.trim;
      ctx.fillRect(r * 1.45, r * 0.22, 3, 3);
      break;
    }
    case "LANCE": {
      if (layer === "back") {
        // 등 뒤 태양 원반
        ctx.beginPath();
        ctx.arc(-r * 0.55, 0, r * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = skin.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.6);
      ctx.lineTo(r * 1.7, r * 0.45);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 1.95, r * 0.43);
      ctx.lineTo(r * 1.6, r * 0.3);
      ctx.lineTo(r * 1.6, r * 0.6);
      ctx.closePath();
      ctx.fillStyle = skin.trim;
      ctx.fill();
      break;
    }
    case "GAUNTLET": {
      if (layer !== "front") return;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(r * 0.78, s * r * 0.56, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = skin.trim;
        ctx.fill();
        ctx.strokeStyle = o;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = skin.accent;
        ctx.fillRect(r * 0.95, s * r * 0.56 - 1.5, 2.5, 3);
      }
      break;
    }
    case "SCYTHE": {
      if (layer !== "front") return;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.95);
      ctx.lineTo(r * 1.2, -r * 0.2);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#94A3B8";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.75, -r * 0.2, r * 0.6, -0.4, -2.2, true);
      ctx.strokeStyle = o;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

function drawChampionBody(ctx, f, skin, r, alpha) {
  const o = PALETTE.outline;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(f.x, f.y);
  ctx.rotate(f.facing);

  // 망토 (흔들림)
  const sway = Math.sin(VS.clock * 6 + f.x * 0.05) * r * 0.08;
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 0.72);
  ctx.lineTo(-r * 1.0, -r * 0.6 + sway);
  ctx.lineTo(-r * 1.2, sway);
  ctx.lineTo(-r * 1.0, r * 0.6 + sway);
  ctx.lineTo(-r * 0.15, r * 0.72);
  ctx.closePath();
  ctx.fillStyle = skin.cape;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 망토 팀 컬러 밑단
  ctx.beginPath();
  ctx.moveTo(-r * 1.0, -r * 0.6 + sway);
  ctx.lineTo(-r * 1.2, sway);
  ctx.lineTo(-r * 1.0, r * 0.6 + sway);
  ctx.strokeStyle = teamColor(f.team);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  drawWeapon(ctx, skin, r, "back");

  // 동체
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.62, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.body;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 견갑
  const pr = skin.heavy ? r * 0.44 : r * 0.33;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(-r * 0.05, s * r * 0.72, pr, 0, Math.PI * 2);
    ctx.fillStyle = skin.trim;
    ctx.fill();
    ctx.strokeStyle = o;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // 하이라이트 픽셀
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillRect(-r * 0.05 - 1, s * r * 0.72 - pr * 0.55, 2, 2);
  }

  // 에너지 코어 (가슴)
  const coreGlow = 0.45 + clamp(f.energy / 100, 0, 1) * 0.55;
  ctx.fillStyle = skin.core;
  ctx.globalAlpha *= coreGlow;
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -3);
  ctx.lineTo(-r * 0.3 + 3, 0);
  ctx.lineTo(-r * 0.3, 3);
  ctx.lineTo(-r * 0.3 - 3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha /= coreGlow;

  // 머리 + 바이저
  ctx.beginPath();
  ctx.arc(r * 0.16, 0, r * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = skin.body;
  ctx.fill();
  ctx.strokeStyle = o;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = skin.accent;
  ctx.fillRect(r * 0.3, -r * 0.18, 2.5, r * 0.36);

  drawWeapon(ctx, skin, r, "front");
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
    ctx.ellipse(f.x, f.y + 2, r * 0.9, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0B0F17";
    ctx.fill();
    ctx.strokeStyle = teamColor(f.team);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x - 4, f.y - 2);
    ctx.lineTo(f.x + 4, f.y + 6);
    ctx.moveTo(f.x + 4, f.y - 2);
    ctx.lineTo(f.x - 4, f.y + 6);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 시각 히트스톱 지터 (게임 좌표는 변경하지 않음)
  let jx = 0;
  let jy = 0;
  if (fv && fv.jitter > 0) {
    jx = rand(-2.2, 2.2);
    jy = rand(-2.2, 2.2);
  }
  const view = { x: f.x + jx, y: f.y + jy, facing: f.facing, energy: f.energy, team: f.team };

  // 대시 잔상
  if (fv) {
    for (const a of fv.afterimages) {
      const t = a.life / a.max;
      drawChampionBody(ctx, { x: a.x, y: a.y, facing: a.facing, energy: 0, team: f.team }, skin, r, t * 0.32);
    }
  }

  const stealthAlpha = f.stealthTimer > 0 ? 0.35 : 1;

  ctx.save();
  ctx.globalAlpha = stealthAlpha;

  // 접지 그림자 (Contact Shadow)
  ctx.beginPath();
  ctx.ellipse(view.x + 1.5, view.y + r * 0.7, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fill();

  // 진영 베이스 링 (지면)
  ctx.beginPath();
  ctx.ellipse(view.x, view.y + 2, r + 4, (r + 4) * 0.82, 0, 0, Math.PI * 2);
  ctx.strokeStyle = teamColor(f.team);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = f.team === "red" ? "rgba(244, 63, 94, 0.10)" : "rgba(56, 189, 248, 0.10)";
  ctx.fill();

  // 방향 셰브론 (베이스 링 바깥)
  const tip = r + 10;
  ctx.beginPath();
  ctx.moveTo(view.x + Math.cos(f.facing) * tip, view.y + Math.sin(f.facing) * tip);
  ctx.lineTo(view.x + Math.cos(f.facing - 0.22) * (r + 5), view.y + Math.sin(f.facing - 0.22) * (r + 5));
  ctx.lineTo(view.x + Math.cos(f.facing + 0.22) * (r + 5), view.y + Math.sin(f.facing + 0.22) * (r + 5));
  ctx.closePath();
  ctx.fillStyle = teamColor(f.team);
  ctx.fill();

  // 궁극기 준비 골드 오라
  if (f.energy >= 100) {
    ctx.beginPath();
    ctx.arc(view.x, view.y, r + 6 + Math.sin(VS.clock * 8) * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = stealthAlpha;
  drawChampionBody(ctx, view, skin, r, 1);

  // 반격 육각 방패 돔
  if (f.counterTimer > 0) {
    const hexR = r + 6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = VS.clock * 2 + (i * Math.PI) / 3;
      const hx = view.x + Math.cos(a) * hexR;
      const hy = view.y + Math.sin(a) * hexR;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 158, 11, 0.14)";
    ctx.fill();
    ctx.strokeStyle = PALETTE.crit;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // 히트 플래시 (화이트/크림슨 2프레임)
  if (fv && fv.flash > 0) {
    ctx.beginPath();
    ctx.arc(view.x, view.y, r * 1.05, 0, Math.PI * 2);
    ctx.fillStyle = fv.flashColor;
    ctx.globalAlpha = stealthAlpha * 0.85;
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
  }
  ctx.restore();
}

function drawWorldHud(ctx, f) {
  if (!f.alive) return;
  const fv = VS.fighters.get(f.unitId);
  const champ = getChampionById(f.champId);
  const W = 32;
  const x = Math.round(f.x - W / 2);
  const y = Math.round(f.y - f.radius - 17);
  const hpRatio = clamp(f.hp / f.maxHp, 0, 1);
  const ghostRatio = fv ? clamp(fv.ghostHp / f.maxHp, 0, 1) : hpRatio;

  ctx.save();
  ctx.globalAlpha = f.stealthTimer > 0 ? 0.5 : 1;

  // 프레임
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(x - 1, y - 1, W + 2, 9);
  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, W + 3, 10);

  // HP: 잔여 데미지(흰색) → 현재 HP(팀 컬러)
  ctx.fillStyle = "#E2E8F0";
  ctx.fillRect(x, y, Math.round(W * ghostRatio), 4);
  ctx.fillStyle = hpRatio < 0.3 ? PALETTE.crit : teamColor(f.team);
  ctx.fillRect(x, y, Math.round(W * hpRatio), 4);
  // 100HP 눈금
  ctx.fillStyle = "rgba(11, 15, 23, 0.7)";
  for (let t = 100; t < f.maxHp; t += 100) {
    ctx.fillRect(x + Math.round((t / f.maxHp) * W), y, 1, 4);
  }
  // 보호막
  if (f.shield > 0) {
    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.fillRect(x, y, Math.round(W * clamp(f.shield / f.maxHp, 0, 1)), 1.5);
  }

  // 에너지 게이지 (4분할)
  const ey = y + 5;
  const segW = (W - 3) / 4;
  for (let s = 0; s < 4; s++) {
    const fill = clamp((f.energy - s * 25) / 25, 0, 1);
    const sx = x + s * (segW + 1);
    ctx.fillStyle = "#1B2433";
    ctx.fillRect(sx, ey, segW, 2);
    if (fill > 0) {
      ctx.fillStyle = f.energy >= 100 ? PALETTE.crit : PALETTE.gold;
      ctx.fillRect(sx, ey, segW * fill, 2);
    }
  }

  // 반격(Q) 쿨타임 게이지 (우측 세로 바)
  const qMax = (champ?.counterSkill?.cd || 8) * (champ?.patchMod?.cdMult || 1);
  const qFrac = 1 - clamp((f.cds?.counter || 0) / qMax, 0, 1);
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(x + W + 2, y - 1, 4, 9);
  ctx.fillStyle = qFrac >= 1 ? PALETTE.blue : "#334155";
  ctx.fillRect(x + W + 3, y + 7 - Math.round(7 * qFrac), 2, Math.round(7 * qFrac));

  // 숙련도 랭크 태그
  const lv = Number(f.masteryLevel || 1);
  const rank = lv >= 4 ? "S" : lv === 3 ? "A" : lv === 2 ? "B" : "C";
  const rankCol = rank === "S" ? PALETTE.gold : rank === "A" ? PALETTE.crit : rank === "B" ? PALETTE.blue : "#94A3B8";
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(x - 9, y - 1, 7, 9);
  ctx.fillStyle = rankCol;
  ctx.font = "900 7px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(rank, x - 5.5, y + 6);

  // CC 상태 아이콘
  const icons = [];
  if (f.stunTimer > 0) icons.push("STUN");
  if (f.slowTimer > 0) icons.push("SLOW");
  if (f.stealthTimer > 0) icons.push("STEALTH");
  if (f.counterTimer > 0) icons.push("COUNTER");
  if (f.hasteTimer > 0) icons.push("HASTE");
  const startX = f.x - ((icons.length - 1) * 12) / 2;
  icons.forEach((k, i) => drawCCIcon(ctx, k, startX + i * 12, y - 9));

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
  canvas.width = 360;
  canvas.height = 420;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * 아레나 전체 프레임을 그리는 메인 읽기 전용 렌더 함수.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function renderArena(ctx, state) {
  const combat = state.combat;
  const { width, height, centerX, centerY } = combat.arena;
  const safeRadius = combat.arena.safeRadius ?? 175;

  VS.sync(state);

  // 엔진 쉐이크 + 로컬 감쇠 쉐이크 합성
  const engineShake = combat.shakeTimer > 0 ? Math.min(5, combat.shakeTimer * 30) : 0;
  const shake = Math.max(VS.shake, engineShake);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (shake > 0.05) {
    ctx.translate(rand(-shake, shake), rand(-shake, shake));
  }

  // 1. 캐싱된 정적 아레나
  const bg = VS.getBackground(width, height, centerX, centerY);
  if (bg) {
    ctx.drawImage(bg, 0, 0);
  } else {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, width, height);
  }

  // 2. 서든데스 해저드
  drawSuddenDeath(ctx, combat, width, height, centerX, centerY, safeRadius);

  // 3. 지면 레이어
  drawSignatureGround(ctx, combat);
  drawTelegraphs(ctx, combat);
  drawGroundEffects(ctx, combat);

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
