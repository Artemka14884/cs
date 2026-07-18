const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ---- Игровое состояние ----
const players = {}; // id -> {id, name, pos, rot, health, kills, deaths, weapon}
let currentMapId = null; // карту сессии задаёт первый подключившийся игрок

const SPAWN_POINTS = [
  { x: 0, y: 2, z: 0 },
  { x: 10, y: 2, z: 10 },
  { x: -10, y: 2, z: 10 },
  { x: 10, y: 2, z: -10 },
  { x: -10, y: 2, z: -10 },
  { x: 0, y: 2, z: 18 },
  { x: 0, y: 2, z: -18 },
  { x: 18, y: 2, z: 0 }
];

function randomSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', (data) => {
    // Первый игрок сессии определяет карту; остальные подключаются к уже выбранной
    if (!currentMapId) {
      currentMapId = (data && data.mapId) ? String(data.mapId) : 'training';
    }

    const spawn = randomSpawn();
    players[socket.id] = {
      id: socket.id,
      name: (data && data.name ? String(data.name).slice(0, 16) : 'Player'),
      pos: { x: spawn.x, y: spawn.y, z: spawn.z },
      rot: { yaw: 0, pitch: 0 },
      health: 100,
      kills: 0,
      deaths: 0,
      weapon: 'ak47'
    };

    socket.emit('init', {
      id: socket.id,
      players,
      mapId: currentMapId
    });

    socket.broadcast.emit('playerJoined', players[socket.id]);
  });

  socket.on('move', (state) => {
    const p = players[socket.id];
    if (!p || p.health <= 0) return;
    // Базовая защита от совсем невалидных значений
    if (
      state && state.pos &&
      Number.isFinite(state.pos.x) && Number.isFinite(state.pos.y) && Number.isFinite(state.pos.z) &&
      Math.abs(state.pos.x) < 200 && Math.abs(state.pos.y) < 200 && Math.abs(state.pos.z) < 200
    ) {
      p.pos = state.pos;
      p.rot = state.rot;
      p.speed = state.speed || 0;
      socket.broadcast.emit('playerMoved', { id: socket.id, pos: p.pos, rot: p.rot, speed: p.speed });
    }
  });

  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter || shooter.health <= 0) return;
    socket.broadcast.emit('playerShoot', {
      id: socket.id,
      origin: data.origin,
      dir: data.dir
    });
  });

  socket.on('hit', (data) => {
    // data: { targetId, damage }
    const shooter = players[socket.id];
    const target = players[data.targetId];
    if (!shooter || !target || target.health <= 0) return;

    const dmg = Math.min(Math.max(Number(data.damage) || 0, 0), 100);
    target.health -= dmg;

    if (target.health <= 0) {
      target.health = 0;
      target.deaths += 1;
      shooter.kills += 1;
      io.emit('playerKilled', {
        victim: target.id,
        killer: shooter.id,
        killerName: shooter.name,
        victimName: target.name
      });

      setTimeout(() => {
        if (!players[target.id]) return;
        const spawn = randomSpawn();
        target.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
        target.health = 100;
        io.emit('playerRespawn', { id: target.id, pos: target.pos, health: 100 });
      }, 2500);
    } else {
      io.emit('playerDamaged', { id: target.id, health: target.health, by: shooter.id });
    }
  });

  socket.on('chat', (msg) => {
    const p = players[socket.id];
    if (!p) return;
    io.emit('chat', { name: p.name, msg: String(msg).slice(0, 200) });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
    if (Object.keys(players).length === 0) {
      currentMapId = null; // сессия опустела — следующий вошедший снова выбирает карту
    }
    console.log('disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Arena FPS server running on port ${PORT}`);
});
