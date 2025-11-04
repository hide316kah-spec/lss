// ==============================
// ランプシャッター app.js（完全安定統合版）
// ==============================

// --- 二重起動防止 ---
if (window.__LS_RUNNING__) {
  console.warn("already running");
} else {
  window.__LS_RUNNING__ = true;

  // --- 閾値設定 ---
  // 昼は1.5%、夜は4%、赤は2%
  const GREEN_RATIO_MIN = { day: 0.015, night: 0.04 };
  const RED_THRESHOLD = 0.02;

  // --- ROI（右上・横長固定：CSS #roi と一致）---
  const ROI = { x: 0.53, y: 0.06, w: 0.45, h: 0.25 };

  // --- モード取得（昼 or 夜）---
  const mode = window.LS_MODE || "day";

  // --- HTML要素取得 ---
  const video = document.getElementById("preview");
  const roi = document.getElementById("roi");
  const statusEl = document.getElementById("status");
  const flash = document.getElementById("flash");
  const camBtn = document.getElementById("cam"); // ← カメライラストボタン取得
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

  // --- カメライラストの余白・枠削除（UI調整）---
  if (camBtn) {
    camBtn.style.background = "transparent";
    camBtn.style.border = "none";
    camBtn.style.boxShadow = "none";
    camBtn.style.padding = "0";
  }

  // --- タップ撮影（イラストタップでも撮影できる）---
  if (camBtn) {
    camBtn.addEventListener("click", () => triggerShot(false));
  }

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

        // 暗すぎ・明るすぎは除外（反射対策）
        if (brightness < 50 || brightness > 240) continue;

        // 緑・赤判定
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

      // --- 結果反映 ---
      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

      // --- R/G% 表示（HUD）---
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

  // --- 撮影処理（自動・手動共通）---
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

    // === 保存処理（写真アプリ保存対応）===
    const blob = dataURLtoBlob(canvas.toDataURL("image/jpeg", 0.92));
    const file = new File([blob], `${t}_${ok ? "OK" : "NG?"}.jpg`, {
      type: "image/jpeg",
    });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "ランプシャッター" }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.download = `${t}_${ok ? "OK" : "NG?"}.jpg`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  // --- DataURL → Blob 変換関数 ---
  function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }
}
