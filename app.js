// ==============================
// ランプシャッター app.js（HTML構成対応・安定版）
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
  const roi = document.getElementById("roi");
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

  // --- メイン検出処理 ---
  function startDetect() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let lastResult = "";
    const lastShot = { time: 0 };

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

      // ROI計算
      const rx = vw * ROI.x;
      const ry = vh * ROI.y;
      const rw = vw * ROI.w;
      const rh = vh * ROI.h;

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

        // 反射や暗部を除外（暗すぎ・明るすぎを無視）
        if (brightness < 50 || brightness > 240) continue;

        // 緑の検出（強めの発光のみ）
        if (g > r * 1.4 && g > b * 1.2 && g > 90) gCount++;

        // 赤の検出（強めの発光のみ）
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

      // --- 結果反映 ---
      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

      // --- R/G% 表示（プレビューHUD）---
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

      // --- 自動シャッター（OK時）---
      const now = performance.now();
      if (
        result === "OK" &&
        lastResult !== "OK" &&
        now - lastShot.time > 2000
      ) {
        lastShot.time = now;
        triggerShot(true);
      }
      lastResult = result;

      requestAnimationFrame(loop);
    }
    loop();
  }

  // --- シャッター撮影処理 ---
  function triggerShot(auto) {
    // フラッシュ
    flash.style.opacity = 0.85;
    setTimeout(() => (flash.style.opacity = 0), 120);
    // バイブ
    navigator.vibrate?.(80);
    // 音声
    const u = new SpeechSynthesisUtterance("オーケー");
    u.lang = "ja-JP";
    speechSynthesis.speak(u);

    // 撮影保存
    const canvas = document.createElement("canvas");
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);

    // 日付と結果を焼き込み
    const ok = statusEl.textContent === "OK";
    ctx.fillStyle = ok ? "#17c964" : "#e5484d";
    ctx.globalAlpha = 0.85;
    ctx.fillRect(18, 18, ok ? 120 : 140, 60);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ok ? "#003300" : "#fff";
    ctx.font = "700 36px system-ui";
    ctx.fillText(ok ? "OK" : "NG?", 30, 60);
    const d = new Date(),
      z = (n) => String(n).padStart(2, "0");
    const t = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(
      d.getDate()
    )} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    ctx.font = "600 24px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(t, 18, vh - 24);

    // 保存
    const a = document.createElement("a");
    const ts = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(
      d.getHours()
    )}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;
    a.download = ts;
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.click();
    a.remove();
  }
}
