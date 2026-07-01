"use strict";
/* =============================================================
   NEON INVADERS  オンライン対戦サーバー（最小構成）
   ============================================================= */
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

function makeRoomId(){
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

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
    socket.emit("roomJoined", { roomId, role: 2 });
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
