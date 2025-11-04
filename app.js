// ==============================
// ランプシャッター app.js（HTML構成完全対応・安定版）
// ==============================

// --- 二重起動防止 ---
if (window.__LS_RUNNING__) {
  console.warn("already running");
} else {
  window.__LS_RUNNING__ = true;

  // --- 閾値設定 ---
  const GREEN_RATIO_MIN = { day: 0.01, night: 0.04 }; // 緑LEDの閾値（昼1%, 夜4%）
  const RED_THRESHOLD = 0.02; // 赤LEDの閾値
  const ROI = { x: 0.55, y: 0.05, w: 0.45, h: 0.25 }; // ROI右上横長固定

  // --- モード取得 ---
  const mode = window.LS_MODE || "day";

  // --- HTML要素取得 ---
  const video = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const flash = document.getElementById("flash");
  const okSound = new Audio("ok_voice.mp3");

  // --- カメラ起動 ---
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((stream) => {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        startDetect();
      };
    })
    .catch((err) => alert("カメラアクセスが拒否されました: " + err));

  // --- 判定処理 ---
  function startDetect() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let lastResult = "";
    let lastShotTime = 0;

    function loop() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) {
        requestAnimationFrame(loop);
        return;
      }

      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(video, 0, 0, vw, vh);

      const rx = vw * ROI.x;
      const ry = vh * ROI.y;
      const rw = vw * ROI.w;
      const rh = vh * ROI.h;
      const img = ctx.getImageData(rx, ry, rw, rh).data;

      let rCount = 0,
        gCount = 0,
        total = 0;

      for (let i = 0; i < img.length; i += 4) {
        const r = img[i];
        const g = img[i + 1];
        const b = img[i + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 50 || brightness > 240) continue;
        if (g > r * 1.4 && g > b * 1.2 && g > 90) gCount++;
        if (r > g * 1.4 && r > b * 1.2 && r > 90) rCount++;
        total++;
      }

      const gRatio = gCount / total;
      const rRatio = rCount / total;

      // --- 判定 ---
      let result = "NG?";
      if (gRatio > GREEN_RATIO_MIN[mode] && rRatio < RED_THRESHOLD) {
        result = "OK";
      }

      // --- 結果表示 ---
      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

      // --- R/G表示（下部HUD）---
      let stat = document.getElementById("live-stats");
      if (!stat) {
        stat = document.createElement("div");
        stat.id = "live-stats";
        stat.style.position = "fixed";
        stat.style.left = "16px";
        stat.style.bottom = "18px";
        stat.style.color = "#fff";
        stat.style.font = "600 14px system-ui";
        document.body.appendChild(stat);
      }
      stat.innerHTML = `R:${(rRatio * 100).toFixed(1)}%　G:${(
        gRatio * 100
      ).toFixed(1)}%`;

      // --- 自動シャッター（OK検知）---
      const now = performance.now();
      if (result === "OK" && lastResult !== "OK" && now - lastShotTime > 2000) {
        lastShotTime = now;
        triggerShot(true);
      }

      lastResult = result;
      requestAnimationFrame(loop);
    }

    loop();
  }

  // --- 撮影処理 ---
  function triggerShot(auto) {
    // フラッシュ
    flash.style.opacity = 0.85;
    setTimeout(() => (flash.style.opacity = 0), 120);

    // 音声・振動
    okSound.play().catch(() => {});
    navigator.vibrate?.(200);

    // スナップショット保存
    const c = document.createElement("canvas");
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    c.width = vw;
    c.height = vh;
    const cx = c.getContext("2d");
    cx.drawImage(video, 0, 0, vw, vh);

    // 焼き込み
    const ok = statusEl.textContent === "OK";
    cx.fillStyle = ok ? "#17c964" : "#e5484d";
    cx.globalAlpha = 0.85;
    cx.fillRect(18, 18, ok ? 120 : 140, 60);
    cx.globalAlpha = 1;
    cx.fillStyle = ok ? "#003300" : "#fff";
    cx.font = "700 36px system-ui";
    cx.fillText(ok ? "OK" : "NG?", 30, 60);
    const d = new Date(),
      z = (n) => String(n).padStart(2, "0");
    const t = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(
      d.getHours()
    )}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    cx.font = "600 24px system-ui";
    cx.fillStyle = "#fff";
    cx.fillText(t, 18, vh - 24);

    const a = document.createElement("a");
    const ts = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(
      d.getHours()
    )}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;
    a.download = ts;
    a.href = c.toDataURL("image/jpeg", 0.9);
    a.click();
  }
}
