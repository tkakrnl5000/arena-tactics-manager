/**
 * js/models3d.js
 * Three.js 기반 배틀라이트 스타일 16종 3D 챔피언 모델 및 절차적 골격 애니메이션.
 * 순수 비주얼 빌더 (게임 상태 변이 없음, 캐시된 공유 지오메트리/재질 사용).
 */

import * as THREE from "../vendor/three/three.module.min.js";

const GEO_CACHE = {};
const MAT_CACHE = {};

function getGeo(key, factory) {
  if (!GEO_CACHE[key]) GEO_CACHE[key] = factory();
  return GEO_CACHE[key];
}

function getMat(key, factory) {
  if (!MAT_CACHE[key]) MAT_CACHE[key] = factory();
  return MAT_CACHE[key];
}

export function createStandardMat(color, opts = {}) {
  const emissive = opts.emissive ?? 0x000000;
  const emissiveIntensity = opts.emissiveIntensity ?? 0.0;
  const metalness = opts.metalness ?? 0.35;
  const roughness = opts.roughness ?? 0.48;
  const doubleSide = Boolean(opts.doubleSide);
  const transparent = Boolean(opts.transparent);
  const opacity = opts.opacity ?? 1.0;
  const key = `${color}_${emissive}_${emissiveIntensity}_${metalness}_${roughness}_${doubleSide}_${transparent}_${opacity}`;
  return getMat(key, () => new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent,
    opacity
  }));
}

function buildCurvedBladeGeo() {
  return getGeo("curvedBlade", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.7, 2.5);
    shape.quadraticCurveTo(2.4, 9.5, 0.4, 15.5);
    shape.lineTo(-0.9, 13.5);
    shape.quadraticCurveTo(0.2, 7.5, -0.7, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.25, bevelSegments: 1 });
    geo.center();
    return geo;
  });
}

function buildGreatSwordGeo() {
  return getGeo("greatSword", () => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.8, 0);
    shape.lineTo(-2.1, 14.5);
    shape.lineTo(0, 19.5);
    shape.lineTo(2.1, 14.5);
    shape.lineTo(1.8, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 1 });
    geo.translate(0, 2, -0.5);
    return geo;
  });
}

function buildScytheBladeGeo() {
  return getGeo("scytheBlade", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(9, 2.5, 14.5, -6.5);
    shape.quadraticCurveTo(8, 0.2, 0, -2.6);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 1 });
    geo.translate(0, 0, -0.35);
    return geo;
  });
}

function buildBowGeo() {
  return getGeo("longBow", () => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, -11, -3),
      new THREE.Vector3(0, 0, 5.5),
      new THREE.Vector3(0, 11, -3)
    );
    return new THREE.TubeGeometry(curve, 14, 0.85, 6, false);
  });
}

function buildShieldGeo() {
  return getGeo("kiteShield", () => {
    const shape = new THREE.Shape();
    shape.moveTo(-4.8, 6.2);
    shape.lineTo(4.8, 6.2);
    shape.lineTo(4.2, -1.5);
    shape.lineTo(0, -7.2);
    shape.lineTo(-4.2, -1.5);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.35, bevelSegments: 1 });
    geo.center();
    return geo;
  });
}

function getHeroVisualPalette(champId, champColor) {
  const accent = new THREE.Color(champColor || "#38bdf8");
  const palettes = {
    kylen:   { armor: 0x2a2f3d, trim: 0xef4444, skin: 0xe6c1a8, cloth: 0x991b1b, glow: 0xf87171, scale: 1.03 },
    sylvia:  { armor: 0x1e3a2f, trim: 0x4ade80, skin: 0xf0cbb1, cloth: 0x166534, glow: 0x86efac, scale: 0.96 },
    orion:   { armor: 0x262044, trim: 0xc084fc, skin: 0xdcc5b4, cloth: 0x4c1d95, glow: 0xa855f7, scale: 0.99 },
    balrog:  { armor: 0x2b1d1c, trim: 0xf97316, skin: 0x9b5a46, cloth: 0x7c2d12, glow: 0xfb923c, scale: 1.24 },
    nyx:     { armor: 0x1b1629, trim: 0xa855f7, skin: 0xdfc1b5, cloth: 0x581c87, glow: 0xd8b4fe, scale: 0.94 },
    ignis:   { armor: 0x3b1822, trim: 0xfb7185, skin: 0xefc7b1, cloth: 0xbe123c, glow: 0xfda4af, scale: 0.98 },
    vex:     { armor: 0x1a2c38, trim: 0x22d3ee, skin: 0xd8c3b4, cloth: 0x0e7490, glow: 0x67e8f9, scale: 1.00 },
    lyra:    { armor: 0x3a253d, trim: 0xf9a8d4, skin: 0xf4d4c2, cloth: 0x9d174d, glow: 0xf472b6, scale: 0.97 },
    solaris: { armor: 0x42331a, trim: 0xfacc15, skin: 0xecc4a8, cloth: 0x854d0e, glow: 0xfde047, scale: 1.08 },
    titan:   { armor: 0x2f3a47, trim: 0x94a3b8, skin: 0x8d97a4, cloth: 0x334155, glow: 0x38bdf8, scale: 1.26 },
    shade:   { armor: 0x17182b, trim: 0x818cf8, skin: 0x6366f1, cloth: 0x312e81, glow: 0xa5b4fc, scale: 1.00 },
    frost:   { armor: 0x172b42, trim: 0x7dd3fc, skin: 0xdae9f5, cloth: 0x0369a1, glow: 0xbae6fd, scale: 0.98 },
    chronos: { armor: 0x1b3438, trim: 0x2dd4bf, skin: 0xe5c9a8, cloth: 0x115e59, glow: 0x5eead4, scale: 1.02 },
    thorn:   { armor: 0x26331e, trim: 0x4ade80, skin: 0x3f4e34, cloth: 0x14532d, glow: 0x86efac, scale: 1.22 },
    raigon:  { armor: 0x362d26, trim: 0xf59e0b, skin: 0xebc6a8, cloth: 0xb45309, glow: 0xfbbf24, scale: 1.06 },
    volt:    { armor: 0x16273c, trim: 0x38bdf8, skin: 0xe5ceba, cloth: 0x0284c7, glow: 0x7dd3fc, scale: 1.00 }
  };
  return palettes[champId] || {
    armor: 0x283244,
    trim: accent.getHex(),
    skin: 0xe8c7b0,
    cloth: accent.clone().multiplyScalar(0.55).getHex(),
    glow: accent.getHex(),
    scale: 1.0
  };
}

/**
 * 16종 챔피언 각각에 특화된 배틀라이트식 3D 영웅 리그 생성
 */
export function buildChampion3DRig(champ, team) {
  const pal = getHeroVisualPalette(champ.id, champ.color);
  const teamHex = team === "blue" ? 0x38bdf8 : 0xf43f5e;

  const root = new THREE.Group();
  root.userData = { champId: champ.id, team };

  // 1. Ground Team Selector Ring & Forward Facing Chevron (바닥 진영 링)
  const ringMat = getMat(`ring_${team}`, () => new THREE.MeshBasicMaterial({
    color: teamHex,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide
  }));
  const ringMesh = new THREE.Mesh(
    getGeo("teamRing", () => {
      const g = new THREE.RingGeometry(12.2, 14.6, 28);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
    ringMat
  );
  ringMesh.position.y = 0.45;
  root.add(ringMesh);

  const discMat = getMat(`disc_${team}`, () => new THREE.MeshBasicMaterial({
    color: teamHex,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide
  }));
  const innerDisc = new THREE.Mesh(
    getGeo("teamDisc", () => {
      const g = new THREE.CircleGeometry(12.2, 24);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
    discMat
  );
  innerDisc.position.y = 0.35;
  root.add(innerDisc);

  const arrowMesh = new THREE.Mesh(
    getGeo("facingArrow", () => {
      const g = new THREE.ConeGeometry(2.8, 5.2, 3);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    ringMat
  );
  arrowMesh.position.set(0, 0.7, 16.2);
  root.add(arrowMesh);

  // 2. Character Articulated Body Root (scaled cleanly per archetype)
  const bodyRoot = new THREE.Group();
  bodyRoot.scale.setScalar(pal.scale);
  root.add(bodyRoot);

  const armorMat = createStandardMat(pal.armor, { metalness: 0.55, roughness: 0.38 });
  const trimMat = createStandardMat(pal.trim, { metalness: 0.65, roughness: 0.28, emissive: pal.glow, emissiveIntensity: 0.18 });
  const clothMat = createStandardMat(pal.cloth, { metalness: 0.1, roughness: 0.75, doubleSide: true });
  const skinMat = createStandardMat(pal.skin, { metalness: 0.05, roughness: 0.62 });
  const glowMat = createStandardMat(pal.glow, { metalness: 0.2, roughness: 0.2, emissive: pal.glow, emissiveIntensity: 1.35 });
  const steelMat = createStandardMat(0xe2e8f0, { metalness: 0.85, roughness: 0.22 });
  const darkIronMat = createStandardMat(0x1e293b, { metalness: 0.75, roughness: 0.35 });

  // Shadow-casting Torso & Pelvis
  const pelvis = new THREE.Mesh(getGeo("pelvis", () => new THREE.CylinderGeometry(4.3, 3.8, 4.2, 8)), armorMat);
  pelvis.position.y = 9.5;
  pelvis.castShadow = true;
  bodyRoot.add(pelvis);

  const belt = new THREE.Mesh(getGeo("belt", () => new THREE.CylinderGeometry(4.6, 4.6, 1.8, 8)), trimMat);
  belt.position.y = 11.4;
  bodyRoot.add(belt);

  const tabard = new THREE.Mesh(getGeo("tabard", () => new THREE.BoxGeometry(3.8, 6.2, 0.7)), clothMat);
  tabard.position.set(0, 7.6, 3.7);
  tabard.rotation.x = -0.1;
  bodyRoot.add(tabard);

  // Articulated Legs (Left & Right Pivots)
  const makeLeg = (xOffset) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 9.2, 0);
    const thigh = new THREE.Mesh(getGeo("thigh", () => new THREE.CylinderGeometry(1.85, 1.55, 5.2, 7)), clothMat);
    thigh.position.y = -2.4;
    thigh.castShadow = true;
    pivot.add(thigh);
    const greave = new THREE.Mesh(getGeo("greave", () => new THREE.CylinderGeometry(1.75, 1.5, 4.8, 7)), armorMat);
    greave.position.y = -6.2;
    greave.castShadow = true;
    pivot.add(greave);
    const boot = new THREE.Mesh(getGeo("boot", () => new THREE.BoxGeometry(2.7, 2.0, 4.2)), darkIronMat);
    boot.position.set(0, -8.3, 0.9);
    boot.castShadow = true;
    pivot.add(boot);
    return pivot;
  };
  const leftLegPivot = makeLeg(-2.5);
  const rightLegPivot = makeLeg(2.5);
  bodyRoot.add(leftLegPivot, rightLegPivot);

  // Torso Group (rotates with attack slash / cast torso twist!)
  const torsoPivot = new THREE.Group();
  torsoPivot.position.y = 11.6;
  bodyRoot.add(torsoPivot);

  const isHeavy = champ.role === "TANK";
  const chestW = isHeavy ? 6.6 : champ.role === "MELEE" ? 5.8 : 4.9;
  const chestMesh = new THREE.Mesh(
    getGeo(`chest_${chestW}`, () => new THREE.CylinderGeometry(chestW, 4.1, 8.6, 8)),
    armorMat
  );
  chestMesh.position.y = 4.3;
  chestMesh.castShadow = true;
  torsoPivot.add(chestMesh);

  const chestCore = new THREE.Mesh(getGeo("chestCore", () => new THREE.OctahedronGeometry(1.6, 0)), glowMat);
  chestCore.position.set(0, 5.4, chestW * 0.62);
  torsoPivot.add(chestCore);

  // Flowing Back Cape / Mantle (for non-tank/tech, or armored back fin)
  const capePivot = new THREE.Group();
  capePivot.position.set(0, 8.2, -3.4);
  torsoPivot.add(capePivot);

  if (champ.id === "vex") {
    // Jet thrusters
    for (const sx of [-2.4, 2.4]) {
      const pod = new THREE.Mesh(getGeo("jetPod", () => new THREE.CylinderGeometry(1.3, 1.7, 5.5, 7)), darkIronMat);
      pod.position.set(sx, -1.6, -0.5);
      pod.rotation.x = 0.25;
      capePivot.add(pod);
      const flame = new THREE.Mesh(getGeo("jetFlame", () => new THREE.ConeGeometry(1.1, 3.0, 6)), glowMat);
      flame.position.set(sx, -5.0, -1.2);
      flame.rotation.x = Math.PI + 0.25;
      capePivot.add(flame);
    }
  } else if (champ.id === "lyra" || champ.id === "solaris" || champ.id === "volt") {
    // Floating Mystic Back Halo / Electric Ring
    const haloRing = new THREE.Mesh(getGeo("backHalo", () => new THREE.TorusGeometry(6.8, 0.55, 6, 18, Math.PI * 1.45)), glowMat);
    haloRing.position.set(0, 2.2, -2.0);
    haloRing.rotation.z = -Math.PI * 0.225;
    capePivot.add(haloRing);
  }
  const capeGeo = getGeo("cape", () => {
    const g = new THREE.BoxGeometry(8.2, 12.0, 0.65);
    g.translate(0, -6.0, 0);
    return g;
  });
  const capeMesh = new THREE.Mesh(capeGeo, clothMat);
  capeMesh.rotation.x = 0.22;
  capeMesh.castShadow = true;
  capePivot.add(capeMesh);

  // Shoulders & Pauldrons + Arms
  const makeArm = (side) => {
    const armPivot = new THREE.Group();
    const sx = side * (chestW + 1.1);
    armPivot.position.set(sx, 7.2, 0);

    // Heroic Pauldron
    const pauldronScale = isHeavy ? 1.35 : champ.role === "MELEE" ? 1.15 : 0.88;
    const pauldron = new THREE.Mesh(getGeo("pauldron", () => new THREE.SphereGeometry(2.6, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62)), trimMat);
    pauldron.scale.set(pauldronScale, pauldronScale * 0.88, pauldronScale);
    pauldron.position.set(side * 0.5, 0.8, 0);
    pauldron.castShadow = true;
    armPivot.add(pauldron);

    if (isHeavy || champ.id === "thorn") {
      const spike = new THREE.Mesh(getGeo("pSpike", () => new THREE.ConeGeometry(0.9, 3.6, 5)), steelMat);
      spike.position.set(side * 1.6, 3.2, 0);
      spike.rotation.z = -side * 0.5;
      armPivot.add(spike);
    }

    const upperArm = new THREE.Mesh(getGeo("upperArm", () => new THREE.CylinderGeometry(1.45, 1.25, 4.6, 7)), armorMat);
    upperArm.position.y = -2.1;
    upperArm.castShadow = true;
    armPivot.add(upperArm);

    const gauntlet = new THREE.Mesh(getGeo("gauntlet", () => new THREE.CylinderGeometry(1.5, 1.35, 4.2, 7)), darkIronMat);
    gauntlet.position.set(0, -5.6, 0.8);
    gauntlet.rotation.x = -0.35;
    gauntlet.castShadow = true;
    armPivot.add(gauntlet);

    const handMount = new THREE.Group();
    handMount.position.set(0, -7.2, 1.8);
    armPivot.add(handMount);

    return { armPivot, handMount };
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  torsoPivot.add(leftArm.armPivot, rightArm.armPivot);

  // Sculpted Head + Helmet / Hood / Crown + Emissive Eyes
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 9.6, 0);
  torsoPivot.add(headPivot);

  const headSphere = new THREE.Mesh(getGeo("headBase", () => new THREE.SphereGeometry(3.3, 12, 10)), skinMat);
  headSphere.position.y = 2.6;
  headSphere.castShadow = true;
  headPivot.add(headSphere);

  // Glowing Battlerite Eyes
  for (const ex of [-1.05, 1.05]) {
    const eye = new THREE.Mesh(getGeo("eye", () => new THREE.BoxGeometry(0.95, 0.55, 0.5)), glowMat);
    eye.position.set(ex, 2.8, 3.1);
    headPivot.add(eye);
  }

  // Unique Headgear per Champion
  const helmGroup = new THREE.Group();
  helmGroup.position.y = 2.6;
  headPivot.add(helmGroup);

  if (champ.id === "balrog" || champ.id === "titan" || champ.id === "thorn") {
    const helm = new THREE.Mesh(getGeo("heavyHelm", () => new THREE.CylinderGeometry(3.55, 3.8, 4.8, 8)), armorMat);
    helm.position.y = 0.5;
    helmGroup.add(helm);
    for (const hs of [-1, 1]) {
      const horn = new THREE.Mesh(getGeo("horn", () => new THREE.ConeGeometry(1.0, 5.2, 6)), trimMat);
      horn.position.set(hs * 3.1, 2.4, 0.2);
      horn.rotation.z = -hs * 0.72;
      horn.rotation.x = 0.25;
      helmGroup.add(horn);
    }
  } else if (champ.id === "kylen" || champ.id === "raigon" || champ.id === "solaris") {
    const crestHelm = new THREE.Mesh(getGeo("knightHelm", () => new THREE.SphereGeometry(3.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58)), armorMat);
    crestHelm.position.y = 0.2;
    helmGroup.add(crestHelm);
    const fin = new THREE.Mesh(getGeo("helmFin", () => new THREE.BoxGeometry(0.8, 3.6, 4.6)), trimMat);
    fin.position.set(0, 3.3, -0.5);
    helmGroup.add(fin);
  } else if (champ.id === "sylvia" || champ.id === "nyx" || champ.id === "shade") {
    const hood = new THREE.Mesh(getGeo("assassinHood", () => new THREE.ConeGeometry(4.1, 6.2, 8)), clothMat);
    hood.position.set(0, 1.3, -0.6);
    hood.rotation.x = -0.22;
    helmGroup.add(hood);
  } else if (champ.id === "vex") {
    const visor = new THREE.Mesh(getGeo("cyberVisor", () => new THREE.BoxGeometry(5.6, 1.8, 4.2)), glowMat);
    visor.position.set(0, 0.3, 1.6);
    helmGroup.add(visor);
    const dome = new THREE.Mesh(getGeo("cyberDome", () => new THREE.SphereGeometry(3.5, 10, 8)), darkIronMat);
    dome.position.y = 0.3;
    helmGroup.add(dome);
  } else {
    // Mages & Supports (Orion, Ignis, Lyra, Frost, Chronos, Volt) -> Crown / Hat / Diadem
    const crown = new THREE.Mesh(getGeo("mageCrown", () => new THREE.TorusGeometry(3.3, 0.62, 6, 12)), trimMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 2.0;
    helmGroup.add(crown);
    const spire = new THREE.Mesh(getGeo("crownSpire", () => new THREE.OctahedronGeometry(1.3, 0)), glowMat);
    spire.position.set(0, 3.6, 1.5);
    helmGroup.add(spire);
  }

  // Bespoke 3D Weapons attached cleanly to Left / Right Hands
  const buildWeaponIntoHands = () => {
    const bladeMat = steelMat;
    if (champ.id === "kylen") {
      for (const h of [rightArm.handMount, leftArm.handMount]) {
        const blade = new THREE.Mesh(buildCurvedBladeGeo(), trimMat);
        blade.rotation.x = Math.PI * 0.42;
        blade.position.set(0, 1, 6.5);
        blade.castShadow = true;
        h.add(blade);
      }
    } else if (champ.id === "raigon") {
      const gs = new THREE.Mesh(buildGreatSwordGeo(), bladeMat);
      gs.rotation.x = Math.PI * 0.42;
      gs.position.set(0, 0.5, 1.5);
      gs.castShadow = true;
      rightArm.handMount.add(gs);
      const guard = new THREE.Mesh(getGeo("hilt", () => new THREE.BoxGeometry(6.8, 1.2, 1.8)), trimMat);
      guard.position.set(0, 1.2, 2.2);
      rightArm.handMount.add(guard);
    } else if (champ.id === "balrog") {
      const shaft = new THREE.Mesh(getGeo("hammerShaft", () => new THREE.CylinderGeometry(0.85, 0.85, 18, 6)), darkIronMat);
      shaft.rotation.x = Math.PI * 0.42;
      shaft.position.set(0, 0, 5.5);
      const head = new THREE.Mesh(getGeo("hammerHead", () => new THREE.BoxGeometry(7.2, 5.5, 5.2)), armorMat);
      head.position.set(0, 2.2, 12.5);
      const core = new THREE.Mesh(getGeo("hammerCore", () => new THREE.BoxGeometry(7.6, 2.2, 2.2)), glowMat);
      core.position.set(0, 2.2, 12.5);
      rightArm.handMount.add(shaft, head, core);
    } else if (champ.id === "sylvia") {
      const bow = new THREE.Mesh(buildBowGeo(), trimMat);
      bow.position.set(0, 0, 3.2);
      bow.castShadow = true;
      leftArm.handMount.add(bow);
      const arrow = new THREE.Mesh(getGeo("arrow", () => new THREE.CylinderGeometry(0.45, 0.45, 12, 5)), glowMat);
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0, 5.5);
      rightArm.handMount.add(arrow);
    } else if (champ.id === "vex") {
      const rifle = new THREE.Mesh(getGeo("railgun", () => new THREE.BoxGeometry(2.1, 2.6, 17.5)), darkIronMat);
      rifle.position.set(-1.5, 0, 7.5);
      rifle.castShadow = true;
      const railGlow = new THREE.Mesh(getGeo("railGlow", () => new THREE.BoxGeometry(0.8, 0.9, 16.5)), glowMat);
      railGlow.position.set(-1.5, 1.1, 8.0);
      rightArm.handMount.add(rifle, railGlow);
    } else if (champ.id === "nyx") {
      for (const h of [rightArm.handMount, leftArm.handMount]) {
        const katar = new THREE.Mesh(getGeo("katar", () => new THREE.ConeGeometry(1.5, 10.5, 4)), glowMat);
        katar.rotation.x = Math.PI / 2;
        katar.position.set(0, 0, 5.5);
        h.add(katar);
      }
    } else if (champ.id === "shade") {
      const pole = new THREE.Mesh(getGeo("scythePole", () => new THREE.CylinderGeometry(0.65, 0.65, 22, 6)), darkIronMat);
      pole.rotation.x = Math.PI * 0.42;
      pole.position.set(0, 1.0, 6.5);
      const sBlade = new THREE.Mesh(buildScytheBladeGeo(), glowMat);
      sBlade.position.set(0, 4.2, 13.5);
      sBlade.rotation.y = Math.PI * 0.25;
      rightArm.handMount.add(pole, sBlade);
    } else if (champ.id === "solaris") {
      const lance = new THREE.Mesh(getGeo("sunLance", () => new THREE.ConeGeometry(1.4, 17, 6)), glowMat);
      lance.rotation.x = Math.PI * 0.45;
      lance.position.set(0, 0.8, 7.5);
      rightArm.handMount.add(lance);
      const shield = new THREE.Mesh(buildShieldGeo(), trimMat);
      shield.position.set(-1.2, 0.6, 2.2);
      shield.rotation.y = -0.35;
      shield.castShadow = true;
      leftArm.handMount.add(shield);
    } else if (champ.id === "titan") {
      for (const h of [rightArm.handMount, leftArm.handMount]) {
        const fist = new THREE.Mesh(getGeo("titanFist", () => new THREE.DodecahedronGeometry(3.5, 0)), trimMat);
        fist.position.set(0, 0, 2.4);
        fist.castShadow = true;
        h.add(fist);
      }
    } else if (champ.id === "thorn") {
      const club = new THREE.Mesh(getGeo("thornClub", () => new THREE.ConeGeometry(2.6, 16, 6)), trimMat);
      club.rotation.x = Math.PI * 0.44;
      club.position.set(0, 0.8, 6.5);
      rightArm.handMount.add(club);
    } else {
      // Mages & Supports (Orion, Ignis, Lyra, Frost, Chronos, Volt) -> Sculpted Magic Staff + Glowing Crystal
      const staff = new THREE.Mesh(getGeo("mageStaff", () => new THREE.CylinderGeometry(0.6, 0.6, 19, 6)), trimMat);
      staff.rotation.x = Math.PI * 0.36;
      staff.position.set(0, 2.0, 5.2);
      const orb = new THREE.Mesh(getGeo("staffOrb", () => new THREE.OctahedronGeometry(2.6, 0)), glowMat);
      orb.position.set(0, 6.6, 11.2);
      rightArm.handMount.add(staff, orb);
      const offOrb = new THREE.Mesh(getGeo("offhandOrb", () => new THREE.OctahedronGeometry(1.8, 0)), glowMat);
      offOrb.position.set(0, 0.5, 2.2);
      leftArm.handMount.add(offOrb);
    }
  };
  buildWeaponIntoHands();

  // 3. Counter Golden Shield Aura Mesh + Stun Orbit Stars (pooled inside rig)
  const counterBubble = new THREE.Mesh(
    getGeo("counterBubble", () => new THREE.IcosahedronGeometry(18.5, 1)),
    getMat("counterBubbleMat", () => new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      wireframe: true,
      transparent: true,
      opacity: 0.72
    }))
  );
  counterBubble.position.y = 17;
  counterBubble.visible = false;
  root.add(counterBubble);

  const stunRing = new THREE.Group();
  stunRing.position.y = 33 * pal.scale;
  stunRing.visible = false;
  for (let i = 0; i < 3; i++) {
    const star = new THREE.Mesh(getGeo("stunStar", () => new THREE.OctahedronGeometry(1.55, 0)), getMat("stunStarMat", () => new THREE.MeshBasicMaterial({ color: 0xfde047 })));
    const a = (i / 3) * Math.PI * 2;
    star.position.set(Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5);
    stunRing.add(star);
  }
  root.add(stunRing);

  root.userData.parts = {
    bodyRoot,
    torsoPivot,
    headPivot,
    capePivot,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot: leftArm.armPivot,
    rightArmPivot: rightArm.armPivot,
    ringMesh,
    arrowMesh,
    counterBubble,
    stunRing,
    palScale: pal.scale
  };

  return root;
}

/**
 * 실시간 3D 골격 애니메이션 갱신 (전투 엔진 상태 기반 순수 읽기 업데이트)
 */
export function updateChampionRigAnimation(rig, fighter, arena, timeSec) {
  const parts = rig.userData.parts;
  const cx = arena.centerX || 260;
  const cy = arena.centerY || 210;

  rig.position.set(fighter.x - cx, 0, fighter.y - cy);
  // Three.js +Z faces camera/south; engine facing 0 is +X (East), Math.PI/2 is +Z (South)
  rig.rotation.y = Math.PI / 2 - (fighter.facing || 0);

  if (!fighter.alive) {
    parts.bodyRoot.rotation.x = -Math.PI * 0.48;
    parts.bodyRoot.position.y = 3.5;
    parts.ringMesh.visible = false;
    parts.arrowMesh.visible = false;
    parts.counterBubble.visible = false;
    parts.stunRing.visible = false;
    rig.visible = true;
    return;
  }

  parts.ringMesh.visible = true;
  parts.arrowMesh.visible = true;

  // Stealth flicker visibility
  if (fighter.stealthTimer > 0) {
    rig.visible = Math.floor(timeSec * 14) % 2 === 0;
  } else {
    rig.visible = true;
  }

  const speedMag = Math.hypot(fighter.vx || 0, fighter.vy || 0);
  const moveBlend = Math.min(1, speedMag / 55);
  const stridePhase = timeSec * 13.5;

  // Counter & Stun overlays
  parts.counterBubble.visible = fighter.counterTimer > 0;
  if (parts.counterBubble.visible) {
    parts.counterBubble.rotation.y = timeSec * 4.5;
    parts.counterBubble.rotation.z = Math.sin(timeSec * 6) * 0.25;
  }

  parts.stunRing.visible = fighter.stunTimer > 0;
  if (parts.stunRing.visible) {
    parts.stunRing.rotation.y = timeSec * 7.0;
  }

  // Posture Reset
  parts.bodyRoot.rotation.x = fighter.dashTimer > 0 ? 0.38 : moveBlend * 0.14;
  parts.bodyRoot.position.y = fighter.dashTimer > 0 ? 3.5 : Math.abs(Math.sin(stridePhase)) * moveBlend * 1.4;

  // Leg Stride
  parts.leftLegPivot.rotation.x = Math.sin(stridePhase) * 0.65 * moveBlend;
  parts.rightLegPivot.rotation.x = -Math.sin(stridePhase) * 0.65 * moveBlend;

  // Cape Trail
  parts.capePivot.rotation.x = 0.22 + moveBlend * 0.45 + (fighter.dashTimer > 0 ? 0.35 : 0) + Math.sin(timeSec * 5) * 0.06;

  // State-driven Upper Body & Arm Poses
  if (fighter.stunTimer > 0) {
    parts.torsoPivot.rotation.y = Math.sin(timeSec * 12) * 0.22;
    parts.headPivot.rotation.z = Math.sin(timeSec * 10) * 0.28;
    parts.leftArmPivot.rotation.x = -0.3;
    parts.rightArmPivot.rotation.x = -0.3;
  } else if (fighter.counterTimer > 0) {
    parts.torsoPivot.rotation.y = -0.25;
    parts.headPivot.rotation.z = 0;
    parts.leftArmPivot.rotation.x = -1.25;
    parts.leftArmPivot.rotation.y = 0.55;
    parts.rightArmPivot.rotation.x = -1.25;
    parts.rightArmPivot.rotation.y = -0.55;
  } else if (fighter.state === "ATTACK" || fighter.state === "SKILL" || fighter.state === "ULT") {
    const swing = Math.sin(timeSec * 24) * 0.55;
    parts.torsoPivot.rotation.y = swing * 0.45;
    parts.headPivot.rotation.z = 0;
    parts.rightArmPivot.rotation.x = -1.35 + swing;
    parts.rightArmPivot.rotation.y = 0;
    parts.leftArmPivot.rotation.x = -0.55 - swing * 0.4;
    parts.leftArmPivot.rotation.y = 0;
  } else {
    parts.torsoPivot.rotation.y = Math.sin(stridePhase) * 0.10 * moveBlend;
    parts.headPivot.rotation.z = 0;
    parts.rightArmPivot.rotation.x = -0.45 + Math.sin(stridePhase) * 0.45 * moveBlend;
    parts.rightArmPivot.rotation.y = 0;
    parts.leftArmPivot.rotation.x = -0.35 - Math.sin(stridePhase) * 0.45 * moveBlend;
    parts.leftArmPivot.rotation.y = 0;
  }
}
