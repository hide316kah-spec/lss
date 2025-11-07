// ==============================
// ランプシャッター app.js（光学認識強化・保存完全版）
// ==============================

if (window.__LS_RUNNING__) {
  console.warn("already running");
} else {
  window.__LS_RUNNING__ = true;

  // --- 基本閾値 ---
  const GREEN_RATIO_MIN = { day: 0.015, night: 0.05 };
  const RED_THRESHOLD = 0.01;
  const ROI = { x: 0.55, y: 0.05, w: 0.45, h: 0.25 };
  const mode = window.LS_MODE || "day";

  // --- 光学強化用定数 ---
  const SAT_MIN = 0.25;          // 彩度下限
  const HIGH_BRIGHT = 250;       // 白飛びしきい値
  const STABLE_FRAMES = 4;       // 緑が安定して続いたらOK
  const RED_VETO_RATIO = 0.003;  // 赤比率VETO閾値
  const RED_VETO_CLUSTER = 5;    // 赤クラスタ数VETO
  const GRID = 12;               // ROI分割数

  // --- 要素取得 ---
  const video = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const flash = document.getElementById("flash");
  const camBtn = document.getElementById("cam");
  const okSound = new Audio("ok_voice.mp3");
  let pendingFile = null;
  let startTime = performance.now();

  // --- カメラ起動 ---
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
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

  // --- 彩度計算 ---
  function pseudoSaturation(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }

  // --- 緑・赤判定 ---
  function isGreen(r, g, b) {
    const sat = pseudoSaturation(r, g, b);
    const bright = (r + g + b) / 3;
    if (bright > HIGH_BRIGHT && sat < 0.25) return false;
    if (sat < SAT_MIN) return false;
    return (g > r * 1.4 && g > b * 1.2 && g > 90);
  }

  function isRed(r, g, b) {
    const sat = pseudoSaturation(r, g, b);
    const bright = (r + g + b) / 3;
    if (bright > HIGH_BRIGHT && sat < 0.25) return false;
    if (sat < SAT_MIN) return false;
    return (r > g * 1.4 && r > b * 1.2 && r > 90);
  }

  // --- 判定ループ ---
  function startDetect() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let lastResult = "";
    let lastShotTime = 0;
    window.__gStable__ = 0;

    function loop() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return requestAnimationFrame(loop);

      const elapsed = performance.now() - startTime;
      if (elapsed < 2000) return requestAnimationFrame(loop);

      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(video, 0, 0, vw, vh);

      const rx = vw * ROI.x, ry = vh * ROI.y, rw = vw * ROI.w, rh = vh * ROI.h;
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      const pixels = imgData.data;

      let rCount = 0, gCount = 0, total = 0;
      const gridW = Math.max(1, Math.floor(rw / GRID));
      const gridH = Math.max(1, Math.floor(rh / GRID));
      const redGrid = Array(GRID * GRID).fill(0);

      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const px = ((y * rw) + x) * 4;
          const r = pixels[px], g = pixels[px + 1], b = pixels[px + 2];
          const bright = (r + g + b) / 3;
          if (bright < 50) continue;
          const gHit = isGreen(r, g, b);
          const rHit = isRed(r, g, b);
          if (gHit) gCount++;
          if (rHit) {
            rCount++;
            const gx = Math.min(GRID - 1, Math.floor(x / gridW));
            const gy = Math.min(GRID - 1, Math.floor(y / gridH));
            redGrid[gy * GRID + gx] = 1;
          }
          total++;
        }
      }

      const gRatio = total ? gCount / total : 0;
      const rRatio = total ? rCount / total : 0;
      const redClusters = redGrid.reduce((a, b) => a + b, 0);

      // 連続安定
      if (gRatio > GREEN_RATIO_MIN[mode]) window.__gStable__++;
      else window.__gStable__ = 0;

      const redPresent = (rRatio > RED_VETO_RATIO) || (redClusters >= RED_VETO_CLUSTER);
      let result = "NG?";
      if (!redPresent && window.__gStable__ >= STABLE_FRAMES) result = "OK";

      statusEl.textContent = result;
      statusEl.className = `badge ${result === "OK" ? "ok" : "ng"}`;

      // 数値表示
      let stat = document.getElementById("live-stats");
      if (!stat) {
        stat = document.createElement("div");
        stat.id = "live-stats";
        Object.assign(stat.style, {
          position: "fixed", left: "16px", bottom: "18px",
          color: "#fff", font: "600 14px system-ui", zIndex: "99"
        });
        document.body.appendChild(stat);
      }
      stat.textContent = `R:${(rRatio * 100).toFixed(1)}%  G:${(gRatio * 100).toFixed(1)}%`;

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

  // --- 撮影トリガー ---
  camBtn.addEventListener("click", () => triggerShot(false));

  function triggerShot(auto) {
    navigator.vibrate?.(200);
    if (auto) okSound.play().catch(() => {});

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
    const t = `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    ctx.font = "600 24px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(t, 18, vh - 24);

    const ts = `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;

    canvas.toBlob((blob) => {
      pendingFile = new File([blob], ts, { type: "image/jpeg" });
      if (auto) {
        const msg = document.createElement("div");
        msg.textContent = "📸 画面をタップして保存";
        Object.assign(msg.style, {
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(0,0,0,0.7)", color: "#fff",
          padding: "14px 22px", borderRadius: "10px",
          font: "600 18px system-ui", zIndex: "999"
        });
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 2000);
      }
    }, "image/jpeg", 0.92);
  }

  // --- 保存実行 ---
  document.body.addEventListener("click", () => {
    if (!pendingFile) return;
    const file = pendingFile;
    pendingFile = null;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: file.name,
        text: "画像を保存を選択してください"
      }).catch(() => {});
    }
  });
}
