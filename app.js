// ==============================
// ランプシャッター app.js（保存・自動・閾値統合版）
// ==============================

if (window.__LS_RUNNING__) {
  console.warn("already running");
} else {
  window.__LS_RUNNING__ = true;

  const GREEN_RATIO_MIN = { day: 0.015, night: 0.04 }; // 昼1.5%, 夜4%
  const RED_THRESHOLD = 0.02;
  const ROI = { x: 0.55, y: 0.05, w: 0.45, h: 0.25 };

  const mode = window.LS_MODE || "day";

  const video = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const flash = document.getElementById("flash");
  const camBtn = document.getElementById("cam");
  const okSound = new Audio("ok_voice.mp3");

  // ---- カメラ起動 ----
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

  // ---- メイン検出処理 ----
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

      const imgData = ctx.getImageData(rx, ry, rw, rh);
      const pixels = imgData.data;
      let rCount = 0, gCount = 0, total = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 50 || brightness > 240) continue;
        if (g > r * 1.4 && g > b * 1.2 && g > 90) gCount++;
        if (r > g * 1.4 && r > b * 1.2 && r > 90) rCount++;
        total++;
      }

      const gRatio = gCount / total;
      const rRatio = rCount / total;

      // --- 閾値表示（左下） ---
      let stat = document.getElementById("live-stats");
      if (!stat) {
        stat = document.createElement("div");
        stat.id = "live-stats";
        stat.style.position = "fixed";
        stat.style.left = "16px";
        stat.style.bottom = "18px";
        stat.style.color = "#fff";
        stat.style.font = "600 14px system-ui";
        stat.style.zIndex = "99";
        document.body.appendChild(stat);
      }
      stat.textContent = `R:${(rRatio * 100).toFixed(1)}%  G:${(
        gRatio * 100
      ).toFixed(1)}%`;

      // --- 判定 ---
      let result = "NG?";
      if (gRatio > GREEN_RATIO_MIN[mode] && rRatio < RED_THRESHOLD) {
        result = "OK";
      }

      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

      // --- 自動シャッター（OK時） ---
      const now = performance.now();
      if (result === "OK" && lastResult !== "OK" && now - lastShotTime > 2500) {
        lastShotTime = now;
        triggerShot(true);
      }
      lastResult = result;

      requestAnimationFrame(loop);
    }
    loop();
  }

  // ---- 手動撮影ボタン（イラストタップ）----
  camBtn.addEventListener("click", () => triggerShot(false));

  // ---- 撮影処理（共通）----
  function triggerShot(auto) {
    // 演出
    flash.style.opacity = 0.85;
    setTimeout(() => (flash.style.opacity = 0), 120);
    navigator.vibrate?.(100);
    if (auto) okSound.play();

    // 撮影保存
    const canvas = document.createElement("canvas");
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);

    const ok = statusEl.textContent === "OK";
    ctx.fillStyle = ok ? "#17c964" : "#e5484d";
    ctx.globalAlpha = 0.85;
    ctx.fillRect(18, 18, ok ? 120 : 140, 60);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ok ? "#003300" : "#fff";
    ctx.font = "700 36px system-ui";
    ctx.fillText(ok ? "OK" : "NG?", 30, 60);

    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    const t = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(
      d.getDate()
    )} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    ctx.font = "600 24px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(t, 18, vh - 24);

    const a = document.createElement("a");
    const ts = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(
      d.getHours()
    )}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;
    a.download = ts;
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.click();
  }
}
