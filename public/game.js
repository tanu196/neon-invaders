"use strict";
/* =============================================================
   NEON INVADERS  本体スクリプト
   構成：
   [A] 共通ヘルパー / 設定 / 音 / 入力
   [B] 1人プレイ（既存機能：そのまま維持）
   [C] 画面遷移とメニュー
   [D] オンライン対戦（最小構成：位置とスコアの同期）
   [E] PWA登録 と 起動処理
   ============================================================= */

/* =============================================================
   [A] 共通部分
   ============================================================= */
const $  = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

function rand(min, max){ return Math.random() * (max - min) + min; }
function randInt(min, max){ return Math.floor(rand(min, max + 1)); }
function hit(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

const DIFFICULTY = {
  easy:   { lives: 5, enemySpeed: 0.75, fireRate: 0.55, bulletSpeed: 0.8, label: "EASY"   },
  normal: { lives: 3, enemySpeed: 1.0,  fireRate: 1.0,  bulletSpeed: 1.0, label: "NORMAL" },
  hard:   { lives: 2, enemySpeed: 1.35, fireRate: 1.6,  bulletSpeed: 1.25, label: "HARD"  },
};
const SKINS = ["#2ef2ff", "#45ff8f", "#ffe14d", "#ff7a59", "#b06bff", "#ff3df0"];
const ENEMY_TYPES = {
  normal: { hp: 1, score: 100,  color: "#2ef2ff", w: 30, h: 22 },
  tough:  { hp: 3, score: 250,  color: "#ff3df0", w: 34, h: 26 },
  rare:   { hp: 1, score: 1000, color: "#ffe14d", w: 28, h: 22 },
};
const PLAYER_Y = H - 70;
const MAX_STAGE = 100;   // 最大ステージ。ここをクリアするとゲーム終了（クリア）

const Sound = {
  ctx: null, enabled: true,
  init(){
    if(!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC) this.ctx = new AC();
    }
    if(this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  beep(freq, dur, type = "square", vol = 0.15){
    if(!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur);
  },
  shoot(){ this.beep(880, 0.08, "square", 0.08); },
  explosion(){ this.beep(140, 0.25, "sawtooth", 0.18); this.beep(90, 0.3, "triangle", 0.12); },
  hit(){ this.beep(220, 0.18, "sawtooth", 0.2); },
  power(){ this.beep(660, 0.12, "sine", 0.2); this.beep(990, 0.12, "sine", 0.18); },
  stage(){ this.beep(523, 0.12, "sine"); this.beep(784, 0.16, "sine"); },
  count(){ this.beep(700, 0.1, "sine", 0.2); },
};

const input = { left: false, right: false, fire: false };
window.addEventListener("keydown", (e) => {
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
  switch(e.key){
    case "ArrowLeft": case "a": case "A": input.left  = true; break;
    case "ArrowRight":case "d": case "D": input.right = true; break;
    case " ": input.fire = true; break;
    case "p": case "P": togglePause(); break;
  }
});
window.addEventListener("keyup", (e) => {
  switch(e.key){
    case "ArrowLeft": case "a": case "A": input.left  = false; break;
    case "ArrowRight":case "d": case "D": input.right = false; break;
    case " ": input.fire = false; break;
  }
});
function bindPad(el, key){
  const on  = (e) => { e.preventDefault(); input[key] = true;  Sound.init(); };
  const off = (e) => { e.preventDefault(); input[key] = false; };
  el.addEventListener("touchstart", on,  { passive:false });
  el.addEventListener("touchend",   off, { passive:false });
  el.addEventListener("touchcancel",off, { passive:false });
  el.addEventListener("mousedown", on);
  el.addEventListener("mouseup",   off);
  el.addEventListener("mouseleave",off);
}
bindPad($("pad-left"),  "left");
bindPad($("pad-right"), "right");
bindPad($("pad-fire"),  "fire");

function makeStars(){
  const stars = [];
  for(let i = 0; i < 70; i++){
    stars.push({ x: rand(0, W), y: rand(0, H), size: rand(0.5, 2.2), speed: rand(0.3, 1.6) });
  }
  return stars;
}

let scene = "menu";
let settings = { difficulty: "normal", skin: SKINS[0] };

// ===== 追加：移動速度・音・操作ボタン表示の設定（localStorageに保存） =====
const SETTINGS_KEY = "neon-invaders-settings";
// タッチ端末（スマホ）は初期値を少し遅めの4、それ以外は5にする（おすすめは5）
const IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
settings.moveSpeed = IS_TOUCH ? 4 : 5;   // 1〜10段階
settings.showControls = true;            // スマホ操作ボタンを表示するか
settings.playerName = "";                // ランキング用のプレイヤー名（空なら「ゲスト」）
// 保存された設定を読み込む
function loadSettings(){
  try{
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if(saved){
      if(typeof saved.moveSpeed === "number") settings.moveSpeed = clamp(saved.moveSpeed, 1, 10);
      if(typeof saved.sound === "boolean") Sound.enabled = saved.sound;
      if(typeof saved.showControls === "boolean") settings.showControls = saved.showControls;
      if(typeof saved.playerName === "string") settings.playerName = saved.playerName;
    }
  }catch(e){}
}
// 設定を保存する
function saveSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    moveSpeed: settings.moveSpeed,
    sound: Sound.enabled,
    showControls: settings.showControls,
    playerName: settings.playerName,
  }));
}
// スライダーの値(1〜10)を実際の移動ピクセル数に変換（5でちょうど良い速さ）
function moveSpeedPixels(){ return settings.moveSpeed * 0.7; }

/* =============================================================
   [B] 1人プレイ
   ============================================================= */
let state;

function newGame(){
  const d = DIFFICULTY[settings.difficulty];
  state = {
    player: { x: W/2 - 18, y: PLAYER_Y, w: 36, h: 24, speed: 5, color: settings.skin },
    bullets: [], enemyBullets: [], enemies: [], boss: null,
    powerups: [], explosions: [], shields: [], stars: makeStars(),
    lives: d.lives, score: 0, stage: 1,
    rapidTime: 0, doubleTime: 0, barrierTime: 0,
    combo: 0, comboTimer: 0,
    fireCooldown: 0, enemyDir: 1,
    introTimer: 0, introText: "", flashTimer: 0, movePattern: 0,
  };
}

function makeShields(){
  const shields = [];
  const blocks = 4, gap = W / blocks;
  for(let b = 0; b < blocks; b++){
    const baseX = gap * b + gap/2 - 24;
    for(let r = 0; r < 2; r++) for(let c = 0; c < 4; c++)
      shields.push({ x: baseX + c*12, y: H - 180 + r*12, w: 12, h: 12, hp: 3 });
  }
  return shields;
}

function setupStage(){
  const s = state;
  s.enemies = []; s.boss = null; s.enemyBullets = []; s.enemyDir = 1;
  s.movePattern = (s.stage - 1) % 3;
  s.shields = makeShields();
  if(s.stage % 5 === 0){
    s.boss = {
      x: W/2 - 50, y: 60, w: 100, h: 60,
      hp: 30 + s.stage * 6, maxHp: 30 + s.stage * 6,
      dir: 1, speed: 1.4 + s.stage * 0.05, shootTimer: 0, color: "#ff3df0",
    };
    s.introText = "BOSS STAGE!";
  } else {
    const cols = 10;
    const rows = Math.min(3 + Math.floor(s.stage / 2), 5);
    const offsetX = (W - cols * 46) / 2 + 8;
    for(let r = 0; r < rows; r++) for(let c = 0; c < cols; c++){
      let type = "normal";
      if(r === 0 && Math.random() < 0.5) type = "tough";
      if(Math.random() < 0.06) type = "rare";
      const def = ENEMY_TYPES[type];
      s.enemies.push({
        type, hp: def.hp, score: def.score, color: def.color, w: def.w, h: def.h,
        baseX: offsetX + c * 46, baseY: 70 + r * 40,
        x: offsetX + c * 46, y: 70 + r * 40,
        swayPhase: rand(0, Math.PI * 2), alive: true,
      });
    }
    s.introText = "STAGE " + s.stage;
  }
  scene = "intro"; s.introTimer = 1.6; Sound.stage();
}

function updatePlayer(dt){
  const p = state.player;
  const px = moveSpeedPixels();          // 設定した移動速度（ピクセル/フレーム）
  if(input.left)  p.x -= px;
  if(input.right) p.x += px;
  // clamp(=Math.max/Math.min相当)で画面外に出ないようにする
  p.x = clamp(p.x, 4, W - p.w - 4);
  state.fireCooldown -= dt;
  if(input.fire && state.fireCooldown <= 0){
    const rapid = state.rapidTime > 0;
    state.fireCooldown = rapid ? 0.12 : 0.32;
    if(state.doubleTime > 0){ spawnBullet(p.x + 6, p.y); spawnBullet(p.x + p.w - 10, p.y); }
    else spawnBullet(p.x + p.w/2 - 2, p.y);
    Sound.shoot();
  }
}
function spawnBullet(x, y){ state.bullets.push({ x, y, w: 4, h: 12, speed: 9 }); }

function updateBullets(){
  const s = state;
  for(const b of s.bullets) b.y -= b.speed;
  s.bullets = s.bullets.filter(b => b.y + b.h > 0);
  const bSpeed = DIFFICULTY[settings.difficulty].bulletSpeed;
  for(const b of s.enemyBullets) b.y += b.speed * bSpeed;
  s.enemyBullets = s.enemyBullets.filter(b => b.y < H);
}

function updateEnemies(dt){
  const s = state;
  const alive = s.enemies.filter(e => e.alive);
  if(alive.length === 0 && !s.boss) return;
  const d = DIFFICULTY[settings.difficulty];
  const speedUp = 1 + (1 - alive.length / Math.max(1, s.enemies.length)) * 1.5;
  const baseSpeed = (0.6 + s.stage * 0.12) * d.enemySpeed * speedUp;
  // 端の判定は「揺れを含む実際のx」ではなく、隊列位置 baseX で行う（揺れ幅ぶんの余白14pxを確保）
  // こうすることでステージ2の横揺れでも端条件が連続成立せず、降下は壁に触れるたび1回だけになる
  const EDGE_MARGIN = 14;
  let hitEdge = false;
  for(const e of alive){ if(e.baseX <= EDGE_MARGIN || e.baseX + e.w >= W - EDGE_MARGIN){ hitEdge = true; break; } }
  if(hitEdge){ s.enemyDir *= -1; for(const e of s.enemies){ if(e.alive) e.baseY += 18; } }
  for(const e of alive){
    e.baseX += s.enemyDir * baseSpeed; e.swayPhase += dt * 3;
    if(s.movePattern === 0){ e.x = e.baseX; e.y = e.baseY; }
    else if(s.movePattern === 1){ e.x = e.baseX + Math.sin(e.swayPhase) * 10; e.y = e.baseY; }
    else { e.x = e.baseX; e.y = e.baseY + Math.sin(e.swayPhase) * 8; }
    if(e.y + e.h >= PLAYER_Y){ gameOver("敵に侵略されました…"); return; }
    const fireChance = 0.0006 * d.fireRate * (1 + s.stage * 0.15);
    if(Math.random() < fireChance)
      s.enemyBullets.push({ x: e.x + e.w/2 - 2, y: e.y + e.h, w: 4, h: 10, speed: 4 });
  }
}

function updateBoss(dt){
  const s = state, boss = s.boss;
  if(!boss) return;
  boss.x += boss.dir * boss.speed;
  if(boss.x <= 4 || boss.x + boss.w >= W - 4) boss.dir *= -1;
  boss.shootTimer -= dt;
  if(boss.shootTimer <= 0){
    boss.shootTimer = 1.1 - Math.min(0.6, s.stage * 0.03);
    const cx = boss.x + boss.w/2;
    for(const vx of [-1.5, 0, 1.5])
      s.enemyBullets.push({ x: cx - 2, y: boss.y + boss.h, w: 5, h: 12, speed: 4, vx });
  }
}

function maybeDropPowerup(x, y){
  if(Math.random() < 0.12){
    const kinds = ["rapid", "double", "barrier"];
    state.powerups.push({ x: x - 9, y, w: 18, h: 18, speed: 1.8, kind: kinds[randInt(0, 2)] });
  }
}
function updatePowerups(dt){
  const s = state, p = s.player;
  for(const it of s.powerups) it.y += it.speed;
  s.powerups = s.powerups.filter(it => {
    if(hit(it, p)){
      if(it.kind === "rapid")   s.rapidTime  = 8;
      if(it.kind === "double")  s.doubleTime = 10;
      if(it.kind === "barrier") s.barrierTime= 7;
      Sound.power(); return false;
    }
    return it.y < H;
  });
  s.rapidTime   = Math.max(0, s.rapidTime   - dt);
  s.doubleTime  = Math.max(0, s.doubleTime  - dt);
  s.barrierTime = Math.max(0, s.barrierTime - dt);
}

function checkCollisions(){
  const s = state, p = s.player;
  for(const b of s.bullets){
    for(const e of s.enemies){
      if(!e.alive) continue;
      if(hit(b, e)){
        e.hp--; b.dead = true;
        if(e.hp <= 0){
          e.alive = false; addScore(e.score); addCombo();
          spawnExplosion(e.x + e.w/2, e.y + e.h/2, e.color);
          maybeDropPowerup(e.x + e.w/2, e.y); Sound.explosion();
        } else Sound.hit();
        break;
      }
    }
  }
  if(s.boss){
    for(const b of s.bullets){
      if(b.dead) continue;
      if(hit(b, s.boss)){
        s.boss.hp--; b.dead = true; spawnExplosion(b.x, b.y, "#ffe14d", 4);
        if(s.boss.hp <= 0){
          for(let i = 0; i < 14; i++)
            spawnExplosion(s.boss.x + rand(0, s.boss.w), s.boss.y + rand(0, s.boss.h), "#ff3df0");
          addScore(5000); Sound.explosion(); s.boss = null; break;   // ボスを消したら弾ループを抜ける（null参照でのフリーズ防止）
        }
      }
    }
  }
  for(const blk of s.shields){
    for(const b of s.bullets){ if(!b.dead && hit(b, blk)){ b.dead = true; blk.hp--; } }
    for(const b of s.enemyBullets){ if(!b.dead && hit(b, blk)){ b.dead = true; blk.hp--; } }
  }
  s.shields = s.shields.filter(blk => blk.hp > 0);
  s.bullets = s.bullets.filter(b => !b.dead);
  for(const b of s.enemyBullets){
    if(b.vx) b.x += b.vx;
    if(hit(b, p)){
      b.dead = true;
      if(s.barrierTime > 0){ spawnExplosion(p.x + p.w/2, p.y, "#45ff8f", 5); Sound.hit(); }
      else damagePlayer();
    }
  }
  s.enemyBullets = s.enemyBullets.filter(b => !b.dead);
}
function damagePlayer(){
  const s = state;
  s.lives--; s.combo = 0; s.comboTimer = 0; s.flashTimer = 0.3;
  Sound.explosion(); spawnExplosion(s.player.x + s.player.w/2, s.player.y, s.player.color);
  if(s.lives <= 0) gameOver("機体が破壊されました…");
}
function addScore(base){
  const mult = Math.min(8, 1 + Math.floor(state.combo / 3));
  state.score += base * mult;
}
function addCombo(){ state.combo++; state.comboTimer = 2.2; }
function updateCombo(dt){
  if(state.comboTimer > 0){ state.comboTimer -= dt; if(state.comboTimer <= 0) state.combo = 0; }
}
function spawnExplosion(x, y, color, count = 10){
  for(let i = 0; i < count; i++){
    const a = rand(0, Math.PI * 2), sp = rand(1, 4);
    state.explosions.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 1, color });
  }
}
function updateExplosions(dt){
  for(const p of state.explosions){ p.x += p.vx; p.y += p.vy; p.life -= dt * 2.2; }
  state.explosions = state.explosions.filter(p => p.life > 0);
}
function updateStars(){
  for(const st of state.stars){ st.y += st.speed; if(st.y > H){ st.y = 0; st.x = rand(0, W); } }
}
function checkStageClear(){
  const s = state;
  if(!s.enemies.some(e => e.alive) && !s.boss){
    if(s.stage >= MAX_STAGE){                       // 最終ステージ(100)をクリアしたら終了
      gameOver("STAGE " + MAX_STAGE + " 到達！ おめでとう！", true);
      return;
    }
    s.stage++; setupStage();
  }
}
function update(dt){
  updateStars(); updatePlayer(dt); updateBullets();
  updateEnemies(dt); updateBoss(dt); updatePowerups(dt);
  updateExplosions(dt); updateCombo(dt); checkCollisions(); checkStageClear();
  if(state.flashTimer > 0) state.flashTimer -= dt;
}

function neon(color, blur = 12){ ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color; ctx.strokeStyle = color; }
function resetShadow(){ ctx.shadowBlur = 0; }
function drawStarsBg(stars){
  ctx.fillStyle = "#02030a"; ctx.fillRect(0, 0, W, H);
  for(const st of stars){
    ctx.globalAlpha = clamp(st.size / 2.2, 0.2, 1);
    ctx.fillStyle = "#aab8ff"; ctx.fillRect(st.x, st.y, st.size, st.size);
  }
  ctx.globalAlpha = 1;
}
function drawBackground(){ drawStarsBg(state.stars); }
function drawShip(x, y, w, h, color, up = true){
  neon(color, 14);
  ctx.beginPath();
  if(up){ ctx.moveTo(x + w/2, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); }
  else  { ctx.moveTo(x + w/2, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); }
  ctx.closePath(); ctx.fill(); resetShadow();
}
function drawPlayer(){
  const p = state.player;
  drawShip(p.x, p.y, p.w, p.h, p.color, true);
  if(state.barrierTime > 0){
    neon("#45ff8f", 16);
    ctx.globalAlpha = 0.5 + Math.sin(performance.now()/120)*0.2;
    ctx.lineWidth = 2; ctx.beginPath();
    ctx.arc(p.x + p.w/2, p.y + p.h/2, 28, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1; resetShadow();
  }
}
function drawEnemies(){
  for(const e of state.enemies){
    if(!e.alive) continue;
    neon(e.color, 10);
    if(e.type === "tough"){ ctx.fillRect(e.x, e.y, e.w, e.h); }
    else if(e.type === "rare"){
      ctx.beginPath();
      ctx.moveTo(e.x + e.w/2, e.y); ctx.lineTo(e.x + e.w, e.y + e.h/2);
      ctx.lineTo(e.x + e.w/2, e.y + e.h); ctx.lineTo(e.x, e.y + e.h/2);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = "#02030a";
      ctx.fillRect(e.x + 6, e.y + 7, 5, 5); ctx.fillRect(e.x + e.w - 11, e.y + 7, 5, 5);
    }
  }
  resetShadow();
}
function drawBoss(){
  const boss = state.boss; if(!boss) return;
  neon(boss.color, 18); ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
  ctx.fillStyle = "#02030a";
  ctx.fillRect(boss.x + 20, boss.y + 20, 12, 12);
  ctx.fillRect(boss.x + boss.w - 32, boss.y + 20, 12, 12);
  resetShadow();
  const ratio = boss.hp / boss.maxHp;
  ctx.fillStyle = "#330"; ctx.fillRect(boss.x, boss.y - 10, boss.w, 5);
  ctx.fillStyle = "#ff3df0"; ctx.fillRect(boss.x, boss.y - 10, boss.w * ratio, 5);
}
function drawBullets(){
  neon("#ffffff", 8); for(const b of state.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
  neon("#ff6b6b", 8); for(const b of state.enemyBullets) ctx.fillRect(b.x, b.y, b.w, b.h);
  resetShadow();
}
function drawShields(){
  for(const blk of state.shields){
    const c = blk.hp === 3 ? "#45ff8f" : blk.hp === 2 ? "#ffe14d" : "#ff7a59";
    neon(c, 6); ctx.fillRect(blk.x, blk.y, blk.w - 1, blk.h - 1);
  }
  resetShadow();
}
function drawPowerups(){
  for(const it of state.powerups){
    const c = it.kind === "rapid" ? "#2ef2ff" : it.kind === "double" ? "#ffe14d" : "#45ff8f";
    const label = it.kind === "rapid" ? "R" : it.kind === "double" ? "D" : "B";
    neon(c, 12); ctx.fillRect(it.x, it.y, it.w, it.h); resetShadow();
    ctx.fillStyle = "#02030a"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(label, it.x + it.w/2, it.y + it.h - 4);
  }
}
function drawExplosionsList(list){
  for(const p of list){
    ctx.globalAlpha = clamp(p.life, 0, 1);
    neon(p.color, 10); ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1; resetShadow();
}
function drawHUD(){
  ctx.textAlign = "left"; ctx.font = "bold 16px sans-serif";
  neon("#2ef2ff", 6); ctx.fillText("SCORE " + state.score, 10, 24); resetShadow();
  ctx.textAlign = "center"; ctx.fillStyle = "#9fb6ff"; ctx.fillText("STAGE " + state.stage, W/2, 24);
  ctx.textAlign = "right"; neon("#ff3df0", 6);
  let lifeStr = ""; for(let i = 0; i < state.lives; i++) lifeStr += "♥";
  ctx.fillText(lifeStr || " ", W - 10, 24); resetShadow();
  if(state.combo >= 2){
    const mult = Math.min(8, 1 + Math.floor(state.combo / 3));
    ctx.textAlign = "center"; neon("#ffe14d", 10); ctx.font = "bold 18px sans-serif";
    ctx.fillText(state.combo + " COMBO  x" + mult, W/2, 50); resetShadow();
  }
  let px = 10; ctx.textAlign = "left"; ctx.font = "12px sans-serif";
  const showTimer = (t, label, color) => { if(t > 0){ ctx.fillStyle = color; ctx.fillText(label + " " + t.toFixed(1) + "s", px, H - 8); px += 86; } };
  showTimer(state.rapidTime, "連射", "#2ef2ff");
  showTimer(state.doubleTime, "2連弾", "#ffe14d");
  showTimer(state.barrierTime, "バリア", "#45ff8f");
}
function drawLowHpWarning(){
  if(state.lives === 1){
    const a = (Math.sin(performance.now()/150) + 1) / 2 * 0.35;
    ctx.fillStyle = "rgba(255,0,40," + a.toFixed(3) + ")"; ctx.fillRect(0, 0, W, H);
  }
  if(state.flashTimer > 0){
    ctx.fillStyle = "rgba(255,255,255," + (state.flashTimer * 0.6).toFixed(2) + ")"; ctx.fillRect(0, 0, W, H);
  }
}
function drawIntro(){
  const t = state.introTimer; ctx.globalAlpha = clamp(t, 0, 1);
  ctx.textAlign = "center"; neon("#2ef2ff", 20); ctx.font = "bold 40px sans-serif";
  ctx.fillText(state.introText, W/2, H/2); resetShadow(); ctx.globalAlpha = 1;
}
function draw(){
  drawBackground(); drawShields(); drawEnemies(); drawBoss(); drawPlayer();
  drawBullets(); drawPowerups(); drawExplosionsList(state.explosions);
  drawHUD(); drawLowHpWarning();
  if(scene === "intro") drawIntro();
}

/* =============================================================
   [C] 画面遷移とメニュー
   ============================================================= */
const OVERLAYS = ["screen-name","screen-menu","screen-solo","screen-howto","screen-settings","screen-online","screen-result","screen-pause","screen-over"];
function showScreen(id){
  OVERLAYS.forEach(s => $(s).classList.toggle("hidden", s !== id));
  document.body.classList.add("overlay-open");     // オーバーレイ表示中の目印（横画面で操作ボタンを隠す用）
}
function hideAllScreens(){
  OVERLAYS.forEach(s => $(s).classList.add("hidden"));
  document.body.classList.remove("overlay-open");
}

function startGame(startStage){
  Sound.init(); newGame();
  if(typeof startStage === "number") state.stage = startStage;   // 裏コマンド用：開始ステージを上書き（通常は1）
  setupStage(); hideAllScreens();
}
function togglePause(){
  if(scene === "playing"){ scene = "paused"; showScreen("screen-pause"); }
  else if(scene === "paused"){ scene = "playing"; $("screen-pause").classList.add("hidden"); }
}
function gameOver(reason, isClear){
  scene = "over"; saveScore(state.score);
  // 見出しをクリア/ゲームオーバーで切り替える（毎回設定して元に戻す）
  const overTitle = $("screen-over").querySelector(".title");
  if(isClear){
    overTitle.textContent = "ALL CLEAR!";
    overTitle.style.color = "var(--neon-green)";
    overTitle.style.textShadow = "0 0 12px var(--neon-green)";
  } else {
    overTitle.textContent = "GAME OVER";
    overTitle.style.color = "var(--neon-pink)";
    overTitle.style.textShadow = "0 0 12px var(--neon-pink)";
  }
  $("over-reason").textContent = reason;
  $("over-score").textContent = state.score;
  $("over-best").textContent = "HI-SCORE: " + getHighScore();
  renderRanking("ranking-over"); showScreen("screen-over");
  // 全プレイヤー共通ランキングへ登録し、そのモードの上位を表示
  const gmode = settings.difficulty;
  submitGlobalScore(gmode, state.score).then(() => loadGlobalRanking(gmode, "ranking-global-over"));
}
function goTitle(){
  scene = "menu"; showScreen("screen-menu"); renderRanking("ranking-start");
  loadGlobalRanking(globalMode, "ranking-global-menu");   // 全国ランキングも更新
}

const STORE_KEY = "neon-invaders-ranking";
function loadRanking(){ try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch(e){ return []; } }
function saveScore(score){
  const list = loadRanking(); list.push(score); list.sort((a, b) => b - a);
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 5)));
}
function getHighScore(){ const list = loadRanking(); return list.length ? list[0] : 0; }
function renderRanking(elementId){
  const list = loadRanking(); const ol = $(elementId); ol.innerHTML = "";
  if(list.length === 0){ ol.innerHTML = "<li><span>—</span><span>記録なし</span></li>"; return; }
  list.forEach((sc, i) => {
    const li = document.createElement("li");
    li.innerHTML = "<span>" + (i+1) + "位</span><span>" + sc + "</span>";
    ol.appendChild(li);
  });
}

// ===== 全プレイヤー共通ランキング（サーバー保存・モード別） =====
let globalMode = "normal";   // メニューで表示中のモード

// サーバーに自分のスコアを送る（1人プレイのゲームオーバー時）
function submitGlobalScore(mode, score){
  const name = settings.playerName || "ゲスト";
  return fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: mode, name: name, score: score }),
  }).then(r => r.json()).catch(() => null);
}

// サーバーから共通ランキングを取得して表示する
function loadGlobalRanking(mode, elementId){
  const ol = $(elementId);
  if(ol) ol.innerHTML = "<li><span>…</span><span>読込中</span></li>";
  return fetch("/api/ranking?mode=" + encodeURIComponent(mode))
    .then(r => r.json())
    .then(data => renderGlobalRanking(elementId, data.list))
    .catch(() => { if(ol) ol.innerHTML = "<li><span>—</span><span>サーバー未接続</span></li>"; });
}

// 取得したランキングを画面に並べる
function renderGlobalRanking(elementId, list){
  const ol = $(elementId); if(!ol) return;
  ol.innerHTML = "";
  if(!list || list.length === 0){ ol.innerHTML = "<li><span>—</span><span>まだ記録がありません</span></li>"; return; }
  list.forEach((row, i) => {
    const li = document.createElement("li");
    const nm = row.name || "ゲスト";
    li.innerHTML = "<span>" + (i+1) + "位 " + nm + "</span><span>" + row.score + "</span>";
    ol.appendChild(li);
  });
}

$("difficulty-row").addEventListener("click", (e) => {
  const el = e.target.closest(".choice"); if(!el) return;
  settings.difficulty = el.dataset.diff;
  document.querySelectorAll("#difficulty-row .choice").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
});
const skinRow = $("skin-row");
SKINS.forEach((color, i) => {
  const dot = document.createElement("div");
  dot.className = "skin-dot" + (i === 0 ? " active" : "");
  dot.style.background = color; dot.style.color = color;
  dot.addEventListener("click", () => {
    settings.skin = color;
    document.querySelectorAll(".skin-dot").forEach(d => d.classList.remove("active"));
    dot.classList.add("active");
  });
  skinRow.appendChild(dot);
});
$("sound-toggle").addEventListener("click", function(){
  Sound.enabled = !Sound.enabled;
  this.textContent = Sound.enabled ? "🔊 音 ON" : "🔇 音 OFF";
  this.classList.toggle("active", Sound.enabled);
  if(Sound.enabled) Sound.init();
  saveSettings();   // 追加：音設定も保存
});

// ===== 追加：設定画面の処理 =====
// 速度の数値を「遅い/普通/速い」の言葉に変換
function speedWord(v){ return v <= 3 ? "遅い" : (v <= 7 ? "普通" : "速い"); }
// スマホ操作ボタンの表示/非表示を反映
function applyControlsVisibility(){
  // 操作ボタンの表示ON/OFFはbodyのクラスで制御（CSS側で表示/非表示を切り替え）
  document.body.classList.toggle("controls-off", !settings.showControls);
}
// 設定画面の表示を今の設定に合わせて更新
function refreshSettingsUI(){
  $("speed-slider").value = settings.moveSpeed;
  $("speed-value").textContent = settings.moveSpeed + "（" + speedWord(settings.moveSpeed) + "）";
  $("set-sound").textContent = Sound.enabled ? "🔊 ON" : "🔇 OFF";
  $("set-sound").classList.toggle("active", Sound.enabled);
  $("set-controls").textContent = settings.showControls ? "表示 ON" : "表示 OFF";
  $("set-controls").classList.toggle("active", settings.showControls);
  $("player-name").value = settings.playerName;
  applyControlsVisibility();
}
function openSettings(){ showScreen("screen-settings"); refreshSettingsUI(); }
$("btn-menu-settings").addEventListener("click", openSettings);
$("btn-pause-settings").addEventListener("click", openSettings);
$("btn-settings-back").addEventListener("click", () => {
  // ポーズ中に開いたときはポーズ画面へ、それ以外はメニューへ戻る
  if(scene === "paused") showScreen("screen-pause"); else showScreen("screen-menu");
});
// 初回ユーザー名入力画面のボタン
function finishNameSetup(){
  Sound.init();
  saveSettings();               // 入力した名前を保存
  showScreen("screen-menu");    // メニューへ進む
}
$("btn-name-ok").addEventListener("click", () => {
  const v = $("first-name-input").value.slice(0, 12).trim();
  settings.playerName = v || "ゲスト";   // 空なら「ゲスト」
  finishNameSetup();
});
$("btn-name-skip").addEventListener("click", () => {
  settings.playerName = "ゲスト";
  finishNameSetup();
});
// スライダーを動かすとすぐ反映（リアルタイム）
$("speed-slider").addEventListener("input", function(){
  settings.moveSpeed = clamp(parseInt(this.value, 10) || 5, 1, 10);
  $("speed-value").textContent = settings.moveSpeed + "（" + speedWord(settings.moveSpeed) + "）";
  saveSettings();
});
// プリセット（遅い/普通/速い）ボタン
document.querySelectorAll("#speed-presets .choice").forEach(el => {
  el.addEventListener("click", () => {
    settings.moveSpeed = clamp(parseInt(el.dataset.speed, 10) || 5, 1, 10);
    saveSettings(); refreshSettingsUI();
  });
});
// 設定画面の音ON/OFF
$("set-sound").addEventListener("click", () => {
  Sound.enabled = !Sound.enabled; if(Sound.enabled) Sound.init();
  $("sound-toggle").textContent = Sound.enabled ? "🔊 音 ON" : "🔇 音 OFF";
  $("sound-toggle").classList.toggle("active", Sound.enabled);
  saveSettings(); refreshSettingsUI();
});
// スマホ操作ボタンの表示ON/OFF
$("set-controls").addEventListener("click", () => {
  settings.showControls = !settings.showControls;
  saveSettings(); refreshSettingsUI();
});
// プレイヤー名の入力（ランキング用）
$("player-name").addEventListener("input", function(){
  settings.playerName = this.value.slice(0, 12);
  saveSettings();
});
// 全国ランキングのモード切り替えタブ
document.querySelectorAll("#global-mode-tabs .choice").forEach(el => {
  el.addEventListener("click", () => {
    globalMode = el.dataset.gmode;
    document.querySelectorAll("#global-mode-tabs .choice").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    loadGlobalRanking(globalMode, "ranking-global-menu");
  });
});

$("btn-menu-solo").addEventListener("click", () => { Sound.init(); showScreen("screen-solo"); });
$("btn-menu-online").addEventListener("click", () => { Sound.init(); openOnlineMenu(); });
$("btn-menu-howto").addEventListener("click", () => showScreen("screen-howto"));
$("btn-solo-back").addEventListener("click", goTitle);
$("btn-howto-back").addEventListener("click", goTitle);
$("btn-solo-start").addEventListener("click", startGame);
$("btn-restart").addEventListener("click", startGame);
$("btn-resume").addEventListener("click", togglePause);
$("btn-quit").addEventListener("click", goTitle);
$("btn-title").addEventListener("click", goTitle);

// ===== 裏コマンド：タイトルロゴを1.5秒以内に5回タップ/クリックで「STAGE 100 チャレンジ」を解禁 =====
let titleTapCount = 0;
let titleTapTimer = null;
const menuTitle = $("screen-menu").querySelector(".title");
if(menuTitle){
  menuTitle.addEventListener("click", () => {
    titleTapCount++;
    clearTimeout(titleTapTimer);
    titleTapTimer = setTimeout(() => { titleTapCount = 0; }, 1500);   // 1.5秒以内に5回で発動
    if(titleTapCount >= 5){
      titleTapCount = 0;
      $("btn-stage100").style.display = "";   // 隠しボタンを表示
      Sound.init(); Sound.power();            // 解禁の合図（効果音）
    }
  });
}
// 隠しボタン：ステージ100から開始（最終ボス）。スコアは通常どおりランキング登録される
$("btn-stage100").addEventListener("click", () => startGame(100));

/* =============================================================
   [D] オンライン対戦（最小構成）
   ============================================================= */
const net = { socket: null, roomId: "", role: 0, countdown: null };
let online = null;
let sendAccum = 0;

function setOnlineStatus(msg){ $("online-status").textContent = msg; }

function openOnlineMenu(){
  showScreen("screen-online");
  $("waiting-box").classList.add("hidden");
  setOnlineStatus("ルームを作成するか、IDを入力して参加してください");
}

function connectOnline(){
  // オフラインのときは対戦できないので案内を出す
  if(!navigator.onLine){
    setOnlineStatus("オンライン対戦にはインターネット接続が必要です");
    return false;
  }
  if(typeof io === "undefined"){
    setOnlineStatus("⚠ サーバーに接続できません。オンライン対戦には『npm start』でサーバー起動が必要です。");
    return false;
  }
  if(net.socket && net.socket.connected) return true;
  net.socket = io();
  bindSocket();
  return true;
}

function bindSocket(){
  const s = net.socket;
  s.on("roomCreated", (d) => {
    net.roomId = d.roomId; net.role = d.role;
    $("room-id-show").textContent = d.roomId;
    $("waiting-box").classList.remove("hidden");
    setOnlineStatus("相手を待っています…");
  });
  s.on("roomJoined", (d) => {
    net.roomId = d.roomId; net.role = d.role;
    setOnlineStatus("接続しました。まもなく開始します。");
  });
  s.on("joinError", (msg) => setOnlineStatus("⚠ " + msg));
  s.on("bothReady", () => { net.countdown = 3; scene = "onlineCountdown"; hideAllScreens(); });
  s.on("countdown", (n) => { net.countdown = n; Sound.count(); });
  s.on("matchStart", (d) => startOnlineMatch(d.duration || 60));
  s.on("opponentState", (d) => {
    if(!online) return;
    online.oppX = d.x; online.oppScore = d.score; online.oppLives = d.lives; online.oppOver = d.over;
  });
  s.on("opponentLeft", () => {
    setOnlineStatus("相手が切断しました");
    if(online && !online.finished) finishOnline("相手が切断しました");
    else { scene = "menu"; showScreen("screen-menu"); }
  });
}

$("btn-create-room").addEventListener("click", () => { if(connectOnline()) net.socket.emit("createRoom"); });
$("btn-join-room").addEventListener("click", () => {
  const id = $("room-id-input").value.trim().toUpperCase();
  if(id.length < 3){ setOnlineStatus("ルームIDを入力してください"); return; }
  if(connectOnline()) net.socket.emit("joinRoom", id);
});
$("btn-online-back").addEventListener("click", () => {
  if(net.socket){ net.socket.disconnect(); net.socket = null; }
  goTitle();
});
$("btn-result-again").addEventListener("click", () => {
  if(net.socket){ net.socket.disconnect(); net.socket = null; }
  online = null; goTitle();
});

function startOnlineMatch(duration){
  Sound.init();
  online = {
    myX: W/2 - 18, myScore: 0, myLives: 3, myOver: false,
    oppX: W/2 - 18, oppScore: 0, oppLives: 3, oppOver: false,
    bullets: [], enemies: [], explosions: [],
    fireCooldown: 0, spawnTimer: 0,
    timeLeft: duration, finished: false, result: "",
    stars: makeStars(),
  };
  scene = "onlinePlaying";
}

function onlineUpdate(dt){
  const o = online; if(!o) return;
  for(const st of o.stars){ st.y += st.speed; if(st.y > H){ st.y = 0; st.x = rand(0, W); } }
  const px = moveSpeedPixels();          // 自分だけに移動速度を反映（相手はネット同期なので影響なし）
  if(input.left)  o.myX -= px;
  if(input.right) o.myX += px;
  o.myX = clamp(o.myX, 4, W - 40);       // 画面外に出ないよう制限
  o.fireCooldown -= dt;
  if(input.fire && o.fireCooldown <= 0 && !o.myOver){
    o.fireCooldown = 0.3;
    o.bullets.push({ x: o.myX + 16, y: H - 90, w: 4, h: 12, speed: 9 });
    Sound.shoot();
  }
  for(const b of o.bullets) b.y -= b.speed;
  o.bullets = o.bullets.filter(b => b.y + b.h > 0);
  o.spawnTimer -= dt;
  if(o.spawnTimer <= 0 && !o.myOver){
    o.spawnTimer = 0.8;
    o.enemies.push({ x: rand(20, W - 50), y: -20, w: 30, h: 22, speed: rand(1.2, 2.2), color: "#2ef2ff" });
  }
  for(const e of o.enemies){
    e.y += e.speed;
    if(e.y > H - 60){ e.dead = true; o.myLives--; if(o.myLives <= 0) o.myOver = true; }
  }
  for(const b of o.bullets){
    for(const e of o.enemies){
      if(!e.dead && hit(b, e)){
        e.dead = true; b.dead = true; o.myScore += 100;
        for(let i = 0; i < 8; i++){
          const a = rand(0, Math.PI*2), sp = rand(1, 3);
          o.explosions.push({ x: e.x + 15, y: e.y + 10, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 1, color: e.color });
        }
        Sound.explosion();
      }
    }
  }
  o.bullets = o.bullets.filter(b => !b.dead);
  o.enemies = o.enemies.filter(e => !e.dead);
  for(const p of o.explosions){ p.x += p.vx; p.y += p.vy; p.life -= dt * 2.2; }
  o.explosions = o.explosions.filter(p => p.life > 0);
  o.timeLeft -= dt;
  sendAccum += dt;
  if(sendAccum >= 0.05 && net.socket && net.socket.connected){
    sendAccum = 0;
    net.socket.emit("state", { x: o.myX, score: o.myScore, lives: o.myLives, over: o.myOver });
  }
  if(!o.finished && (o.timeLeft <= 0 || o.myOver)){
    finishOnline(o.timeLeft <= 0 ? "タイムアップ！" : "あなたはやられた…");
  }
}

function finishOnline(note){
  const o = online; if(!o || o.finished) return;
  o.finished = true;
  if(net.socket && net.socket.connected)
    net.socket.emit("state", { x: o.myX, score: o.myScore, lives: o.myLives, over: true });
  let title, color;
  if(o.myScore > o.oppScore){ title = "YOU WIN!"; color = "var(--neon-green)"; }
  else if(o.myScore < o.oppScore){ title = "YOU LOSE"; color = "var(--neon-pink)"; }
  else { title = "DRAW"; color = "var(--neon-yellow)"; }
  $("result-title").textContent = title;
  $("result-title").style.color = color;
  $("result-title").style.textShadow = "0 0 12px " + color;
  $("result-score").innerHTML = "あなた " + o.myScore + " 　-　 相手 " + o.oppScore;
  $("result-note").textContent = note;
  scene = "onlineResult";
  showScreen("screen-result");
}

function onlineDraw(){
  const o = online;
  drawStarsBg(o ? o.stars : []);
  if(scene === "onlineCountdown"){
    ctx.textAlign = "center"; neon("#2ef2ff", 24); ctx.font = "bold 80px sans-serif";
    const txt = net.countdown > 0 ? String(net.countdown) : "START";
    ctx.fillText(txt, W/2, H/2); resetShadow();
    return;
  }
  if(!o) return;
  drawShip(o.oppX, 50, 36, 24, "#ff7a59", false);
  drawShip(o.myX, H - 90, 36, 24, settings.skin, true);
  neon("#ffffff", 8); for(const b of o.bullets) ctx.fillRect(b.x, b.y, b.w, b.h); resetShadow();
  for(const e of o.enemies){ neon(e.color, 10); ctx.fillRect(e.x, e.y, e.w, e.h); } resetShadow();
  drawExplosionsList(o.explosions);
  ctx.textAlign = "left"; neon("#2ef2ff", 6); ctx.font = "bold 15px sans-serif";
  ctx.fillText("自分 " + o.myScore, 10, 22);
  ctx.fillText("♥".repeat(Math.max(0, o.myLives)), 10, 42);
  resetShadow();
  ctx.textAlign = "right"; neon("#ff7a59", 6);
  ctx.fillText("相手 " + o.oppScore, W - 10, 22);
  ctx.fillText("♥".repeat(Math.max(0, o.oppLives)), W - 10, 42);
  resetShadow();
  ctx.textAlign = "center"; ctx.fillStyle = "#9fb6ff"; ctx.font = "bold 16px sans-serif";
  ctx.fillText("⏱ " + Math.max(0, Math.ceil(o.timeLeft)) + "s", W/2, 22);
  ctx.fillStyle = "#6f7aa8"; ctx.font = "11px sans-serif";
  ctx.fillText("ROOM " + net.roomId + "（接続中）", W/2, 40);
}

/* =============================================================
   [E] ゲームループ・PWA登録・起動
   ============================================================= */
let lastTime = 0;
function loop(now){
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if(scene === "playing"){ update(dt); draw(); }
  else if(scene === "intro"){ updateStars(); draw(); state.introTimer -= dt; if(state.introTimer <= 0) scene = "playing"; }
  else if(scene === "paused"){ draw(); }
  else if(scene === "onlinePlaying"){ onlineUpdate(dt); onlineDraw(); }
  else if(scene === "onlineCountdown" || scene === "onlineResult"){ onlineDraw(); }
  requestAnimationFrame(loop);
}

function fitCanvas(){
  const ratio = W / H;
  const landscape = window.innerWidth > window.innerHeight;   // 横画面かどうか
  // 横画面は操作ボタンを左右端に置くので、縦の余白を減らし左右に操作ボタン分をあける
  const reserveH = landscape ? 6 : 150;
  const reserveW = landscape ? 120 : 12;
  let maxW = window.innerWidth - reserveW;
  let maxH = window.innerHeight - reserveH;
  let w = maxW, h = w / ratio;
  if(h > maxH){ h = maxH; w = h * ratio; }
  canvas.style.width  = Math.floor(w) + "px";
  canvas.style.height = Math.floor(h) + "px";
}
window.addEventListener("resize", fitCanvas);
window.addEventListener("orientationchange", fitCanvas);

if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => console.log("SW登録失敗:", err));
  });
}

loadSettings();   // 追加：保存された設定を読み込む
// 追加：読み込んだ設定を画面に反映
$("sound-toggle").textContent = Sound.enabled ? "🔊 音 ON" : "🔇 音 OFF";
$("sound-toggle").classList.toggle("active", Sound.enabled);
applyControlsVisibility();

fitCanvas();
renderRanking("ranking-start");
loadGlobalRanking(globalMode, "ranking-global-menu");   // 起動時に全国ランキングを取得
// 初回（名前が未設定）ならユーザー名入力画面、設定済みならメニューを表示
if(settings.playerName){ showScreen("screen-menu"); }
else { showScreen("screen-name"); }
requestAnimationFrame(loop);
