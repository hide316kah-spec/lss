// ==============================
// ランプシャッター app.js（モード選択タップで保存許可確保版）
// ==============================

if (window.__LS_RUNNING__) {
  console.warn("already running");
} else {
  window.__LS_RUNNING__ = true;

  const GREEN_RATIO_MIN = { day: 0.015, night: 0.05 };
  const RED_THRESHOLD = 0.01;
  const ROI = { x: 0.55, y: 0.05, w: 0.45, h: 0.25 };
  const mode = window.LS_MODE || "day";

  const video = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const flash = document.getElementById("flash");
  const camBtn = document.getElementById("cam");
  const okSound = new Audio("ok_voice.mp3");

  // --- カメラ起動 ---
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((stream) => {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play().catch(() => {
          video.addEventListener("click", () => video.play(), { once: true });
        });
        startDetect();
      };
    })
    .catch((err) => alert("カメラアクセスが拒否されました: " + err));

  // --- 判定ループ ---
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
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 50 || brightness > 240) continue;
        if (g > r * 1.4 && g > b * 1.2 && g > 90) gCount++;
        if (r > g * 1.4 && r > b * 1.2 && r > 90) rCount++;
        total++;
      }

      const gRatio = gCount / total;
      const rRatio = rCount / total;

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
      stat.textContent = `R:${(rRatio * 100).toFixed(1)}%  G:${(gRatio * 100).toFixed(1)}%`;

      let result = "NG?";
      if (gRatio > GREEN_RATIO_MIN[mode] && rRatio < RED_THRESHOLD)
        result = "OK";

      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

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

  // --- イラストタップで撮影 ---
  camBtn.addEventListener("click", () => triggerShot(false));

  // --- 撮影処理 ---
  function triggerShot(auto) {
    flash.style.transition = "opacity 0.15s";
    flash.style.opacity = 0.9;
    setTimeout(() => (flash.style.opacity = 0), 150);
    navigator.vibrate?.(200);

    if (auto) okSound.play();

    const canvas = document.createElement("canvas");
    const vw = video.videoWidth, vh = video.videoHeight;
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
    const t = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    ctx.font = "600 24px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(t, 18, vh - 24);

    const ts = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;

    canvas.toBlob((blob) => {
      const file = new File([blob], ts, { type: "image/jpeg" });
      const url = URL.createObjectURL(file);

      // --- 保存権限を確保済みなら共有シートで写真保存可能 ---
      const userTapped = localStorage.getItem('LS_USER_TAPPED') === '1';
      if (navigator.canShare && navigator.canShare({ files: [file] }) && userTapped) {
        navigator.share({
          files: [file],
          title: ts,
          text: "画像を保存を選択してください"
        }).catch(()=>{});
      } else {
        // 保険：古いSafariなど
        const a = document.createElement("a");
        a.href = url;
        a.download = ts;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/jpeg", 0.92);
  }
}
