"use strict";
/* =============================================================
   NEON INVADERS サーバー
   - public を配信
   - Socket.IO でオンライン対戦
   - 追加：全プレイヤー共通ランキング（モード別）をファイルに保存するAPI
   ============================================================= */
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());                                    // JSONボディを読む
app.use(express.static(path.join(__dirname, "public")));

/* ===== 全プレイヤー共通ランキング（モード別） ===== */
const RANK_FILE = path.join(__dirname, "rankings.json");
const MODES = ["easy", "normal", "hard"];
const MAX_KEEP = 20;

// ファイルから読み込む（無ければ空の構造を返す）
function loadRankings(){
  try {
    const data = JSON.parse(fs.readFileSync(RANK_FILE, "utf8"));
    for(const m of MODES) if(!Array.isArray(data[m])) data[m] = [];
    return data;
  } catch(e){
    return { easy: [], normal: [], hard: [] };
  }
}
// ファイルに保存する
function saveRankings(data){
  try { fs.writeFileSync(RANK_FILE, JSON.stringify(data)); }
  catch(e){ console.log("ランキング保存失敗:", e.message); }
}

let rankings = loadRankings();

// 指定モードの上位10件を返す
app.get("/api/ranking", (req, res) => {
  const mode = MODES.includes(req.query.mode) ? req.query.mode : "normal";
  res.json({ mode: mode, list: rankings[mode].slice(0, 10) });
});

// スコアを登録して、そのモードの上位10件を返す
app.post("/api/score", (req, res) => {
  const body = req.body || {};
  const mode = MODES.includes(body.mode) ? body.mode : "normal";
  let name = String(body.name || "ゲスト").slice(0, 12).trim() || "ゲスト";
  const score = Math.max(0, Math.floor(Number(body.score) || 0));
  rankings[mode].push({ name: name, score: score, at: Date.now() });
  rankings[mode].sort((a, b) => b.score - a.score);
  rankings[mode] = rankings[mode].slice(0, MAX_KEEP);
  saveRankings(rankings);
  res.json({ mode: mode, list: rankings[mode].slice(0, 10) });
});

/* ===== オンライン対戦（Socket.IO） ===== */
const rooms = {};
function makeRoomId(){ return Math.random().toString(36).substring(2, 6).toUpperCase(); }

io.on("connection", (socket) => {
  console.log("接続:", socket.id);

  socket.on("createRoom", () => {
    let id = makeRoomId();
    while(rooms[id]) id = makeRoomId();
    rooms[id] = { players: [socket.id] };
    socket.join(id);
    socket.data.roomId = id;
    socket.data.role = 1;
    socket.emit("roomCreated", { roomId: id, role: 1 });
    console.log("ルーム作成:", id);
  });

  socket.on("joinRoom", (roomId) => {
    roomId = String(roomId || "").toUpperCase().trim();
    const room = rooms[roomId];
    if(!room){ socket.emit("joinError", "ルームが見つかりません"); return; }
    if(room.players.length >= 2){ socket.emit("joinError", "そのルームは満員です"); return; }
    room.players.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 2;
    socket.emit("roomJoined", { roomId: roomId, role: 2 });
    io.to(roomId).emit("bothReady");
    startCountdown(roomId);
    console.log("ルーム参加:", roomId);
  });

  socket.on("state", (data) => {
    const roomId = socket.data.roomId;
    if(roomId) socket.to(roomId).emit("opponentState", data);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if(roomId && rooms[roomId]){
      socket.to(roomId).emit("opponentLeft");
      delete rooms[roomId];
      console.log("ルーム解散:", roomId);
    }
  });
});

function startCountdown(roomId){
  let n = 3;
  io.to(roomId).emit("countdown", n);
  const timer = setInterval(() => {
    n--;
    if(n > 0){
      io.to(roomId).emit("countdown", n);
    } else {
      io.to(roomId).emit("countdown", 0);
      clearInterval(timer);
      io.to(roomId).emit("matchStart", { duration: 60 });
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("サーバー起動: http://localhost:" + PORT);
});
