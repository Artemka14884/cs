import * as THREE from 'three';

/* =========================================================
   ARENA FPS ONLINE — клиент
   Three.js рендер, физика движения с баннихопом,
   AK-47 со spray-паттерном отдачи, Socket.io мультиплеер.
========================================================= */

// ---------- Базовая настройка сцены ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b7d9);
scene.fog = new THREE.Fog(0x87b7d9, 40, 140);

const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Свет ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
sun.position.set(40, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 200;
scene.add(sun);

// ---------- Материалы ----------
const matFloor = new THREE.MeshStandardMaterial({ color: 0x555f6b, roughness: 0.9 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.85 });
const matBox = new THREE.MeshStandardMaterial({ color: 0xb8863b, roughness: 0.7 });
const matRamp = new THREE.MeshStandardMaterial({ color: 0x3d6b8a, roughness: 0.6 });
const matMetal = new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.35, metalness: 0.6 });

// ---------- Коллизионные объекты (простые AABB) ----------
const colliders = []; // {mesh, box3}

function addBox(w, h, d, x, y, z, material, castShadow = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const box3 = new THREE.Box3().setFromObject(mesh);
  colliders.push({ mesh, box3 });
  return mesh;
}

// ---------- Тренировочная карта ----------
function buildTrainingMap() {
  // Пол
  const floorGeo = new THREE.PlaneGeometry(140, 140);
  const floor = new THREE.Mesh(floorGeo, matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Внешние стены арены
  addBox(140, 8, 1, 0, 4, -70, matWall);
  addBox(140, 8, 1, 0, 4, 70, matWall);
  addBox(1, 8, 140, -70, 4, 0, matWall);
  addBox(1, 8, 140, 70, 4, 0, matWall);

  // Центральные укрытия (для стрельбы/тренировки прицела)
  addBox(4, 3, 4, 8, 1.5, 8, matBox);
  addBox(4, 3, 4, -8, 1.5, 8, matBox);
  addBox(4, 3, 4, 8, 1.5, -8, matBox);
  addBox(4, 3, 4, -8, 1.5, -8, matBox);
  addBox(2, 2, 12, 0, 1, 0, matBox);

  // Мишени-стены для тренировки отдачи (AK-47 spray)
  for (let i = -2; i <= 2; i++) {
    addBox(3, 4, 0.3, i * 4, 2, -30, matMetal);
  }

  // ---- Зона баннихопа: серия рамп и платформ разной высоты ----
  const bhopZ = 30;
  const rampCount = 7;
  for (let i = 0; i < rampCount; i++) {
    const x = -24 + i * 8;
    const height = 1 + i * 0.6;
    // платформа
    addBox(4, 0.5, 4, x, height, bhopZ, matRamp);
    // рампа-подъём к следующей платформе
    if (i < rampCount - 1) {
      const rampMesh = addBox(4, 0.4, 4.2, x + 4, height + 0.4, bhopZ, matRamp);
      rampMesh.rotation.x = -0.35;
    }
  }
  // Финальная высокая платформа с прыжком вниз (для практики приземления в бхоп)
  addBox(6, 0.5, 6, -24 + rampCount * 8, 1 + (rampCount - 1) * 0.6, bhopZ, matRamp);

  // Отдельная низкая полоса препятствий (страйф-джампы)
  for (let i = 0; i < 10; i++) {
    addBox(1.2, 0.4, 3, -20 + i * 3.5, 0.6, 45 + (i % 2 === 0 ? 0 : 1.5), matRamp);
  }

  // Лестница из ящиков
  for (let i = 0; i < 5; i++) {
    addBox(3, 1, 3, 40, 0.5 + i * 1, -20 + i * 3, matBox);
  }

  // ---- Дополнительные объекты для тренировки (бочки, ящики разных форм) ----
  addBarrel(15, 1, -20);
  addBarrel(15.8, 1, -19.3);
  addBarrel(-15, 1, -20);
  addCrateStack(25, 0, 0, 3);
  addCrateStack(-25, 0, 0, 2);
  addCrateStack(0, 0, -45, 4);
  addBox(6, 0.15, 6, 25, 0.08, 20, matMetal, false); // плита-платформа
  addBarrel(25, 1, 20.5);
  addBarrel(-8, 1, -8.5);
}

// ---------- Переиспользуемые объекты-пропы ----------
function addBarrel(x, y, z) {
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a3b2b, roughness: 0.6, metalness: 0.3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const box3 = new THREE.Box3().setFromObject(mesh);
  colliders.push({ mesh, box3 });
  return mesh;
}

function addCrateStack(cx, cy, cz, count) {
  const positions = [
    [0, 0, 0], [1.1, 0, 0], [0.55, 1.1, 0], [0, 0, 1.1], [1.1, 0, 1.1]
  ];
  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const [dx, dy, dz] = positions[i];
    addBox(1, 1, 1, cx + dx, cy + 0.5 + dy, cz + dz, matBox);
  }
}

// Карта строится после получения ответа от сервера (см. socket.on('init', ...) ниже),
// чтобы все игроки сессии видели одну и ту же карту.
let activeMapId = 'training';
function buildMap(mapId) {
  activeMapId = mapId;
  if (mapId === 'bazaar') {
    buildDesertBazaarMap();
  } else if (mapId === 'industrial') {
    buildIndustrialMap();
  } else {
    buildTrainingMap();
  }
  colliders.forEach(c => c.box3.setFromObject(c.mesh));
  spawnGrenadePickups(mapId);
}

// ---------- Пустынный рынок (оригинальная карта в духе ближневосточного города,
// вдохновлена общей эстетикой пустынных карт жанра — не копия конкретного
// официального левел-дизайна) ----------
function buildDesertBazaarMap() {
  const matSand = new THREE.MeshStandardMaterial({ color: 0xd9b877, roughness: 0.95 });
  const matSandstone = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85 });
  const matSandstoneDark = new THREE.MeshStandardMaterial({ color: 0xa67e4d, roughness: 0.85 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
  const matCloth = new THREE.MeshStandardMaterial({ color: 0xb3402f, roughness: 0.9 });
  const matClothBlue = new THREE.MeshStandardMaterial({ color: 0x2f6fb3, roughness: 0.9 });
  const matPalm = new THREE.MeshStandardMaterial({ color: 0x3c6b34, roughness: 0.8 });
  const matTrunk = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });

  scene.background = new THREE.Color(0xe8c98a);
  scene.fog = new THREE.Fog(0xe8c98a, 45, 150);
  hemi.color.set(0xfff3d0);
  hemi.groundColor.set(0xc9a06a);
  sun.color.set(0xffe3ad);
  sun.intensity = 1.3;

  // Песчаный пол
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), matSand);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Внешние границы города
  addBox(150, 10, 1, 0, 5, -75, matSandstoneDark);
  addBox(150, 10, 1, 0, 5, 75, matSandstoneDark);
  addBox(1, 10, 150, -75, 5, 0, matSandstoneDark);
  addBox(1, 10, 150, 75, 5, 0, matSandstoneDark);

  // ---- Здание А (юго-западный квартал, "точка А") ----
  function building(x, z, w, d, h, mat, doorGapX = null) {
    const wallH = h;
    addBox(w, wallH, 0.5, x, wallH / 2, z - d / 2, mat); // задняя стена
    addBox(0.5, wallH, d, x - w / 2, wallH / 2, z, mat);  // левая
    addBox(0.5, wallH, d, x + w / 2, wallH / 2, z, mat);  // правая
    if (doorGapX === null) {
      addBox(w, wallH, 0.5, x, wallH / 2, z + d / 2, mat); // передняя (без прохода)
    } else {
      const gap = 2.2;
      addBox((w - gap) / 2, wallH, 0.5, x - gap / 2 - (w - gap) / 4, wallH / 2, z + d / 2, mat);
      addBox((w - gap) / 2, wallH, 0.5, x + gap / 2 + (w - gap) / 4, wallH / 2, z + d / 2, mat);
    }
    addBox(w + 0.6, 0.4, d + 0.6, x, h + 0.2, z, matSandstoneDark); // крыша
  }

  building(-30, -35, 14, 12, 6, matSandstone, 0);
  building(-30, 35, 14, 12, 6, matSandstone, 0);
  building(30, -35, 14, 12, 6, matSandstone, 0);
  building(30, 35, 14, 12, 6, matSandstone, 0);

  // Арки-проходы между зданиями (характерный элемент ближневосточной архитектуры)
  function archway(x, z, rotY) {
    const g = new THREE.Group();
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), matSandstone);
    pillarL.position.set(-1.5, 2, 0);
    const pillarR = pillarL.clone();
    pillarR.position.set(1.5, 2, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.6, 0.6), matSandstone);
    top.position.set(0, 4, 0);
    g.add(pillarL, pillarR, top);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    [pillarL, pillarR].forEach(p => {
      const worldPos = p.getWorldPosition(new THREE.Vector3());
      const box3 = new THREE.Box3().setFromObject(p);
      colliders.push({ mesh: p, box3 });
    });
  }
  archway(0, -35, 0);
  archway(0, 35, 0);

  // ---- Средний коридор (mid) с длинной стеной-прикрытием ----
  addBox(1, 3, 40, -3, 1.5, 0, matSandstone);
  addBox(1, 3, 40, 3, 1.5, 0, matSandstoneDark);
  for (let i = -1; i <= 1; i += 2) {
    addBox(2, 1.2, 2, i * 3, 0.6, 15, matSandstone);
    addBox(2, 1.2, 2, i * 3, 0.6, -15, matSandstone);
  }

  // ---- Рыночная площадь в центре с прилавками и навесами ----
  function marketStall(x, z, clothMat) {
    const g = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8);
    const positions = [[-1.2, -0.8], [1.2, -0.8], [-1.2, 0.8], [1.2, 0.8]];
    positions.forEach(([px, pz]) => {
      const pole = new THREE.Mesh(poleGeo, matWood);
      pole.position.set(px, 1.1, pz);
      pole.castShadow = true;
      g.add(pole);
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2, 1), clothMat);
    roof.position.set(0, 2.25, 0);
    roof.castShadow = true;
    g.add(roof);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.6), matWood);
    counter.position.set(0, 0.45, 0);
    counter.castShadow = true;
    counter.receiveShadow = true;
    g.add(counter);
    g.position.set(x, 0, z);
    scene.add(g);
    const box3 = new THREE.Box3().setFromObject(counter);
    colliders.push({ mesh: counter, box3 });
    return g;
  }
  marketStall(-8, 5, matCloth);
  marketStall(8, 5, matClothBlue);
  marketStall(-8, -5, matClothBlue);
  marketStall(8, -5, matCloth);

  // Ящики и бочки, разбросанные по рынку (прикрытия для перестрелок)
  addCrateStackDesert(0, 0, 10, 3, matWood);
  addCrateStackDesert(14, 0, 0, 2, matWood);
  addCrateStackDesert(-14, 0, 0, 4, matWood);
  addBarrelDesert(3, 1, 2);
  addBarrelDesert(-3, 1, -2);
  addBarrelDesert(18, 1, 18);
  addBarrelDesert(-18, 1, -18);
  addBarrelDesert(18, 1, -18);
  addBarrelDesert(-18, 1, 18);

  // Пальмы для атмосферы
  function palm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 3.2, 8), matTrunk);
    trunk.position.set(x, 1.6, z);
    trunk.rotation.z = 0.08;
    trunk.castShadow = true;
    scene.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.25, 2.2, 4), matPalm);
      leaf.position.set(x, 3.1, z);
      leaf.rotation.z = Math.PI / 2.4;
      leaf.rotation.y = (i / 6) * Math.PI * 2;
      leaf.castShadow = true;
      scene.add(leaf);
    }
  }
  palm(22, 4); palm(-22, -4); palm(4, 22); palm(-4, -22); palm(0, 55); palm(0, -55);

  // Высокие сторожевые башни по углам (визуальные ориентиры)
  [[-55, -55], [55, -55], [-55, 55], [55, 55]].forEach(([x, z]) => {
    addBox(4, 9, 4, x, 4.5, z, matSandstoneDark);
    addBox(4.6, 0.4, 4.6, x, 9.2, z, matSandstone);
  });

  // Дальняя зона для баннихопа — те же рампы, что и на тренировочной, но в песочной тематике
  const bhopZ = 60;
  const rampCount = 6;
  for (let i = 0; i < rampCount; i++) {
    const x = -18 + i * 7;
    const height = 1 + i * 0.6;
    addBox(4, 0.5, 4, x, height, bhopZ, matSandstone);
    if (i < rampCount - 1) {
      const rampMesh = addBox(4, 0.4, 4.2, x + 3.5, height + 0.4, bhopZ, matSandstone);
      rampMesh.rotation.x = -0.35;
    }
  }
}

function addBarrelDesert(x, y, z) {
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b5a3b, roughness: 0.7, metalness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const box3 = new THREE.Box3().setFromObject(mesh);
  colliders.push({ mesh, box3 });
}

function addCrateStackDesert(cx, cy, cz, count, mat) {
  const positions = [
    [0, 0, 0], [1.1, 0, 0], [0.55, 1.1, 0], [0, 0, 1.1], [1.1, 0, 1.1]
  ];
  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const [dx, dy, dz] = positions[i];
    addBox(1, 1, 1, cx + dx, cy + 0.5 + dy, cz + dz, mat);
  }
}

// ---------- Промышленная зона (оригинальная карта: контейнерный склад/порт) ----------
function buildIndustrialMap() {
  const matGround = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.95 });
  const matContainerRed = new THREE.MeshStandardMaterial({ color: 0xa8412f, roughness: 0.6, metalness: 0.3 });
  const matContainerBlue = new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.6, metalness: 0.3 });
  const matContainerYellow = new THREE.MeshStandardMaterial({ color: 0xc4a12b, roughness: 0.6, metalness: 0.3 });
  const matContainerGreen = new THREE.MeshStandardMaterial({ color: 0x3f7a3f, roughness: 0.6, metalness: 0.3 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.9 });
  const matBeam = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.8 });

  scene.background = new THREE.Color(0x6d7686);
  scene.fog = new THREE.Fog(0x6d7686, 40, 140);
  hemi.color.set(0xcfd8e3);
  hemi.groundColor.set(0x3a3d42);
  sun.color.set(0xdfe6ee);
  sun.intensity = 1.0;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), matGround);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Границы порта
  addBox(140, 9, 1, 0, 4.5, -70, matConcrete);
  addBox(140, 9, 1, 0, 4.5, 70, matConcrete);
  addBox(1, 9, 140, -70, 4.5, 0, matConcrete);
  addBox(1, 9, 140, 70, 4.5, 0, matConcrete);

  const containerColors = [matContainerRed, matContainerBlue, matContainerYellow, matContainerGreen];
  function container(x, z, rotY, stacked, colorIdx) {
    const mat = containerColors[colorIdx % containerColors.length];
    const w = 2.4, h = 2.6, d = 6;
    const g = addBox(w, h, d, x, h / 2, z, mat);
    g.rotation.y = rotY;
    // Пересчитываем коллайдер под финальный поворот (box3 считается в момент addBox, до rotation)
    const entry = colliders.find(c => c.mesh === g);
    if (entry) entry.box3.setFromObject(g);

    if (stacked) {
      const g2 = addBox(w, h, d, x, h * 1.5, z, containerColors[(colorIdx + 1) % containerColors.length]);
      g2.rotation.y = rotY;
      const entry2 = colliders.find(c => c.mesh === g2);
      if (entry2) entry2.box3.setFromObject(g2);
    }
    return g;
  }

  // Ряды контейнеров (укрытия, лабиринт для перестрелок)
  container(-20, -20, 0, true, 0);
  container(-20, -10, 0, false, 1);
  container(-12, -20, Math.PI / 2, false, 2);
  container(20, 20, 0, true, 3);
  container(20, 10, 0, false, 0);
  container(12, 20, Math.PI / 2, false, 1);
  container(-20, 20, Math.PI / 2, false, 2);
  container(20, -20, Math.PI / 2, true, 3);
  container(0, -30, 0, false, 1);
  container(0, 30, 0, false, 2);
  container(-30, 0, Math.PI / 2, false, 0);
  container(30, 0, Math.PI / 2, false, 3);

  // Центральная зона — открытая площадка с ящиками
  addCrateStackIndustrial(0, 0, 0, 4);
  addCrateStackIndustrial(6, 0, -4, 2);
  addCrateStackIndustrial(-6, 0, 4, 3);

  // Портовые краны (визуальный ориентир + частичная коллизия по опорам)
  function crane(x, z) {
    addBox(1, 14, 1, x - 4, 7, z, matBeam);
    addBox(1, 14, 1, x + 4, 7, z, matBeam);
    addBox(9, 0.6, 1, x, 14, z, matBeam, false);
    addBox(0.5, 0.5, 6, x, 13.6, z - 3, matBeam, false);
  }
  crane(-40, -40);
  crane(40, 40);

  // Штабеля ящиков вдоль стен под тренировку прицела
  for (let i = -2; i <= 2; i++) {
    addBox(3, 4, 0.3, i * 5, 2, -35, matBeam);
  }

  // Зона баннихопа — металлические платформы/рампы
  const bhopZ = 45;
  const rampCount = 7;
  for (let i = 0; i < rampCount; i++) {
    const x = -24 + i * 8;
    const height = 1 + i * 0.6;
    addBox(4, 0.5, 4, x, height, bhopZ, matBeam);
    if (i < rampCount - 1) {
      const rampMesh = addBox(4, 0.4, 4.2, x + 4, height + 0.4, bhopZ, matBeam);
      rampMesh.rotation.x = -0.35;
    }
  }
}

function addCrateStackIndustrial(cx, cy, cz, count) {
  const positions = [
    [0, 0, 0], [1.1, 0, 0], [0.55, 1.1, 0], [0, 0, 1.1], [1.1, 0, 1.1]
  ];
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8863b, roughness: 0.7 });
  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const [dx, dy, dz] = positions[i];
    addBox(1, 1, 1, cx + dx, cy + 0.5 + dy, cz + dz, mat);
  }
}

// ---------- AK-47 (процедурная модель, не текстуры из игр) ----------
function buildAK47() {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b3f1d, roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.35, metalness: 0.7 });
  const magMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.5 });

  // Ствольная коробка (receiver)
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), steelMat);
  receiver.position.set(0, 0, 0);
  group.add(receiver);

  // Приклад
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.28), woodMat);
  stock.position.set(0, -0.01, 0.38);
  group.add(stock);

  // Цевьё
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.22), woodMat);
  handguard.position.set(0, -0.02, -0.32);
  group.add(handguard);

  // Ствол
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 12), steelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.62);
  group.add(barrel);

  // Дульный тормоз
  const muzzleTip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 12), steelMat);
  muzzleTip.rotation.x = Math.PI / 2;
  muzzleTip.position.set(0, 0.01, -0.84);
  group.add(muzzleTip);

  // Изогнутый магазин (несколько сегментов для изгиба)
  const magGroup = new THREE.Group();
  const segCount = 5;
  for (let i = 0; i < segCount; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.05), magMat);
    const t = i / (segCount - 1);
    seg.position.set(0, -0.12 - t * 0.16, -0.02 + Math.sin(t * 1.2) * 0.07);
    seg.rotation.x = -t * 0.5;
    magGroup.add(seg);
  }
  group.add(magGroup);

  // Мушка/прицел
  const foreSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), steelMat);
  foreSight.position.set(0, 0.05, -0.78);
  group.add(foreSight);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.012), steelMat);
  rearSight.position.set(0, 0.05, -0.1);
  group.add(rearSight);

  // Рукоятка
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.06), woodMat);
  grip.position.set(0, -0.11, 0.12);
  grip.rotation.x = 0.35;
  group.add(grip);

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

  // Точка дульной вспышки (в мировых координатах вычисляется отдельно)
  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0.01, -0.87);
  group.add(muzzlePoint);
  group.userData.muzzlePoint = muzzlePoint;

  return group;
}

// ---------- Пистолет (процедурная модель) ----------
function buildPistol() {
  const group = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x35383d, roughness: 0.3, metalness: 0.75 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.24), steelMat);
  slide.position.set(0, 0.03, -0.06);
  group.add(slide);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 10), steelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.035, -0.22);
  group.add(barrel);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.12), steelMat);
  frame.position.set(0, -0.005, 0.02);
  group.add(frame);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.13, 0.06), gripMat);
  grip.position.set(0, -0.09, 0.06);
  grip.rotation.x = 0.25;
  group.add(grip);

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), steelMat);
  trigger.position.set(0, -0.02, -0.01);
  group.add(trigger);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.015), steelMat);
  sight.position.set(0, 0.06, -0.15);
  group.add(sight);

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0.035, -0.27);
  group.add(muzzlePoint);
  group.userData.muzzlePoint = muzzlePoint;

  return group;
}

// ---------- Нож (процедурная модель) ----------
function buildKnife() {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: 0.2, metalness: 0.9 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 0.7 });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.22), bladeMat);
  blade.position.set(0, 0, -0.14);
  group.add(blade);

  const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 4), bladeMat);
  bladeTip.rotation.x = -Math.PI / 2;
  bladeTip.rotation.y = Math.PI / 4;
  bladeTip.position.set(0, 0, -0.27);
  group.add(bladeTip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 }));
  guard.position.set(0, 0, -0.02);
  group.add(guard);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.13, 8), handleMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0, 0.06);
  group.add(handle);

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}

// ---------- Набор оружия и переключение ----------
function attachMuzzleFX(group) {
  const mp = group.userData.muzzlePoint;
  if (!mp) return null;
  const light = new THREE.PointLight(0xffb347, 0, 4, 2);
  light.position.copy(mp.position);
  group.add(light);

  const geo = new THREE.ConeGeometry(0.03, 0.12, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(mp.position);
  mesh.position.z -= 0.05;
  group.add(mesh);

  return { light, mat };
}

const ak47Group = buildAK47();
ak47Group.position.set(0.22, -0.22, -0.45);
ak47Group.rotation.y = Math.PI;

const pistolGroup = buildPistol();
pistolGroup.position.set(0.2, -0.2, -0.35);
pistolGroup.rotation.y = Math.PI;
pistolGroup.visible = false;

const knifeGroup = buildKnife();
knifeGroup.position.set(0.18, -0.18, -0.32);
knifeGroup.rotation.y = Math.PI;
knifeGroup.visible = false;

camera.add(ak47Group, pistolGroup, knifeGroup);
scene.add(camera);

const weaponFX = {
  ak47: attachMuzzleFX(ak47Group),
  pistol: attachMuzzleFX(pistolGroup)
};
const weaponGroups = { ak47: ak47Group, pistol: pistolGroup, knife: knifeGroup };

const WEAPON_STATS = {
  ak47: { kind: 'gun', magSize: 30, rof: 100, dmg: 27, headDmg: 60, reloadTime: 1600 },
  pistol: { kind: 'gun', magSize: 12, rof: 260, dmg: 22, headDmg: 45, reloadTime: 1200 },
  knife: { kind: 'melee', dmg: 55, range: 2.3, swingTime: 430 }
};

let currentWeapon = 'ak47';

function switchWeapon(name) {
  if (!weaponGroups[name] || currentWeapon === name || player.reloading) return;
  weaponGroups[currentWeapon].visible = false;
  weaponGroups[name].visible = true;
  currentWeapon = name;
  recoilOffsetPitch = 0;
  recoilOffsetYaw = 0;
  recoilIndex = 0;
  updateAmmoHUD();
  updateWeaponNameHUD();
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') switchWeapon('ak47');
  if (e.code === 'Digit2') switchWeapon('pistol');
  if (e.code === 'Digit3') switchWeapon('knife');
  if (e.code === 'KeyG') throwGrenade();
});


// ---------- Игрок: физика движения (Source-style, с баннихопом) ----------
const player = {
  pos: new THREE.Vector3(0, 2, 0),
  vel: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  onGround: false,
  height: 1.7,
  radius: 0.35,
  health: 100,
  alive: true,
  ammoByWeapon: { ak47: 30, pistol: 12 },
  reloading: false,
  jumpQueued: false,
  grenades: 1
};

const keys = {};
let pointerLocked = false;

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && player.onGround) {
    player.jumpQueued = true;
  }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyT') {
    const chatInput = document.getElementById('chatInput');
    if (document.activeElement !== chatInput) {
      chatInput.style.display = 'block';
      chatInput.style.pointerEvents = 'auto';
      chatInput.focus();
    }
  }
  if (e.code === 'Escape') document.exitPointerLock();
  if (e.code === 'Tab') {
    e.preventDefault();
    document.getElementById('scoreboard').classList.remove('hidden');
    updateScoreboard();
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') document.getElementById('scoreboard').classList.add('hidden');
});

document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.code === 'Enter') {
    const val = e.target.value.trim();
    if (val) socket.emit('chat', val);
    e.target.value = '';
    e.target.style.display = 'none';
    e.target.style.pointerEvents = 'none';
    e.target.blur();
  } else if (e.code === 'Escape') {
    e.target.style.display = 'none';
    e.target.style.pointerEvents = 'none';
    e.target.blur();
  }
});

// ---------- Мышь / Pointer Lock / Тач-управление ----------
const canvas = renderer.domElement;
const lockHint = document.getElementById('crosshairLockHint');

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
let touchControlsActive = false;

function requestLock() { canvas.requestPointerLock(); }

document.getElementById('playBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value || 'Player';
  const mapId = document.getElementById('mapSelect').value;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  socket.emit('join', { name, mapId });

  if (isTouchDevice) {
    document.getElementById('touchControls').classList.remove('hidden');
    touchControlsActive = true;
  } else {
    requestLock();
  }
});

canvas.addEventListener('click', () => {
  if (isTouchDevice) return; // на тач-устройствах стрельба идёт через кнопку, а не клик по канвасу
  if (!pointerLocked && !document.getElementById('menu').classList.contains('hidden')) return;
  if (!pointerLocked) requestLock();
  else if (player.alive) shoot();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  lockHint.classList.toggle('hidden', pointerLocked || isTouchDevice);
  if (document.getElementById('menu').classList.contains('hidden') === false) {
    lockHint.classList.add('hidden');
  }
});

const MOUSE_SENS = 0.0022;
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  player.yaw -= e.movementX * MOUSE_SENS;
  player.pitch -= e.movementY * MOUSE_SENS;
  player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, player.pitch));
  applyRecoilToView(); // отдача аккуратно суммируется поверх
});

let mouseHeld = false;
document.addEventListener('mousedown', (e) => { if (e.button === 0) mouseHeld = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });

// ================= СЕНСОРНОЕ УПРАВЛЕНИЕ (телефон/планшет) =================
// Джойстик слева — движение, свайп справа — обзор камерой,
// отдельные кнопки — стрельба/прыжок/перезарядка.
const touchMoveVector = { x: 0, y: 0 }; // x: право(+)/лево(-), y: вперёд(+)/назад(-)

if (isTouchDevice) {
  const joystickZone = document.getElementById('joystickZone');
  const joystickBase = document.getElementById('joystickBase');
  const joystickStick = document.getElementById('joystickStick');
  const lookZone = document.getElementById('lookZone');

  let joystickTouchId = null;
  let joystickOriginX = 0, joystickOriginY = 0;
  const JOYSTICK_RADIUS = 55;

  joystickZone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (joystickTouchId !== null) return;
    joystickTouchId = t.identifier;
    joystickOriginX = t.clientX;
    joystickOriginY = t.clientY;
    joystickBase.style.display = 'block';
    joystickBase.style.left = (t.clientX - 55) + 'px';
    joystickBase.style.top = (t.clientY - 55) + 'px';
    joystickStick.style.top = '30px';
    joystickStick.style.left = '30px';
  }, { passive: true });

  joystickZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickTouchId) continue;
      let dx = t.clientX - joystickOriginX;
      let dy = t.clientY - joystickOriginY;
      const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_RADIUS);
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * dist;
      dy = Math.sin(angle) * dist;
      joystickStick.style.left = (30 + dx) + 'px';
      joystickStick.style.top = (30 + dy) + 'px';
      touchMoveVector.x = dx / JOYSTICK_RADIUS;
      touchMoveVector.y = -dy / JOYSTICK_RADIUS; // вверх на экране = вперёд
    }
  }, { passive: true });

  function endJoystick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickTouchId) continue;
      joystickTouchId = null;
      joystickBase.style.display = 'none';
      touchMoveVector.x = 0;
      touchMoveVector.y = 0;
    }
  }
  joystickZone.addEventListener('touchend', endJoystick, { passive: true });
  joystickZone.addEventListener('touchcancel', endJoystick, { passive: true });

  // Обзор камерой свайпом по правой части экрана
  let lookTouchId = null;
  let lastLookX = 0, lastLookY = 0;
  const TOUCH_LOOK_SENS = 0.0055;

  lookZone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (lookTouchId !== null) return;
    lookTouchId = t.identifier;
    lastLookX = t.clientX;
    lastLookY = t.clientY;
  }, { passive: true });

  lookZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookTouchId) continue;
      const dx = t.clientX - lastLookX;
      const dy = t.clientY - lastLookY;
      lastLookX = t.clientX;
      lastLookY = t.clientY;
      player.yaw -= dx * TOUCH_LOOK_SENS;
      player.pitch -= dy * TOUCH_LOOK_SENS;
      player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, player.pitch));
    }
  }, { passive: true });

  function endLook(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  }
  lookZone.addEventListener('touchend', endLook, { passive: true });
  lookZone.addEventListener('touchcancel', endLook, { passive: true });

  // Кнопки
  const fireBtn = document.getElementById('touchFire');
  fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); mouseHeld = true; }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); mouseHeld = false; }, { passive: false });
  fireBtn.addEventListener('touchcancel', () => { mouseHeld = false; });

  const jumpBtn = document.getElementById('touchJump');
  jumpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (player.onGround) player.jumpQueued = true;
  }, { passive: false });

  const reloadBtn = document.getElementById('touchReload');
  reloadBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startReload(); }, { passive: false });

  const weaponSwitchBtn = document.getElementById('touchWeaponSwitch');
  const WEAPON_CYCLE = ['ak47', 'pistol', 'knife'];
  weaponSwitchBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const idx = WEAPON_CYCLE.indexOf(currentWeapon);
    switchWeapon(WEAPON_CYCLE[(idx + 1) % WEAPON_CYCLE.length]);
  }, { passive: false });

  const grenadeBtn = document.getElementById('touchGrenade');
  grenadeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); throwGrenade(); }, { passive: false });
}



// =========================================================
// СИСТЕМА ОТДАЧИ AK-47 (spray-паттерн, как в CS)
// Каждый выстрел даёт смещение по pitch (вверх) и yaw (в сторону),
// паттерн нарастает по мере продолжения очереди и плавно восстанавливается,
// когда игрок отпускает гашетку.
// =========================================================
const AK_RECOIL_PATTERN = (() => {
  // 30 патронов: сначала строго вверх, затем расхождение вправо-влево с нарастанием (классика AK spray)
  const pattern = [];
  for (let i = 0; i < 30; i++) {
    let up, side;
    if (i < 4) {
      up = 0.9 + i * 0.15;
      side = (Math.random() - 0.5) * 0.08;
    } else if (i < 12) {
      up = 1.5 + (i - 4) * 0.05;
      side = 0.35 + (i - 4) * 0.12 + (Math.random() - 0.5) * 0.15;
    } else if (i < 20) {
      up = 1.9 - (i - 12) * 0.02;
      side = 1.3 - (i - 12) * 0.18 + (Math.random() - 0.5) * 0.2;
    } else {
      up = 1.7 + (Math.random() - 0.5) * 0.3;
      side = (Math.random() - 0.5) * 1.4;
    }
    pattern.push({ up: up * 0.011, side: side * 0.011 });
  }
  return pattern;
})();

let recoilIndex = 0;
let recoilOffsetPitch = 0; // накопленное смещение прицела от отдачи
let recoilOffsetYaw = 0;
let lastShotTime = 0;
const RECOIL_RECOVERY_DELAY = 180; // мс после последнего выстрела, когда начинается восстановление
const RECOIL_RECOVERY_SPEED = 0.09; // скорость возврата камеры

// Отдача пистолета — заметно слабее и без длинного накопления, как у полуавтоматического оружия
const PISTOL_RECOIL_PATTERN = (() => {
  const pattern = [];
  for (let i = 0; i < 12; i++) {
    const up = 0.7 + Math.random() * 0.3;
    const side = (Math.random() - 0.5) * 0.6;
    pattern.push({ up: up * 0.011, side: side * 0.011 });
  }
  return pattern;
})();

function getActiveRecoilPattern() {
  return currentWeapon === 'pistol' ? PISTOL_RECOIL_PATTERN : AK_RECOIL_PATTERN;
}

function applyRecoilToView() {
  // применяется вместе с движением мыши в render loop, ничего доп. тут не требуется
}

function fireRecoilKick() {
  const pattern = getActiveRecoilPattern();
  const step = pattern[Math.min(recoilIndex, pattern.length - 1)];
  recoilOffsetPitch += step.up;
  recoilOffsetYaw += step.side;
  recoilIndex++;
  lastShotTime = performance.now();
}

function updateRecoilRecovery(dt) {
  const since = performance.now() - lastShotTime;
  if (since > RECOIL_RECOVERY_DELAY) {
    recoilOffsetPitch *= Math.pow(1 - RECOIL_RECOVERY_SPEED, dt * 60);
    recoilOffsetYaw *= Math.pow(1 - RECOIL_RECOVERY_SPEED, dt * 60);
    if (Math.abs(recoilOffsetPitch) < 0.0005) recoilOffsetPitch = 0;
    if (Math.abs(recoilOffsetYaw) < 0.0005) recoilOffsetYaw = 0;
    if (recoilOffsetPitch === 0 && recoilOffsetYaw === 0) recoilIndex = 0;
  }
}

// ---------- Стрельба / ближний бой ----------
let lastFireTime = 0;
let lastMeleeTime = 0;
const raycaster = new THREE.Raycaster();
const otherPlayerMeshes = {}; // id -> group (для попаданий)

function startReload() {
  const stats = WEAPON_STATS[currentWeapon];
  if (stats.kind !== 'gun') return; // у ножа перезарядки нет
  if (player.reloading || player.ammoByWeapon[currentWeapon] === stats.magSize) return;
  player.reloading = true;
  const reloadingWeapon = currentWeapon;
  setTimeout(() => {
    player.ammoByWeapon[reloadingWeapon] = stats.magSize;
    player.reloading = false;
    updateAmmoHUD();
  }, stats.reloadTime);
}

function raycastHit(origin, dir, maxRange) {
  raycaster.set(origin, dir);
  raycaster.far = maxRange;

  const targets = Object.values(otherPlayerMeshes);
  const meshList = [];
  targets.forEach(g => g.traverse(o => { if (o.isMesh) meshList.push(o); }));

  const hits = raycaster.intersectObjects(meshList, false);
  const envHits = raycaster.intersectObjects(colliders.map(c => c.mesh), false);

  if (hits.length > 0) {
    const envDist = envHits.length > 0 ? envHits[0].distance : Infinity;
    if (hits[0].distance < envDist) return hits[0];
  }
  return null;
}

function shoot() {
  if (!player.alive) return;
  const stats = WEAPON_STATS[currentWeapon];

  if (stats.kind === 'melee') { meleeAttack(stats); return; }
  if (player.reloading) return;

  const now = performance.now();
  if (now - lastFireTime < stats.rof) return;
  if (player.ammoByWeapon[currentWeapon] <= 0) { startReload(); return; }
  lastFireTime = now;
  player.ammoByWeapon[currentWeapon]--; // магазин ограничен, но резерв бесконечен — патроны никогда не заканчиваются насовсем
  updateAmmoHUD();

  fireRecoilKick();
  muzzleFlash();

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.getWorldPosition(new THREE.Vector3());

  const validHit = raycastHit(origin, dir, 200);
  if (validHit) {
    let obj = validHit.object;
    while (obj && !obj.userData.playerId) obj = obj.parent;
    if (obj) {
      const dmg = obj.userData.headHit && validHit.object === obj.userData.headHit ? stats.headDmg : stats.dmg;
      socket.emit('hit', { targetId: obj.userData.playerId, damage: dmg });
    }
  }

  socket.emit('shoot', { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z } });
}

function meleeAttack(stats) {
  const now = performance.now();
  if (now - lastMeleeTime < stats.swingTime) return;
  lastMeleeTime = now;

  knifeSwingAnim();

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.getWorldPosition(new THREE.Vector3());

  const validHit = raycastHit(origin, dir, stats.range);
  if (validHit) {
    let obj = validHit.object;
    while (obj && !obj.userData.playerId) obj = obj.parent;
    if (obj) {
      socket.emit('hit', { targetId: obj.userData.playerId, damage: stats.dmg });
    }
  }
}

function knifeSwingAnim() {
  const g = knifeGroup;
  const baseX = g.position.x, baseY = g.position.y;
  g.rotation.z = -0.6;
  g.position.x -= 0.08;
  setTimeout(() => {
    g.rotation.z = 0.15;
    g.position.x = baseX + 0.05;
  }, 90);
  setTimeout(() => {
    g.rotation.z = 0;
    g.position.x = baseX;
    g.position.y = baseY;
  }, 220);
}

function muzzleFlash() {
  const fx = weaponFX[currentWeapon];
  const group = weaponGroups[currentWeapon];
  if (!fx || !group) return;
  fx.light.intensity = 6;
  fx.mat.opacity = 1;
  setTimeout(() => { fx.light.intensity = 0; fx.mat.opacity = 0; }, 45);

  // лёгкая тряска оружия визуально
  group.position.z += 0.03;
  setTimeout(() => { group.position.z -= 0.03; }, 40);
}

// =========================================================
// ГРАНАТЫ: бросок с дугой полёта, взрыв с уроном по расстоянию,
// плюс подбираемые точки спавна, случайно разбросанные по карте
// и появляющиеся заново через некоторое время после подбора.
// =========================================================
const GRENADE_GRAVITY = 14;
const GRENADE_THROW_SPEED = 16;
const GRENADE_FUSE_TIME = 1500; // мс до взрыва после броска
const GRENADE_RADIUS = 7;       // радиус поражения
const GRENADE_MAX_DAMAGE = 100;
const activeGrenades = []; // {mesh, vel, spawnTime, exploded}

function throwGrenade() {
  if (!player.alive || player.grenades <= 0) return;
  player.grenades--;
  updateGrenadeHUD();

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y += 0.28; // лёгкая дуга вверх
  dir.normalize();

  const origin = camera.getWorldPosition(new THREE.Vector3());
  origin.addScaledVector(dir, 0.4);

  const geo = new THREE.SphereGeometry(0.09, 10, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a5c2e, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  mesh.castShadow = true;
  scene.add(mesh);

  activeGrenades.push({
    mesh,
    vel: dir.clone().multiplyScalar(GRENADE_THROW_SPEED),
    spawnTime: performance.now(),
    exploded: false
  });
}

function updateGrenades(dt) {
  for (let i = activeGrenades.length - 1; i >= 0; i--) {
    const g = activeGrenades[i];
    if (g.exploded) continue;

    g.vel.y -= GRENADE_GRAVITY * dt;
    g.mesh.position.addScaledVector(g.vel, dt);

    // Простое отражение от пола, чтобы граната не улетала под текстуры
    if (g.mesh.position.y <= 0.15) {
      g.mesh.position.y = 0.15;
      g.vel.y *= -0.4;
      g.vel.x *= 0.6;
      g.vel.z *= 0.6;
    }

    const age = performance.now() - g.spawnTime;
    if (age >= GRENADE_FUSE_TIME) {
      explodeGrenade(g);
    }
  }
}

function explodeGrenade(g) {
  g.exploded = true;
  const pos = g.mesh.position.clone();
  scene.remove(g.mesh);

  // Визуальная вспышка взрыва
  const flashGeo = new THREE.SphereGeometry(0.3, 12, 12);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.position.copy(pos);
  scene.add(flashMesh);
  const light = new THREE.PointLight(0xffaa33, 8, GRENADE_RADIUS * 2);
  light.position.copy(pos);
  scene.add(light);

  let t = 0;
  const growInterval = setInterval(() => {
    t += 0.06;
    const scale = 1 + t * 14;
    flashMesh.scale.set(scale, scale, scale);
    flashMat.opacity = Math.max(0, 0.9 - t * 1.4);
    light.intensity = Math.max(0, 8 - t * 12);
    if (t >= 0.65) {
      clearInterval(growInterval);
      scene.remove(flashMesh);
      scene.remove(light);
    }
  }, 16);

  activeGrenades.splice(activeGrenades.indexOf(g), 1);

  // Урон себе (если рядом)
  const selfDist = player.pos.distanceTo(pos);
  if (selfDist < GRENADE_RADIUS && player.alive) {
    const dmg = Math.round(GRENADE_MAX_DAMAGE * (1 - selfDist / GRENADE_RADIUS));
    if (dmg > 0 && myId) socket.emit('hit', { targetId: myId, damage: dmg });
  }

  // Урон другим игрокам в радиусе (по известным клиенту позициям)
  Object.values(otherPlayerMeshes).forEach(mesh => {
    const worldPos = mesh.position.clone();
    worldPos.y += 0.9;
    const dist = worldPos.distanceTo(pos);
    if (dist < GRENADE_RADIUS) {
      const dmg = Math.round(GRENADE_MAX_DAMAGE * (1 - dist / GRENADE_RADIUS));
      if (dmg > 0) socket.emit('hit', { targetId: mesh.userData.playerId, damage: dmg });
    }
  });
}

// ---- Подбираемые гранаты, случайно разбросанные по карте ----
const grenadePickups = []; // {mesh, active}
const GRENADE_PICKUP_COUNT = 6;
const GRENADE_PICKUP_RESPAWN_DELAY = 14000;
const MAP_BOUNDS = { training: 55, bazaar: 55, industrial: 55 };

function spawnGrenadePickups(mapId) {
  const bound = MAP_BOUNDS[mapId] || 55;
  const geo = new THREE.OctahedronGeometry(0.22, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8fae3a, roughness: 0.4, metalness: 0.3, emissive: 0x1c2a08, emissiveIntensity: 0.4 });

  for (let i = 0; i < GRENADE_PICKUP_COUNT; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);
    const pickup = { mesh, active: true };
    respawnPickupAt(pickup, bound);
    grenadePickups.push(pickup);
  }
}

function respawnPickupAt(pickup, bound) {
  const x = (Math.random() - 0.5) * 2 * (bound - 8);
  const z = (Math.random() - 0.5) * 2 * (bound - 8);
  pickup.mesh.position.set(x, 1.0, z);
  pickup.active = true;
  pickup.mesh.visible = true;
}

function updateGrenadePickups(dt, bound) {
  const now = performance.now();
  grenadePickups.forEach(pickup => {
    if (!pickup.active) return;
    pickup.mesh.rotation.y += dt * 1.6;
    pickup.mesh.position.y = 1.0 + Math.sin(now * 0.002 + pickup.mesh.id) * 0.12;

    const dist = Math.hypot(player.pos.x - pickup.mesh.position.x, player.pos.z - pickup.mesh.position.z);
    if (dist < 1.4 && player.alive && player.grenades < 2) {
      pickup.active = false;
      pickup.mesh.visible = false;
      player.grenades = Math.min(2, player.grenades + 1);
      updateGrenadeHUD();
      setTimeout(() => respawnPickupAt(pickup, bound), GRENADE_PICKUP_RESPAWN_DELAY);
    }
  });
}

// ---------- Движение (WASD) + баннихоп физика ----------
const GRAVITY = 20;
const JUMP_SPEED = 7.2;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 60;          // высокое ускорение в воздухе даёт возможность бхопа/страйфа
const MAX_GROUND_SPEED = 6.5;
const MAX_AIR_WISH_SPEED = 1.6; // ограничение "wish speed" в воздухе как в Source (даёт speedgain через strafe)
const FRICTION = 6.5;

function getWishDir() {
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).negate();
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const wish = new THREE.Vector3();
  if (keys['KeyW']) wish.add(forward);
  if (keys['KeyS']) wish.sub(forward);
  if (keys['KeyD']) wish.add(right);
  if (keys['KeyA']) wish.sub(right);

  // Виртуальный джойстик (мобильные устройства)
  if (isTouchDevice) {
    wish.addScaledVector(forward, touchMoveVector.y);
    wish.addScaledVector(right, touchMoveVector.x);
  }

  if (wish.lengthSq() > 1) wish.normalize();
  return wish;
}

function applyFriction(dt) {
  const speed = Math.hypot(player.vel.x, player.vel.z);
  if (speed < 0.05) { player.vel.x = 0; player.vel.z = 0; return; }
  const drop = speed * FRICTION * dt;
  const newSpeed = Math.max(speed - drop, 0);
  const scale = newSpeed / speed;
  player.vel.x *= scale;
  player.vel.z *= scale;
}

function accelerate(wishDir, wishSpeed, accel, dt) {
  const currentSpeed = player.vel.x * wishDir.x + player.vel.z * wishDir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  player.vel.x += accelSpeed * wishDir.x;
  player.vel.z += accelSpeed * wishDir.z;
}

function updateMovement(dt) {
  const wishDir = getWishDir();

  if (player.onGround) {
    applyFriction(dt);
    const wishSpeed = MAX_GROUND_SPEED * (keys['ShiftLeft'] ? 1.35 : 1);
    accelerate(wishDir, wishSpeed, GROUND_ACCEL, dt);

    if (player.jumpQueued) {
      player.vel.y = JUMP_SPEED;
      player.onGround = false;
      player.jumpQueued = false;
      // ВАЖНО: friction не применяется в момент прыжка — это и есть основа баннихопа:
      // горизонтальная скорость, набранная на земле, полностью переносится в прыжок.
    }
  } else {
    // В воздухе — ограниченный wishSpeed, но накопленная скорость (vel) не режется трением,
    // что позволяет наращивать скорость через постоянный strafe (A/D + движение мыши), как в CS/Source.
    accelerate(wishDir, MAX_AIR_WISH_SPEED, AIR_ACCEL, dt);
    player.vel.y -= GRAVITY * dt;
    player.jumpQueued = false;
  }

  // Интеграция позиции
  const nextPos = player.pos.clone();
  nextPos.x += player.vel.x * dt;
  nextPos.z += player.vel.z * dt;
  nextPos.y += player.vel.y * dt;

  resolveCollisions(nextPos);
  player.pos.copy(nextPos);
}

function resolveCollisions(nextPos) {
  // Пол
  if (nextPos.y <= 1.7) {
    nextPos.y = 1.7;
    player.vel.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // Простое AABB столкновение с объектами карты (по XZ, плюс проверка приземления сверху)
  const r = player.radius;
  for (const c of colliders) {
    const b = c.box3;
    const withinX = nextPos.x + r > b.min.x && nextPos.x - r < b.max.x;
    const withinZ = nextPos.z + r > b.min.z && nextPos.z - r < b.max.z;
    const feetY = nextPos.y - 1.7;
    const headY = nextPos.y;

    if (withinX && withinZ) {
      // Приземление на верх объекта
      if (player.vel.y <= 0 && feetY >= b.max.y - 0.35 && feetY <= b.max.y + 0.4) {
        nextPos.y = b.max.y + 1.7;
        player.vel.y = 0;
        player.onGround = true;
        continue;
      }
      // Боковое столкновение — выталкивание
      if (feetY < b.max.y - 0.1 && headY > b.min.y) {
        // ВАЖНО: используем мировой центр bounding box (b), а не c.mesh.position —
        // для вложенных объектов (например, прилавков внутри группы) mesh.position
        // хранит ЛОКАЛЬНЫЕ координаты относительно родителя, что раньше ломало отталкивание.
        const centerX = (b.min.x + b.max.x) / 2;
        const centerZ = (b.min.z + b.max.z) / 2;
        const dx = nextPos.x - centerX;
        const dz = nextPos.z - centerZ;
        if (Math.abs(dx) > Math.abs(dz)) {
          nextPos.x = centerX + Math.sign(dx || 1) * ((b.max.x - b.min.x) / 2 + r);
          player.vel.x = 0;
        } else {
          nextPos.z = centerZ + Math.sign(dz || 1) * ((b.max.z - b.min.z) / 2 + r);
          player.vel.z = 0;
        }
      }
    }
  }

  // Границы арены
  nextPos.x = Math.max(-68, Math.min(68, nextPos.x));
  nextPos.z = Math.max(-68, Math.min(68, nextPos.z));
}

// ---------- Прочие игроки ----------
function createOtherPlayerMesh(name) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b6ea5, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 8), bodyMat);
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), bodyMat);
  head.position.y = 1.65;
  head.castShadow = true;
  group.add(head);
  group.userData.headHit = head;

  // Мини-табличка с ником
  scene.add(group);
  return group;
}

// ---------- Сеть (Socket.io) ----------
const socket = io();
let myId = null;

socket.on('init', (data) => {
  myId = data.id;
  buildMap(data.mapId || 'training');
  updateAmmoHUD();
  updateWeaponNameHUD();
  updateGrenadeHUD();
  Object.values(data.players).forEach(p => {
    if (p.id !== myId) spawnRemotePlayer(p);
  });
});

socket.on('playerJoined', (p) => {
  if (p.id !== myId) spawnRemotePlayer(p);
});

function spawnRemotePlayer(p) {
  if (otherPlayerMeshes[p.id]) return;
  const mesh = createOtherPlayerMesh(p.name);
  mesh.userData.playerId = p.id;
  mesh.position.set(p.pos.x, p.pos.y - 1.7, p.pos.z);
  otherPlayerMeshes[p.id] = mesh;
}

socket.on('playerMoved', (data) => {
  const m = otherPlayerMeshes[data.id];
  if (!m) return;
  m.position.set(data.pos.x, data.pos.y - 1.7, data.pos.z);
  m.rotation.y = data.rot.yaw;
});

socket.on('playerLeft', (data) => {
  const m = otherPlayerMeshes[data.id];
  if (m) { scene.remove(m); delete otherPlayerMeshes[data.id]; }
});

socket.on('playerDamaged', (data) => {
  if (data.id === myId) {
    player.health = data.health;
    updateHealthHUD();
    flashDamageVignette();
  }
});

socket.on('playerKilled', (data) => {
  addKillfeed(data.killerName, data.victimName);
  if (data.victim === myId) {
    player.alive = false;
    document.getElementById('deathScreen').classList.remove('hidden');
    let t = 3;
    document.getElementById('respawnTimer').textContent = t;
    const interval = setInterval(() => {
      t--;
      document.getElementById('respawnTimer').textContent = Math.max(t, 0);
      if (t <= 0) clearInterval(interval);
    }, 1000);
  }
});

socket.on('playerRespawn', (data) => {
  if (data.id === myId) {
    player.pos.set(data.pos.x, data.pos.y, data.pos.z);
    player.vel.set(0, 0, 0);
    player.health = data.health;
    player.alive = true;
    updateHealthHUD();
    document.getElementById('deathScreen').classList.add('hidden');
  } else {
    const m = otherPlayerMeshes[data.id];
    if (m) m.position.set(data.pos.x, data.pos.y - 1.7, data.pos.z);
  }
});

socket.on('chat', (data) => {
  const box = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.textContent = `${data.name}: ${data.msg}`;
  box.appendChild(el);
  while (box.children.length > 6) box.removeChild(box.firstChild);
  setTimeout(() => el.remove(), 8000);
});

let lastNetSend = 0;
function sendNetworkUpdate() {
  const now = performance.now();
  if (now - lastNetSend < 50) return; // 20 Гц
  lastNetSend = now;
  const speed = Math.hypot(player.vel.x, player.vel.z);
  socket.emit('move', {
    pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
    rot: { yaw: player.yaw, pitch: player.pitch },
    speed
  });
}

// ---------- HUD ----------
function updateHealthHUD() {
  document.getElementById('healthValue').textContent = Math.max(0, Math.round(player.health));
}
function updateAmmoHUD() {
  const stats = WEAPON_STATS[currentWeapon];
  if (stats.kind === 'melee') {
    document.getElementById('ammoValue').textContent = '—';
  } else {
    document.getElementById('ammoValue').textContent = `${player.ammoByWeapon[currentWeapon]} / ∞`;
  }
}
function updateWeaponNameHUD() {
  const names = { ak47: 'AK-47', pistol: 'Пистолет', knife: 'Нож' };
  document.getElementById('weaponNameValue').textContent = names[currentWeapon];
  document.querySelectorAll('#weaponSlots .slot').forEach(el => {
    el.classList.toggle('active', el.dataset.weapon === currentWeapon);
  });
}
function updateGrenadeHUD() {
  document.getElementById('grenadeValue').textContent = player.grenades;
}
function addKillfeed(killer, victim) {
  const feed = document.getElementById('killfeed');
  const el = document.createElement('div');
  el.className = 'kill-entry';
  el.textContent = `${killer}  ➤  ${victim}`;
  feed.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function flashDamageVignette() {
  document.body.style.transition = 'none';
  document.body.style.boxShadow = 'inset 0 0 150px 40px rgba(255,0,0,0.5)';
  requestAnimationFrame(() => {
    document.body.style.transition = 'box-shadow 0.4s';
    document.body.style.boxShadow = 'none';
  });
}
function updateScoreboard() {
  // упрощённый скорборд по известным игрокам
  const board = document.getElementById('scoreboard');
  board.innerHTML = '<table><tr><th>Игрок</th></tr>' +
    Object.values(otherPlayerMeshes).map(m => `<tr><td>${m.userData.playerId}</td></tr>`).join('') +
    '</table>';
}

// ---------- Главный цикл рендера ----------
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if ((pointerLocked || touchControlsActive) && player.alive) {
    updateMovement(dt);
    if (mouseHeld) shoot();
  }

  updateRecoilRecovery(dt);
  updateGrenades(dt);
  updateGrenadePickups(dt, MAP_BOUNDS[activeMapId] || 55);

  // Камера: позиция игрока + смещение отдачи по pitch/yaw
  camera.position.set(player.pos.x, player.pos.y, player.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw + recoilOffsetYaw;
  camera.rotation.x = player.pitch + recoilOffsetPitch;

  document.getElementById('speedValue').textContent = Math.round(Math.hypot(player.vel.x, player.vel.z) * 50);

  sendNetworkUpdate();
  renderer.render(scene, camera);
}
animate();
