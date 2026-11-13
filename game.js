/**
 * 6인의 원정대 (Six Expedition) - 게임 엔진
 * 6인 비동기 방치형 협동 웹게임
 */

// Initial 6 Hero Preset Configuration
const DEFAULT_HEROES = [
  {
    id: 0,
    name: "플레이어 1",
    job: "바바리안 (탱커)",
    avatar: "🪓",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt", // hunt, mine, training
  },
  {
    id: 1,
    name: "플레이어 2",
    job: "아크메이지 (광역딜러)",
    avatar: "🔮",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt",
  },
  {
    id: 2,
    name: "플레이어 3",
    job: "성기사 (버퍼)",
    avatar: "🛡️",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt",
  },
  {
    id: 3,
    name: "플레이어 4",
    job: "암살자 (치명타)",
    avatar: "🗡️",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt",
  },
  {
    id: 4,
    name: "플레이어 5",
    job: "엘프 궁수 (속사딜러)",
    avatar: "🏹",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt",
  },
  {
    id: 5,
    name: "플레이어 6",
    job: "대사제 (성자/힐러)",
    avatar: "📜",
    level: 1,
    exp: 0,
    weaponLvl: 1,
    armorLvl: 1,
    skillLvl: 1,
    duty: "hunt",
  }
];

// Initial Facilities (Base Building)
const DEFAULT_FACILITIES = [
  { id: "mine", name: "에테르 마석 광산", icon: "⛏️", level: 1, baseCost: 100, costMult: 1.35, desc: "초당 에테르 마석을 채굴합니다." },
  { id: "alchemy", name: "연금술 공방", icon: "⚗️", level: 1, baseCost: 50, costMult: 1.25, desc: "초당 지속적으로 골드를 생산합니다." },
  { id: "barracks", name: "원정대 훈련장", icon: "🎯", level: 1, baseCost: 150, costMult: 1.3, desc: "모든 영웅이 방치 중 초당 경험치를 얻습니다." },
  { id: "altar", name: "고대 제단", icon: "✨", level: 0, baseCost: 500, costMult: 1.5, desc: "파티 전체 공격력을 영구히 5%씩 증폭시킵니다." }
];

// World Boss Preset
const WORLD_BOSS = {
  name: "심연의 흑룡 '카라시스'",
  icon: "🐉",
  level: 1,
  hp: 50000,
  maxHp: 50000,
};

class GameEngine {
  constructor() {
    this.gold = 50;
    this.ether = 0;
    this.stage = 1;
    this.autoCombat = true;
    this.selectedHeroIndex = 0;
    this.lastSavedTime = Date.now();

    this.heroes = JSON.parse(JSON.stringify(DEFAULT_HEROES));
    this.facilities = JSON.parse(JSON.stringify(DEFAULT_FACILITIES));
    this.worldBoss = JSON.parse(JSON.stringify(WORLD_BOSS));

    // Enemy in current stage
    this.currentEnemy = null;
    this.isBossStage = false;
    this.bossTimerSec = 0;
    this.bossTimerMax = 30;

    // Loop intervals
    this.combatInterval = null;
    this.idleProductionInterval = null;
    this.autoSaveInterval = null;
  }

  init() {
    this.loadGame();
    this.bindEvents();
    this.spawnEnemy();
    this.renderAll();

    // Start Main Loops
    this.combatInterval = setInterval(() => this.combatTick(), 1000);
    this.idleProductionInterval = setInterval(() => this.productionTick(), 1000);
    this.autoSaveInterval = setInterval(() => this.saveGame(false), 5000);
  }

  // --- Calculations ---
  getHeroAtk(hero) {
    const base = 5 + hero.level * 4 + hero.weaponLvl * 6;
    const altar = this.facilities.find(f => f.id === 'altar');
    const altarBuff = 1 + (altar ? altar.level * 0.05 : 0);
    const paladin = this.heroes[2]; // Slot 2: Paladin Party Buff
    const partyBuff = 1 + (paladin.skillLvl * 0.03);
    return Math.floor(base * altarBuff * partyBuff);
  }

  getTotalPartyAtk() {
    return this.heroes.reduce((sum, h) => {
      // Heroes on duty "hunt" contribute 100% ATK, others contribute 50%
      const mult = h.duty === "hunt" ? 1.0 : 0.5;
      return sum + Math.floor(this.getHeroAtk(h) * mult);
    }, 0);
  }

  getExpForNextLevel(level) {
    return Math.floor(25 * Math.pow(1.22, level - 1));
  }

  getFacilityCost(fac) {
    return Math.floor(fac.baseCost * Math.pow(fac.costMult, fac.level));
  }

  // --- Combat Logic ---
  spawnEnemy() {
    this.isBossStage = (this.stage % 5 === 0);
    const isBoss = this.isBossStage;
    const hpMult = isBoss ? 6.5 : 1.0;
    const baseHp = Math.floor((40 + this.stage * 35 * Math.pow(1.12, this.stage / 2)) * hpMult);

    const normalMonsters = [
      { name: "던전 슬라임", avatar: "👾" },
      { name: "고블린 척후병", avatar: "👺" },
      { name: "골격 전사", avatar: "💀" },
      { name: "동굴 거미", avatar: "🕷️" },
      { name: "그림자 박쥐", avatar: "🦇" },
      { name: "사악한 놀", avatar: "🐺" }
    ];

    const bossMonsters = [
      { name: "오우거 족장", avatar: "👹" },
      { name: "고대 바위 골렘", avatar: "🗿" },
      { name: "리치 로드", avatar: "🧙‍♂️" },
      { name: "심연의 베히모스", avatar: "🦏" },
      { name: "화염의 드래곤", avatar: "🐲" }
    ];

    const list = isBoss ? bossMonsters : normalMonsters;
    const choice = list[Math.floor(Math.random() * list.length)];

    this.currentEnemy = {
      name: `${choice.name} (Lv.${this.stage})`,
      avatar: choice.avatar,
      isBoss: isBoss,
      hp: baseHp,
      maxHp: baseHp,
      goldReward: Math.floor((15 + this.stage * 8) * (isBoss ? 4.5 : 1)),
      etherReward: isBoss ? Math.floor(2 + this.stage * 0.8) : (Math.random() < 0.25 ? 1 : 0),
      expReward: Math.floor((12 + this.stage * 6) * (isBoss ? 3 : 1))
    };

    if (isBoss) {
      this.bossTimerSec = this.bossTimerMax;
      this.addLog(`🚨 보스 출현! [${this.currentEnemy.name}]이 앞을 막아섭니다!`, 'boss');
    }

    this.renderStageView();
  }

  combatTick() {
    if (!this.autoCombat || !this.currentEnemy) return;

    // Check Boss Timer
    if (this.currentEnemy.isBoss) {
      this.bossTimerSec -= 1;
      if (this.bossTimerSec <= 0) {
        this.addLog(`❌ 보스 토벌 시간 초과! 이전 층으로 후퇴합니다.`, 'boss');
        this.stage = Math.max(1, this.stage - 1);
        this.spawnEnemy();
        return;
      }
      const timerEl = document.getElementById('stage-timer');
      if (timerEl) timerEl.textContent = `⏳ 제한 시간: ${this.bossTimerSec}초`;
    } else {
      const timerEl = document.getElementById('stage-timer');
      if (timerEl) timerEl.textContent = '';
    }

    // Each hero strikes
    this.heroes.forEach((hero, idx) => {
      if (this.currentEnemy.hp <= 0) return;

      const heroSlotEl = document.getElementById(`hero-slot-${idx}`);
      if (heroSlotEl) {
        heroSlotEl.classList.add('attacking');
        setTimeout(() => heroSlotEl.classList.remove('attacking'), 300);
      }

      const atk = this.getHeroAtk(hero);
      // Assassin (Slot 3) has higher crit chance
      const isCrit = (idx === 3 && Math.random() < 0.35) || Math.random() < 0.12;
      const dmg = isCrit ? Math.floor(atk * 1.8) : atk;

      this.currentEnemy.hp -= dmg;
      Sound.playAttack(isCrit);
      this.showDamagePopup(dmg, isCrit);

      // Hero gains EXP from hit
      this.grantHeroExp(hero, Math.max(1, Math.floor(this.currentEnemy.expReward / 6)));
    });

    this.updateEnemyHpBar();

    // Check Enemy Defeat
    if (this.currentEnemy.hp <= 0) {
      this.onEnemyDefeated();
    }
  }

  onEnemyDefeated() {
    const enemy = this.currentEnemy;
    this.gold += enemy.goldReward;
    this.ether += enemy.etherReward;

    let logMsg = `🏆 [${enemy.name}] 처치! +${enemy.goldReward}G`;
    if (enemy.etherReward > 0) logMsg += ` +${enemy.etherReward}💎`;
    this.addLog(logMsg, 'reward');

    if (enemy.isBoss) {
      Sound.playVictory();
    }

    // Advance Stage
    this.stage += 1;
    this.spawnEnemy();
    this.renderHeaderResources();
  }

  grantHeroExp(hero, expAmount) {
    hero.exp += expAmount;
    let needed = this.getExpForNextLevel(hero.level);
    while (hero.exp >= needed) {
      hero.exp -= needed;
      hero.level += 1;
      Sound.playLevelUp();
      this.addLog(`✨ [${hero.name}] 레벨 업! Lv.${hero.level} 달성!`, 'sys');
      needed = this.getExpForNextLevel(hero.level);
    }
  }

  // --- Production Tick (Per Second) ---
  productionTick() {
    // 1. Facilities
    const alchemy = this.facilities.find(f => f.id === 'alchemy');
    const mine = this.facilities.find(f => f.id === 'mine');
    const barracks = this.facilities.find(f => f.id === 'barracks');

    if (alchemy && alchemy.level > 0) {
      this.gold += Math.floor(alchemy.level * 2);
    }
    if (mine && mine.level > 0) {
      // 20% chance per second per level to get Ether
      if (Math.random() < 0.2 * mine.level) {
        this.ether += 1;
      }
    }
    if (barracks && barracks.level > 0) {
      this.heroes.forEach(h => {
        this.grantHeroExp(h, barracks.level * 2);
      });
    }

    // 2. Hero Duty Rewards
    this.heroes.forEach(h => {
      if (h.duty === 'mine') {
        if (Math.random() < 0.15) this.ether += 1;
      } else if (h.duty === 'training') {
        this.grantHeroExp(h, 4);
      }
    });

    this.renderHeaderResources();
    this.renderHeroSlots();
  }

  // --- Offline Idle Calculation ---
  processOfflineTime() {
    const now = Date.now();
    const diffSec = Math.floor((now - this.lastSavedTime) / 1000);

    // Min 10 seconds to trigger offline modal, max capped at 24 hours (86,400s)
    if (diffSec >= 10) {
      const cappedSec = Math.min(diffSec, 86400);

      const alchemy = this.facilities.find(f => f.id === 'alchemy');
      const goldPerSec = (alchemy ? alchemy.level * 2 : 1) + (this.stage * 0.5);
      const earnedGold = Math.floor(goldPerSec * cappedSec * 0.7);

      const mine = this.facilities.find(f => f.id === 'mine');
      const earnedEther = Math.floor((mine ? mine.level * 0.05 : 0.01) * cappedSec);

      const expPerHero = Math.floor(cappedSec * (1 + this.stage * 0.1));
      this.heroes.forEach(h => this.grantHeroExp(h, expPerHero));

      this.gold += earnedGold;
      this.ether += earnedEther;

      // Show Offline Modal
      this.showOfflineModal(cappedSec, earnedGold, earnedEther, expPerHero);
    }
    this.lastSavedTime = Date.now();
  }

  showOfflineModal(sec, gold, ether, exp) {
    const modal = document.getElementById('offline-modal');
    const timeText = document.getElementById('offline-time-text');
    const list = document.getElementById('offline-rewards-list');
    if (!modal || !timeText || !list) return;

    const mins = Math.floor(sec / 60);
    const hours = Math.floor(mins / 60);
    const timeStr = hours > 0 ? `${hours}시간 ${mins % 60}분` : `${mins}분 ${sec % 60}초`;

    timeText.innerHTML = `자리 비움 동안 <strong>${timeStr}</strong> 동안 원정대가 쉼 없이 탐험했습니다!`;
    list.innerHTML = `
      <div class="off-item">🪙 +${gold.toLocaleString()} Gold</div>
      <div class="off-item">💎 +${ether.toLocaleString()} Ether</div>
      <div class="off-item">📖 영웅당 +${exp.toLocaleString()} EXP</div>
    `;

    modal.classList.add('active');
  }

  // --- Save / Load System ---
  saveGame(notify = true) {
    this.lastSavedTime = Date.now();
    const data = {
      version: 1.1,
      savedAt: this.lastSavedTime,
      gold: this.gold,
      ether: this.ether,
      stage: this.stage,
      heroes: this.heroes,
      facilities: this.facilities,
      worldBoss: this.worldBoss
    };

    const str = JSON.stringify(data);
    localStorage.setItem('six_expedition_save', str);

    if (notify) {
      this.addLog(`💾 게임 데이터가 성공적으로 저장되었습니다!`, 'sys');
    }
    return str;
  }

  loadGame() {
    const saved = localStorage.getItem('six_expedition_save');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.gold = data.gold || 0;
        this.ether = data.ether || 0;
        this.stage = data.stage || 1;
        this.lastSavedTime = data.savedAt || Date.now();

        if (Array.isArray(data.heroes) && data.heroes.length === 6) {
          this.heroes = data.heroes;
        }
        if (Array.isArray(data.facilities)) {
          this.facilities = data.facilities;
        }
        if (data.worldBoss) {
          this.worldBoss = data.worldBoss;
        }

        this.processOfflineTime();
      } catch (e) {
        console.error("Save load failed:", e);
      }
    }
  }

  getExportCode() {
    const jsonStr = this.saveGame(false);
    return btoa(encodeURIComponent(jsonStr));
  }

  importSaveCode(code) {
    try {
      const decoded = decodeURIComponent(atob(code.trim()));
      const data = JSON.parse(decoded);
      if (data.heroes && data.stage) {
        localStorage.setItem('six_expedition_save', decoded);
        this.loadGame();
        this.renderAll();
        alert("🎉 세이브 데이터를 정상적으로 불러왔습니다!");
        return true;
      }
    } catch (e) {
      alert("⚠️ 올바르지 않은 세이브 코드입니다. 코드를 다시 확인해주세요.");
    }
    return false;
  }

  // --- Rendering UI ---
  renderAll() {
    this.renderHeaderResources();
    this.renderStageView();
    this.renderHeroSlots();
    this.renderPlayerSelectButtons();
    this.renderHeroDetail();
    this.renderFacilities();
    this.renderRaid();
  }

  renderHeaderResources() {
    document.getElementById('res-gold').textContent = this.gold.toLocaleString();
    document.getElementById('res-ether').textContent = this.ether.toLocaleString();
    document.getElementById('res-stage').textContent = `${this.stage}F`;
  }

  renderStageView() {
    if (!this.currentEnemy) return;
    document.getElementById('stage-name').textContent = `던전 깊은 곳 - ${this.stage}층`;
    document.getElementById('enemy-name').textContent = this.currentEnemy.name;
    document.getElementById('enemy-avatar').textContent = this.currentEnemy.avatar;

    const badge = document.getElementById('enemy-type-badge');
    if (badge) {
      badge.textContent = this.currentEnemy.isBoss ? "👑 층 보스" : "일반 몬스터";
      badge.className = this.currentEnemy.isBoss ? "badge boss" : "badge";
    }

    this.updateEnemyHpBar();
  }

  updateEnemyHpBar() {
    if (!this.currentEnemy) return;
    const pct = Math.max(0, Math.min(100, (this.currentEnemy.hp / this.currentEnemy.maxHp) * 100));
    const hpBar = document.getElementById('enemy-hp-bar');
    const hpText = document.getElementById('enemy-hp-text');
    if (hpBar) hpBar.style.width = `${pct}%`;
    if (hpText) hpText.textContent = `${Math.max(0, this.currentEnemy.hp).toLocaleString()} / ${this.currentEnemy.maxHp.toLocaleString()}`;
  }

  renderHeroSlots() {
    this.heroes.forEach((hero, idx) => {
      const slotEl = document.getElementById(`hero-slot-${idx}`);
      if (!slotEl) return;

      const isSelected = (idx === this.selectedHeroIndex);
      slotEl.className = `hero-slot ${isSelected ? 'selected' : ''}`;

      const dutyLabels = { hunt: "⚔️ 전투 사냥", mine: "⛏️ 에테르 채굴", training: "📖 수련 중" };

      slotEl.innerHTML = `
        <div class="slot-header">
          <div class="slot-avatar">${hero.avatar}</div>
          <div class="slot-name-col">
            <div class="slot-player-name">${hero.name}</div>
            <div class="slot-job-title">${hero.job}</div>
          </div>
        </div>
        <div class="slot-stats-mini">
          <span>Lv.${hero.level}</span>
          <span>공격력: <strong>${this.getHeroAtk(hero)}</strong></span>
        </div>
        <div class="slot-action-badge">${dutyLabels[hero.duty] || "대기"}</div>
      `;
    });
  }

  renderPlayerSelectButtons() {
    const container = document.getElementById('player-select-btns');
    if (!container) return;
    container.innerHTML = '';

    this.heroes.forEach((hero, idx) => {
      const btn = document.createElement('button');
      btn.className = `player-btn ${idx === this.selectedHeroIndex ? 'active' : ''}`;
      btn.textContent = `${idx + 1}`;
      btn.title = `${hero.name} (${hero.job})`;
      btn.addEventListener('click', () => {
        Sound.playClick();
        this.selectedHeroIndex = idx;
        this.renderPlayerSelectButtons();
        this.renderHeroDetail();
        this.renderHeroSlots();
      });
      container.appendChild(btn);
    });
  }

  renderHeroDetail() {
    const container = document.getElementById('hero-detail-card');
    if (!container) return;

    const hero = this.heroes[this.selectedHeroIndex];
    const expNeed = this.getExpForNextLevel(hero.level);
    const weaponCost = Math.floor(30 * Math.pow(1.3, hero.weaponLvl));
    const armorCost = Math.floor(25 * Math.pow(1.28, hero.armorLvl));
    const skillCost = Math.floor(50 * Math.pow(1.35, hero.skillLvl));

    container.innerHTML = `
      <div class="hero-title-row">
        <div class="hero-title-left">
          <div class="hero-detail-avatar">${hero.avatar}</div>
          <div>
            <input type="text" class="hero-edit-name" id="input-hero-name" value="${hero.name}" title="클릭하여 이름 변경" />
            <span class="hero-job-badge">${hero.job}</span>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: var(--accent-gold);">Lv.${hero.level}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">EXP: ${hero.exp} / ${expNeed}</div>
        </div>
      </div>

      <!-- Upgrades Grid -->
      <div class="upgrade-grid">
        <div class="upgrade-card">
          <div class="upg-info">
            <h4>⚔️ 무기 강화 (Lv.${hero.weaponLvl})</h4>
            <p>공격력 +6 증가</p>
          </div>
          <button class="upg-btn" id="btn-upg-weapon" ${this.gold < weaponCost ? 'disabled' : ''}>
            <span>강화</span><span>🪙 ${weaponCost.toLocaleString()}</span>
          </button>
        </div>

        <div class="upgrade-card">
          <div class="upg-info">
            <h4>🛡️ 방어구 강화 (Lv.${hero.armorLvl})</h4>
            <p>전투 생존력 및 골드 획득량 증가</p>
          </div>
          <button class="upg-btn" id="btn-upg-armor" ${this.gold < armorCost ? 'disabled' : ''}>
            <span>강화</span><span>🪙 ${armorCost.toLocaleString()}</span>
          </button>
        </div>

        <div class="upgrade-card">
          <div class="upg-info">
            <h4>✨ 고유 스킬 연마 (Lv.${hero.skillLvl})</h4>
            <p>직업 전용 특수 효과 증폭</p>
          </div>
          <button class="upg-btn" id="btn-upg-skill" ${this.gold < skillCost ? 'disabled' : ''}>
            <span>연마</span><span>🪙 ${skillCost.toLocaleString()}</span>
          </button>
        </div>

        <div class="upgrade-card">
          <div class="upg-info">
            <h4>💎 에테르 각성</h4>
            <p>에테르 마석으로 영구 스탯 10% 증가</p>
          </div>
          <button class="upg-btn" id="btn-upg-awaken" ${this.ether < 10 ? 'disabled' : ''}>
            <span>각성</span><span>💎 10</span>
          </button>
        </div>
      </div>

      <!-- Duty Assignment (Idle Task) -->
      <div class="duty-section">
        <h4>📋 방치 임무 지정 (오프라인/자동 행동)</h4>
        <div class="duty-options">
          <button class="duty-btn ${hero.duty === 'hunt' ? 'active' : ''}" data-duty="hunt">
            ⚔️ 던전 사냥<br><small>던전 클리어 집중</small>
          </button>
          <button class="duty-btn ${hero.duty === 'mine' ? 'active' : ''}" data-duty="mine">
            ⛏️ 마석 채굴<br><small>에테르 마석 파밍</small>
          </button>
          <button class="duty-btn ${hero.duty === 'training' ? 'active' : ''}" data-duty="training">
            📖 수련원 수련<br><small>빠른 레벨업</small>
          </button>
        </div>
      </div>
    `;

    // Bind Name Change Event
    const nameInput = document.getElementById('input-hero-name');
    if (nameInput) {
      nameInput.addEventListener('change', (e) => {
        hero.name = e.target.value.trim() || `플레이어 ${hero.id + 1}`;
        this.renderHeroSlots();
        this.renderPlayerSelectButtons();
        this.saveGame(false);
      });
    }

    // Bind Upgrade Buttons
    const btnWeapon = document.getElementById('btn-upg-weapon');
    if (btnWeapon) {
      btnWeapon.addEventListener('click', () => {
        if (this.gold >= weaponCost) {
          this.gold -= weaponCost;
          hero.weaponLvl += 1;
          Sound.playLevelUp();
          this.renderAll();
        }
      });
    }

    const btnArmor = document.getElementById('btn-upg-armor');
    if (btnArmor) {
      btnArmor.addEventListener('click', () => {
        if (this.gold >= armorCost) {
          this.gold -= armorCost;
          hero.armorLvl += 1;
          Sound.playLevelUp();
          this.renderAll();
        }
      });
    }

    const btnSkill = document.getElementById('btn-upg-skill');
    if (btnSkill) {
      btnSkill.addEventListener('click', () => {
        if (this.gold >= skillCost) {
          this.gold -= skillCost;
          hero.skillLvl += 1;
          Sound.playLevelUp();
          this.renderAll();
        }
      });
    }

    const btnAwaken = document.getElementById('btn-upg-awaken');
    if (btnAwaken) {
      btnAwaken.addEventListener('click', () => {
        if (this.ether >= 10) {
          this.ether -= 10;
          hero.level += 2;
          hero.weaponLvl += 2;
          Sound.playVictory();
          this.addLog(`🌟 [${hero.name}] 에테르 각성 성공! 스탯이 대폭 상승했습니다!`, 'sys');
          this.renderAll();
        }
      });
    }

    // Duty Click Events
    container.querySelectorAll('.duty-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const duty = btn.getAttribute('data-duty');
        hero.duty = duty;
        Sound.playClick();
        this.renderHeroDetail();
        this.renderHeroSlots();
      });
    });
  }

  renderFacilities() {
    const list = document.getElementById('facility-list');
    if (!list) return;
    list.innerHTML = '';

    this.facilities.forEach(fac => {
      const cost = this.getFacilityCost(fac);
      const card = document.createElement('div');
      card.className = 'facility-card';
      card.innerHTML = `
        <div class="fac-left">
          <div class="fac-icon">${fac.icon}</div>
          <div class="fac-text">
            <h4>${fac.name} (Lv.${fac.level})</h4>
            <p>${fac.desc}</p>
          </div>
        </div>
        <button class="btn btn-accent btn-sm" id="btn-fac-${fac.id}" ${this.gold < cost ? 'disabled' : ''}>
          업그레이드 (🪙 ${cost.toLocaleString()})
        </button>
      `;

      card.querySelector(`#btn-fac-${fac.id}`).addEventListener('click', () => {
        if (this.gold >= cost) {
          this.gold -= cost;
          fac.level += 1;
          Sound.playLevelUp();
          this.addLog(`🏗️ 시설 업그레이드 완료: [${fac.name}] Lv.${fac.level}!`, 'sys');
          this.renderAll();
        }
      });

      list.appendChild(card);
    });
  }

  renderRaid() {
    const container = document.getElementById('raid-container');
    if (!container) return;

    const totalAtk = this.getTotalPartyAtk();
    const hpPct = Math.max(0, (this.worldBoss.hp / this.worldBoss.maxHp) * 100);

    container.innerHTML = `
      <div class="raid-boss-card">
        <div class="raid-boss-icon">${this.worldBoss.icon}</div>
        <h3>${this.worldBoss.name} (Lv.${this.worldBoss.level})</h3>
        <div class="health-bar-container" style="width: 100%; height: 22px;">
          <div class="health-bar" style="width: ${hpPct}%; background: linear-gradient(90deg, #7c3aed, #a855f7);"></div>
          <span class="health-text">${this.worldBoss.hp.toLocaleString()} / ${this.worldBoss.maxHp.toLocaleString()}</span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted);">
          6명의 친구가 힘을 합쳐 보스를 처치하면 대량의 골드와 에테르 마석을 분배받습니다.
        </p>
      </div>

      <div class="raid-stats-summary">
        <div class="raid-stat-box">
          <div class="val">${totalAtk.toLocaleString()}</div>
          <div class="lbl">6인 원정대 총합 전투력</div>
        </div>
        <div class="raid-stat-box">
          <div class="val">${this.worldBoss.level * 25}💎</div>
          <div class="lbl">격파 시 에테르 보상</div>
        </div>
      </div>

      <button class="btn btn-danger btn-block" id="btn-raid-attack" style="padding: 12px; font-size: 1rem;">
        ⚔️ 6인 원정대 총공격 가하기!
      </button>
    `;

    const btnAttack = container.querySelector('#btn-raid-attack');
    if (btnAttack) {
      btnAttack.addEventListener('click', () => {
        const dmg = Math.floor(totalAtk * (1.2 + Math.random() * 0.5));
        this.worldBoss.hp -= dmg;
        Sound.playAttack(true);
        this.addLog(`💥 원정대 전원 총공격! 레이드 보스에게 ${dmg.toLocaleString()} 피해!`, 'boss');

        if (this.worldBoss.hp <= 0) {
          const rewardEther = this.worldBoss.level * 25;
          const rewardGold = this.worldBoss.level * 3000;
          this.ether += rewardEther;
          this.gold += rewardGold;
          Sound.playVictory();
          alert(`🎉 레이드 보스 처치 성공!\n보상: +${rewardGold.toLocaleString()} 골드, +${rewardEther} 에테르 마석!`);

          this.worldBoss.level += 1;
          this.worldBoss.maxHp = Math.floor(this.worldBoss.maxHp * 1.8);
          this.worldBoss.hp = this.worldBoss.maxHp;
        }

        this.renderRaid();
        this.renderHeaderResources();
      });
    }
  }

  showDamagePopup(dmg, isCrit) {
    const enemyCard = document.querySelector('.enemy-card');
    if (!enemyCard) return;

    const popup = document.createElement('div');
    popup.className = `dmg-popup ${isCrit ? 'crit' : ''}`;
    popup.textContent = `${isCrit ? 'CRIT! ' : ''}-${dmg}`;
    popup.style.left = `${40 + Math.random() * 40}%`;
    popup.style.top = `${20 + Math.random() * 40}%`;

    enemyCard.appendChild(popup);
    setTimeout(() => popup.remove(), 800);

    const avatar = document.getElementById('enemy-avatar');
    if (avatar) {
      avatar.classList.add('hit');
      setTimeout(() => avatar.classList.remove('hit'), 200);
    }
  }

  addLog(text, type = 'normal') {
    const box = document.getElementById('combat-log');
    if (!box) return;

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    entry.textContent = `[${time}] ${text}`;

    box.appendChild(entry);
    box.scrollTop = box.scrollHeight;

    while (box.children.length > 30) {
      box.removeChild(box.firstChild);
    }
  }

  // --- Event Bindings ---
  bindEvents() {
    // Sound Button
    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const isMuted = Sound.toggleMute();
        btnSound.textContent = isMuted ? "🔇 소리 Off" : "🔊 소리 On";
        btnSound.className = isMuted ? "btn btn-secondary btn-sm" : "btn btn-accent btn-sm";
      });
    }

    // Toggle Auto Combat
    const btnAuto = document.getElementById('btn-toggle-auto');
    if (btnAuto) {
      btnAuto.addEventListener('click', () => {
        this.autoCombat = !this.autoCombat;
        btnAuto.textContent = this.autoCombat ? "⚡ 자동 사냥 활성 중" : "⏸️ 자동 사냥 일시정지";
        btnAuto.className = this.autoCombat ? "btn btn-accent" : "btn btn-secondary";
      });
    }

    // Boss Challenge Button
    const btnBoss = document.getElementById('btn-challenge-boss');
    if (btnBoss) {
      btnBoss.addEventListener('click', () => {
        this.stage = Math.ceil(this.stage / 5) * 5;
        this.spawnEnemy();
        this.renderAll();
      });
    }

    // Navigation Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        Sound.playClick();
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const content = document.getElementById(targetId);
        if (content) content.classList.add('active');
      });
    });

    // Save Modal Open / Close
    const saveModal = document.getElementById('save-modal');
    const btnOpenSave = document.getElementById('btn-save-modal');
    const btnCloseSave = document.getElementById('btn-modal-close');
    const saveTextarea = document.getElementById('save-code-textarea');

    if (btnOpenSave && saveModal) {
      btnOpenSave.addEventListener('click', () => {
        Sound.playClick();
        if (saveTextarea) saveTextarea.value = this.getExportCode();
        saveModal.classList.add('active');
      });
    }

    if (btnCloseSave && saveModal) {
      btnCloseSave.addEventListener('click', () => saveModal.classList.remove('active'));
    }

    // Copy Save Code
    const btnCopy = document.getElementById('btn-copy-save');
    if (btnCopy && saveTextarea) {
      btnCopy.addEventListener('click', () => {
        saveTextarea.select();
        navigator.clipboard.writeText(saveTextarea.value).then(() => {
          alert("📋 세이브 코드가 클립보드에 복사되었습니다!\n친구에게 카카오톡/디스코드로 전달해 보세요.");
        }).catch(() => {
          alert("텍스트를 직접 드래그하여 복사해 주세요.");
        });
      });
    }

    // Load Save Code
    const btnLoad = document.getElementById('btn-load-save');
    if (btnLoad && saveTextarea) {
      btnLoad.addEventListener('click', () => {
        const code = saveTextarea.value;
        if (code) {
          if (this.importSaveCode(code)) {
            saveModal.classList.remove('active');
          }
        }
      });
    }

    // Download Save File (.json)
    const btnDownload = document.getElementById('btn-download-save');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(this.saveGame(false));
        const a = document.createElement('a');
        a.setAttribute("href", dataStr);
        a.setAttribute("download", `six_expedition_save_${Date.now()}.json`);
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

    // Reset Game
    const btnReset = document.getElementById('btn-reset-game');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm("⚠️ 정말로 모든 진행 상황을 초기화하시겠습니까?")) {
          localStorage.removeItem('six_expedition_save');
          location.reload();
        }
      });
    }

    // Claim Offline Rewards
    const btnClaim = document.getElementById('btn-claim-offline');
    const offlineModal = document.getElementById('offline-modal');
    if (btnClaim && offlineModal) {
      btnClaim.addEventListener('click', () => {
        Sound.playVictory();
        offlineModal.classList.remove('active');
        this.renderAll();
      });
    }
  }
}

// Start Game on Window Loaded
window.addEventListener('DOMContentLoaded', () => {
  window.Game = new GameEngine();
  window.Game.init();
});
