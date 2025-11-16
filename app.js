(() => {
  const $ = s => document.querySelector(s);

  // DOM
  const modeSelect = $("#mode-select");
  const app = $("#app");
  const cam = $("#cam");
  const badge = $("#badge");
  const modeLabel = $("#mode-label");
  const flash = $("#flash");
  const shutterBtn = $("#shutter");

  // 調査モードパネル
  const rAvgEl = $("#r-avg");
  const gAvgEl = $("#g-avg");
  const bAvgEl = $("#b-avg");
  const rFracEl = $("#r-frac");
  const gFracEl = $("#g-frac");
  const bFracEl = $("#b-frac");

  // ミニパネル（昼夜）
  const miniREl = $("#mini-r");
  const miniGEl = $("#mini-g");

  let currentMode = "day";   // "day" | "night" | "debug"
  let stream = null;
  let rafId = null;

  // ==== モード選択 ====

  document.querySelectorAll(".mode-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      enterMode(mode);
    });
  });

  async function enterMode(mode) {
    currentMode = mode;
    document.body.dataset.mode = mode;

    if (mode === "day") modeLabel.textContent = "昼モード";
    else if (mode === "night") modeLabel.textContent = "夜モード";
    else modeLabel.textContent = "調査モード";

    // バッジ初期化
    if (mode === "debug") {
      badge.textContent = "";
    } else {
      badge.textContent = "NG?";
      badge.className = "badge ng";
    }

    modeSelect.hidden = true;
    app.hidden = false;

    if (!stream) {
      try {
        await startCamera();
      } catch (e) {
        alert("カメラ起動に失敗: " + e.message);
        return;
      }
    }
    if (!rafId) loop();
  }

  async function startCamera() {
    const constraintsList = [
      { video: { facingMode: { exact: "environment" } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false }
    ];

    for (const c of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (_) {}
    }
    if (!stream) throw new Error("カメラが見つかりません");

    cam.srcObject = stream;
    await cam.play();
  }

  // ==== 判定ループ ====

  function loop() {
    rafId = requestAnimationFrame(loop);

    const vw = cam.videoWidth;
    const vh = cam.videoHeight;
    if (!vw || !vh) return;

    const canvas = loop.canvas || (loop.canvas = Object.assign(document.createElement("canvas"), { width: vw, height: vh }));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.drawImage(cam, 0, 0, vw, vh);

    // ROI位置（右上）
    const rw = Math.floor(vw * 0.60);
    const rh = Math.floor(vh * 0.27);
    const rx = vw - rw - Math.floor(vw * 0.04);
    const ry = Math.floor(vh * 0.06);

    const img = ctx.getImageData(rx, ry, rw, rh).data;

    let rSum = 0, gSum = 0, bSum = 0;
    let redCount = 0, greenCount = 0, blueCount = 0, total = 0;

    // 6px 間引き
    for (let i = 0; i < img.length; i += 4 * 6) {
      const r = img[i];
      const g = img[i + 1];
      const b = img[i + 2];

      const sum = r + g + b + 1;
      const rn = r / sum;
      const gn = g / sum;
      const bn = b / sum;

      rSum += r;
      gSum += g;
      bSum += b;
      total++;

      const isRed   = (r > 90 && rn > 0.40 && r - g > 18 && r - b > 18);
      const isGreen = (g > 80 && gn > 0.40 && g - r > 10 && g - b > 10);
      if (isRed) redCount++;
      if (isGreen) greenCount++;

      // blue の参考値（特に閾値はまだ使わない）
      const isBlue = (b > 80 && bn > 0.40 && b - r > 10 && b - g > 10);
      if (isBlue) blueCount++;
    }

    const rAvg = rSum / Math.max(total, 1);
    const gAvg = gSum / Math.max(total, 1);
    const bAvg = bSum / Math.max(total, 1);

    const redFrac   = redCount / Math.max(total, 1);
    const greenFrac = greenCount / Math.max(total, 1);
    const blueFrac  = blueCount / Math.max(total, 1); // まだ判定には使わない

    // 表示更新
    updatePanels(rAvg, gAvg, bAvg, redFrac, greenFrac, blueFrac);

    // 判定（昼・夜モードのみ）
    if (currentMode === "day" || currentMode === "night") {
      const NG = redFrac > 0.010;
      const OK = !NG && greenFrac > 0.030;

      const result = OK ? "OK" : "NG?";
      setBadge(result);

      // ここでは自動シャッターは「無し」なので撮影はしない
    }
  }

  function updatePanels(rAvg, gAvg, bAvg, redFrac, greenFrac, blueFrac) {
    const rStr = rAvg.toFixed(1);
    const gStr = gAvg.toFixed(1);
    const bStr = bAvg.toFixed(1);
    const rfStr = (redFrac * 100).toFixed(2);
    const gfStr = (greenFrac * 100).toFixed(2);
    const bfStr = (blueFrac * 100).toFixed(2);

    // 調査モード
    rAvgEl.textContent = rStr;
    gAvgEl.textContent = gStr;
    bAvgEl.textContent = bStr;
    rFracEl.textContent = rfStr;
    gFracEl.textContent = gfStr;
    bFracEl.textContent = bfStr;

    // 昼夜モードの小さい表示は赤/緑比率だけ
    miniREl.textContent = `R% ${rfStr}`;
    miniGEl.textContent = `G% ${gfStr}`;
  }

  function setBadge(result) {
    if (currentMode === "debug") return; // 調査モードは表示しない

    badge.textContent = result;
    if (result === "OK") {
      badge.className = "badge ok";
    } else {
      badge.className = "badge ng";
    }
  }

  // ==== シャッター（手動のみ） ====

  shutterBtn.addEventListener("click", () => {
    // まずフラッシュ＆バイブ
    triggerFeedback();

    // JPEG保存は少し遅らせて、バイブが潰れないようにする
    setTimeout(() => {
      const mark = decideMarkForSave();
      captureAndSave(mark);
    }, 350);
  });

  function triggerFeedback() {
    // フラッシュ
    flash.classList.remove("flash-on");
    void flash.offsetWidth; // 再トリガ
    flash.classList.add("flash-on");

    // バイブ
    try {
      if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    } catch (_) {}
  }

  function decideMarkForSave() {
    if (currentMode === "debug") {
      return "DBG";
    }
    const txt = badge.textContent || "NG?";
    return txt === "OK" ? "OK" : "NG?";
  }

  async function captureAndSave(mark) {
    const vw = cam.videoWidth;
    const vh = cam.videoHeight;
    if (!vw || !vh) return;

    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(cam, 0, 0, vw, vh);

    // ラベル（下部帯）
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");

    const tsText = `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    const label = `日時:${tsText}   結果:${mark}`;

    const barH = Math.floor(vh * 0.06);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, vh - barH, vw, barH);

    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.floor(vw / 26)}px -apple-system,system-ui`;
    ctx.textBaseline = "middle";
    ctx.fillText(label, 18, vh - barH / 2);

    // JPEGデータURL（画質軽め）
    const quality = 0.7;
    const dataUrl = canvas.toDataURL("image/jpeg", quality);

    const fileName = `lamp_${y}${m}${d}_${hh}${mm}${ss}_${mark}.jpg`;

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

})();
