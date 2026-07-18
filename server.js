/**
 * ====================================================================
 *  server.js — серверная часть прототипа мультиплеерного FPS-шутера
 * ====================================================================
 *
 * Стек: Node.js + Express (раздача статики) + ws (WebSocket, realtime).
 *
 * Архитектура:
 *  - Express отдаёт клиентский код из папки /public (index.html + ассеты).
 *  - WebSocket-сервер держит по одному соединению на игрока и обменивается
 *    JSON-сообщениями.
 *  - Сервер является "источником истины" (authoritative) для:
 *      * здоровья игроков и урона,
 *      * попаданий пуль (хитскан-рейкаст против игроков и стен),
 *      * физики гранат,
 *      * таймера раунда и смены карты.
 *  - Позиция/поворот игрока обновляется по данным клиента (клиентское
 *    предсказание движения) — сервер лишь ограничивает координаты
 *    границами карты. Это осознанное упрощение для прототипа
 *    (полноценная server-side физика движения — тема для доработки).
 *
 * Игровой цикл (game loop) тикает с частотой TICK_RATE раз в секунду:
 *  1. обновляет физику гранат,
 *  2. проверяет взрывы гранат и наносит урон по радиусу,
 *  3. проверяет респавн погибших игроков,
 *  4. проверяет таймер раунда и переключает карту,
 *  5. рассылает всем клиентам снапшот состояния игры.
 * ====================================================================
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Раздаём статику клиента
app.use(express.static(path.join(__dirname, 'public')));

// Render (и другие хостинги) проверяют доступность сервиса через healthcheck
app.get('/health', (req, res) => res.status(200).send('ok'));

// ---------------------------------------------------------------------
// КОНФИГУРАЦИЯ ИГРЫ
// ---------------------------------------------------------------------

const TICK_RATE = 20; // тиков игрового цикла в секунду
const ROUND_DURATION = 5 * 60; // длительность раунда в секундах (5 минут)
const RESPAWN_DELAY = 3000; // мс до респавна после смерти
const PLAYER_HIT_RADIUS = 0.55; // радиус "капсулы" игрока для попаданий (упрощённо — сфера)
const PLAYER_HEIGHT = 1.8;
const MAX_PLAYERS = 10;

// Характеристики оружия. dmg — урон за попадание, rate — мс между выстрелами,
// range — максимальная дальность хитскана, ammo — размер магазина, reload — мс перезарядки.
const WEAPONS = {
  rifle:  { name: 'Автомат',  dmg: 24, rate: 100,  range: 120, ammo: 30, reload: 1800, auto: true,  headshotMult: 2 },
  pistol: { name: 'Пистолет', dmg: 20, rate: 260,  range: 90,  ammo: 12, reload: 1200, auto: false, headshotMult: 2 },
  knife:  { name: 'Нож',      dmg: 55, rate: 450,  range: 2.4, ammo: Infinity, reload: 0, auto: false, headshotMult: 1 },
};

const GRENADE_CONFIG = {
  frag: { fuse: 1600, radius: 6, maxDamage: 110, gravity: -9.8, throwSpeed: 16 },
  smoke: { fuse: 1200, radius: 5, maxDamage: 0, gravity: -9.8, throwSpeed: 14, smokeLife: 12000 },
};

// ---------------------------------------------------------------------
// ОПИСАНИЕ КАРТ
// Каждая карта — набор статических прямоугольных препятствий (AABB),
// используемых и для рендера на клиенте, и для коллизий на сервере/клиенте.
// obstacles: { x, z, w, d, h }  — центр по X/Z, ширина, глубина, высота.
// spawns: точки появления игроков.
// ---------------------------------------------------------------------

const MAPS = {
  dust: {
    name: 'Dune (Dust2-like)',
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
    skyColor: 0xd9b98a,
    groundColor: 0xc2a06b,
    obstacles: [
      // центральный туннель / "мид"
      { x: 0,   z: 0,   w: 4,  d: 30, h: 3 },
      // ящики на "long"
      { x: -20, z: 15,  w: 3,  d: 3,  h: 1.2 },
      { x: -22, z: 18,  w: 3,  d: 3,  h: 1.2 },
      { x: -25, z: 10,  w: 6,  d: 2,  h: 2.5 },
      // "short"
      { x: 20,  z: -15, w: 3,  d: 3,  h: 1.2 },
      { x: 22,  z: -18, w: 3,  d: 3,  h: 1.2 },
      // сайт A
      { x: -25, z: -25, w: 8,  d: 2,  h: 2.5 },
      { x: -30, z: -20, w: 2,  d: 8,  h: 2.5 },
      { x: -18, z: -30, w: 3,  d: 3,  h: 1.2 },
      // сайт B
      { x: 25,  z: 25,  w: 8,  d: 2,  h: 2.5 },
      { x: 30,  z: 20,  w: 2,  d: 8,  h: 2.5 },
      { x: 18,  z: 30,  w: 3,  d: 3,  h: 1.2 },
      // внешние стены периметра
      { x: 0,  z: -40, w: 82, d: 1, h: 4 },
      { x: 0,  z: 40,  w: 82, d: 1, h: 4 },
      { x: -40, z: 0,  w: 1,  d: 82, h: 4 },
      { x: 40,  z: 0,  w: 1,  d: 82, h: 4 },
    ],
    spawns: [
      { x: -30, z: -30 }, { x: -32, z: -25 }, { x: -28, z: -33 }, { x: -33, z: -28 },
      { x: 30, z: 30 }, { x: 32, z: 25 }, { x: 28, z: 33 }, { x: 33, z: 28 },
      { x: 0, z: -35 }, { x: 0, z: 35 },
    ],
  },

  mirage: {
    name: 'Sandstone (Mirage-like)',
    bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 38 },
    skyColor: 0xb8cbe0,
    groundColor: 0xa08f74,
    obstacles: [
      // "коннектор" в центре
      { x: -5, z: 0,  w: 3, d: 3, h: 2.2 },
      { x: 5,  z: 3,  w: 3, d: 3, h: 2.2 },
      // "рынок" (market) — куб. лабиринт из ящиков
      { x: -10, z: -10, w: 3, d: 3, h: 1.4 },
      { x: -14, z: -6,  w: 3, d: 3, h: 1.4 },
      { x: -6,  z: -14, w: 3, d: 3, h: 1.4 },
      { x: -16, z: -14, w: 2, d: 6, h: 2.4 },
      // сайт A ("пальма")
      { x: 22, z: 22, w: 6, d: 2, h: 2.6 },
      { x: 26, z: 18, w: 2, d: 6, h: 2.6 },
      { x: 18, z: 28, w: 3, d: 3, h: 1.2 },
      // сайт B ("аппартаменты")
      { x: -22, z: 22, w: 6, d: 2, h: 2.6 },
      { x: -26, z: 18, w: 2, d: 6, h: 2.6 },
      { x: -18, z: 28, w: 3, d: 3, h: 1.2 },
      // "дворец" (palace) сбоку
      { x: 20, z: -20, w: 8, d: 2, h: 3 },
      { x: 24, z: -14, w: 2, d: 8, h: 3 },
      // внешние стены
      { x: 0,  z: -38, w: 78, d: 1, h: 4 },
      { x: 0,  z: 38,  w: 78, d: 1, h: 4 },
      { x: -38, z: 0,  w: 1,  d: 78, h: 4 },
      { x: 38,  z: 0,  w: 1,  d: 78, h: 4 },
    ],
    spawns: [
      { x: -30, z: 30 }, { x: -33, z: 25 }, { x: -28, z: 33 }, { x: -25, z: 28 },
      { x: 30, z: -30 }, { x: 33, z: -25 }, { x: 28, z: -33 }, { x: 25, z: -28 },
      { x: -30, z: -30 }, { x: 30, z: 30 },
    ],
  },
};

const MAP_ORDER = Object.keys(MAPS); // ['dust', 'mirage'] — порядок ротации карт

// ---------------------------------------------------------------------
// СОСТОЯНИЕ ИГРЫ (в памяти процесса — для прототипа этого достаточно)
// ---------------------------------------------------------------------

const state = {
  players: new Map(),   // id -> playerObject
  bullets: [],          // временные трассеры для визуализации (не участвуют в хит-детекте)
  grenades: [],         // активные гранаты в полёте
  smokes: [],           // активные дымовые облака (только визуал)
  currentMapIndex: 0,
  roundTimeLeft: ROUND_DURATION,
};

let nextId = 1;

function currentMap() {
  return MAPS[MAP_ORDER[state.currentMapIndex]];
}

function randomSpawn() {
  const map = currentMap();
  const s = map.spawns[Math.floor(Math.random() * map.spawns.length)];
  return { x: s.x, y: 1, z: s.z };
}

/** Создаёт нового игрока с дефолтными характеристиками. */
function createPlayer(ws, name) {
  const id = String(nextId++);
  const spawn = randomSpawn();
  const player = {
    id,
    ws,
    name: sanitizeName(name),
    x: spawn.x, y: spawn.y, z: spawn.z,
    yaw: 0, pitch: 0,
    hp: 100,
    alive: true,
    weapon: 'rifle',
    ammo: { rifle: WEAPONS.rifle.ammo, pistol: WEAPONS.pistol.ammo },
    reloading: false,
    lastShotAt: 0,
    kills: 0,
    deaths: 0,
    respawnAt: 0,
  };
  state.players.set(id, player);
  return player;
}

function sanitizeName(name) {
  const clean = String(name || '').replace(/[<>]/g, '').trim().slice(0, 16);
  return clean.length ? clean : 'Игрок' + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ФУНКЦИИ (для попаданий и коллизий)
// ---------------------------------------------------------------------

/** Пересечение луча (ox,oy,oz)+(dx,dy,dz)*t с AABB. Возвращает t (дистанцию) или null. */
function rayIntersectsAABB(ox, oy, oz, dx, dy, dz, box) {
  const minX = box.x - box.w / 2, maxX = box.x + box.w / 2;
  const minZ = box.z - box.d / 2, maxZ = box.z + box.d / 2;
  const minY = 0, maxY = box.h;

  let tmin = -Infinity, tmax = Infinity;

  const axes = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];

  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

/** Пересечение луча со сферой (для попаданий по игрокам). Возвращает t или null. */
function rayIntersectsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  return t0 >= 0 ? t0 : null;
}

/**
 * Выполняет хитскан-выстрел shooter'а в направлении (dx,dy,dz).
 * Возвращает { hitPlayer, hitPoint, distance } либо null, если попали в стену/промах.
 */
function performHitscan(shooter, dx, dy, dz, range) {
  const map = currentMap();
  const ox = shooter.x, oy = shooter.y + 1.5, oz = shooter.z; // высота "глаз"

  // ближайшая стена на пути луча
  let wallDist = range;
  for (const box of map.obstacles) {
    const t = rayIntersectsAABB(ox, oy, oz, dx, dy, dz, box);
    if (t !== null && t < wallDist) wallDist = t;
  }

  // ближайший игрок на пути луча (не дальше стены)
  let closestPlayer = null;
  let closestDist = wallDist;
  for (const other of state.players.values()) {
    if (other.id === shooter.id || !other.alive) continue;
    const t = rayIntersectsSphere(ox, oy, oz, dx, dy, dz, other.x, other.y + PLAYER_HEIGHT / 2, other.z, PLAYER_HIT_RADIUS);
    if (t !== null && t < closestDist) {
      closestDist = t;
      closestPlayer = other;
    }
  }

  if (closestPlayer) {
    return {
      hitPlayer: closestPlayer,
      distance: closestDist,
      point: { x: ox + dx * closestDist, y: oy + dy * closestDist, z: oz + dz * closestDist },
    };
  }
  return null;
}

/** Ограничивает координаты игрока границами текущей карты. */
function clampToBounds(p) {
  const b = currentMap().bounds;
  p.x = Math.max(b.minX + 1, Math.min(b.maxX - 1, p.x));
  p.z = Math.max(b.minZ + 1, Math.min(b.maxZ - 1, p.z));
}

// ---------------------------------------------------------------------
// WEBSOCKET: ПРИЁМ СООБЩЕНИЙ ОТ КЛИЕНТОВ
// ---------------------------------------------------------------------

function broadcast(obj, exceptWs = null) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exceptWs) {
      client.send(data);
    }
  }
}

function broadcastChat(name, text) {
  broadcast({ type: 'chat', name, text, ts: Date.now() });
}

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      // ---------------------------------------------------------
      case 'join': {
        if (state.players.size >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ type: 'joinError', reason: 'Сервер заполнен (максимум ' + MAX_PLAYERS + ' игроков)' }));
          return;
        }
        player = createPlayer(ws, msg.name);
        ws.send(JSON.stringify({
          type: 'init',
          id: player.id,
          map: MAP_ORDER[state.currentMapIndex],
          mapData: currentMap(),
          weapons: WEAPONS,
          roundTimeLeft: state.roundTimeLeft,
          players: [...state.players.values()].map(publicPlayer),
        }));
        broadcast({ type: 'playerJoined', player: publicPlayer(player) }, ws);
        broadcastChat('Система', `${player.name} присоединился к игре`);
        break;
      }

      // ---------------------------------------------------------
      case 'chat': {
        if (!player) return;
        const text = String(msg.text || '').slice(0, 200);
        if (text.trim().length === 0) return;
        broadcastChat(player.name, text);
        break;
      }

      // ---------------------------------------------------------
      // Обновление позиции/поворота (клиентское предсказание движения,
      // сервер лишь валидирует границы карты)
      case 'input': {
        if (!player || !player.alive) return;
        if (typeof msg.x === 'number') player.x = msg.x;
        if (typeof msg.y === 'number') player.y = msg.y;
        if (typeof msg.z === 'number') player.z = msg.z;
        if (typeof msg.yaw === 'number') player.yaw = msg.yaw;
        if (typeof msg.pitch === 'number') player.pitch = msg.pitch;
        clampToBounds(player);
        break;
      }

      // ---------------------------------------------------------
      case 'switchWeapon': {
        if (!player || !player.alive) return;
        if (WEAPONS[msg.weapon]) {
          player.weapon = msg.weapon;
          player.reloading = false;
        }
        break;
      }

      // ---------------------------------------------------------
      case 'reload': {
        if (!player || !player.alive) return;
        const w = WEAPONS[player.weapon];
        if (!w || w.ammo === Infinity || player.reloading) return;
        player.reloading = true;
        setTimeout(() => {
          if (player.alive) {
            player.ammo[player.weapon] = w.ammo;
          }
          player.reloading = false;
        }, w.reload);
        break;
      }

      // ---------------------------------------------------------
      case 'shoot': {
        if (!player || !player.alive || player.reloading) return;
        const weapon = WEAPONS[player.weapon];
        if (!weapon) return;
        const now = Date.now();
        if (now - player.lastShotAt < weapon.rate) return; // ограничение скорострельности
        if (weapon.ammo !== Infinity) {
          if ((player.ammo[player.weapon] ?? 0) <= 0) return;
          player.ammo[player.weapon] -= 1;
        }
        player.lastShotAt = now;

        // нормализуем направление выстрела, присланное клиентом
        const len = Math.hypot(msg.dx, msg.dy, msg.dz) || 1;
        const dx = msg.dx / len, dy = msg.dy / len, dz = msg.dz / len;

        const result = performHitscan(player, dx, dy, dz, weapon.range);

        // трассер для визуализации у всех клиентов
        const tracerEnd = result
          ? result.point
          : { x: player.x + dx * weapon.range, y: player.y + 1.5 + dy * weapon.range, z: player.z + dz * weapon.range };
        broadcast({
          type: 'shotFired',
          shooterId: player.id,
          weapon: player.weapon,
          from: { x: player.x, y: player.y + 1.5, z: player.z },
          to: tracerEnd,
        });

        if (result && result.hitPlayer) {
          const dmg = weapon.dmg;
          applyDamage(result.hitPlayer, dmg, player);
        }
        break;
      }

      // ---------------------------------------------------------
      case 'throwGrenade': {
        if (!player || !player.alive) return;
        const kind = msg.kind === 'smoke' ? 'smoke' : 'frag';
        const cfg = GRENADE_CONFIG[kind];
        const len = Math.hypot(msg.dx, msg.dy, msg.dz) || 1;
        const dx = msg.dx / len, dy = msg.dy / len, dz = msg.dz / len;
        state.grenades.push({
          id: 'g' + nextId++,
          kind,
          ownerId: player.id,
          x: player.x, y: player.y + 1.4, z: player.z,
          vx: dx * cfg.throwSpeed, vy: dy * cfg.throwSpeed + 2, vz: dz * cfg.throwSpeed,
          createdAt: Date.now(),
          exploded: false,
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (player) {
      state.players.delete(player.id);
      broadcast({ type: 'playerLeft', id: player.id });
      broadcastChat('Система', `${player.name} покинул игру`);
    }
  });
});

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z,
    yaw: p.yaw, pitch: p.pitch, hp: p.hp, alive: p.alive,
    weapon: p.weapon, kills: p.kills, deaths: p.deaths,
    ammo: p.ammo[p.weapon] ?? null,
  };
}

/** Наносит урон игроку, обрабатывает смерть/начисление фрагов. */
function applyDamage(target, dmg, attacker) {
  if (!target.alive) return;
  target.hp -= dmg;
  broadcast({ type: 'damaged', id: target.id, hp: Math.max(target.hp, 0), by: attacker ? attacker.id : null });
  if (target.hp <= 0) {
    target.alive = false;
    target.deaths += 1;
    if (attacker && attacker.id !== target.id) attacker.kills += 1;
    target.respawnAt = Date.now() + RESPAWN_DELAY;
    broadcast({
      type: 'playerDied',
      id: target.id,
      killerId: attacker ? attacker.id : null,
      killerName: attacker ? attacker.name : 'Мир',
      victimName: target.name,
    });
  }
}

// ---------------------------------------------------------------------
// ФИЗИКА ГРАНАТ (простая баллистика с гравитацией и отскоком от границ карты)
// ---------------------------------------------------------------------

function updateGrenades(dt) {
  const map = currentMap();
  const now = Date.now();

  for (const g of state.grenades) {
    if (g.exploded) continue;

    const cfg = GRENADE_CONFIG[g.kind];
    g.vy += cfg.gravity * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;

    // отскок от пола
    if (g.y <= 0.3) {
      g.y = 0.3;
      g.vy = -g.vy * 0.45; // потеря энергии при отскоке
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    // отскок от границ карты (упрощённо, без стен-препятствий)
    if (g.x < map.bounds.minX || g.x > map.bounds.maxX) g.vx *= -0.5;
    if (g.z < map.bounds.minZ || g.z > map.bounds.maxZ) g.vz *= -0.5;
    clampGrenadeToBounds(g, map);

    // детонация по истечении фитиля
    if (now - g.createdAt >= cfg.fuse) {
      explodeGrenade(g);
    }
  }

  // удаляем старые взорвавшиеся гранаты/дым из списков через некоторое время
  state.grenades = state.grenades.filter(g => !g.exploded || now - g.explodedAt < 500);
  state.smokes = state.smokes.filter(s => now - s.createdAt < s.life);
}

function clampGrenadeToBounds(g, map) {
  g.x = Math.max(map.bounds.minX, Math.min(map.bounds.maxX, g.x));
  g.z = Math.max(map.bounds.minZ, Math.min(map.bounds.maxZ, g.z));
}

function explodeGrenade(g) {
  g.exploded = true;
  g.explodedAt = Date.now();
  const cfg = GRENADE_CONFIG[g.kind];

  if (g.kind === 'frag') {
    // урон по всем игрокам в радиусе взрыва, затухающий с расстоянием
    for (const p of state.players.values()) {
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - g.x, p.z - g.z);
      if (dist <= cfg.radius) {
        const falloff = 1 - dist / cfg.radius;
        const dmg = Math.round(cfg.maxDamage * falloff);
        if (dmg > 0) {
          const attacker = state.players.get(g.ownerId) || null;
          applyDamage(p, dmg, attacker);
        }
      }
    }
    broadcast({ type: 'explosion', kind: 'frag', x: g.x, y: g.y, z: g.z });
  } else {
    // дымовая граната — чисто визуальный эффект, создаёт зону дыма
    state.smokes.push({ id: g.id, x: g.x, y: g.y, z: g.z, radius: cfg.radius, createdAt: Date.now(), life: cfg.smokeLife });
    broadcast({ type: 'explosion', kind: 'smoke', x: g.x, y: g.y, z: g.z, radius: cfg.radius, life: cfg.smokeLife });
  }
}

// ---------------------------------------------------------------------
// РЕСПАВН И РОТАЦИЯ КАРТ
// ---------------------------------------------------------------------

function updateRespawns() {
  const now = Date.now();
  for (const p of state.players.values()) {
    if (!p.alive && now >= p.respawnAt) {
      const spawn = randomSpawn();
      p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
      p.hp = 100;
      p.alive = true;
      p.ammo = { rifle: WEAPONS.rifle.ammo, pistol: WEAPONS.pistol.ammo };
      p.weapon = 'rifle';
      broadcast({ type: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z });
    }
  }
}

function switchMap() {
  state.currentMapIndex = (state.currentMapIndex + 1) % MAP_ORDER.length;
  state.roundTimeLeft = ROUND_DURATION;
  const map = currentMap();

  // сброс всех игроков на новой карте
  for (const p of state.players.values()) {
    const spawn = randomSpawn();
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
    p.hp = 100;
    p.alive = true;
    p.kills = 0;
    p.deaths = 0;
    p.ammo = { rifle: WEAPONS.rifle.ammo, pistol: WEAPONS.pistol.ammo };
    p.weapon = 'rifle';
  }
  state.grenades = [];
  state.smokes = [];

  broadcast({
    type: 'mapChange',
    map: MAP_ORDER[state.currentMapIndex],
    mapData: map,
    roundTimeLeft: state.roundTimeLeft,
    players: [...state.players.values()].map(publicPlayer),
  });
  broadcastChat('Система', `Раунд окончен! Смена карты: ${map.name}`);
}

// ---------------------------------------------------------------------
// ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ
// ---------------------------------------------------------------------

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  updateGrenades(dt);
  updateRespawns();

  // таймер раунда
  state.roundTimeLeft -= dt;
  if (state.roundTimeLeft <= 0) {
    switchMap();
  }

  // снапшот состояния — рассылается всем клиентам
  broadcast({
    type: 'state',
    players: [...state.players.values()].map(publicPlayer),
    grenades: state.grenades.map(g => ({ id: g.id, kind: g.kind, x: g.x, y: g.y, z: g.z, exploded: g.exploded })),
    roundTimeLeft: Math.max(0, Math.round(state.roundTimeLeft)),
  });
}, 1000 / TICK_RATE);

// ---------------------------------------------------------------------
// ЗАПУСК СЕРВЕРА
// ---------------------------------------------------------------------

// ВАЖНО: порт обязательно берём из переменной окружения PORT — так требует Render
// (и большинство других PaaS-хостингов), которые сами назначают порт снаружи.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер тактического шутера запущен на порту ${PORT}`);
  console.log(`Текущая карта: ${currentMap().name}`);
});
