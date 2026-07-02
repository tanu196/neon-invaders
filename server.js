"use strict";
/* =============================================================
   NEON INVADERS サーバー
   - public を配信
   - Socket.IO でオンライン対戦
   - 全プレイヤー共通ランキング（モード別・1人1件=自己ベスト）
       ・環境変数 DATABASE_URL があれば Postgres に永続保存（再起動でも消えない）
       ・無ければ rankings.json に保存（ローカル開発用のフォールバック）
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

/* ===== ランキング設定 ===== */
const MODES = ["easy", "normal", "hard"];
const DISPLAY = 10;    // 画面に返す件数（上位10件）
const MAX_KEEP = 20;   // ファイル保存時に残す最大件数

// DATABASE_URL があればDBモード、無ければファイルモード
const DATABASE_URL = process.env.DATABASE_URL;
const useDB = !!DATABASE_URL;

let pool = null;
if(useDB){
  const { Pool } = require("pg");   // DBを使うときだけ読み込む
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },   // Neon/Supabase等はSSL必須
  });
  // テーブル作成（mode+name を主キーにして「1人1件」を保証）
  pool.query(`
    CREATE TABLE IF NOT EXISTS rankings (
      mode text NOT NULL,
      name text NOT NULL,
      score integer NOT NULL,
      updated_at bigint NOT NULL,
      PRIMARY KEY (mode, name)
    )
  `).then(() => console.log("DBランキング準備OK"))
    .catch((e) => console.log("DB初期化エラー:", e.message));
}

/* ===== ファイルモード（フォールバック用） ===== */
const RANK_FILE = path.join(__dirname, "rankings.json");
function loadRankings(){
  try {
    const data = JSON.parse(fs.readFileSync(RANK_FILE, "utf8"));
    for(const m of MODES) if(!Array.isArray(data[m])) data[m] = [];
    return data;
  } catch(e){
    return { easy: [], normal: [], hard: [] };
  }
}
function saveRankings(data){
  try { fs.writeFileSync(RANK_FILE, JSON.stringify(data)); }
  catch(e){ console.log("ランキング保存失敗:", e.message); }
}
let fileRankings = useDB ? null : loadRankings();

/* ===== ランキングの取得・登録（DB/ファイル共通の窓口） ===== */
// 指定モードの上位を取得する
function getRanking(mode){
  if(useDB){
    return pool.query(
      "SELECT name, score FROM rankings WHERE mode = $1 ORDER BY score DESC LIMIT $2",
      [mode, DISPLAY]
    ).then((r) => r.rows);
  }
  return Promise.resolve(fileRankings[mode].slice(0, DISPLAY));
}
// スコアを登録する（同じ名前は自己ベストだけ残す＝1人1件）
function addScore(mode, name, score){
  if(useDB){
    // 同じ mode+name があれば高いほうのスコアに更新（自己ベスト）
    return pool.query(
      `INSERT INTO rankings (mode, name, score, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mode, name)
       DO UPDATE SET score = GREATEST(rankings.score, EXCLUDED.score),
                     updated_at = EXCLUDED.updated_at`,
      [mode, name, score, Date.now()]
    ).then(() => getRanking(mode));
  }
  // ファイルモード：同名があれば高い方に更新、無ければ追加
  const list = fileRankings[mode];
  const found = list.find((r) => r.name === name);
  if(found){ if(score > found.score){ found.score = score; found.at = Date.now(); } }
  else { list.push({ name: name, score: score, at: Date.now() }); }
  list.sort((a, b) => b.score - a.score);
  fileRankings[mode] = list.slice(0, MAX_KEEP);
  saveRankings(fileRankings);
  return Promise.resolve(fileRankings[mode].slice(0, DISPLAY));
}

/* ===== ランキングAPI ===== */
app.get("/api/ranking", async (req, res) => {
  const mode = MODES.includes(req.query.mode) ? req.query.mode : "normal";
  try { res.json({ mode: mode, list: await getRanking(mode) }); }
  catch(e){ console.log("ランキング取得エラー:", e.message); res.status(500).json({ mode: mode, list: [] }); }
});
app.post("/api/score", async (req, res) => {
  const body = req.body || {};
  const mode = MODES.includes(body.mode) ? body.mode : "normal";
  const name = String(body.name || "ゲスト").slice(0, 12).trim() || "ゲスト";
  const score = Math.max(0, Math.floor(Number(body.score) || 0));
  try { res.json({ mode: mode, list: await addScore(mode, name, score) }); }
  catch(e){ console.log("スコア登録エラー:", e.message); res.status(500).json({ mode: mode, list: [] }); }
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
