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
}
buildTrainingMap();

// Пересчёт box3 коллайдеров один раз после постройки карты
colliders.forEach(c => c.box3.setFromObject(c.mesh));

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

const weaponGroup = buildAK47();
weaponGroup.position.set(0.22, -0.22, -0.45);
weaponGroup.rotation.y = Math.PI;
camera.add(weaponGroup);
scene.add(camera);

// Дульная вспышка
const flashLight = new THREE.PointLight(0xffb347, 0, 4, 2);
weaponGroup.add(flashLight);
flashLight.position.copy(weaponGroup.userData.muzzlePoint.position);

const flashGeo = new THREE.ConeGeometry(0.03, 0.12, 8);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0 });
const flashMesh = new THREE.Mesh(flashGeo, flashMat);
flashMesh.rotation.x = -Math.PI / 2;
flashMesh.position.copy(weaponGroup.userData.muzzlePoint.position);
flashMesh.position.z -= 0.05;
weaponGroup.add(flashMesh);

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
  ammo: 30,
  reserve: 90,
  reloading: false,
  jumpQueued: false
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

// ---------- Мышь / Pointer Lock ----------
const canvas = renderer.domElement;
const lockHint = document.getElementById('crosshairLockHint');

function requestLock() { canvas.requestPointerLock(); }

document.getElementById('playBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value || 'Player';
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  socket.emit('join', { name });
  requestLock();
});

canvas.addEventListener('click', () => {
  if (!pointerLocked && !document.getElementById('menu').classList.contains('hidden')) return;
  if (!pointerLocked) requestLock();
  else if (player.alive) shoot();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  lockHint.classList.toggle('hidden', pointerLocked || !document.getElementById('hud').classList.contains ? false : true);
  lockHint.classList.toggle('hidden', pointerLocked);
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

function applyRecoilToView() {
  // применяется вместе с движением мыши в render loop, ничего доп. тут не требуется
}

function fireRecoilKick() {
  const step = AK_RECOIL_PATTERN[Math.min(recoilIndex, AK_RECOIL_PATTERN.length - 1)];
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

// ---------- Стрельба ----------
const RATE_OF_FIRE = 100; // мс между выстрелами (~600 RPM как у AK-47)
let lastFireTime = 0;
const raycaster = new THREE.Raycaster();
const otherPlayerMeshes = {}; // id -> group (для попаданий)

function startReload() {
  if (player.reloading || player.ammo === 30 || player.reserve === 0) return;
  player.reloading = true;
  setTimeout(() => {
    const needed = 30 - player.ammo;
    const take = Math.min(needed, player.reserve);
    player.ammo += take;
    player.reserve -= take;
    player.reloading = false;
    updateAmmoHUD();
  }, 1600);
}

function shoot() {
  if (!player.alive || player.reloading) return;
  const now = performance.now();
  if (now - lastFireTime < RATE_OF_FIRE) return;
  if (player.ammo <= 0) { startReload(); return; }
  lastFireTime = now;
  player.ammo--;
  updateAmmoHUD();

  fireRecoilKick();
  muzzleFlash();

  // Направление выстрела берётся из камеры (с учётом уже применённой отдачи в render loop)
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.getWorldPosition(new THREE.Vector3());

  raycaster.set(origin, dir);
  raycaster.far = 200;

  const targets = Object.values(otherPlayerMeshes);
  const meshList = [];
  targets.forEach(g => g.traverse(o => { if (o.isMesh) meshList.push(o); }));

  const hits = raycaster.intersectObjects(meshList, false);
  const envHits = raycaster.intersectObjects(colliders.map(c => c.mesh), false);

  let validHit = null;
  if (hits.length > 0) {
    const envDist = envHits.length > 0 ? envHits[0].distance : Infinity;
    if (hits[0].distance < envDist) validHit = hits[0];
  }

  if (validHit) {
    let obj = validHit.object;
    while (obj && !obj.userData.playerId) obj = obj.parent;
    if (obj) {
      const dmg = obj.userData.headHit && validHit.object === obj.userData.headHit ? 60 : 27;
      socket.emit('hit', { targetId: obj.userData.playerId, damage: dmg });
    }
  }

  socket.emit('shoot', { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z } });
}

function muzzleFlash() {
  flashLight.intensity = 6;
  flashMat.opacity = 1;
  setTimeout(() => { flashLight.intensity = 0; flashMat.opacity = 0; }, 45);

  // лёгкая тряска камеры/оружия визуально
  weaponGroup.position.z += 0.03;
  setTimeout(() => { weaponGroup.position.z -= 0.03; }, 40);
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
  if (wish.lengthSq() > 0) wish.normalize();
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
        const dx = nextPos.x - c.mesh.position.x;
        const dz = nextPos.z - c.mesh.position.z;
        if (Math.abs(dx) > Math.abs(dz)) {
          nextPos.x = c.mesh.position.x + Math.sign(dx) * ((b.max.x - b.min.x) / 2 + r);
          player.vel.x = 0;
        } else {
          nextPos.z = c.mesh.position.z + Math.sign(dz) * ((b.max.z - b.min.z) / 2 + r);
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
  document.getElementById('ammoValue').textContent = `${player.ammo} / ${player.reserve}`;
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

  if (pointerLocked && player.alive) {
    updateMovement(dt);
    if (mouseHeld) shoot();
  }

  updateRecoilRecovery(dt);

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
