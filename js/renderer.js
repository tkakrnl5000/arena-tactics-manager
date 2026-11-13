/**
 * js/renderer.js
 * Three.js WebGL2 기반 배틀라이트 3D 아레나 렌더러 + 투영 오버레이(2D HUD Canvas).
 * 순수 읽기 전용 렌더 패스 (게임 상태 변이 0%).
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { getChampionById } from "./state.js";
import { buildChampion3DRig, createStandardMat, updateChampionRigAnimation } from "./models3d.js";

const TEX_CACHE = {};

function createArenaStoneTexture(mapId, floorHex, accentHex) {
  const key = `${mapId}_${floorHex}_${accentHex}`;
  if (TEX_CACHE[key]) return TEX_CACHE[key];

  const size = 512;
  const cvs = document.createElement("canvas");
  cvs.width = size;
  cvs.height = size;
  const c = cvs.getContext("2d");

  c.fillStyle = floorHex || "#181a20";
  c.fillRect(0, 0, size, size);

  // Subtle flagstone stone tiles with mortar lines
  const step = 64;
  for (let gx = 0; gx < size; gx += step) {
    for (let gy = 0; gy < size; gy += step) {
      const shade = ((gx * 13 + gy * 31) % 19) - 9;
      c.fillStyle = shade > 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.14)";
      c.fillRect(gx + 2, gy + 2, step - 4, step - 4);
      c.strokeStyle = "rgba(0,0,0,0.45)";
      c.lineWidth = 2;
      c.strokeRect(gx + 1, gy + 1, step - 2, step - 2);
      c.strokeStyle = "rgba(255,255,255,0.025)";
      c.lineWidth = 1;
      c.strokeRect(gx + 3, gy + 3, step - 6, step - 6);
    }
  }

  // Magma cracks / moss / frost accents
  if (mapId === "magma_forge") {
    c.strokeStyle = "rgba(249, 115, 22, 0.22)";
    c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.moveTo((i * 89) % size, 0);
      c.lineTo(((i * 89) + 120) % size, size);
      c.stroke();
    }
  } else if (mapId === "frost_citadel") {
    c.fillStyle = "rgba(186, 230, 253, 0.05)";
    for (let i = 0; i < 18; i++) {
      c.beginPath();
      c.arc((i * 73) % size, (i * 137) % size, 18 + (i % 14), 0, Math.PI * 2);
      c.fill();
    }
  } else if (mapId === "void_nexus") {
    c.strokeStyle = "rgba(45, 212, 191, 0.14)";
    c.lineWidth = 2;
    c.strokeRect(12, 12, size - 24, size - 24);
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 3.0);
  tex.colorSpace = THREE.SRGBColorSpace;
  TEX_CACHE[key] = tex;
  return tex;
}

function getMapThemeColors(mapId) {
  switch (mapId) {
    case "magma_forge":
      return { floor: "#1c1315", wall: 0x261a1c, trim: 0xf97316, ambient: 0xffedd5, orb: 0xf97316, bg: 0x0b080a };
    case "frost_citadel":
      return { floor: "#14202d", wall: 0x1e2c3d, trim: 0x38bdf8, ambient: 0xe0f2fe, orb: 0x38bdf8, bg: 0x070d14 };
    case "void_nexus":
      return { floor: "#121f22", wall: 0x172b2a, trim: 0x2dd4bf, ambient: 0xd1fae5, orb: 0x2dd4bf, bg: 0x060d0f };
    case "starlight_sanctum":
    default:
      return { floor: "#1e1b16", wall: 0x2b251c, trim: 0xe5b869, ambient: 0xfef3c7, orb: 0x22d3ee, bg: 0x0a0907 };
  }
}

function buildArenaStageGroup(arena) {
  const mapId = arena.mapId || "starlight_sanctum";
  const theme = getMapThemeColors(mapId);
  const w = arena.width || 520;
  const h = arena.height || 420;
  const cx = arena.centerX || w / 2;
  const cy = arena.centerY || h / 2;

  const group = new THREE.Group();
  const stoneTex = createArenaStoneTexture(mapId, theme.floor, theme.trim);

  // Outer void floor skirt
  const outerFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 260, h + 260),
    new THREE.MeshStandardMaterial({ color: theme.bg, roughness: 0.95, metalness: 0.05 })
  );
  outerFloor.rotation.x = -Math.PI / 2;
  outerFloor.position.y = -2.2;
  group.add(outerFloor);

  // Main Arena Stone Floor (Shadow Receiver!)
  const arenaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 18, h + 18),
    new THREE.MeshStandardMaterial({
      map: stoneTex,
      roughness: 0.78,
      metalness: 0.14
    })
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.receiveShadow = true;
  group.add(arenaFloor);

  // Center Battlerite Orb Dais Platform & Concentric Gold Ring
  const daisMat = createStandardMat(theme.wall, { metalness: 0.35, roughness: 0.55 });
  const trimMat = createStandardMat(theme.trim, { metalness: 0.7, roughness: 0.3, emissive: theme.trim, emissiveIntensity: 0.22 });
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(42, 48, 1.8, 16), daisMat);
  dais.position.set(0, 0.3, 0);
  dais.receiveShadow = true;
  group.add(dais);

  const daisRing = new THREE.Mesh(new THREE.RingGeometry(43, 46, 32), new THREE.MeshBasicMaterial({
    color: theme.trim,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide
  }));
  daisRing.rotation.x = -Math.PI / 2;
  daisRing.position.y = 0.25;
  group.add(daisRing);

  // Midfield lane inlay rings
  for (const sx of [-135, 135]) {
    const spawnRing = new THREE.Mesh(new THREE.RingGeometry(24, 27, 24), new THREE.MeshBasicMaterial({
      color: sx < 0 ? 0x38bdf8 : 0xf43f5e,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide
    }));
    spawnRing.rotation.x = -Math.PI / 2;
    spawnRing.position.set(sx, 0.2, 0);
    group.add(spawnRing);
  }

  // Sculpted Colosseum Stone Perimeter Walls & Corner Battlements + Braziers
  const wallH = 18;
  const halfW = w / 2 + 8;
  const halfH = h / 2 + 8;
  const wallGeoH = new THREE.BoxGeometry(w + 26, wallH, 14);
  const wallGeoV = new THREE.BoxGeometry(14, wallH, h + 26);

  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeoH, daisMat);
    wall.position.set(0, wallH / 2 - 1, sz * halfH);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const ledge = new THREE.Mesh(new THREE.BoxGeometry(w + 28, 2.4, 16), trimMat);
    ledge.position.set(0, wallH - 0.5, sz * halfH);
    group.add(ledge);
  }
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeoV, daisMat);
    wall.position.set(sx * halfW, wallH / 2 - 1, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    // Spawn Arch Gates on East & West
    const gateColor = sx < 0 ? 0x38bdf8 : 0xf43f5e;
    const gateMat = createStandardMat(gateColor, { emissive: gateColor, emissiveIntensity: 0.75 });
    const arch = new THREE.Mesh(new THREE.BoxGeometry(8, 24, 72), gateMat);
    arch.position.set(sx * (halfW - 2), 11, 0);
    group.add(arch);
  }

  // 4 Corner Stone Towers with Glowing Flames
  const cornerFlames = [];
  for (const cxSign of [-1, 1]) {
    for (const czSign of [-1, 1]) {
      const px = cxSign * (halfW - 8);
      const pz = czSign * (halfH - 8);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(11, 14, 24, 8), daisMat);
      tower.position.set(px, 11, pz);
      tower.castShadow = true;
      tower.receiveShadow = true;
      group.add(tower);

      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(9, 6, 4, 8), trimMat);
      bowl.position.set(px, 24, pz);
      group.add(bowl);

      const flame = new THREE.Mesh(
        new THREE.OctahedronGeometry(4.5, 0),
        new THREE.MeshBasicMaterial({ color: theme.orb })
      );
      flame.position.set(px, 29, pz);
      group.add(flame);
      cornerFlames.push(flame);
    }
  }

  // 4 Sculpted Stone Arena Pillars matching engine geometry (arena.pillars)
  const pillarCrystals = [];
  if (arena.pillars) {
    for (const p of arena.pillars) {
      const px = p.x - cx;
      const pz = p.y - cy;
      const r = p.radius || 19;

      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.16, 5.5, 8), daisMat);
      plinth.position.set(px, 2.75, pz);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.90, 22, 8), daisMat);
      shaft.position.set(px, 16, pz);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      group.add(shaft);

      const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.70, 4.5, 8), daisMat);
      crown.position.set(px, 29, pz);
      crown.castShadow = true;
      crown.receiveShadow = true;
      group.add(crown);

      const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.74, 1.35, 6, 8), trimMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(px, 27, pz);
      group.add(collar);

      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(4.4, 0),
        createStandardMat(theme.orb, { emissive: theme.orb, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.1 })
      );
      crystal.position.set(px, 38, pz);
      group.add(crystal);
      pillarCrystals.push(crystal);
    }
  }

  // Dynamic Shrines Mesh Pool
  const shrineMeshes = [];
  if (arena.shrines) {
    for (const s of arena.shrines) {
      const sx = s.x - cx;
      const sz = s.y - cy;
      const sColor =
        s.type === "HEAL_SHRINE" ? 0x10b981 :
        s.type === "ATK_SHRINE" ? 0xf97316 :
        s.type === "SHIELD_SHRINE" ? 0x67e8f9 :
        s.type === "ENERGY_SHRINE" ? 0xf59e0b : 0xa855f7;

      const socket = new THREE.Mesh(
        new THREE.RingGeometry(11, 14.5, 20),
        new THREE.MeshBasicMaterial({ color: sColor, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
      );
      socket.rotation.x = -Math.PI / 2;
      socket.position.set(sx, 0.35, sz);
      group.add(socket);

      const orbGem = new THREE.Mesh(
        new THREE.OctahedronGeometry(6.8, 0),
        createStandardMat(sColor, { emissive: sColor, emissiveIntensity: 1.3, roughness: 0.15 })
      );
      orbGem.position.set(sx, 11, sz);
      orbGem.castShadow = true;
      group.add(orbGem);
      shrineMeshes.push({ shrineId: s.id, socket, orbGem, sx, sz });
    }
  }

  // Dynamic Hazard Zone Rings
  const hazardMeshes = [];
  if (arena.hazards) {
    for (const h of arena.hazards) {
      const hx = h.x - cx;
      const hz = h.y - cy;
      const hr = h.radius || 32;
      const hColor =
        h.type === "LEYLINE_HASTE" ? 0x38bdf8 :
        h.type === "LAVA_GEYSER" ? 0xf97316 :
        h.type === "BLIZZARD_SLOW" ? 0x7dd3fc : 0xa855f7;

      const discMat = new THREE.MeshBasicMaterial({ color: hColor, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(hr, 24), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(hx, 0.3, hz);
      group.add(disc);

      const ringMat = new THREE.MeshBasicMaterial({ color: hColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(hr - 2.2, hr, 24), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hx, 0.4, hz);
      group.add(ring);

      hazardMeshes.push({ hazardId: h.id, disc, discMat, ring, ringMat });
    }
  }

  return { group, cornerFlames, pillarCrystals, shrineMeshes, hazardMeshes, theme };
}

function syncOverlayCanvasSize(mainCanvas, hudCanvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = mainCanvas.clientWidth || 360;
  const h = mainCanvas.clientHeight || 300;
  if (hudCanvas.width !== Math.round(w * dpr) || hudCanvas.height !== Math.round(h * dpr)) {
    hudCanvas.width = Math.round(w * dpr);
    hudCanvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

/**
 * Three.js WebGL2 렌더러 + 투영 오버레이 2D HUD 초기화
 */
export function initRenderer(canvas) {
  let hudCanvas = document.getElementById("arena-hud-canvas");
  if (!hudCanvas && canvas && canvas.parentElement) {
    hudCanvas = document.createElement("canvas");
    hudCanvas.id = "arena-hud-canvas";
    hudCanvas.className = "arena-hud-overlay";
    canvas.parentElement.insertBefore(hudCanvas, canvas.nextSibling);
  }

  let webgl = null;
  try {
    webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    webgl.shadowMap.enabled = true;
    webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1.18;
  } catch (err) {
    console.warn("[Renderer] WebGL 초기화 실패, 2D 폴백:", err?.message);
    return {
      isFallback2D: true,
      ctx2d: canvas.getContext("2d"),
      hudCtx: hudCanvas ? hudCanvas.getContext("2d") : null,
      canvas,
      hudCanvas
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b10);
  scene.fog = new THREE.FogExp2(0x090b10, 0.00075);

  const camera = new THREE.PerspectiveCamera(34, 1.2, 40, 1400);
  camera.position.set(0, 390, 320);
  camera.lookAt(0, 8, 0);

  // Studio Three-Point Colosseum Lighting
  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1c1917, 1.25);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff1dc, 2.25);
  dirLight.position.set(-140, 310, 165);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 60;
  dirLight.shadow.camera.far = 760;
  const dCam = 310;
  dirLight.shadow.camera.left = -dCam;
  dirLight.shadow.camera.right = dCam;
  dirLight.shadow.camera.top = dCam;
  dirLight.shadow.camera.bottom = -dCam;
  dirLight.shadow.bias = -0.0008;
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
  rimLight.position.set(190, 160, -210);
  scene.add(rimLight);

  // Center Battlerite Energy Orb Rig
  const orbGroup = new THREE.Group();
  const orbCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(10.5, 0),
    createStandardMat(0x22d3ee, { emissive: 0x22d3ee, emissiveIntensity: 1.5, roughness: 0.1 })
  );
  orbCore.position.y = 18;
  orbCore.castShadow = true;
  const orbCage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(15.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xfde047, wireframe: true, transparent: true, opacity: 0.72 })
  );
  orbCage.position.y = 18;
  const orbRing = new THREE.Mesh(
    new THREE.RingGeometry(18, 21, 28),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  orbRing.rotation.x = -Math.PI / 2;
  orbRing.position.y = 0.5;
  const orbLight = new THREE.PointLight(0x22d3ee, 1.4, 125);
  orbLight.position.y = 22;
  orbGroup.add(orbCore, orbCage, orbRing, orbLight);
  orbGroup.visible = false;
  scene.add(orbGroup);

  // Sudden Death 3D Storm Ring
  const vortexMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const vortexRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 8, 56), vortexMat);
  vortexRing.rotation.x = Math.PI / 2;
  vortexRing.position.y = 2.0;
  vortexRing.visible = false;
  scene.add(vortexRing);

  // Pre-allocated 3D Projectile Pool (Zero-GC!)
  const projPool = [];
  const projGeo = new THREE.SphereGeometry(1, 10, 8);
  const haloGeo = new THREE.SphereGeometry(1.65, 8, 6);
  for (let i = 0; i < 64; i++) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.38 }));
    g.add(core, halo);
    g.visible = false;
    scene.add(g);
    projPool.push({ g, core, halo });
  }

  // Pre-allocated 3D Ring/Nova VFX Pool
  const fxPool = [];
  const ringFxGeo = new THREE.RingGeometry(0.75, 1.0, 28);
  ringFxGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(ringFxGeo, mat);
    mesh.position.y = 1.6;
    mesh.visible = false;
    scene.add(mesh);
    fxPool.push({ mesh, mat });
  }

  return {
    isFallback2D: false,
    webgl,
    scene,
    camera,
    hemiLight,
    canvas,
    hudCanvas,
    hudCtx: hudCanvas ? hudCanvas.getContext("2d") : null,
    mapId: null,
    stage: null,
    fighterRigs: new Map(),
    orbGroup,
    orbCore,
    orbCage,
    vortexRing,
    projPool,
    fxPool,
    camX: 0,
    camZ: 0,
    projVec: new THREE.Vector3()
  };
}

function drawProjectedFighterBar(hctx, x, y, fighter, timeSec) {
  const barW = 46;
  const barH = 5.5;
  const left = Math.round(x - barW / 2);
  const top = Math.round(y);
  const isBlue = fighter.team === "blue";

  // Player Nickname + Champion Name above bar
  const nickMatch = String(fighter.playerName || "").match(/\(([^)]+)\)/);
  const overheadLabel = nickMatch ? `${nickMatch[1]}·${fighter.name}` : fighter.name;
  hctx.font = "700 8.5px Pretendard, -apple-system, sans-serif";
  hctx.textAlign = "center";
  hctx.fillStyle = "rgba(0,0,0,0.8)";
  hctx.fillText(overheadLabel, x + 0.8, top - 11.2);
  hctx.fillStyle = isBlue ? "#bae6fd" : "#fecdd3";
  hctx.fillText(overheadLabel, x, top - 12);

  // Subtle status badge (Counter or Stun only)
  if (fighter.counterTimer > 0) {
    hctx.font = "800 8px Pretendard, sans-serif";
    hctx.fillStyle = "#fde047";
    hctx.fillText("COUNTER", x, top - 22);
  } else if (fighter.stunTimer > 0) {
    hctx.font = "800 8px Pretendard, sans-serif";
    hctx.fillStyle = "#fca5a5";
    hctx.fillText("STUN", x, top - 22);
  }

  // Frame
  hctx.fillStyle = "rgba(8, 11, 18, 0.88)";
  hctx.fillRect(left - 1, top - 1, barW + 2, barH + 5);

  const hpPct = Math.max(0, Math.min(1, fighter.hp / Math.max(1, fighter.maxHp)));
  const recPct = Math.max(hpPct, Math.min(1, (fighter.recoveryHp ?? fighter.maxHp) / Math.max(1, fighter.maxHp)));

  // Eroded Permanently Lost Max HP track (#141720 already filled)
  // Recoverable Grey-Tinted Region (between hpPct and recPct)
  if (recPct > hpPct) {
    hctx.fillStyle = "rgba(148, 163, 184, 0.34)";
    hctx.fillRect(left + Math.round(barW * hpPct), top, Math.max(1, Math.round(barW * (recPct - hpPct))), barH);
  }

  // Current Alive HP Fill
  hctx.fillStyle = isBlue ? "#38bdf8" : "#f43f5e";
  hctx.fillRect(left, top, Math.round(barW * hpPct), barH);

  // White Shield Cap
  if (fighter.shield > 0) {
    const shPct = Math.min(0.45, fighter.shield / Math.max(1, fighter.maxHp));
    hctx.fillStyle = "#f8fafc";
    hctx.fillRect(left + Math.round(barW * hpPct) - 1, top, Math.max(2, Math.round(barW * shPct)), barH);
  }

  // 4 Battlerite Energy Pips underneath
  const pipY = top + barH + 1;
  const pipW = (barW - 3) / 4;
  const energy = fighter.energy || 0;
  for (let p = 0; p < 4; p++) {
    const px = left + p * (pipW + 1);
    const segFill = Math.max(0, Math.min(1, (energy - p * 25) / 25));
    hctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    hctx.fillRect(px, pipY, pipW, 2.4);
    if (segFill > 0) {
      hctx.fillStyle = energy >= 100
        ? (Math.sin(timeSec * 12) > 0 ? "#fde047" : "#f59e0b")
        : "#22d3ee";
      hctx.fillRect(px, pipY, pipW * segFill, 2.4);
    }
  }
}

/**
 * 3D 아레나 + 캐릭터 + 투사체 + 2D HUD 오버레이 순수 읽기 렌더 패스
 */
export function renderArena(r, state) {
  if (!r || !state?.combat) return;
  const combat = state.combat;
  const arena = combat.arena || { width: 520, height: 420, centerX: 260, centerY: 210 };
  const timeSec = performance.now() * 0.001;

  if (r.isFallback2D) {
    const ctx = r.ctx2d;
    if (!ctx) return;
    ctx.fillStyle = "#0e131b";
    ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
    return;
  }

  const cw = r.canvas.clientWidth || 360;
  const ch = r.canvas.clientHeight || 300;
  if (cw > 0 && ch > 0) {
    const curSize = r.webgl.getSize(new THREE.Vector2());
    if (Math.abs(curSize.x - cw) > 1 || Math.abs(curSize.y - ch) > 1) {
      r.webgl.setSize(cw, ch, false);
      r.camera.aspect = cw / ch;
      r.camera.updateProjectionMatrix();
    }
  }

  // 1. Sync Map Stage on Change
  const targetMapId = arena.mapId || "starlight_sanctum";
  if (r.mapId !== targetMapId || !r.stage) {
    if (r.stage) r.scene.remove(r.stage.group);
    r.stage = buildArenaStageGroup(arena);
    r.scene.add(r.stage.group);
    r.scene.background.setHex(r.stage.theme.bg);
    r.hemiLight.color.setHex(r.stage.theme.ambient);
    r.mapId = targetMapId;
  }

  // Animate ambient flames & pillar crystals
  for (let i = 0; i < r.stage.cornerFlames.length; i++) {
    const fl = r.stage.cornerFlames[i];
    fl.rotation.y = timeSec * 2.2 + i;
    fl.position.y = 29 + Math.sin(timeSec * 5 + i) * 1.4;
  }
  for (let i = 0; i < r.stage.pillarCrystals.length; i++) {
    const cr = r.stage.pillarCrystals[i];
    cr.rotation.y = timeSec * 1.8 + i;
    cr.position.y = 40.5 + Math.sin(timeSec * 3.2 + i) * 1.8;
  }

  // Sync Shrines & Hazards
  for (const sm of r.stage.shrineMeshes) {
    const sData = (arena.shrines || []).find((s) => s.id === sm.shrineId);
    const ready = sData ? sData.ready : true;
    sm.orbGem.visible = ready;
    if (ready) {
      sm.orbGem.rotation.y = timeSec * 2.5;
      sm.orbGem.position.y = 10 + Math.sin(timeSec * 4) * 2.2;
    }
  }
  for (const hm of r.stage.hazardMeshes) {
    const hData = (arena.hazards || []).find((h) => h.id === hm.hazardId);
    if (!hData) continue;
    if (hData.type === "LEYLINE_HASTE") {
      hm.ring.rotation.z = timeSec * 0.8;
      hm.discMat.opacity = 0.14;
    } else if (hData.phase === "ACTIVE") {
      hm.discMat.opacity = 0.42;
      hm.ringMat.opacity = 0.9;
    } else if (hData.phase === "WARNING") {
      hm.discMat.opacity = 0.22 + Math.sin(timeSec * 12) * 0.12;
      hm.ringMat.opacity = 0.85;
    } else {
      hm.discMat.opacity = 0.05;
      hm.ringMat.opacity = 0.22;
    }
  }

  // 2. Sync Center Energy Orb
  const orb = combat.orb;
  if (orb && orb.active) {
    r.orbGroup.visible = true;
    r.orbGroup.position.set(orb.x - arena.centerX, 0, orb.y - arena.centerY);
    r.orbCore.rotation.y = timeSec * 2.6;
    r.orbCore.rotation.x = timeSec * 1.4;
    r.orbCage.rotation.y = -timeSec * 1.9;
    const bob = Math.sin(timeSec * 4.5) * 2.5;
    r.orbCore.position.y = 17 + bob;
    r.orbCage.position.y = 17 + bob;
    const scaleHp = 0.65 + 0.35 * (orb.hp / Math.max(1, orb.maxHp));
    r.orbCore.scale.setScalar(scaleHp);
  } else {
    r.orbGroup.visible = false;
  }

  // 3. Sudden Death Storm Ring
  if (combat.suddenDeath) {
    r.vortexRing.visible = true;
    r.vortexRing.scale.setScalar(arena.safeRadius || 160);
    r.vortexMat.opacity = 0.35 + Math.sin(timeSec * 7) * 0.15;
  } else {
    r.vortexRing.visible = false;
  }

  // 4. Sync Fighters (Create rigs dynamically for current match units & animate!)
  const activeUnitIds = new Set();
  let sumX = 0;
  let sumZ = 0;
  let aliveCount = 0;

  for (const f of combat.fighters || []) {
    activeUnitIds.add(f.unitId);
    let rig = r.fighterRigs.get(f.unitId);
    if (!rig || rig.userData.champId !== f.champId || rig.userData.team !== f.team) {
      if (rig) r.scene.remove(rig);
      const champ = getChampionById(f.champId);
      rig = buildChampion3DRig(champ, f.team);
      r.fighterRigs.set(f.unitId, rig);
      r.scene.add(rig);
    }
    updateChampionRigAnimation(rig, f, arena, timeSec);
    if (f.alive) {
      sumX += f.x - arena.centerX;
      sumZ += f.y - arena.centerY;
      aliveCount++;
    }
  }
  for (const [id, rig] of r.fighterRigs.entries()) {
    if (!activeUnitIds.has(id)) {
      r.scene.remove(rig);
      r.fighterRigs.delete(id);
    }
  }

  // Smooth Angled Battlerite Camera Follow + Hitstop Micro-Shake
  const targetCamX = aliveCount > 0 ? (sumX / aliveCount) * 0.24 : 0;
  const targetCamZ = aliveCount > 0 ? (sumZ / aliveCount) * 0.18 : 0;
  r.camX = r.camX * 0.90 + targetCamX * 0.10;
  r.camZ = r.camZ * 0.90 + targetCamZ * 0.10;

  let shakeX = 0;
  let shakeZ = 0;
  if (combat.shakeTimer > 0) {
    shakeX = (Math.random() - 0.5) * 4.5;
    shakeZ = (Math.random() - 0.5) * 4.5;
  }
  // Zoom camera slightly tighter on portrait vs landscape so entire arena fits crisply!
  const aspect = cw / Math.max(1, ch);
  const camHeight = aspect < 1.0 ? 485 : 355;
  const camBack = aspect < 1.0 ? 355 : 275;
  r.camera.position.set(r.camX + shakeX, camHeight, r.camZ + camBack + shakeZ);
  r.camera.lookAt(r.camX, 8, r.camZ);

  // 5. Sync Projectiles Pool
  const projs = combat.projectiles || [];
  for (let i = 0; i < r.projPool.length; i++) {
    const slot = r.projPool[i];
    if (i < projs.length) {
      const p = projs[i];
      slot.g.visible = true;
      slot.g.position.set(p.x - arena.centerX, 13.5, p.y - arena.centerY);
      const rad = Math.max(3.6, (p.radius || 6) * 0.85);
      slot.g.scale.setScalar(rad);
      slot.halo.material.color.set(p.color || "#38bdf8");
    } else {
      slot.g.visible = false;
    }
  }

  // 6. Sync 3D Ring/Shockwave VFX Pool (zero bloated sprites!)
  const effects = combat.effects || [];
  let fxIdx = 0;
  for (let i = 0; i < effects.length && fxIdx < r.fxPool.length; i++) {
    const ef = effects[i];
    if (ef.type === "FLOAT_TEXT") continue;
    const slot = r.fxPool[fxIdx++];
    const progress = 1 - Math.max(0, ef.duration / Math.max(0.05, ef.maxDuration || 0.35));
    slot.mesh.visible = true;
    slot.mesh.position.set(ef.x - arena.centerX, 1.8, ef.y - arena.centerY);
    slot.mesh.scale.setScalar(Math.max(4, (ef.radius || 28) * (0.4 + progress * 0.9)));
    slot.mat.color.set(ef.color || "#facc15");
    slot.mat.opacity = Math.max(0, (1 - progress) * 0.72);
  }
  while (fxIdx < r.fxPool.length) {
    r.fxPool[fxIdx++].mesh.visible = false;
  }

  // Render 3D Scene!
  r.webgl.render(r.scene, r.camera);

  // 7. Render Razor-Sharp Projected Battlerite Overhead HUD on 2D Overlay
  if (r.hudCanvas && r.hudCtx) {
    const { w, h, dpr } = syncOverlayCanvasSize(r.canvas, r.hudCanvas);
    const hctx = r.hudCtx;
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, w, h);

    // Project Center Orb Bar
    if (orb && orb.active) {
      r.projVec.set(orb.x - arena.centerX, 34, orb.y - arena.centerY);
      r.projVec.project(r.camera);
      const ox = (r.projVec.x * 0.5 + 0.5) * w;
      const oy = (-r.projVec.y * 0.5 + 0.5) * h;
      if (ox > 0 && ox < w && oy > 0 && oy < h) {
        const bw = 40;
        hctx.fillStyle = "rgba(8,11,18,0.85)";
        hctx.fillRect(ox - bw / 2 - 1, oy - 1, bw + 2, 6);
        hctx.fillStyle = "#22d3ee";
        hctx.fillRect(ox - bw / 2, oy, bw * Math.max(0, orb.hp / Math.max(1, orb.maxHp)), 4);
      }
    }

    // Project Fighter Health + Recovery HP + Energy Bars
    for (const f of combat.fighters || []) {
      if (!f.alive) continue;
      if (f.stealthTimer > 0 && Math.floor(timeSec * 14) % 2 !== 0) continue;
      const rig = r.fighterRigs.get(f.unitId);
      const heightOff = 36 * (rig?.userData?.parts?.palScale || 1.0);
      r.projVec.set(f.x - arena.centerX, heightOff, f.y - arena.centerY);
      r.projVec.project(r.camera);
      const sx = (r.projVec.x * 0.5 + 0.5) * w;
      const sy = (-r.projVec.y * 0.5 + 0.5) * h;
      if (sx > -40 && sx < w + 40 && sy > -20 && sy < h + 20) {
        drawProjectedFighterBar(hctx, sx, sy, f, timeSec);
      }
    }

    // Ultra-Minimal Micro Event Pops (strictly <= 4 small 7.5px labels, never covering combat!)
    let popCount = 0;
    for (let i = effects.length - 1; i >= 0 && popCount < 4; i--) {
      const ef = effects[i];
      if (ef.type !== "FLOAT_TEXT" || !ef.text) continue;
      const progress = 1 - Math.max(0, ef.duration / Math.max(0.1, ef.maxDuration || 0.5));
      r.projVec.set(ef.x - arena.centerX, 42 + progress * 10, ef.y - arena.centerY);
      r.projVec.project(r.camera);
      const tx = (r.projVec.x * 0.5 + 0.5) * w;
      const ty = (-r.projVec.y * 0.5 + 0.5) * h;
      hctx.globalAlpha = Math.max(0, 1 - progress);
      hctx.font = "800 7.5px Pretendard, sans-serif";
      hctx.textAlign = "center";
      hctx.fillStyle = ef.color || "#fde047";
      hctx.fillText(ef.text, tx, ty);
      hctx.globalAlpha = 1;
      popCount++;
    }
  }
}
