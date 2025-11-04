// ==============================
// ランプシャッター最終版 app.js
// ==============================

// --- 定数設定 ---
const GREEN_RATIO_MIN = { day: 0.01, night: 0.04 }; // 緑LEDの閾値（昼1%, 夜4%）
const RED_THRESHOLD = 0.02; // 赤LEDの閾値（全体比）
const ROI = { x: 0.65, y: 0.05, w: 0.3, h: 0.25 }; // ROI右上横長
let mode = localStorage.getItem("mode") || "day";

// --- 要素取得 ---
const video = document.createElement("video");
video.autoplay = true;
video.playsInline = true;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.body.appendChild(canvas);

const resultBox = document.createElement("div");
resultBox.style.position = "fixed";
resultBox.style.top = "20px";
resultBox.style.left = "20px";
resultBox.style.padding = "5px 10px";
resultBox.style.fontSize = "32px";
resultBox.style.fontWeight = "bold";
resultBox.style.borderRadius = "8px";
resultBox.style.color = "white";
resultBox.style.background = "rgba(0,0,0,0.5)";
document.body.appendChild(resultBox);

const percentBox = document.createElement("div");
percentBox.style.position = "fixed";
percentBox.style.bottom = "20px";
percentBox.style.left = "20px";
percentBox.style.fontSize = "20px";
percentBox.style.color = "white";
document.body.appendChild(percentBox);

// --- サウンド設定 ---
const okSound = new Audio("ok_voice.mp3");

// --- カメラ起動 ---
navigator.mediaDevices
  .getUserMedia({ video: { facingMode: "environment" } })
  .then((stream) => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      drawLoop();
    };
  })
  .catch((err) => alert("カメラアクセスが拒否されました: " + err));

// --- 判定ループ ---
let lastResult = "";
function drawLoop() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) {
    requestAnimationFrame(drawLoop);
    return;
  }
  canvas.width = vw;
  canvas.height = vh;
  ctx.drawImage(video, 0, 0, vw, vh);

  // ROI枠（点線のみ）
  ctx.strokeStyle = "rgba(0,255,128,0.5)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  const rx = vw * ROI.x;
  const ry = vh * ROI.y;
  const rw = vw * ROI.w;
  const rh = vh * ROI.h;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);

  const imgData = ctx.getImageData(rx, ry, rw, rh);
  const pixels = imgData.data;
  let rCount = 0,
    gCount = 0,
    total = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness < 50) continue; // 暗部・反射を無視
    if (g > r * 1.4 && g > b * 1.2 && g > 90) gCount++;
    if (r > g * 1.4 && r > b * 1.2 && r > 90) rCount++;
    total++;
  }

  const gRatio = gCount / total;
  const rRatio = rCount / total;
  percentBox.textContent = `R:${(rRatio * 100).toFixed(1)}%  G:${(
    gRatio * 100
  ).toFixed(1)}%`;

  let result = "NG?";
  if (gRatio > GREEN_RATIO_MIN[mode] && rRatio < RED_THRESHOLD) {
    result = "OK";
  }

  // 結果表示
  resultBox.textContent = result;
  resultBox.style.background =
    result === "OK" ? "rgba(0,200,0,0.8)" : "rgba(200,0,0,0.8)";

  // OK時のみ自動シャッター
  if (result === "OK" && lastResult !== "OK") {
    triggerShutter();
  }

  lastResult = result;
  requestAnimationFrame(drawLoop);
}

// --- 自動シャッター処理 ---
function triggerShutter() {
  flashEffect();
  okSound.play();
  navigator.vibrate?.(200);

  setTimeout(() => {
    const link = document.createElement("a");
    const ts = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .split(".")[0];
    link.download = `${ts}_OK.jpg`;
    link.href = canvas.toDataURL("image/jpeg");
    link.click();
  }, 400);
}

// --- フラッシュ演出 ---
function flashEffect() {
  const flash = document.createElement("div");
  flash.style.position = "fixed";
  flash.style.top = 0;
  flash.style.left = 0;
  flash.style.width = "100%";
  flash.style.height = "100%";
  flash.style.background = "white";
  flash.style.opacity = 0.8;
  flash.style.zIndex = 9999;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 120);
}
