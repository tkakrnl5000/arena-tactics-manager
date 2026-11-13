# AGENTS.md — Arena Tactics Manager (아레나 택틱스 매니저) Architectural Contract

## 1. System Overview & Core Constraints
- **Title**: Arena Tactics Manager (아레나 택틱스 매니저)
- **Platform**: Mobile-first Web Browser (`9:16` portrait container, `max-width: 440px`, `100dvh`, touch-optimized).
- **Tech Stack**: Vanilla ES2022 Modules (`type="module"`), HTML5 Canvas 2D (`360x420` logical coordinate space), CSS3 Variables, Zero npm/bundler build step.
- **Core Loop**:
  1. **Club Management (Teamfight Manager style)**: 6-team league, 3v3 active roster (4 players per team: 3 starters + 1 sub), 4 player stats, 5 player traits, condition (`0..100`), champion mastery, weekly AP (`3 AP/week`) spent on Training / Scrim / FA Scouting, periodic balance patches every 2 weeks, LCK-style Bo3 Regular Season (5 weeks, 15 matches) + Top-4 Bo5 Playoffs.
  2. **Arena Combat (Battlerite style)**: 60fps 3v3 real-time arena with non-target skillshots, Counter stance (`Q`) with hitstop (`8 frames`), stun (`1.2s`), & energy gain, Center Energy Orb (`120 HP`, spawns every `15s`, grants `+25 Energy` & `+15% HP` teamwide on last hit), EX Skills (`50 Energy`) & Ultimates (`100 Energy`), Sudden Death shrinking vortex after `45s`, Between-set Rite Card draft (`12 Rite cards`), and 3 real-time Coach Tactical Calls.
  3. **Multiplayer & Drop-in Takeover**: 6-Team League (`Seat 0` Human Host + `Seats 1..5` AI Coaches initially). 4-digit Room Code (`1000..9999`) allows mid-season human takeover (`isAI: true -> false`). Uses **Neon Serverless Postgres HTTP SQL API** when configured, with automatic fallback to `BroadcastChannel` + `localStorage`.

---

## 2. Strict Module Boundaries

| File | Responsibility | Prohibited Actions |
| :--- | :--- | :--- |
| `AGENTS.md` | Single source of truth for schemas, signatures, SQL DDL, and verification rules. | N/A |
| `index.html` | 9:16 mobile shell, Top HUD, `#arena-canvas`, Combat Ticker, Bottom Tactical Bar, Modals. | No inline game logic. |
| `style.css` | Dark tactical UI, 9:16 responsive layout, touch buttons, draft/rite cards, animations. | No JS dependencies. |
| `js/state.js` | Pure JSON-serializable state tree, 12 champions, 12 Rite cards, 5 traits, 4 stats, initializers. | No DOM, Canvas, or network calls. |
| `js/engine.js` | 60fps physics, skillshots, Counter stance, Center Orb, EX/Ult, Sudden Death, Utility AI, Coach Calls. | No direct DOM manipulation or Canvas drawing. |
| `js/league.js` | 6-team round-robin schedule, headless match sim, standings tiebreakers, Bo5 playoffs, AP actions, balance patches. | No Canvas drawing or direct DOM rendering. |
| `js/network.js` | 4-digit Room Code create/join, seat takeover sync, Neon HTTP API client, `BroadcastChannel` + `localStorage` fallback. | No physics math or direct Canvas access. |
| `js/controller.js` | Main `requestAnimationFrame` loop, screen state machine, user action dispatch, DOM event listeners. | Must delegate rendering to `renderer.js` and `hud.js`. |
| `js/renderer.js` | Pure HTML5 Canvas 2D rendering (arena floor, safe zone, tokens, facing arrows, projectiles, counter aura, hitstop, shake). | **Zero game-state mutations.** |
| `js/hud.js` | Pure DOM rendering for screens, league table, draft grid, rite cards, coach buttons, modals. | **Zero physics/combat math.** |

---

## 3. Complete State Schemas (`js/state.js`)

### 3.1 Screen State Enum (`SCREEN_STATES`)
`"LOBBY" | "WEEKLY_HUB" | "DRAFT" | "COMBAT" | "RITE_DRAFT" | "PLAYOFF_BRACKET"`

### 3.2 Champion Pool Schema (`CHAMPIONS` — 12 Champions)
Each entry in `CHAMPIONS` (keyed and ordered by `id`):
```json
{
  "id": "kylen",
  "name": "카일렌 (Kylen)",
  "role": "MELEE",
  "color": "#ef4444",
  "baseHp": 680,
  "moveSpeed": 135,
  "radius": 16,
  "basicAtk": { "name": "섬광베기", "dmg": 48, "cd": 0.65, "range": 48, "projSpeed": 0, "isMelee": true },
  "skillPrimary": { "name": "질풍참", "dmg": 85, "cd": 4.5, "range": 140, "projSpeed": 420, "type": "DASH" },
  "counterSkill": { "name": "검기 반격", "cd": 8.0, "duration": 0.9, "stunDuration": 1.2, "retaliateDmg": 70 },
  "exSkill": { "name": "EX 혈풍섬", "cost": 50, "dmg": 135, "cd": 1.0, "range": 160, "healSelf": 65 },
  "ultSkill": { "name": "무쌍난무", "cost": 100, "dmg": 220, "range": 180, "aoeRadius": 70 },
  "patchMod": { "dmgMult": 1.0, "hpMult": 1.0, "cdMult": 1.0 }
}
```

#### All 12 Mandatory Champions:
1. `kylen` — **카일렌 (Kylen)** | `role: "MELEE"` | `baseHp: 680`, `moveSpeed: 135`, Dash striker & blade parry counter.
2. `sylvia` — **실비아 (Sylvia)** | `role: "RANGED"` | `baseHp: 520`, `moveSpeed: 145`, Piercing wind arrow & gale gust counter.
3. `orion` — **오리온 (Orion)** | `role: "MAGE"` | `baseHp: 540`, `moveSpeed: 125`, Plasma orb skillshot & gravity Distortion counter.
4. `balrog` — **발록 (Balrog)** | `role: "TANK"` | `baseHp: 820`, `moveSpeed: 118`, Magma leap & molten bulwark counter.
5. `nyx` — **닉스 (Nyx)** | `role: "ASSASSIN"` | `baseHp: 500`, `moveSpeed: 155`, Shadow kunai & mist vanish counter.
6. `ignis` — **이그니스 (Ignis)** | `role: "MAGE"` | `baseHp: 510`, `moveSpeed: 128`, Fireball volley & flame mirror counter.
7. `vex` — **벡스 (Vex)** | `role: "RANGED"` | `baseHp: 530`, `moveSpeed: 132`, Railgun snipe & EM field counter.
8. `lyra` — **라이라 (Lyra)** | `role: "SUPPORT"` | `baseHp: 580`, `moveSpeed: 135`, Starlight bolt/mend & astral barrier counter.
9. `solaris` — **솔라리스 (Solaris)** | `role: "SUPPORT"` | `baseHp: 660`, `moveSpeed: 130`, Solar lance & radiant aegis counter.
10. `titan` — **타이탄 (Titan)** | `role: "TANK"` | `baseHp: 850`, `moveSpeed: 115`, Seismic charge & shockwave guard counter.
11. `shade` — **셰이드 (Shade)** | `role: "ASSASSIN"` | `baseHp: 560`, `moveSpeed: 148`, Void scythe & phase shift counter.
12. `frost` — **프로스트 (Frost)** | `role: "MAGE"` | `baseHp: 550`, `moveSpeed: 126`, Cryo lance & ice prism counter.

### 3.3 Player Stats (4 Mandatory Stats) & Player Traits (5 Mandatory Traits)
- **4 Player Stats (`PlayerStats`)**:
  - `mechanics` (`number`, `1..100`): Boosts skillshot damage (`+0.3%/pt`) & projectile speed.
  - `reflex` (`number`, `1..100`): Boosts Counter trigger probability (`+0.4%/pt`) & dodge movement.
  - `teamwork` (`number`, `1..100`): Boosts Coach Call duration (`+0.3%/pt`) & Orb focus coordination.
  - `mental` (`number`, `1..100`): Boosts Sudden Death resilience & Energy gain when trailing (`+0.4%/pt`).
- **5 Player Traits (`TRAITS`)**:
  - `clutch_gene`: `"클러치 유전자"` — `+20%` damage and `+15%` energy gain in Sudden Death or final set of a series.
  - `counter_master`: `"반격의 달인"` — Counter cooldown `-25%` and stun duration `+0.4s`.
  - `orb_hunter`: `"오브 사냥꾼"` — `+35%` bonus damage to Center Energy Orb and high orb priority.
  - `lone_wolf`: `"고독한 늑대"` — `+15%` damage when no ally is within `100px`.
  - `glass_cannon`: `"유리대포"` — `+25%` damage dealt, `+15%` damage taken.

### 3.4 Rite Cards Schema (`RITE_CARDS` — 12 Cards)
```json
{
  "id": "rite_crimson_edge",
  "name": "핏빛 칼날",
  "category": "OFFENSE",
  "desc": "팀 전원 기본 공격 및 스킬 적중 시 피해량의 10% 체력 회복",
  "effectKey": "lifesteal",
  "value": 0.10
}
```
#### All 12 Mandatory Rite Cards:
1. `rite_crimson_edge` (핏빛 칼날): `lifesteal: 0.10`
2. `rite_reflex_shield` (반사의 문장): `counterShield: 120`
3. `rite_orb_synergy` (오브 공명): `orbBonusEnergy: 15`
4. `rite_ex_overcharge` (EX 과충전): `exCostReduction: 10` (EX costs 40 instead of 50)
5. `rite_sudden_valor` (종말의 결의): `vortexResist: 0.40`
6. `rite_tactical_echo` (전술 메아리): `coachCdReduction: 0.30`
7. `rite_swift_boots` (신속의 전투화): `moveSpeedMult: 1.15`
8. `rite_piercing_bolts` (관통 탄환): `projSpeedMult: 1.20`
9. `rite_iron_bastion` (강철 요새): `maxHpMult: 1.15`
10. `rite_executioner` (처형자의 본능): `execDmgMult: 1.25` (below 35% HP)
11. `rite_arcane_flow` (비전 순환): `skillCdMult: 0.80`
12. `rite_guardian_grace` (수호자의 은총): `emergencyShield: 160` (at <20% HP once/round)

### 3.5 Complete Root State Tree (`GameState`)
```json
{
  "version": 1,
  "roomCode": "4821",
  "localSeatIndex": 0,
  "screen": "LOBBY",
  "week": 1,
  "maxWeeks": 5,
  "patchVersion": "1.0",
  "patchNotes": [],
  "seats": [
    {
      "seatIndex": 0,
      "teamId": "team_0",
      "teamName": "서울 노바 (Seoul Nova)",
      "teamColor": "#3b82f6",
      "coachName": "Host Coach",
      "isAI": false,
      "ap": 3,
      "maxAp": 3,
      "wins": 0,
      "losses": 0,
      "setWins": 0,
      "setLosses": 0,
      "roster": [
        {
          "playerId": "p_0_0",
          "name": "FakerLite",
          "condition": 90,
          "stats": { "mechanics": 78, "reflex": 74, "teamwork": 70, "mental": 80 },
          "trait": "clutch_gene",
          "mastery": { "kylen": 3, "orion": 2, "nyx": 1 }
        }
      ]
    }
  ],
  "faPool": [],
  "schedule": [
    {
      "week": 1,
      "matches": [
        { "matchId": "w1_m0", "homeSeat": 0, "awaySeat": 1, "completed": false, "homeSets": 0, "awaySets": 0, "winnerSeat": null }
      ]
    }
  ],
  "playoffs": {
    "active": false,
    "round": "SEMI_1",
    "seeds": [0, 1, 2, 3],
    "semi1": { "homeSeat": 0, "awaySeat": 3, "homeSets": 0, "awaySets": 0, "winnerSeat": null },
    "semi2": { "homeSeat": 1, "awaySeat": 2, "homeSets": 0, "awaySets": 0, "winnerSeat": null },
    "final": { "homeSeat": null, "awaySeat": null, "homeSets": 0, "awaySets": 0, "winnerSeat": null },
    "championSeat": null
  },
  "activeSeries": {
    "matchId": "w1_m0",
    "bestOf": 3,
    "currentSet": 1,
    "blueSeat": 0,
    "redSeat": 1,
    "blueWins": 0,
    "redWins": 0,
    "draft": {
      "phase": "BAN_BLUE",
      "stepIndex": 0,
      "blueBans": [],
      "redBans": [],
      "bluePicks": [],
      "redPicks": []
    },
    "blueRites": [],
    "redRites": [],
    "riteOptions": []
  },
  "combat": {
    "running": false,
    "paused": false,
    "timer": 60.0,
    "suddenDeath": false,
    "arena": { "width": 360, "height": 420, "centerX": 180, "centerY": 210, "safeRadius": 175, "minRadius": 55 },
    "hitstopFrames": 0,
    "shakeFrames": 0,
    "orb": { "active": false, "x": 180, "y": 210, "hp": 120, "maxHp": 120, "respawnTimer": 10.0 },
    "fighters": [],
    "projectiles": [],
    "effects": [],
    "coachCalls": {
      "blue": { "activeCall": null, "activeTimer": 0, "cds": { "CALL_FOCUS": 0, "CALL_ORB_CONTEST": 0, "CALL_BAIT_COUNTER": 0 } },
      "red": { "activeCall": null, "activeTimer": 0, "cds": { "CALL_FOCUS": 0, "CALL_ORB_CONTEST": 0, "CALL_BAIT_COUNTER": 0 } }
    },
    "tickerLogs": []
  }
}
```

### 3.6 Fighter & Projectile Runtime Schema (`combat.fighters[i]`, `combat.projectiles[i]`)
```json
{
  "unitId": "blue_0",
  "team": "blue",
  "champId": "kylen",
  "playerName": "FakerLite",
  "x": 90,
  "y": 140,
  "vx": 0,
  "vy": 0,
  "facing": 0.0,
  "radius": 16,
  "hp": 680,
  "maxHp": 680,
  "shield": 0,
  "energy": 0,
  "maxEnergy": 100,
  "alive": true,
  "state": "IDLE",
  "stunTimer": 0,
  "counterTimer": 0,
  "dashTimer": 0,
  "cds": { "basic": 0, "primary": 0, "counter": 0, "ex": 0 },
  "emergencyUsed": false,
  "stats": { "mechanics": 78, "reflex": 74, "teamwork": 70, "mental": 80 },
  "trait": "clutch_gene",
  "masteryLevel": 3
}
```

---

## 4. Exact Exported Module Function Signatures

### 4.1 `js/state.js`
- `export const SCREEN_STATES: Readonly<Record<string, string>>`
- `export const CHAMPIONS: Record<string, ChampionDef>`
- `export const RITE_CARDS: RiteCardDef[]`
- `export const TRAITS: Record<string, TraitDef>`
- `export const COACH_CALLS: Record<string, CoachCallDef>`
- `export function createInitialState(roomCode?: string): GameState`
- `export function cloneState(state: GameState): GameState`
- `export function getChampionById(champId: string): ChampionDef`
- `export function getRiteById(riteId: string): RiteCardDef`

### 4.2 `js/engine.js`
- `export function initCombatRound(state: GameState): void`
  - Spawns 3v3 fighters from `activeSeries.draft.bluePicks` and `redPicks`, applies player stats, mastery, traits, balance patch modifiers, and active Rite Cards.
- `export function stepCombat(state: GameState, dt: number): { roundEnded: boolean, winnerTeam: "blue" | "red" | null }`
  - Advances 1 tick (`dt = 1/60`): processes `hitstopFrames`, updates timers, shrinks `safeRadius` in Sudden Death (`timer <= 15s` or overtime), spawns/updates Center Energy Orb, runs Utility AI for each living fighter, updates projectiles & collisions, intercepts hits on `counterTimer > 0` (triggers `hitstopFrames = 8`, stuns attacker for `1.2s`, grants `+20` energy), triggers EX (`>= 50` energy) & Ultimate (`100` energy), and checks round wipe.
- `export function triggerCoachCall(state: GameState, team: "blue" | "red", callType: "CALL_FOCUS" | "CALL_ORB_CONTEST" | "CALL_BAIT_COUNTER"): boolean`
  - Activates the tactical call for `team` if off cooldown, logs to `combat.tickerLogs`, and applies immediate tactical behavior/buffs.
- `export function evaluateUtilityAI(state: GameState, fighter: Fighter): void`
  - Scores actions (Attack Nearest, Snipe Low HP, Contest Center Orb, Activate Counter on Incoming Projectile, Cast EX/Ult, Evade Vortex) weighted by `stats`, `trait`, and active `coachCalls`.

### 4.3 `js/league.js`
- `export function generateSchedule(seatCount?: number): WeekSchedule[]`
  - Generates a 5-week 6-team round-robin schedule (3 Bo3 matches per week).
- `export function executeWeeklyAction(state: GameState, seatIndex: number, actionType: "TRAIN" | "SCRIM" | "SCOUT_FA", payload?: { playerIndex?: number, statKey?: string, faIndex?: number }): { ok: boolean, message: string }`
  - Consumes `1 AP`, updates player stats/condition/roster, and logs result.
- `export function startPlayerMatchOrSimWeek(state: GameState): void`
  - Simulates AI-vs-AI matches for the current week and transitions human match into `DRAFT`.
- `export function simulateMatchHeadless(state: GameState, homeSeat: number, awaySeat: number, bestOf: number): { homeSets: number, awaySets: number, winnerSeat: number }`
  - Fast deterministic/statistical match simulator using team roster power, condition, mastery, and traits.
- `export function advanceDraftStep(state: GameState, champId: string): void`
  - Progresses snake draft (`BAN_BLUE -> BAN_RED -> PICK_BLUE_1 -> PICK_RED_1 -> PICK_RED_2 -> PICK_BLUE_2 -> PICK_BLUE_3 -> PICK_RED_3`), auto-picking for AI seats.
- `export function offerRiteCards(state: GameState): void`
  - Populates `activeSeries.riteOptions` with 3 non-duplicate Rite Cards between sets.
- `export function selectRiteCard(state: GameState, team: "blue" | "red", riteId: string): void`
  - Adds selected Rite Card to `blueRites`/`redRites` (and auto-picks for AI opponent), then starts the next set's `COMBAT`.
- `export function completeSeriesAndAdvance(state: GameState): void`
  - Records match winner, checks if regular season week is complete, triggers balance patches on even weeks, or advances Top-4 Bo5 Playoff bracket.
- `export function getStandings(state: GameState): SeatState[]`
  - Returns seats sorted by `wins DESC`, `(setWins - setLosses) DESC`, `setWins DESC`.
- `export function applyBalancePatch(state: GameState): PatchNote[]`
  - Buffs 2 underused champions and nerfs 2 dominant champions by `±8%..12%`, incrementing `patchVersion`.

### 4.4 `js/network.js`
- `export function configureNeon(connectionUrlOrEndpoint: string): boolean`
- `export function createRoom(state: GameState): Promise<{ roomCode: string, mode: "NEON" | "LOCAL" }>`
- `export function joinRoom(roomCode: string, preferredSeatIndex?: number, coachName?: string): Promise<{ ok: boolean, state: GameState | null, assignedSeat: number, mode: "NEON" | "LOCAL", error?: string }>`
- `export function claimSeat(state: GameState, seatIndex: number, coachName: string): Promise<GameState>`
  - Converts `seats[seatIndex].isAI = false`, updates `coachName`, persists to Neon + `BroadcastChannel` + `localStorage`.
- `export function syncRoomState(state: GameState): Promise<boolean>`
- `export function subscribeRoomUpdates(roomCode: string, onRemoteUpdate: (newState: GameState) => void): () => void`

### 4.5 `js/renderer.js`
- `export function initRenderer(canvas: HTMLCanvasElement): CanvasRenderingContext2D`
- `export function renderArena(ctx: CanvasRenderingContext2D, state: GameState): void`
  - Pure read-only Canvas draw pass: arena grid, Sudden Death danger ring outside `safeRadius`, Center Energy Orb with HP ring, fighters with role color, HP bar, 4-segment Energy bar, facing vector, Counter golden aura, stun stars, projectiles, floating effects, and hitstop/shake offsets.

### 4.6 `js/hud.js`
- `export function initHUD(callbacks: HUDCallbacks): void`
- `export function renderHUD(state: GameState): void`
  - Updates Top Bar (Week, Room Code, Connection Mode, AP), transitions active screen container (`LOBBY`, `WEEKLY_HUB`, `DRAFT`, `COMBAT`, `RITE_DRAFT`, `PLAYOFF_BRACKET`), renders tactical call buttons with cooldown overlays, and updates combat ticker.
- `export function showModal(title: string, htmlContent: string): void`
- `export function hideModal(): void`

### 4.7 `js/controller.js`
- `export function initApp(): void`
  - Bootstraps state, canvas renderer, HUD bindings, network listener, and starts the 60fps `requestAnimationFrame` loop.

---

## 5. Neon Serverless Postgres Schema & HTTP Interface (`js/network.js`)

### 5.1 SQL DDL (`rooms` Table)
```sql
CREATE TABLE IF NOT EXISTS rooms (
  room_code VARCHAR(4) PRIMARY KEY,
  host_seat SMALLINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms (updated_at DESC);
```

### 5.2 Neon HTTP SQL API Specification
- **Endpoint**: `POST https://<neon-host>/sql`
- **Headers**:
  - `Content-Type: application/json`
  - `Neon-Connection-String: postgresql://<user>:<pass>@<neon-host>/<dbname>?sslmode=require`
- **Upsert Room Query (Create / Sync)**:
  ```json
  {
    "query": "INSERT INTO rooms (room_code, host_seat, version, state_json, updated_at) VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (room_code) DO UPDATE SET version = rooms.version + 1, state_json = EXCLUDED.state_json, updated_at = NOW() RETURNING room_code, version, state_json;",
    "params": ["4821", 0, 1, "{\"version\":1,...}"]
  }
  ```
- **Fetch / Join / Seat Takeover Query**:
  ```json
  {
    "query": "SELECT room_code, version, state_json, updated_at FROM rooms WHERE room_code = $1 LIMIT 1;",
    "params": ["4821"]
  }
  ```
- **Automatic Local Fallback**:
  - When Neon credentials are not configured or network fails, `network.js` transparently persists state to `localStorage.setItem("atm_room_" + roomCode, JSON.stringify(state))` and broadcasts via `new BroadcastChannel("atm_channel_" + roomCode)` so multiple browser tabs can test 4-digit Room Code drop-in takeover immediately with zero setup.

---

## 6. Verification Rules for Phase 1 & Phase 2 Implementation
1. **Zero Build Step**: Opening `index.html` over local HTTP or directly must load all ES modules cleanly without npm bundlers.
2. **Strict Separation**: `renderer.js` must never mutate `state`; `hud.js` must never compute projectile trajectories or collision math.
3. **Counter & Orb Mechanics**: Hitting a fighter during `counterTimer > 0` must negate damage, set `hitstopFrames = 8`, stun the attacker, and award energy. Destroying the Center Orb must award teamwide energy and heal.
4. **Drop-In Multiplayer**: Opening two tabs, creating a 4-digit room in Tab 1, and joining that code in Tab 2 to take over `Seat 1..5` must flip `seats[i].isAI` from `true` to `false` and synchronize across tabs.
