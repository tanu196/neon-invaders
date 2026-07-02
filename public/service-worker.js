"use strict";
/* =============================================================
   Service Worker（PWA用）
   - 必要なファイルをキャッシュし、オフラインでもタイトル画面を表示できるようにする
   - オンライン対戦の通信(/socket.io)はキャッシュしない（常に最新・接続が必要）
   ============================================================= */

// キャッシュの名前。ファイルを更新したら v3 → v4 と数字を上げると確実に更新される
const CACHE = "neon-invaders-v7";

// 必ずキャッシュしたい重要ファイル（1つでも失敗するとSWは止まる）
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json"
];

// アイコンは任意（まだ作っていなくてもエラーにしない）
const ICON_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// インストール：重要ファイルは確実に、アイコンは可能なら保存する
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(CORE_ASSETS).then(() => {
        // アイコンが無くても全体が失敗しないよう allSettled を使う
        return Promise.allSettled(ICON_ASSETS.map((url) => cache.add(url)));
      });
    }).then(() => self.skipWaiting())
  );
});

// 有効化：古いバージョンのキャッシュを削除する
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 取得：オンライン対戦の通信はキャッシュせず、それ以外はキャッシュ優先で返す
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Socket.IO の通信は常にネットワークを使う（キャッシュしない）
  if(url.pathname.startsWith("/socket.io")) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).catch(() => caches.match("./index.html"));
    })
  );
});
