const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
let nextId = 1;

const publicFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/game.js': ['game.js', 'text/javascript; charset=utf-8']
};
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  const entry = publicFiles[pathname];
  if (!entry) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, entry[0]), (error, content) => {
    if (error) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Could not load game files.'); return; }
    res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' }); res.end(content);
  });
});
const wss = new WebSocket.Server({ server });

function send(socket, packet) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
}
function roomRoster(roomName) {
  const room = rooms.get(roomName);
  return room ? [...room.values()].map(client => ({
    id: client.id, slot: client.slot, name: client.name, color: client.color,
    outfit: client.outfit, hat: client.hat
  })) : [];
}
function broadcastRoster(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;
  const players = roomRoster(roomName);
  for (const client of room.values()) send(client.socket, { type: 'roster', players });
}
function relay(client, packet) {
  const room = rooms.get(client.room);
  if (!room) return;
  for (const peer of room.values()) {
    if (peer.id === client.id) continue;
    send(peer.socket, { ...packet, id: client.id });
  }
}

wss.on('connection', socket => {
  const client = { socket, id: String(nextId++), slot: 0, room: null, name: 'OPERATOR', color: '#a78bfa', outfit: 'standard', hat: 'helmet', teamSize: 3 };
  socket.on('message', raw => {
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch (_) { return; }
    if (packet.type === 'join') {
      const roomName = String(packet.room || 'SQUAD').replace(/[^a-z0-9_-]/gi, '').slice(0, 16).toUpperCase() || 'SQUAD';
      const teamSize = Math.max(1, Math.min(5, Number(packet.teamSize) || 3));
      if (client.room) {
        const oldRoom = rooms.get(client.room);
        if (oldRoom) { oldRoom.delete(client.id); broadcastRoster(client.room); }
      }
      let room = rooms.get(roomName);
      if (!room) {
        room = new Map(); room.teamSize = teamSize;
        room.mapType = String(packet.mapType || 'dust2');
        room.gameMode = String(packet.gameMode || 'deathmatch');
        room.duration = Number(packet.duration ?? 180);
        rooms.set(roomName, room);
      }
      if (room.teamSize !== teamSize || room.mapType !== String(packet.mapType || 'dust2') || room.gameMode !== String(packet.gameMode || 'deathmatch') || room.duration !== Number(packet.duration ?? 180)) {
        send(socket, { type: 'notice', text: 'ROOM SETTINGS DIFFER — use the same team size, mode, map, and match time as the host.' });
        socket.close(); return;
      }
      if (room.size >= room.teamSize * 2) {
        send(socket, { type: 'notice', text: 'ROOM FULL — choose another room or wait for a slot.' });
        socket.close(); return;
      }
      const occupiedSlots = new Set([...room.values()].map(peer => peer.slot));
      let nextSlot = 0; while (occupiedSlots.has(nextSlot)) nextSlot++;
      client.room = roomName;
      client.slot = nextSlot;
      client.teamSize = teamSize;
      client.name = String(packet.name || 'OPERATOR').slice(0, 18);
      client.color = /^#[0-9a-f]{6}$/i.test(packet.color || '') ? packet.color : '#a78bfa';
      client.outfit = String(packet.outfit || 'standard').slice(0, 20);
      client.hat = String(packet.hat || 'helmet').slice(0, 20);
      room.set(client.id, client);
      send(socket, { type: 'welcome', id: client.id, slot: client.slot, room: roomName });
      broadcastRoster(roomName);
      return;
    }
    if (!client.room) return;
    if (packet.type === 'state') {
      const clean = {
        type: 'state', id: client.id,
        x: Math.max(0, Math.min(2200, Number(packet.x) || 0)),
        y: Math.max(0, Math.min(1500, Number(packet.y) || 0)),
        angle: Number(packet.angle) || 0,
        health: Math.max(0, Math.min(100, Number(packet.health) || 0)),
        alive: !!packet.alive, ammo: Math.max(0, Number(packet.ammo) || 0), hidden: !!packet.hidden
      };
      relay(client, clean);
    } else if (packet.type === 'shot') {
      const bullets = Array.isArray(packet.bullets) ? packet.bullets.slice(0, 8).map(b => ({
        x: Number(b.x) || 0, y: Number(b.y) || 0, vx: Number(b.vx) || 0, vy: Number(b.vy) || 0,
        team: Number(client.slot) % 2 === 0 ? 'blue' : 'red', weaponName: String(b.weaponName || 'WEAPON').slice(0, 24),
        damage: Math.max(1, Math.min(120, Number(b.damage) || 20)), color: Number(client.slot) % 2 === 0 ? '#8bd0ff' : '#ff9ba6'
      })) : [];
      relay(client, { type: 'shot', bullets });
    } else if (packet.type === 'grenade') {
      relay(client, { type: 'grenade', x: Number(packet.x) || 0, y: Number(packet.y) || 0,
        vx: Number(packet.vx) || 0, vy: Number(packet.vy) || 0, fuse: Math.max(0, Math.min(2, Number(packet.fuse) || 0.9)),
        team: Number(client.slot) % 2 === 0 ? 'blue' : 'red' });
    } else if (packet.type === 'hit') {
      const targetId = String(packet.targetClientId || '');
      const target = [...(rooms.get(client.room)?.values() || [])].find(peer => peer.id === targetId);
      if (!target || target.id === client.id) return;
      relay(client, {
        type: 'hit', targetClientId: target.id,
        health: Math.max(0, Math.min(100, Number(packet.health) || 0)), alive: !!packet.alive,
        cause: String(packet.cause || 'WEAPON').slice(0, 24), blueScore: Number(packet.blueScore) || 0, redScore: Number(packet.redScore) || 0
      });
    } else if (packet.type === 'roundUpdate') {
      relay(client, { type: 'roundUpdate', blueScore: Number(packet.blueScore) || 0, redScore: Number(packet.redScore) || 0, roundNumber: Number(packet.roundNumber) || 1, text: String(packet.text || 'ROUND OVER').slice(0, 100) });
    } else if (packet.type === 'matchEnd') {
      relay(client, { type: 'matchEnd', blueWon: !!packet.blueWon });
    }
  });
  socket.on('close', () => {
    if (!client.room) return;
    const room = rooms.get(client.room);
    if (room) {
      room.delete(client.id);
      if (!room.size) rooms.delete(client.room);
      else broadcastRoster(client.room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nHIDE & SHOOT LAN server listening on port ${PORT}`);
  console.log('Open on this computer: http://localhost:' + PORT);
  console.log('WebSocket on this computer: ws://localhost:' + PORT);
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) if (net.family === 'IPv4' && !net.internal) {
      console.log(`Other devices: open http://${net.address}:${PORT}`);
      console.log(`Multiplayer address: ${net.address}:${PORT}`);
    }
  }
  console.log('\nKeep this terminal open while playing.\n');
});
