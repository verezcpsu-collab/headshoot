
const $ = id => document.getElementById(id);
const canvas = $("gameCanvas");
let ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const WORLD_W = 2200, WORLD_H = 1500;
const camera = { x: 0, y: 0 };
const WEAPONS = {
  rifle:  { name: "ASSAULT RIFLE", ammo: 30, damage: 22, cooldown: 0.115, speed: 13, pellets: 1, spread: 0.035, reload: 1.15 },
  sniper: { name: "SNIPER RIFLE", ammo: 5, damage: 100, cooldown: 0.85, speed: 19, pellets: 1, spread: 0.008, reload: 1.65 },
  shotgun:{ name: "SHOTGUN", ammo: 8, damage: 14, cooldown: 0.58, speed: 11, pellets: 7, spread: 0.34, reload: 1.35 },
  smg:    { name: "SMG", ammo: 36, damage: 14, cooldown: 0.075, speed: 12, pellets: 1, spread: 0.075, reload: 1.05 },
  pistol: { name: "PISTOL", ammo: 12, damage: 27, cooldown: 0.28, speed: 12, pellets: 1, spread: 0.025, reload: 0.9 }
};
const weaponOrder = ["rifle", "sniper", "shotgun", "smg", "pistol"];
let grenades = [], explosions = [], grenadeCount = 3;
let pickups = [];
let powerTimers = { speed: 0, damage: 0, shield: 0 };

const defaults = {
  difficulty: "normal",
  volume: 50,
  sound: true,
  sensitivity: 100,
  winScore: 10,
  crosshair: true,
  characterName: "NIGHT RUNNER",
  characterColor: "#a78bfa",
  outfit: "standard",
  hatStyle: "helmet",
  weaponType: "rifle",
  weaponColor: "#d5d9e5",
  mapType: "dust2",
  gameMode: "deathmatch",
  matchDuration: 180
};

let settings = { ...defaults };
let screen = "menu";
let running = false;
let paused = false;
let gameEnded = false;
let blueScore = 0, redScore = 0, playerKills = 0;
let players = [], bullets = [], particles = [];
let roundNumber = 1, plantProgress = 0, defuseProgress = 0, bomb = null, roundPauseTimer = 0;
let coverRects = [];
let reloadTimer = 0;
let message = "", messageTimer = 0;
let matchTime = 180;
let killFeedItems = [];
let keys = {};
let mouse = { x: W / 2, y: H / 2, down: false };
let lastTime = 0;
let audioContext = null;
let audioReady = false;
let loadingTimer = null;
let countdownTimer = null;
let countdownValue = 5;

// Same-Wi-Fi multiplayer: requires the included Node.js relay server.
const network = { socket: null, connected: false, clientId: null, slot: 0, room: "SQUAD", peers: [], playType: "single", lastStateAt: 0 };
function netSend(packet) {
  if (network.socket && network.socket.readyState === WebSocket.OPEN) network.socket.send(JSON.stringify(packet));
}
function netStatus(text, good = false) {
  const el = $("networkStatus");
  if (el) { el.textContent = text; el.classList.toggle("connected", good); }
}
function updateRosterUI() {
  const roster = $("roomRoster");
  if (!roster) return;
  if (!network.connected) { roster.textContent = "No players connected."; return; }
  const list = network.peers.length ? network.peers : [{ id: network.clientId, name: settings.characterName, slot: network.slot }];
  roster.innerHTML = "";
  list.forEach(peer => {
    const row = document.createElement("div"); row.className = "roster-player";
    const dot = document.createElement("i"); dot.className = "roster-dot";
    const name = document.createElement("span"); name.textContent = peer.name + (peer.id === network.clientId ? " (YOU)" : "");
    const team = document.createElement("small"); team.textContent = Number(peer.slot) % 2 === 0 ? "BLUE" : "RED";
    row.append(dot, name, team); roster.appendChild(row);
  });
  const cap = Number($("teamSizeChoice")?.value || 3) * 2;
  const note = document.createElement("p"); note.className = "roster-count"; note.textContent = `${list.length}/${cap} players in room`;
  roster.appendChild(note);
}
function disconnectLAN() {
  if (network.socket) { try { network.socket.close(); } catch (_) {} }
  network.socket = null; network.connected = false; network.clientId = null; network.peers = [];
  netStatus("OFFLINE · READY"); updateRosterUI();
}
function connectLAN() {
  const raw = ($("serverAddress")?.value || "localhost:3000").trim();
  const address = raw.includes("://") ? raw : `ws://${raw}`;
  const room = (($("roomCode")?.value || "SQUAD").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || "SQUAD").toUpperCase();
  disconnectLAN();
  netStatus("CONNECTING…");
  let socket;
  try { socket = new WebSocket(address); }
  catch (error) { netStatus("CONNECTION FAILED"); setMessage("CHECK HOST ADDRESS AND LAN SERVER"); return; }
  network.socket = socket; network.room = room; network.playType = "lan";
  socket.addEventListener("open", () => {
    netSend({ type: "join", room, teamSize: Number($("teamSizeChoice")?.value || 3), name: settings.characterName || "OPERATOR", color: settings.characterColor, outfit: settings.outfit, hat: settings.hatStyle, mapType: settings.mapType, gameMode: $("modeChoice")?.value || settings.gameMode, duration: Number($("matchTimeChoice")?.value ?? settings.matchDuration ?? 180) });
    netStatus("CONNECTED · WAITING FOR ROOM", true);
  });
  socket.addEventListener("message", event => {
    let packet; try { packet = JSON.parse(event.data); } catch (_) { return; }
    if (packet.type === "welcome") { network.clientId = packet.id; network.slot = packet.slot; }
    if (packet.type === "roster") {
      network.peers = packet.players || [];
      network.connected = true; netStatus(`ROOM ${network.room} · ${network.peers.length} PLAYER${network.peers.length === 1 ? "" : "S"}`, true); updateRosterUI();
      if (screen === "game") syncNetworkPlayers();
    }
    if (packet.type === "state" && packet.id !== network.clientId) {
      const p = players.find(item => item.id === `net:${packet.id}`);
      if (p) { p.x = packet.x; p.y = packet.y; p.angle = packet.angle; p.health = packet.health; p.alive = packet.alive; p.ammo = packet.ammo; p.hidden = !!packet.hidden; }
    }
    if (packet.type === "shot" && packet.id !== network.clientId && screen === "game") {
      const ownerId = `net:${packet.id}`;
      (packet.bullets || []).forEach(b => bullets.push({ ...b, owner: ownerId, life: 1.3 }));
      playSound("shoot");
    }
    if (packet.type === "grenade" && packet.id !== network.clientId && screen === "game") {
      grenades.push({ x: packet.x, y: packet.y, vx: packet.vx, vy: packet.vy, fuse: packet.fuse, team: packet.team, owner: `net:${packet.id}` });
    }
    if (packet.type === "hit" && packet.id !== network.clientId) {
      const targetId = packet.targetClientId === network.clientId ? "you" : `net:${packet.targetClientId}`;
      const target = players.find(item => item.id === targetId);
      if (target) {
        target.health = packet.health; target.alive = packet.alive;
        if (!packet.alive) { target.respawnTimer = settings.gameMode === "elimination" ? 99999 : 1.6; spawnParticles(target.x, target.y, target.team === "blue" ? "#55a7ff" : "#ff596e", 15); }
        const owner = players.find(item => item.id === `net:${packet.id}`);
        if (!packet.alive) addKillFeed(owner, target, packet.cause || "WEAPON");
        if (packet.blueScore != null) blueScore = packet.blueScore;
        if (packet.redScore != null) redScore = packet.redScore;
        updateHUD();
      }
    }
    if (packet.type === "roundUpdate") {
      blueScore = Number(packet.blueScore) || 0; redScore = Number(packet.redScore) || 0;
      roundNumber = Number(packet.roundNumber) || roundNumber;
      roundPauseTimer = Math.max(roundPauseTimer, 3.2);
      setMessage(packet.text || "ROUND OVER · NEXT ROUND SOON"); updateHUD();
      if (blueScore >= 3 || redScore >= 3) endGame(blueScore > redScore, true);
    }
    if (packet.type === "matchEnd") endGame(!!packet.blueWon, true);
    if (packet.type === "notice") setMessage(packet.text || "ROOM UPDATE");
  });
  socket.addEventListener("close", () => { network.connected = false; netStatus("DISCONNECTED"); updateRosterUI(); });
  socket.addEventListener("error", () => { netStatus("SERVER UNAVAILABLE"); setMessage("LAN SERVER NOT FOUND — CHECK HOST IP AND PORT 3000"); });
}
function syncNetworkPlayers() {
  if (!network.connected || !network.peers.length) return;
  const local = players.find(p => p.isHuman);
  if (!local) return;
  const teamSize = Number($("teamSizeChoice")?.value || 3);
  const localPeer = network.peers.find(peer => peer.id === network.clientId);
  const localSlot = localPeer ? Number(localPeer.slot) : network.slot;
  local.team = localSlot % 2 === 0 ? "blue" : "red";
  local.x = local.team === "blue" ? 350 : WORLD_W - 350;
  local.y = WORLD_H / 2 + ((Math.floor(localSlot / 2) % teamSize) - (teamSize - 1) / 2) * 90;
  for (const peer of network.peers) {
    if (peer.id === network.clientId) continue;
    const id = `net:${peer.id}`;
    let remote = players.find(p => p.id === id);
    const team = Number(peer.slot) % 2 === 0 ? "blue" : "red";
    const x = team === "blue" ? 350 : WORLD_W - 350;
    const y = WORLD_H / 2 + ((Math.floor(Number(peer.slot) / 2) % teamSize) - (teamSize - 1) / 2) * 90;
    if (!remote) {
      remote = makePlayer(id, team, x, y, false);
      remote.isRemote = true; remote.botName = peer.name || "OPERATOR"; remote.botColor = peer.color || (team === "blue" ? "#55a7ff" : "#ff596e");
      remote.botOutfit = peer.outfit || "standard"; remote.botHat = peer.hat || "helmet"; remote.ammo = 30;
      players.push(remote);
    }
    remote.team = team; remote.botName = peer.name || remote.botName; remote.botColor = peer.color || remote.botColor;
  }
  players = players.filter(p => !p.isRemote || network.peers.some(peer => `net:${peer.id}` === p.id));
  updateHUD();
}
function broadcastLocalState(now) {
  if (!network.connected || screen !== "game" || now - network.lastStateAt < 45) return;
  network.lastStateAt = now;
  const p = players.find(item => item.isHuman);
  if (!p) return;
  netSend({ type: "state", x: p.x, y: p.y, angle: p.angle, health: p.health, alive: p.alive, ammo: p.ammo, hidden: p.hidden });
}


function loadSettings() {
  try {
    const saved = localStorage.getItem("hideShootSettings");
    if (saved) settings = { ...defaults, ...JSON.parse(saved) };
  } catch (error) {
    settings = { ...defaults };
  }
}

function saveSettings() {
  try {
    localStorage.setItem("hideShootSettings", JSON.stringify(settings));
  } catch (error) {
    // Game still works if browser storage is unavailable.
  }
}

function saveCharacter() {
  settings.characterName = $("characterName").value.trim() || "NIGHT RUNNER";
  settings.outfit = $("outfit").value;
  settings.hatStyle = $("hatStyle").value;
  settings.weaponType = $("weaponType").value;
  settings.characterColor = $("customColor").value || settings.characterColor;
  settings.weaponColor = $("weaponColor").value;
  saveSettings();
  updatePreviews();
  showScreen("menu");
}

function syncSettingsUI() {
  $("difficulty").value = settings.difficulty;
  $("volume").value = settings.volume;
  $("volumeValue").textContent = settings.volume + "%";
  $("soundToggle").checked = settings.sound;
  $("sensitivity").value = settings.sensitivity;
  $("sensitivityValue").textContent = settings.sensitivity + "%";
  $("winScore").value = String(settings.winScore);
  $("crosshairToggle").checked = settings.crosshair;
  if ($("modeChoice")) $("modeChoice").value = settings.gameMode || "deathmatch";
  if ($("matchTimeChoice")) $("matchTimeChoice").value = String(settings.matchDuration ?? 180);
  $("characterName").value = settings.characterName;
  $("outfit").value = settings.outfit;
  $("hatStyle").value = settings.hatStyle || "helmet";
  $("weaponType").value = settings.weaponType || "rifle";
  $("customColor").value = settings.characterColor;
  $("weaponColor").value = settings.weaponColor;

  document.querySelectorAll(".swatch").forEach(button => {
    button.classList.toggle(
      "selected",
      button.dataset.color === settings.characterColor
    );
  });
}

function showScreen(name) {
  screen = name;
  ["menuScreen", "settingsScreen", "customizeScreen", "gameScreen"]
    .forEach(id => $(id).classList.add("hidden"));

  const ids = {
    menu: "menuScreen",
    settings: "settingsScreen",
    customize: "customizeScreen",
    game: "gameScreen"
  };

  $(ids[name]).classList.remove("hidden");
  $("headerSettings").classList.toggle("hidden", name === "game");
  updatePreviews();

  if (name === "game") {
    draw();
  }
}

function beginLoading(onComplete = null) {
  const loading = $("loadingScreen");
  const app = $("app");
  loading.classList.remove("hidden");
  app.classList.add("hidden");

  let progress = 0;
  $("loadingBar").style.width = "0%";
  $("loadingPercent").textContent = "0%";
  $("loadingTip").textContent = onComplete ? "Preparing your match..." : "Preparing the battlefield...";

  if (loadingTimer) clearInterval(loadingTimer);

  loadingTimer = setInterval(() => {
    progress = Math.min(100, progress + 2 + Math.floor(Math.random() * 5));
    $("loadingBar").style.width = progress + "%";
    $("loadingPercent").textContent = progress + "%";

    if (progress >= 35) $("loadingTip").textContent = onComplete ? "Loading selected map..." : "Equipping your operator...";
    if (progress >= 70) $("loadingTip").textContent = onComplete ? "Deploying your squad..." : "Loading battle arena...";
    if (progress >= 100) {
      clearInterval(loadingTimer);
      loadingTimer = null;
      loading.classList.add("hidden");
      app.classList.remove("hidden");
      if (typeof onComplete === "function") onComplete();
      else showScreen("menu");
    }
  }, 35);
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  running = false;
  paused = false;
  keys = {};
  mouse.down = false;
  countdownValue = 5;
  $("gameOverlay").classList.remove("hidden");
  $("overlayTitle").textContent = String(countdownValue);
  $("overlayText").textContent = "GET READY — MATCH STARTS IN 5 SECONDS";
  $("resumeBtn").classList.add("hidden");
  $("restartBtn").classList.add("hidden");
  $("menuBtn").classList.add("hidden");
  countdownTimer = setInterval(() => {
    countdownValue--;
    if (countdownValue > 0) {
      $("overlayTitle").textContent = String(countdownValue);
      $("overlayText").textContent = "GET READY — MATCH STARTS IN " + countdownValue + " SECONDS";
      return;
    }
    clearInterval(countdownTimer);
    countdownTimer = null;
    $("gameOverlay").classList.add("hidden");
    $("resumeBtn").classList.remove("hidden");
    $("restartBtn").classList.remove("hidden");
    $("menuBtn").classList.remove("hidden");
    running = true;
    lastTime = performance.now();
    setMessage("GO! GOOD LUCK, OPERATOR!");
  }, 1000);
}

function initAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
      audioReady = true;
    }
  } catch (error) {
    audioReady = false;
  }
}

function playSound(type) {
  if (!settings.sound || settings.volume <= 0 || !audioReady || !audioContext) return;

  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    const config = {
      shoot: [180, 75, 0.065],
      hit: [280, 110, 0.09],
      reload: [380, 520, 0.11],
      win: [420, 700, 0.24],
      lose: [180, 90, 0.25]
    }[type] || [200, 100, 0.08];

    oscillator.type = type === "win" ? "triangle" : "square";
    oscillator.frequency.setValueAtTime(config[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(30, config[1]), now + config[2]
    );

    gain.gain.setValueAtTime(settings.volume / 100 * 0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + config[2]);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + config[2]);
  } catch (error) {
    // Audio is optional.
  }
}

function makeCover() {
  coverRects = [];
  // Keep both spawn areas and the player's initial path clear so movement can never start trapped.
  const type = settings.mapType || "forest";
  const layouts = {
    dust2: [
      // Original Dust-II-inspired lanes: A long, central mid, lower tunnels, and two bomb-site courtyards.
      [430,250,210,62],[650,250,62,180],[760,410,160,58],[980,245,190,62],
      [1220,250,62,180],[1350,405,180,58],[1590,250,210,62],[1820,250,62,190],
      [400,650,180,62],[640,610,62,200],[790,760,180,62],[1020,650,220,62],
      [1280,760,180,62],[1500,610,62,200],[1660,650,180,62],[1900,650,180,62],
      [430,1080,210,62],[650,1000,62,190],[800,1200,180,62],[1060,1110,180,62],
      [1330,1200,180,62],[1540,1000,62,190],[1690,1100,210,62],[1900,1240,170,62]
    ],
    mirage: [
      [430,260,190,60],[690,350,60,180],[850,250,210,60],[1120,380,60,190],
      [1320,250,210,60],[1580,350,60,180],[1740,260,190,60],[450,700,190,60],
      [710,640,60,190],[870,760,190,60],[1120,650,210,60],[1390,760,190,60],
      [1630,640,60,190],[1790,700,190,60],[480,1180,210,60],[770,1270,60,170],
      [930,1160,200,60],[1300,1160,200,60],[1510,1270,60,170],[1690,1180,210,60]
    ],
    industrial: [
      [470,240,230,72],[780,330,72,190],[930,240,240,72],[1250,330,72,190],
      [1400,240,240,72],[1710,330,72,190],[1830,240,230,72],[470,650,72,220],
      [630,760,220,72],[930,650,230,72],[1210,760,230,72],[1510,650,72,220],
      [1680,760,220,72],[1870,650,72,220],[480,1180,230,72],[790,1080,72,200],
      [940,1240,230,72],[1370,1240,230,72],[1600,1080,72,200],[1770,1180,230,72]
    ],
    forest: [
      [760,250,150,52],[1050,430,70,155],[1370,250,170,55],[1700,460,145,65],
      [760,780,180,58],[1120,920,70,165],[1510,800,170,55],[1860,1010,160,60],
      [780,1320,150,55],[1300,1370,180,55],[1690,1390,75,140],[1060,620,95,45]
    ],
    desert: [
      [700,280,185,80],[1030,230,80,150],[1430,320,190,70],[1780,260,100,170],
      [820,690,90,180],[1190,650,200,75],[1570,760,90,190],[1880,850,180,75],
      [720,1190,200,75],[1100,1320,90,170],[1450,1190,180,75],[1780,1390,100,150]
    ],
    snow: [
      [720,250,95,160],[1000,300,200,60],[1400,250,100,170],[1740,350,190,60],
      [800,650,190,65],[1120,770,80,175],[1490,650,190,65],[1840,780,80,170],
      [700,1150,100,175],[1020,1240,190,65],[1430,1170,90,170],[1740,1320,190,65]
    ]
  };
  for (const [x,y,w,h] of layouts[type] || layouts.forest) coverRects.push({x: 70 + x * 0.82, y: 25 + y * 0.82, w: w * 0.82, h: h * 0.82});
  // A few small pieces add cover, but never near the starting spawn lanes.
  for (let i = 0; i < 18; i++) {
    const x = 560 + Math.random() * 1050;
    const y = 100 + Math.random() * (WORLD_H - 200);
    if ((x < 700 && y > 650 && y < 1150) || (x > WORLD_W - 700 && y > 650 && y < 1150)) continue;
    const w = 45 + Math.random() * 45, h = 35 + Math.random() * 45;
    if (!coverRects.some(r => x < r.x+r.w+35 && x+w+35 > r.x && y < r.y+r.h+35 && y+h+35 > r.y)) coverRects.push({x,y,w,h});
  }
}

function makePlayer(id, team, x, y, isHuman = false) {
  const botColors = ["#7dff00", "#ffe34d", "#a78bfa", "#35d399", "#f472d0", "#22d3ee", "#f8fafc", "#ff8b42"];
  const botOutfits = ["standard", "heavy", "scout", "urban", "neon", "medic", "stealth"];
  const botHats = ["helmet", "none", "beanie", "headset", "cowboy", "crown"];
  const botNames = ["VIPER", "ECHO", "NOVA", "GHOST", "REAPER", "PIXEL", "RAVEN", "ZERO", "ONYX", "BLAZE"];
  const randomPick = list => list[Math.floor(Math.random() * list.length)];
  return {
    id, team, x, y, spawnX: x, spawnY: y,
    angle: team === "blue" ? 0 : Math.PI,
    radius: 14,
    speed: isHuman ? 4.5 : 2.7,
    health: 100, ammo: isHuman ? (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo : 30,
    isHuman, alive: true, hidden: false,
    botColor: isHuman ? settings.characterColor : randomPick(botColors),
    botOutfit: isHuman ? settings.outfit : randomPick(botOutfits),
    botHat: isHuman ? (settings.hatStyle || "helmet") : randomPick(botHats),
    botName: isHuman ? (settings.characterName || "YOU") : randomPick(botNames) + "-" + (1 + Math.floor(Math.random() * 99)),
    kills: 0, fireCooldown: Math.random() * 0.4,
    respawnTimer: 0, aiTimer: Math.random() * 0.3,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    target: null
  };
}

function resetGame() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  keys = {};
  makeCover();
  const mode = settings.gameMode || "deathmatch";
  const teamSize = Number($("teamSizeChoice")?.value || 3);
  if (network.connected && $("playTypeChoice")?.value === "lan") {
    players = [makePlayer("you", "blue", 350, WORLD_H / 2, true)];
    syncNetworkPlayers();
  } else if (mode === "ffa") {
    players = [makePlayer("you", "blue", 360, 750, true)];
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i / 5) + 0.3;
      players.push(makePlayer("bot" + (i + 1), "red", WORLD_W / 2 + Math.cos(a) * 390, WORLD_H / 2 + Math.sin(a) * 300));
    }
  } else {
    players = [makePlayer("you", "blue", 350, WORLD_H / 2, true)];
    for (let i = 1; i < teamSize; i++) {
      const offset = (i - (teamSize - 1) / 2) * 90;
      players.push(makePlayer("blue" + (i + 1), "blue", 360, WORLD_H / 2 + offset));
    }
    for (let i = 0; i < teamSize; i++) {
      const offset = (i - (teamSize - 1) / 2) * 90;
      players.push(makePlayer("red" + (i + 1), "red", WORLD_W - 360, WORLD_H / 2 + offset));
    }
  }

  bullets = [];
  killFeedItems = [];
  matchTime = Number($("matchTimeChoice")?.value ?? settings.matchDuration ?? 180);
  settings.matchDuration = matchTime;
  grenades = [];
  explosions = [];
  pickups = [];
  powerTimers = { speed: 0, damage: 0, shield: 0 };
  grenadeCount = 3;
  camera.x = clamp(players[0].x - W / 2, 0, WORLD_W - W);
  camera.y = clamp(players[0].y - H / 2, 0, WORLD_H - H);
  particles = [];
  blueScore = 0;
  redScore = 0;
  playerKills = 0;
  roundNumber = 1; plantProgress = 0; defuseProgress = 0; bomb = null; roundPauseTimer = 0;
  reloadTimer = 0;
  message = "";
  messageTimer = 0;
  gameEnded = false;
  paused = false;
  running = true;
  $("gameScreen").classList.add("is-fullscreen");
  mouse.down = false;

  $("activeDifficulty").textContent = settings.difficulty.toUpperCase();
  const modeNames = { deathmatch: "TEAM DEATHMATCH", ffa: "FREE FOR ALL", plant: "PLANT / DEFUSE · BO6", elimination: "TACTICAL ELIMINATION · NO RESPAWNS" };
  $("modeLabel").textContent = modeNames[mode] || modeNames.deathmatch;
  $("blueTeamLabel").textContent = mode === "ffa" ? "YOU · KILLS" : mode === "plant" ? "ATTACKERS" : "BLUE SQUAD";
  $("redTeamLabel").textContent = mode === "ffa" ? "TOP BOT" : mode === "plant" ? "DEFENDERS" : "RED SQUAD";
  const mapNames = { dust2: "DUST DISTRICT", mirage: "SUNSET MARKET", industrial: "INDUSTRIAL YARD", forest: "FOREST OUTPOST", desert: "DESERT RUINS", snow: "FROZEN BASE" };
  $("arenaName")?.replaceChildren(document.createTextNode(mapNames[settings.mapType] || mapNames.forest));
  if ($("matchTime")) $("matchTime").textContent = matchTime > 0 ? `${Math.floor(matchTime / 60).toString().padStart(2,"0")}:${Math.floor(matchTime % 60).toString().padStart(2,"0")}` : "--:--";
  if ($("killFeed")) $("killFeed").innerHTML = "";
  $("gameOverlay").classList.add("hidden");
  $("pauseBtn").textContent = "Ⅱ PAUSE";
  $("resumeBtn").classList.remove("hidden");

  updateHUD();
  if (mode === "plant") setMessage("ROUND 1/6 · GO TO SITE A AND HOLD E TO PLANT");
  else if (mode === "elimination") setMessage("TACTICAL ELIMINATION · NO RESPAWNS · WIPE THE ENEMY TEAM");
  lastTime = performance.now();
  showScreen("game");
}

function updateHUD() {
  if ((settings.gameMode || "deathmatch") === "ffa") {
    const bots = players.filter(p => !p.isHuman);
    blueScore = players.find(p => p.isHuman)?.kills || 0;
    redScore = Math.max(0, ...bots.map(p => p.kills));
  }
  $("blueScore").textContent = blueScore;
  $("redScore").textContent = redScore;
  const localPlayerForHUD = players.find(p => p.isHuman);
  const localIsRed = localPlayerForHUD?.team === "red";
  if ($("matchOwnScore")) $("matchOwnScore").textContent = localIsRed ? redScore : blueScore;
  if ($("matchEnemyScore")) $("matchEnemyScore").textContent = localIsRed ? blueScore : redScore;
  if ($("matchOwnLabel")) $("matchOwnLabel").textContent = (settings.gameMode === "ffa") ? "YOU" : (settings.gameMode === "plant" ? "ATTACK" : (localIsRed ? "RED" : "BLUE"));
  if ($("matchEnemyLabel")) $("matchEnemyLabel").textContent = (settings.gameMode === "ffa") ? "TOP BOT" : (settings.gameMode === "plant" ? "DEFEND" : (localIsRed ? "BLUE" : "RED"));

  const human = players.find(p => p.isHuman);
  if (!human) return;

  $("healthFill").style.width = Math.max(0, human.health) + "%";
  $("healthFill").style.background = human.health < 30
    ? "linear-gradient(90deg,#ff596e,#ff8a8a)"
    : "linear-gradient(90deg,#43e58c,#b2ff7c)";

  $("healthText").textContent = Math.max(0, Math.ceil(human.health));
  const gun = WEAPONS[settings.weaponType] || WEAPONS.rifle;
  $("ammoText").textContent = human.ammo;
  $("ammoMax").textContent = "/ " + gun.ammo;
  $("weaponLabel").textContent = gun.name + " · AMMO";
  $("grenadeText").textContent = grenadeCount;
  $("killsText").textContent = playerKills;
  const localPlayerForScore = players.find(p => p.isHuman);
  $("scoreText").textContent = (settings.gameMode === "plant") ? `${blueScore}–${redScore}` : (settings.gameMode === "ffa" ? (localPlayerForScore?.kills || 0) : (localPlayerForScore?.team === "red" ? redScore : blueScore));

  if (reloadTimer > 0) {
    $("ammoStatus").textContent = "RELOADING";
    $("ammoStatus").style.color = "#ffd76b";
  } else if (human.ammo === 0) {
    $("ammoStatus").textContent = "PRESS R";
    $("ammoStatus").style.color = "#ff737d";
  } else {
    $("ammoStatus").textContent = "READY";
    $("ammoStatus").style.color = "#8bffb1";
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointInRect(x, y, rect, padding = 0) {
  return x >= rect.x - padding && x <= rect.x + rect.w + padding &&
         y >= rect.y - padding && y <= rect.y + rect.h + padding;
}

function blocked(x, y, radius = 0) {
  return coverRects.some(rect => pointInRect(x, y, rect, radius));
}

function lineBlocked(x1, y1, x2, y2) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1)) return true;
  }
  return false;
}

function canSee(a, b) {
  return !lineBlocked(a.x, a.y, b.x, b.y);
}

function movePlayer(p, dx, dy) {
  if (!p.alive) return;

  const nx = clamp(p.x + dx, p.radius + 8, WORLD_W - p.radius - 8);
  if (!blocked(nx, p.y, p.radius)) p.x = nx;

  const ny = clamp(p.y + dy, p.radius + 8, WORLD_H - p.radius - 8);
  if (!blocked(p.x, ny, p.radius)) p.y = ny;
}

function setMessage(text, seconds = 0.9) {
  message = text;
  messageTimer = seconds;
}

function spawnParticles(x, y, color, amount = 9) {
  for (let i = 0; i < amount; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.25 + Math.random() * 0.4,
      maxLife: 0.65,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function shoot(p, angle) {
  if (!running || paused || !p.alive || p.ammo <= 0) return;
  if (p.fireCooldown > 0) return;
  const gun = p.isHuman ? (WEAPONS[settings.weaponType] || WEAPONS.rifle) : WEAPONS.rifle;
  p.ammo--;
  p.fireCooldown = p.isHuman ? gun.cooldown : 0.32;
  const bx = p.x + Math.cos(angle) * 22;
  const by = p.y + Math.sin(angle) * 22;
  const pellets = p.isHuman ? gun.pellets : 1;
  const powerDamage = p.isHuman && powerTimers.damage > 0 ? 1.5 : 1;
  for (let i = 0; i < pellets; i++) {
    const shotAngle = angle + (Math.random() - 0.5) * (p.isHuman ? gun.spread : 0.08);
    bullets.push({
      x: bx, y: by, vx: Math.cos(shotAngle) * (p.isHuman ? gun.speed : 10.5),
      vy: Math.sin(shotAngle) * (p.isHuman ? gun.speed : 10.5),
      team: p.team, owner: p.id, weaponName: gun.name, damage: (p.isHuman ? gun.damage : 25) * powerDamage, life: 1.3,
      color: p.team === "blue" ? "#8bd0ff" : "#ff9ba6"
    });
  }
  if (p.isHuman && network.connected) {
    const created = bullets.slice(-pellets).map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, team: b.team, weaponName: b.weaponName, damage: b.damage, color: b.color }));
    netSend({ type: "shot", bullets: created });
  }
  spawnParticles(bx, by, p.team === "blue" ? "#72bfff" : "#ff6577", 3);
  if (p.isHuman) playSound("shoot");
}

function throwGrenade() {
  const human = players.find(p => p.isHuman);
  if (!running || paused || !human || !human.alive || grenadeCount <= 0) return;
  const angle = human.angle;
  const grenade = { x: human.x + Math.cos(angle) * 22, y: human.y + Math.sin(angle) * 22,
    vx: Math.cos(angle) * 7.5, vy: Math.sin(angle) * 7.5, fuse: 0.9, team: human.team, owner: "you" };
  grenades.push(grenade);
  if (network.connected) netSend({ type: "grenade", x: grenade.x, y: grenade.y, vx: grenade.vx, vy: grenade.vy, fuse: grenade.fuse, team: grenade.team });
  grenadeCount--;
  setMessage("GRENADE OUT!");
  playSound("shoot");
  updateHUD();
}

function explodeGrenade(g) {
  explosions.push({ x: g.x, y: g.y, life: 0.42, maxLife: 0.42, radius: 130 });
  spawnParticles(g.x, g.y, "#ffcb69", 28);
  const remoteOwned = network.connected && String(g.owner || "").startsWith("net:") && g.owner !== `net:${network.clientId}`;
  if (remoteOwned) return; // Other clients render the blast; only the thrower's client applies damage.
  for (const p of players) {
    if (!p.alive || (p.team === g.team && settings.gameMode !== "ffa")) continue;
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    if (d < 130) {
      const grenadeDamage = Math.round(85 * (1 - d / 160));
      p.health -= p.isHuman && powerTimers.shield > 0 ? grenadeDamage * 0.35 : grenadeDamage;
      if (p.health <= 0) eliminate(p, "you", "GRENADE");
      if (network.connected && p.isRemote) {
        netSend({ type: "hit", targetClientId: p.id.startsWith("net:") ? p.id.slice(4) : network.clientId, targetId: p.id, health: p.health, alive: p.alive, cause: "GRENADE", blueScore, redScore });
      }
    }
  }
}

function nearestEnemy(p) {
  let target = null, best = Infinity;
  for (const other of players) {
    if (!other.alive || other.id === p.id) continue;
    if ((settings.gameMode || "deathmatch") !== "ffa" && other.team === p.team) continue;
    const d = distance(p, other);
    if (d < best) { best = d; target = other; }
  }
  return target;
}

function difficultyConfig() {
  return {
    easy:   { speed: 2.0, accuracy: 0.24, cooldown: 0.85, range: 420 },
    normal: { speed: 2.7, accuracy: 0.13, cooldown: 0.58, range: 540 },
    hard:   { speed: 3.0, accuracy: 0.055, cooldown: 0.32, range: 650 },
    insane: { speed: 3.6, accuracy: 0.018, cooldown: 0.22, range: 760 }
  }[settings.difficulty] || { speed: 2.7, accuracy: 0.13, cooldown: 0.58, range: 540 };
}

function updateAI(p, dt) {
  if (!p.alive) return;

  const config = difficultyConfig();
  p.fireCooldown -= dt;
  if (p.ammo <= 0) { p.ammo = 30; p.fireCooldown = Math.max(p.fireCooldown, 0.8); }
  p.aiTimer -= dt;

  if (p.aiTimer <= 0) {
    p.aiTimer = 0.25 + Math.random() * 0.3;
    if (Math.random() < 0.3) p.strafeDir *= -1;
  }

  if (settings.gameMode === "plant" && bomb?.planted && p.team === "red") {
    const bd = distance(p, bomb);
    if (bd > 42) {
      const ba = Math.atan2(bomb.y - p.y, bomb.x - p.x);
      p.angle = ba;
      movePlayer(p, Math.cos(ba) * config.speed, Math.sin(ba) * config.speed);
    } else {
      bomb.defuse = (bomb.defuse || 0) + dt;
      setMessage(`DEFENDERS DEFUSING... ${Math.min(100, Math.floor(bomb.defuse / 3 * 100))}%`);
      if (bomb.defuse >= 3) finishPlantRound(false, "BOMB DEFUSED");
    }
    return;
  }

  const target = nearestEnemy(p);
  if (!target) return;

  p.target = target;
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  p.angle = angle;

  const visible = canSee(p, target);
  let mx = 0, my = 0;

  if (d > 220) {
    mx += Math.cos(angle) * 0.9;
    my += Math.sin(angle) * 0.9;
  } else if (d < 120) {
    mx -= Math.cos(angle) * 0.65;
    my -= Math.sin(angle) * 0.65;
  }

  mx += Math.cos(angle + Math.PI / 2) * 0.6 * p.strafeDir;
  my += Math.sin(angle + Math.PI / 2) * 0.6 * p.strafeDir;

  const len = Math.hypot(mx, my) || 1;
  movePlayer(p, mx / len * config.speed, my / len * config.speed);

  if (visible && d < config.range && p.fireCooldown <= 0) {
    const spread = config.accuracy * Math.max(0.4, d / 300);
    shoot(p, angle + (Math.random() - 0.5) * spread);
    p.fireCooldown = Math.max(p.fireCooldown, config.cooldown);
  }
}

function addKillFeed(owner, target, cause = "ASSAULT RIFLE") {
  const attackerName = owner ? (owner.isHuman ? (settings.characterName || "YOU") : owner.botName) : "UNKNOWN";
  const targetName = target.isHuman ? (settings.characterName || "YOU") : target.botName;
  killFeedItems.unshift({ attacker: attackerName, target: targetName, cause: String(cause || "ASSAULT RIFLE").toUpperCase(), life: 6 });
  killFeedItems = killFeedItems.slice(0, 5);
  const feed = $("killFeed");
  if (feed) {
    feed.innerHTML = "";
    killFeedItems.forEach(item => {
      const row = document.createElement("div"); row.className = "kill-feed-row";
      const a = document.createElement("b"); a.textContent = item.attacker;
      const weapon = document.createElement("span"); weapon.textContent = `  ▸ ${item.cause} ▸  `;
      const t = document.createElement("strong"); t.textContent = item.target;
      row.append(a, weapon, t); feed.appendChild(row);
    });
  }
}

function eliminate(target, ownerId, cause = "ASSAULT RIFLE") {
  if (!target.alive) return;
  target.health = 0; target.alive = false; target.hidden = false; target.respawnTimer = 1.6;
  spawnParticles(target.x, target.y, target.team === "blue" ? "#55a7ff" : "#ff596e", 18);
  const owner = players.find(p => p.id === ownerId);
  if (owner) owner.kills++;
  addKillFeed(owner, target, cause);
  const isEnemyElimination = owner && (settings.gameMode === "ffa" || owner.team !== target.team);
  if (isEnemyElimination && Math.random() < 0.88) {
    const roll = Math.random();
    const type = roll < 0.34 ? "health" : roll < 0.56 ? "ammo" : roll < 0.73 ? "speed" : roll < 0.89 ? "damage" : "shield";
    pickups.push({ x: target.x, y: target.y, type, life: 16, pulse: Math.random() * Math.PI * 2 });
    spawnParticles(target.x, target.y, ({health:"#43e58c", ammo:"#facc15", speed:"#a78bfa", damage:"#ff8b42", shield:"#67d9ff"})[type], 10);
  }
  const mode = settings.gameMode || "deathmatch";
  if (mode === "ffa") {
    const human = players.find(p => p.isHuman);
    blueScore = human?.kills || 0;
    redScore = Math.max(0, ...players.filter(p => !p.isHuman).map(p => p.kills));
  } else if (mode === "plant") {
    if (target.team === "blue" && !players.some(p => p.team === "blue" && p.alive)) finishPlantRound(false, "ATTACKERS ELIMINATED");
    if (target.team === "red" && !players.some(p => p.team === "red" && p.alive) && !bomb?.planted) finishPlantRound(true, "DEFENDERS ELIMINATED");
  } else if (mode === "elimination") {
    if (roundPauseTimer <= 0) {
      const blueAlive = players.some(p => p.team === "blue" && p.alive);
      const redAlive = players.some(p => p.team === "red" && p.alive);
      if (!blueAlive || !redAlive) {
        if (!blueAlive) redScore++; else blueScore++;
        roundPauseTimer = 3.2;
        const roundMessage = `${!blueAlive ? "RED SQUAD" : "BLUE SQUAD"} WINS THE ROUND · NEXT ROUND SOON`;
        setMessage(roundMessage);
        updateHUD();
        if (network.connected) netSend({ type: "roundUpdate", blueScore, redScore, roundNumber, text: roundMessage });
        if (blueScore >= 3 || redScore >= 3) endGame(blueScore > redScore);
      }
    }
  } else {
    if (target.team === "blue") redScore++; else blueScore++;
  }
  if (ownerId === "you") { playerKills++; setMessage("ENEMY ELIMINATED!"); playSound("hit"); }
  else if (target.isHuman) setMessage("YOU WERE ELIMINATED!");
  updateHUD();
  if (mode === "ffa" && blueScore >= Number(settings.winScore)) endGame(true);
  else if (mode === "ffa" && redScore >= Number(settings.winScore)) endGame(false);
  else if (mode === "deathmatch" && (blueScore >= Number(settings.winScore) || redScore >= Number(settings.winScore))) endGame(blueScore >= Number(settings.winScore));
}

function finishPlantRound(attackerWon, reason) {
  if (settings.gameMode !== "plant" || roundPauseTimer > 0 || gameEnded) return;
  if (attackerWon) blueScore++; else redScore++;
  roundPauseTimer = 3.2;
  bomb = null; plantProgress = 0; defuseProgress = 0;
  setMessage(`${attackerWon ? "ATTACKERS WIN ROUND" : "DEFENDERS WIN ROUND"} · ${reason}`);
  updateHUD();
  if (blueScore >= 4 || redScore >= 4 || roundNumber >= 6) endGame(blueScore > redScore);
}

function resetPlantRound() {
  if (!running || gameEnded) return;
  roundNumber++;
  plantProgress = 0; defuseProgress = 0; bomb = null; roundPauseTimer = 0;
  bullets = []; grenades = []; explosions = []; grenadeCount = 3; reloadTimer = 0;
  for (const p of players) {
    const x = p.team === "blue" ? 420 : WORLD_W - 420;
    p.x = x + (Math.random() - 0.5) * 100;
    p.y = WORLD_H / 2 + (Math.random() - 0.5) * 260;
    p.health = 100; p.alive = true; p.hidden = false; p.respawnTimer = 0;
    p.ammo = p.isHuman ? (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo : 30;
  }
  camera.x = clamp(players[0].x - W / 2, 0, WORLD_W - W);
  camera.y = clamp(players[0].y - H / 2, 0, WORLD_H - H);
  setMessage(`ROUND ${roundNumber}/6 · PLANT THE BOMB`);
}

function resetEliminationRound() {
  if (!running || gameEnded || settings.gameMode !== "elimination") return;
  roundNumber++;
  bullets = []; grenades = []; explosions = []; pickups = [];
  grenadeCount = 3; reloadTimer = 0; plantProgress = 0; defuseProgress = 0; bomb = null;
  for (const p of players) {
    const x = p.team === "blue" ? 360 : WORLD_W - 360;
    p.x = x + (Math.random() - 0.5) * 90;
    p.y = WORLD_H / 2 + (Math.random() - 0.5) * 250;
    p.health = 100; p.alive = true; p.hidden = false; p.respawnTimer = 0;
    p.ammo = p.isHuman ? (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo : 30;
    p.fireCooldown = 0.45 + Math.random() * 0.25;
  }
  camera.x = clamp(players[0].x - W / 2, 0, WORLD_W - W);
  camera.y = clamp(players[0].y - H / 2, 0, WORLD_H - H);
  setMessage(`ROUND ${roundNumber} · NO RESPAWNS · WIPE THE ENEMY TEAM`);
  updateHUD();
}

function respawn(p) {
  const baseX = p.team === "blue" ? 300 : WORLD_W - 300;
  const baseY = 250 + Math.random() * (WORLD_H - 500);
  let x = baseX, y = baseY;

  for (let tries = 0; tries < 35; tries++) {
    const tx = clamp(baseX + (Math.random() - 0.5) * 150, 25, WORLD_W - 25);
    const ty = clamp(baseY + (Math.random() - 0.5) * 220, 30, WORLD_H - 30);

    if (!blocked(tx, ty, 20)) {
      x = tx; y = ty; break;
    }
  }

  p.x = x; p.y = y;
  p.health = 100;
  p.ammo = p.isHuman ? (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo : 30;
  p.alive = true;
  p.hidden = false;
  p.fireCooldown = 0.5;
  p.respawnTimer = 0;
}

function startReload() {
  const human = players.find(p => p.isHuman);
  if (!running || paused || !human || !human.alive) return;
  const gun = WEAPONS[settings.weaponType] || WEAPONS.rifle;
  if (reloadTimer > 0 || human.ammo === gun.ammo) return;

  reloadTimer = gun.reload;
  setMessage("RELOADING...");
  playSound("reload");
}

function endGame(blueWon, fromNetwork = false) {
  if (gameEnded) return;
  if (network.connected && !fromNetwork) netSend({ type: "matchEnd", blueWon: !!blueWon });
  running = false;
  gameEnded = true;
  paused = true;
  mouse.down = false;
  const localPlayer = players.find(p => p.isHuman);
  const localWon = network.connected && localPlayer?.team === "red" ? !blueWon : !!blueWon;

  $("gameOverlay").classList.remove("hidden");
  $("overlayTitle").textContent = localWon ? "VICTORY!" : "DEFEAT!";
  const mode = settings.gameMode || "deathmatch";
  const winner = mode === "ffa" ? (localWon ? "YOU WIN!" : "TOP BOT WINS!") : mode === "plant" ? (blueWon ? "ATTACKERS WIN THE MATCH!" : "DEFENDERS WIN THE MATCH!") : (blueWon ? "Blue Squad wins!" : "Red Squad wins!");
  $("overlayText").textContent = `${winner} Personal kills: ${playerKills}. Final score ${blueScore}–${redScore}.`;

  $("resumeBtn").classList.add("hidden");
  playSound(localWon ? "win" : "lose");
}

function pauseGame() {
  if (!running || gameEnded) return;
  paused = true;
  mouse.down = false;
  $("gameOverlay").classList.remove("hidden");
  $("overlayTitle").textContent = "PAUSED";
  $("overlayText").textContent = "Take a breath, soldier. Ready when you are.";
  $("resumeBtn").classList.remove("hidden");
  $("pauseBtn").textContent = "▶ RESUME";
}

function resumeGame() {
  if (!running || gameEnded) return;
  paused = false;
  mouse.down = false;
  $("gameOverlay").classList.add("hidden");
  $("pauseBtn").textContent = "Ⅱ PAUSE";
  lastTime = performance.now();
}

function update(dt) {
  if (!running || paused || gameEnded) return;
  if (matchTime > 0) matchTime = Math.max(0, matchTime - dt);
  const timerEl = $("matchTime");
  if (timerEl) timerEl.textContent = matchTime > 0 ? `${Math.floor(matchTime / 60).toString().padStart(2,"0")}:${Math.floor(matchTime % 60).toString().padStart(2,"0")}` : (Number($("matchTimeChoice")?.value ?? settings.matchDuration ?? 180) === 0 ? "--:--" : "00:00");
  if (matchTime <= 0 && Number($("matchTimeChoice")?.value ?? settings.matchDuration ?? 180) !== 0) { endGame(blueScore >= redScore); return; }
  killFeedItems.forEach(item => item.life -= dt);
  killFeedItems = killFeedItems.filter(item => item.life > 0);
  const feed = $("killFeed");
  if (feed && feed.children.length !== killFeedItems.length) {
    feed.innerHTML = "";
    killFeedItems.forEach(item => {
      const row = document.createElement("div"); row.className = "kill-feed-row";
      const a = document.createElement("b"); a.textContent = item.attacker;
      const weapon = document.createElement("span"); weapon.textContent = `  ▸ ${item.cause} ▸  `;
      const t = document.createElement("strong"); t.textContent = item.target;
      row.append(a, weapon, t); feed.appendChild(row);
    });
  }
  if ((settings.gameMode === "plant" || settings.gameMode === "elimination") && roundPauseTimer > 0) {
    roundPauseTimer -= dt;
    if (roundPauseTimer <= 0 && !gameEnded) {
      if (settings.gameMode === "plant") resetPlantRound();
      else resetEliminationRound();
    }
    return;
  }
  if (messageTimer > 0) messageTimer -= dt;
  for (const type of Object.keys(powerTimers)) powerTimers[type] = Math.max(0, powerTimers[type] - dt);

  const pickupPlayer = players.find(p => p.isHuman && p.alive);
  for (let i = pickups.length - 1; i >= 0; i--) {
    const item = pickups[i];
    item.life -= dt;
    item.pulse += dt * 4;
    if (item.life <= 0) { pickups.splice(i, 1); continue; }
    if (pickupPlayer && Math.hypot(pickupPlayer.x - item.x, pickupPlayer.y - item.y) < 31) {
      const gun = WEAPONS[settings.weaponType] || WEAPONS.rifle;
      if (item.type === "health") {
        if (pickupPlayer.health >= 100) continue;
        pickupPlayer.health = Math.min(100, pickupPlayer.health + 35);
        setMessage("+35 HP · MED KIT COLLECTED");
      } else if (item.type === "ammo") {
        pickupPlayer.ammo = gun.ammo;
        grenadeCount = Math.min(5, grenadeCount + 1);
        setMessage("AMMO RESTOCKED · +1 GRENADE");
      } else if (item.type === "speed") {
        powerTimers.speed = Math.max(powerTimers.speed, 8);
        setMessage("OVERDRIVE · SPEED BOOST 8s");
      } else if (item.type === "damage") {
        powerTimers.damage = Math.max(powerTimers.damage, 8);
        setMessage("OVERCHARGE · DAMAGE BOOST 8s");
      } else if (item.type === "shield") {
        powerTimers.shield = Math.max(powerTimers.shield, 8);
        setMessage("ENERGY SHIELD · 8s");
      }
      spawnParticles(item.x, item.y, ({health:"#43e58c", ammo:"#facc15", speed:"#a78bfa", damage:"#ff8b42", shield:"#67d9ff"})[item.type], 15);
      pickups.splice(i, 1);
      playSound("hit");
      updateHUD();
    }
  }

  if (reloadTimer > 0) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) {
      const human = players.find(p => p.isHuman);
      if (human) human.ammo = (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo;
      reloadTimer = 0;
    }
  }

  const human = players.find(p => p.isHuman);

  if (human && human.alive) {
    human.fireCooldown -= dt;

    let dx = 0, dy = 0;
    if (keys.w || keys.arrowup) dy--;
    if (keys.s || keys.arrowdown) dy++;
    if (keys.a || keys.arrowleft) dx--;
    if (keys.d || keys.arrowright) dx++;

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const speedMultiplier = powerTimers.speed > 0 ? 1.55 : 1;
      movePlayer(human, dx / len * human.speed * speedMultiplier, dy / len * human.speed * speedMultiplier);
    }

    const aimX = mouse.x + camera.x;
    const aimY = mouse.y + camera.y;
    human.angle = Math.atan2(aimY - human.y, aimX - human.x);

    human.hidden = !!keys.e && coverRects.some(rect =>
      pointInRect(human.x, human.y, rect, 30)
    );

    if (settings.gameMode === "plant") {
      const site = { x: WORLD_W / 2, y: WORLD_H / 2 };
      if (!bomb && distance(human, site) < 88 && keys.e) {
        plantProgress += dt;
        setMessage(`PLANTING BOMB... ${Math.min(100, Math.floor(plantProgress / 2 * 100))}%`);
        if (plantProgress >= 2) {
          bomb = { x: site.x, y: site.y, planted: true, fuse: 15, defuse: 0 };
          plantProgress = 0; setMessage("BOMB PLANTED · DEFEND THE SITE!"); playSound("hit");
        }
      } else if (!bomb) plantProgress = 0;
      if (bomb?.planted) {
        bomb.fuse -= dt;
        if (bomb.fuse <= 0) finishPlantRound(true, "BOMB EXPLODED");
        // Human is on the attacking side in this mode; enemy defenders can defuse it.
      }
    }

    if (mouse.down && reloadTimer <= 0) shoot(human, human.angle);
  }

  for (const p of players) {
    if (!p.alive) {
      p.respawnTimer -= dt;
      if (settings.gameMode !== "elimination" && p.respawnTimer <= 0 && running && !gameEnded) respawn(p);
      continue;
    }
    if (!p.isHuman && !p.isRemote) updateAI(p, dt);
  }

  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.x += g.vx; g.y += g.vy; g.vx *= 0.985; g.vy *= 0.985; g.fuse -= dt;
    if (g.fuse <= 0) { explodeGrenade(g); grenades.splice(i, 1); }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life -= dt;
    if (explosions[i].life <= 0) explosions.splice(i, 1);
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life -= dt;

    if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H || blocked(b.x, b.y, 2)) {
      bullets.splice(i, 1);
      continue;
    }

    if (network.connected && String(b.owner).startsWith("net:") && b.owner !== `net:${network.clientId}`) continue;
    let hit = false;
    for (const p of players) {
      if (!p.alive || p.id === b.owner || ((settings.gameMode || "deathmatch") !== "ffa" && p.team === b.team)) continue;

      if (Math.hypot(p.x - b.x, p.y - b.y) < p.radius + 3) {
        const reducedDamage = p.isHuman && powerTimers.shield > 0 ? b.damage * 0.35 : b.damage;
        p.health -= reducedDamage;
        spawnParticles(b.x, b.y, p.isHuman && powerTimers.shield > 0 ? "#67d9ff" : b.color, 5);
        if (p.health <= 0) eliminate(p, b.owner, b.weaponName || "WEAPON");
        if (network.connected && b.owner === "you" && p.isRemote) {
          netSend({ type: "hit", targetClientId: p.id.startsWith("net:") ? p.id.slice(4) : network.clientId, targetId: p.id, health: p.health, alive: p.alive, cause: b.weaponName || "WEAPON", blueScore, redScore });
        }
        bullets.splice(i, 1);
        hit = true;
        break;
      }
    }
    if (hit) continue;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.life -= dt;
    p.vx *= 0.97; p.vy *= 0.97;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (human) {
    const targetX = clamp(human.x - W / 2, 0, WORLD_W - W);
    const targetY = clamp(human.y - H / 2, 0, WORLD_H - H);
    camera.x += (targetX - camera.x) * Math.min(1, dt * 8);
    camera.y += (targetY - camera.y) * Math.min(1, dt * 8);
  }
  updateHUD();
}

function drawFloor() {
  const palettes = {
    dust2: ["#9b8057", "#a68a60", "#92774f", "#f5e0b51b"],
    mirage: ["#98765c", "#a78365", "#8d6c54", "#f3d6b41b"],
    industrial: ["#4b514d", "#535954", "#444a46", "#b4c4b51b"],
    forest: ["#39453c", "#3b473d", "#374239", "#a2b89b0c"],
    desert: ["#786344", "#806b49", "#725d40", "#f7d49a18"],
    snow: ["#667681", "#71838e", "#5e707b", "#e4f4ff18"]
  };
  const palette = palettes[settings.mapType] || palettes.forest;
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  for (let y = 0; y < WORLD_H; y += 40) {
    for (let x = 0; x < WORLD_W; x += 40) {
      ctx.fillStyle = ((x / 40 + y / 40) % 2 === 0) ? palette[1] : palette[2];
      ctx.fillRect(x, y, 40, 40);
    }
  }

  ctx.strokeStyle = palette[3];
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  ctx.fillStyle = "#3b95ff12";
  ctx.fillRect(8, 8, 75, WORLD_H - 16);
  ctx.fillStyle = "#ff536612";
  ctx.fillRect(WORLD_W - 83, 8, 75, WORLD_H - 16);

  // Map-specific floor dressing: lane markings, tile seams, and subtle callouts.
  if (settings.mapType === "dust2" || settings.mapType === "mirage") {
    ctx.strokeStyle = "#e8d1a02b"; ctx.lineWidth = 3;
    for (let y = 160; y < WORLD_H - 120; y += 220) {
      ctx.beginPath(); ctx.moveTo(150, y); ctx.lineTo(WORLD_W - 150, y); ctx.stroke();
    }
    ctx.fillStyle = "#25201630";
    ctx.fillRect(280, 180, 410, 360); ctx.fillRect(1770, 180, 510, 370);
    ctx.fillRect(280, 1110, 420, 380); ctx.fillRect(1780, 1110, 500, 380);
    ctx.fillStyle = "#ffe34d"; ctx.font = "bold 34px Arial"; ctx.textAlign = "center";
    ctx.globalAlpha = 0.56;
    ctx.fillText("A SITE", 490, 350); ctx.fillText("B SITE", 2020, 1320);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f7e8cb"; ctx.font = "bold 18px Arial";
    ctx.fillText("MID", WORLD_W / 2, 880);
  } else if (settings.mapType === "industrial") {
    ctx.strokeStyle = "#d3dbd433"; ctx.lineWidth = 5;
    for (let x = 160; x < WORLD_W; x += 320) {
      ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x, WORLD_H - 100); ctx.stroke();
    }
    ctx.fillStyle = "#7dff0014";
    for (let y = 140; y < WORLD_H; y += 280) ctx.fillRect(100, y, WORLD_W - 200, 7);
  }
  ctx.strokeStyle = "#b5c6a033";
  ctx.lineWidth = 5;
  ctx.strokeRect(5, 5, WORLD_W - 10, WORLD_H - 10);
}

function drawCover() {
  const coverPalette = {
    dust2: ["#51402d", "#b69a70", "#d0b48a", "#f0d7ae", "#8d704b"],
    mirage: ["#4e352c", "#b88a69", "#d2a47f", "#f2c7a1", "#8d6048"],
    industrial: ["#252c29", "#626a64", "#818a82", "#b7c3b8", "#424a45"],
    forest: ["#1f2925", "#82795f", "#a39a7b", "#d1c6a1", "#766d55"],
    desert: ["#44372b", "#a77943", "#c69a60", "#ead0a1", "#8b633b"],
    snow: ["#303d49", "#7e929f", "#a9bac4", "#e3f0f6", "#627682"]
  }[settings.mapType] || ["#1f2925", "#82795f", "#a39a7b", "#d1c6a1", "#766d55"];
  for (const r of coverRects) {
    ctx.fillStyle = coverPalette[0];
    ctx.fillRect(r.x + 5, r.y + 7, r.w, r.h);
    ctx.fillStyle = coverPalette[1];
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = coverPalette[2];
    ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);

    ctx.strokeStyle = coverPalette[3];
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);

    ctx.strokeStyle = coverPalette[4];
    for (let x = r.x + 15; x < r.x + r.w - 5; x += 23) {
      ctx.beginPath(); ctx.moveTo(x, r.y + 5); ctx.lineTo(x, r.y + r.h - 5); ctx.stroke();
    }
  }
}

function drawPlayer(p, preview = false) {
  if (!p.alive && !preview) return;

  const human = p.isHuman;
  const color = human ? settings.characterColor : (p.botColor || (p.team === "blue" ? "#3f9dff" : "#ff5268"));
  const dark = shadeColor(color, -35);
  const weapon = human ? settings.weaponColor : (p.botWeaponColor || "#d5d9e5");
  const outfit = human ? settings.outfit : (p.botOutfit || "standard");
  const hat = human ? (settings.hatStyle || "helmet") : (p.botHat || "helmet");
  const gunType = human ? (settings.weaponType || "rifle") : "rifle";
  const radius = outfit === "heavy" ? 17 : outfit === "scout" ? 12 : 14;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

  // Distinct silhouettes for the selected weapon.
  ctx.fillStyle = "#20232b";
  if (gunType === "sniper") { ctx.fillRect(0, -4, 39, 8); ctx.fillRect(20, -6, 19, 2); ctx.fillRect(8, -7, 8, 3); }
  else if (gunType === "shotgun") { ctx.fillRect(2, -5, 31, 10); ctx.fillRect(5, 4, 10, 4); }
  else if (gunType === "smg") { ctx.fillRect(3, -5, 23, 10); ctx.fillRect(10, 4, 5, 7); }
  else if (gunType === "pistol") { ctx.fillRect(4, -4, 21, 8); ctx.fillRect(8, 3, 6, 7); }
  else { ctx.fillRect(3, -5, 29, 10); ctx.fillRect(10, 4, 7, 5); }
  ctx.fillStyle = weapon;
  ctx.fillRect(gunType === "sniper" ? 24 : 17, -2, gunType === "sniper" ? 19 : 15, 4);

  // Character shadow
  ctx.fillStyle = "#111a1877";
  ctx.beginPath();
  ctx.ellipse(2, 7, radius + 3, radius - 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Heavy armor outline
  if (outfit === "heavy") {
    ctx.fillStyle = "#222435";
    ctx.beginPath();
    ctx.arc(0, 0, radius + 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-1, -1, radius - 3, 0, Math.PI * 2);
  ctx.fill();

  if (outfit === "medic") {
    ctx.fillStyle = "#f5f5f5"; ctx.fillRect(-5, -6, 10, 12);
    ctx.fillStyle = "#e74b62"; ctx.fillRect(-2, -4, 4, 8); ctx.fillRect(-4, -2, 8, 4);
  } else if (outfit === "urban") {
    ctx.fillStyle = "#4b5563"; ctx.fillRect(-8, -7, 5, 5); ctx.fillRect(2, 2, 6, 5);
  } else if (outfit === "neon") {
    ctx.strokeStyle = "#b8ff54"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, radius - 2, 0, Math.PI * 2); ctx.stroke();
  }

  // Hats / helmets are drawn on top of the operator.
  if (hat !== "none") {
    ctx.fillStyle = hat === "crown" ? "#facc15" : hat === "beanie" ? "#f472d0" : hat === "cowboy" ? "#c89a5a" : hat === "headset" ? "#252b39" : "#303747";
    if (hat === "cowboy") { ctx.fillRect(-13, -radius - 5, 26, 4); ctx.fillRect(-8, -radius - 10, 16, 6); }
    else if (hat === "crown") { ctx.fillRect(-8, -radius - 9, 16, 7); ctx.beginPath(); ctx.moveTo(-8, -radius - 8); ctx.lineTo(-7, -radius - 15); ctx.lineTo(-2, -radius - 10); ctx.lineTo(1, -radius - 15); ctx.lineTo(4, -radius - 10); ctx.lineTo(8, -radius - 14); ctx.lineTo(8, -radius - 8); ctx.fill(); }
    else if (hat === "headset") { ctx.strokeStyle = "#aab4c8"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -1, radius + 2, Math.PI, Math.PI * 2); ctx.stroke(); ctx.fillRect(-radius - 3, -3, 4, 9); ctx.fillRect(radius - 1, -3, 4, 9); }
    else { ctx.beginPath(); ctx.arc(0, -4, radius - 2, Math.PI, Math.PI * 2); ctx.fill(); ctx.fillRect(-radius + 1, -5, radius * 2 - 2, 3); }
  }

  if (outfit === "stealth") {
    ctx.fillStyle = "#151522";
    ctx.fillRect(-8, -radius + 5, 16, 5);
  } else if (outfit === "scout") {
    ctx.fillStyle = "#f5d46d";
    ctx.fillRect(-5, -3, 8, 5);
  } else {
    ctx.fillStyle = shadeColor(color, 35);
    ctx.fillRect(-7, -5, 8, 5);
  }

  ctx.restore();

  if (!preview) {
    ctx.fillStyle = "#111";
    ctx.fillRect(p.x - 16, p.y - 25, 32, 5);
    ctx.fillStyle = p.health < 35 ? "#ff596e" : "#7dff9c";
    ctx.fillRect(p.x - 15, p.y - 24, 30 * Math.max(0, p.health) / 100, 3);

    if (human) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "bold 10px Inter";
      ctx.fillText(p.botName || settings.characterName || "YOU", p.x, p.y - 34);
      ctx.textAlign = "left";

      if (p.hidden) {
        ctx.strokeStyle = "#d7ff76";
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function shadeColor(hex, percent) {
  const value = parseInt(hex.replace("#", ""), 16);
  let r = (value >> 16) & 255;
  let g = (value >> 8) & 255;
  let b = value & 255;

  const adjust = channel => clamp(
    Math.round(channel + (percent < 0 ? channel * percent / 100 : (255 - channel) * percent / 100)),
    0, 255
  );

  r = adjust(r); g = adjust(g); b = adjust(b);
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function drawPickups() {
  const info = {
    health: { color: "#43e58c", label: "+", name: "MED KIT" },
    ammo: { color: "#facc15", label: "A", name: "AMMO" },
    speed: { color: "#a78bfa", label: "»", name: "SPEED" },
    damage: { color: "#ff8b42", label: "✦", name: "DAMAGE" },
    shield: { color: "#67d9ff", label: "◇", name: "SHIELD" }
  };
  for (const item of pickups) {
    const data = info[item.type];
    const bob = Math.sin(item.pulse) * 3;
    ctx.save();
    ctx.globalAlpha = item.life < 3 ? 0.45 + Math.sin(item.pulse * 3) * 0.3 : 1;
    ctx.shadowColor = data.color; ctx.shadowBlur = 16;
    ctx.fillStyle = "#11121ce8";
    ctx.beginPath(); ctx.arc(item.x, item.y + bob, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = data.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(item.x, item.y + bob, 14 + Math.sin(item.pulse) * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = data.color; ctx.font = "900 17px Arial"; ctx.textAlign = "center";
    ctx.fillText(data.label, item.x, item.y + bob + 6);
    ctx.font = "900 9px Arial"; ctx.fillStyle = "#ffffff";
    ctx.fillText(data.name, item.x, item.y + bob + 29);
    ctx.restore();
  }
}

function drawBullets() {
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.shadowBlur = 9;
    ctx.shadowColor = b.color;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawCrosshair() {
  if (!settings.crosshair || screen !== "game" || paused) return;
  ctx.save();
  ctx.strokeStyle = "#ffffffdd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, 8, 0, Math.PI * 2);
  ctx.moveTo(mouse.x - 13, mouse.y);
  ctx.lineTo(mouse.x - 5, mouse.y);
  ctx.moveTo(mouse.x + 5, mouse.y);
  ctx.lineTo(mouse.x + 13, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 13);
  ctx.lineTo(mouse.x, mouse.y - 5);
  ctx.moveTo(mouse.x, mouse.y + 5);
  ctx.lineTo(mouse.x, mouse.y + 13);
  ctx.stroke();
  ctx.restore();
}

function drawMessage() {
  if (messageTimer <= 0 || !message) return;
  ctx.save();
  ctx.font = "900 20px 'Barlow Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8;
  ctx.fillText(message, W / 2, 45);
  ctx.restore();
}

function drawGrenades() {
  for (const g of grenades) {
    ctx.fillStyle = "#a5c86a"; ctx.beginPath(); ctx.arc(g.x, g.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#35452d"; ctx.fillRect(g.x - 3, g.y - 11, 6, 4);
  }
  for (const e of explosions) {
    const progress = 1 - e.life / e.maxLife;
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * progress, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff1b0"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * progress, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function draw() {
  if (screen === "game") {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
    drawFloor();
    drawCover();
    drawPickups();
    if (settings.gameMode === "plant") {
      const sx = WORLD_W / 2, sy = WORLD_H / 2;
      ctx.save(); ctx.strokeStyle = "#ffd76b"; ctx.lineWidth = 5; ctx.setLineDash([12, 8]);
      ctx.beginPath(); ctx.arc(sx, sy, 88, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ffd76b"; ctx.font = "bold 22px Arial"; ctx.textAlign = "center";
      ctx.fillText("BOMB SITE A", sx, sy - 104); ctx.restore();
      if (bomb?.planted) {
        ctx.fillStyle = "#ff596e"; ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff1b0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 23, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 16px Arial"; ctx.textAlign = "center";
        ctx.fillText(`BOMB ${Math.ceil(bomb.fuse)}s`, bomb.x, bomb.y - 31);
      }
    }
    for (const p of players) drawPlayer(p);
    drawBullets();
    drawGrenades();
    drawParticles();
    ctx.restore();
    drawMessage();
    drawCrosshair();
  }
  drawPreviewCanvas($("previewCanvas"));
  drawPreviewCanvas($("customCanvas"));
}

function drawPreviewCanvas(previewCanvas) {
  if (!previewCanvas) return;
  const c = previewCanvas.getContext("2d");
  const w = previewCanvas.width, h = previewCanvas.height;

  c.clearRect(0, 0, w, h);
  c.fillStyle = "#171522";
  c.fillRect(0, 0, w, h);

  c.strokeStyle = "#ffffff0d";
  for (let x = 0; x < w; x += 25) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  for (let y = 0; y < h; y += 25) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }

  const p = {
    x: w / 2, y: h / 2 + 4, angle: -0.4,
    team: "blue", isHuman: true, health: 100, alive: true, hidden: false
  };

  const oldCtx = ctx;
  ctx = c;
  drawPlayer(p, true);
  ctx = oldCtx;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000 || 0, 0.04);
  lastTime = now;

  update(dt);
  broadcastLocalState(now);
  draw();
  requestAnimationFrame(loop);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * W / rect.width,
    y: (event.clientY - rect.top) * H / rect.height
  };
}


const playTypeChoice = $("playTypeChoice");
const lanControls = $("lanControls");
if ($("serverAddress") && window.location.hostname && window.location.protocol.startsWith("http")) {
  $("serverAddress").value = `${window.location.hostname}:3000`;
}
if (playTypeChoice) playTypeChoice.addEventListener("change", () => {
  const lan = playTypeChoice.value === "lan";
  lanControls?.classList.toggle("hidden", !lan);
  network.playType = lan ? "lan" : "single";
  if (!lan) disconnectLAN();
  const modeSelect = $("modeChoice");
  if (modeSelect) {
    [...modeSelect.options].forEach(option => { option.disabled = lan && ["ffa", "plant"].includes(option.value); });
    if (lan && ["ffa", "plant"].includes(modeSelect.value)) { modeSelect.value = "deathmatch"; settings.gameMode = "deathmatch"; $("modeDescription").textContent = modeDescriptions.deathmatch; }
  }
  $("teamSizeInfo").textContent = `${$("teamSizeChoice")?.value || 3}v${$("teamSizeChoice")?.value || 3} SQUADS`;
});
$("matchTimeChoice")?.addEventListener("change", () => { settings.matchDuration = Number($("matchTimeChoice").value); saveSettings(); });
$("teamSizeChoice")?.addEventListener("change", () => {
  const size = Number($("teamSizeChoice").value);
  $("teamSizeInfo").textContent = `${size}v${size} SQUADS`;
  if (network.connected) { disconnectLAN(); netStatus("RECONNECT AFTER TEAM SIZE CHANGE"); }
});
$("hostLanBtn")?.addEventListener("click", connectLAN);
$("joinLanBtn")?.addEventListener("click", connectLAN);
$("disconnectLanBtn")?.addEventListener("click", disconnectLAN);

// Menu buttons
$("startBtn").addEventListener("click", () => {
  if ($("matchTimeChoice")) settings.matchDuration = Number($("matchTimeChoice").value);
  if ($("playTypeChoice")?.value === "lan" && !network.connected) {
    setMessage("CONNECT TO A LAN ROOM FIRST");
    netStatus("CONNECT BEFORE STARTING");
    $("lanControls")?.classList.remove("hidden");
    return;
  }
  initAudio();
  // Request fullscreen directly from the click gesture; browsers may decline if unsupported.
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  beginLoading(() => {
    resetGame();
    startCountdown();
  });
});

$("settingsBtn").addEventListener("click", () => {
  syncSettingsUI();
  showScreen("settings");
});

$("headerSettings").addEventListener("click", () => {
  syncSettingsUI();
  showScreen("settings");
});

$("customizeBtn").addEventListener("click", () => showScreen("customize"));
$("previewCustomize").addEventListener("click", () => showScreen("customize"));

document.querySelectorAll(".backBtn").forEach(button => {
  button.addEventListener("click", () => showScreen("menu"));
});

$("saveSettings").addEventListener("click", () => {
  settings.difficulty = $("difficulty").value;
  settings.volume = Number($("volume").value);
  settings.sound = $("soundToggle").checked;
  settings.sensitivity = Number($("sensitivity").value);
  settings.winScore = Number($("winScore").value);
  settings.crosshair = $("crosshairToggle").checked;
  if ($("modeChoice")) settings.gameMode = $("modeChoice").value;
  if ($("matchTimeChoice")) settings.matchDuration = Number($("matchTimeChoice").value);
  saveSettings();
  showScreen("menu");
});

$("volume").addEventListener("input", event => {
  $("volumeValue").textContent = event.target.value + "%";
});

$("sensitivity").addEventListener("input", event => {
  $("sensitivityValue").textContent = event.target.value + "%";
});

document.querySelectorAll(".swatch").forEach(button => {
  button.addEventListener("click", () => {
    settings.characterColor = button.dataset.color;
    $("customColor").value = settings.characterColor;
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
    button.classList.add("selected");
    updatePreviews();
  });
});

$("characterName").addEventListener("input", updatePreviews);
$("outfit").addEventListener("change", () => { settings.outfit = $("outfit").value; updatePreviews(); });
$("hatStyle").addEventListener("change", () => { settings.hatStyle = $("hatStyle").value; updatePreviews(); });
$("weaponType").addEventListener("change", () => {
  settings.weaponType = $("weaponType").value;
  const human = players.find(p => p.isHuman);
  if (human) human.ammo = (WEAPONS[settings.weaponType] || WEAPONS.rifle).ammo;
  updateHUD(); updatePreviews();
});
$("customColor").addEventListener("input", event => {
  settings.characterColor = event.target.value;
  document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("selected", s.dataset.color === settings.characterColor));
  updatePreviews();
});
$("weaponColor").addEventListener("change", () => { settings.weaponColor = $("weaponColor").value; updatePreviews(); });
$("saveCharacter").addEventListener("click", saveCharacter);

function updatePreviews() {
  if ($("previewName")) {
    const name = ($("characterName")?.value || settings.characterName).trim();
    $("previewName").textContent = name || "NIGHT RUNNER";
  }
  drawPreviewCanvas($("previewCanvas"));
  drawPreviewCanvas($("customCanvas"));
}

// Game mode selection
const modeDescriptions = {
  deathmatch: "Objective: score eliminations. Respawns enabled. Match time: choose 3, 5, 10 minutes or no limit.",
  ffa: "Objective: beat the AI on eliminations. Respawns enabled. Match time can be limited or disabled.",
  plant: "Objective: plant at Site A with E or defend and defuse. Round/bomb objectives apply even when the overall match clock is disabled.",
  elimination: "★ RECOMMENDED · Objective: wipe the enemy team. No respawns during a round; first to 3 rounds wins. Match clock can be disabled, but rounds still end when a team is eliminated."
};
const modeChoice = $("modeChoice");
if (modeChoice) {
  modeChoice.value = settings.gameMode || "deathmatch";
  $("modeDescription").textContent = modeDescriptions[modeChoice.value] || modeDescriptions.deathmatch;
  modeChoice.addEventListener("change", () => {
    settings.gameMode = modeChoice.value;
    $("modeDescription").textContent = modeDescriptions[settings.gameMode] || modeDescriptions.deathmatch;
    saveSettings();
  });
}

// Map selection: each choice changes both the battlefield layout and its palette.
const mapDescriptions = {
  dust2: "Classic desert tactical layout: long sightlines, mid control, tunnels, and A/B site courtyards.",
  mirage: "Sunset city blocks with tight corners, open mid lanes, and layered sandstone cover.",
  industrial: "A high-contrast warehouse yard with steel barriers, loading lanes, and hard cover.",
  forest: "Green terrain, timber cover, and a wide central lane.",
  desert: "Warm sand, sandstone barricades, and scattered ruins.",
  snow: "Cold blue terrain, icy barriers, and a frozen military base."
};
const mapChoice = $("mapChoice");
if (mapChoice) {
  mapChoice.value = settings.mapType || "forest";
  $("mapDescription").textContent = mapDescriptions[mapChoice.value] || mapDescriptions.forest;
  mapChoice.addEventListener("change", () => {
    settings.mapType = mapChoice.value;
    $("mapDescription").textContent = mapDescriptions[settings.mapType] || mapDescriptions.forest;
    makeCover(); saveSettings();
    if (screen === "game") draw();
  });
}

// Battle buttons
$("pauseBtn").addEventListener("click", () => {
  if (paused) resumeGame();
  else pauseGame();
});

$("resumeBtn").addEventListener("click", resumeGame);
$("restartBtn").addEventListener("click", () => {
  beginLoading(() => { resetGame(); startCountdown(); });
});

$("menuBtn").addEventListener("click", () => {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  running = false;
  paused = false;
  gameEnded = false;
  mouse.down = false;
  keys = {};
  $("gameOverlay").classList.add("hidden");
  $("gameScreen").classList.remove("is-fullscreen");
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  $("resumeBtn").classList.remove("hidden");
  $("restartBtn").classList.remove("hidden");
  $("menuBtn").classList.remove("hidden");
  showScreen("menu");
});

canvas.addEventListener("mousemove", event => {
  const point = canvasPoint(event);
  const factor = settings.sensitivity / 100;
  mouse.x = clamp(point.x * factor + mouse.x * (1 - factor), 0, W);
  mouse.y = clamp(point.y * factor + mouse.y * (1 - factor), 0, H);
});

canvas.addEventListener("mousedown", event => {
  if (event.button === 0) {
    initAudio();
    mouse.down = true;
  }
});

window.addEventListener("mouseup", event => {
  if (event.button === 0) mouse.down = false;
});

canvas.addEventListener("contextmenu", event => event.preventDefault());

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  const movementKey = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", ArrowUp: "arrowup", ArrowDown: "arrowdown", ArrowLeft: "arrowleft", ArrowRight: "arrowright" })[event.code];
  if (movementKey) keys[movementKey] = true;

  if (key === "escape" && screen === "game" && !gameEnded) {
    if (paused) resumeGame();
    else pauseGame();
    return;
  }

  if (key >= "1" && key <= "5" && screen === "game") {
    settings.weaponType = weaponOrder[Number(key) - 1];
    $("weaponType").value = settings.weaponType;
    const human = players.find(p => p.isHuman);
    if (human) human.ammo = WEAPONS[settings.weaponType].ammo;
    reloadTimer = 0;
    updateHUD(); updatePreviews();
  }
  if (key === "g" && screen === "game") throwGrenade();
  keys[key] = true;

  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    event.preventDefault();
  }

  if (key === "r") startReload();
});

window.addEventListener("keyup", event => {
  keys[event.key.toLowerCase()] = false;
  const movementKey = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", ArrowUp: "arrowup", ArrowDown: "arrowdown", ArrowLeft: "arrowleft", ArrowRight: "arrowright" })[event.code];
  if (movementKey) keys[movementKey] = false;
});

window.addEventListener("blur", () => {
  keys = {};
  mouse.down = false;
});

// Start the app
loadSettings();
syncSettingsUI();
makeCover();
showScreen("menu");
beginLoading();
lastTime = performance.now();
requestAnimationFrame(loop);
