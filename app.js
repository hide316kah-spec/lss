(() => {
  // ---------- DOM 取得 ----------
  const modeSelect = document.getElementById("mode-select");
  const dayBtn = document.getElementById("dayBtn");
  const nightBtn = document.getElementById("nightBtn");
  const inspectBtn = document.getElementById("inspectBtn");

  const app = document.getElementById("app");
  const cam = document.getElementById("cam");
  const preview = document.getElementById("previewCanvas");
  const capture = document.getElementById("captureCanvas");

  const modeLabel = document.getElementById("modeLabel");
  const badge = document.getElementById("badge");
  const inspectBox = document.getElementById("inspectBox");
  const inspectTxt = document.getElementById("inspectTxt");
  const shutter = document.getElementById("shutter");
  const flashEffect = document.getElementById("flashEffect");

  // ---------- 状態 ----------
  let currentMode = "day"; // "day" | "night" | "debug"
  let stream = null;
  let lastMetrics = null; // { rAvg,gAvg,bAvg,redPct,greenPct,bluePct }
  let lastJudge = false;

  // ROI サイズ（A サイズ・右上固定）
  function calcRoi(w, h) {
    const roiW = Math.floor(w * 0.42);
    const roiH = Math.floor(h * 0.24); // Aサイズ（縦やや広め）
    const marginRight = Math.floor(w * 0.06);
    const marginTop = Math.floor(h * 0.14);

    const x = w - roiW - marginRight;
    const y = marginTop;

    return { x, y, w: roiW, h: roiH };
  }

  // ---------- カメラ起動 ----------
  async function startCameraOnce() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("この端末ではカメラが使えません。");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      cam.srcObject = stream;
      await cam.play();
      loop();
    } catch (err) {
      console.error(err);
      alert("カメラの起動に失敗しました。権限設定を確認してください。");
    }
  }

  // ---------- メインループ ----------
  function loop() {
    if (!stream || cam.readyState < 2) {
      requestAnimationFrame(loop);
      return;
    }

    const vw = cam.videoWidth || window.innerWidth;
    const vh = cam.videoHeight || window.innerHeight;

    if (preview.width !== vw || preview.height !== vh) {
      preview.width = vw;
      preview.height = vh;
    }

    const ctx = preview.getContext("2d");
    ctx.drawImage(cam, 0, 0, vw, vh);

    const roi = calcRoi(vw, vh);

    // ROI 内の平均色を計算
    const img = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);
    const data = img.data;
    let rSum = 0,
      gSum = 0,
      bSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    const count = data.length / 4 || 1;
    const rAvg = rSum / count;
    const gAvg = gSum / count;
    const bAvg = bSum / count;
    const total = rAvg + gAvg + bAvg || 1;

    const redPct = (rAvg / total) * 100;
    const greenPct = (gAvg / total) * 100;
    const bluePct = (bAvg / total) * 100;

    lastMetrics = { rAvg, gAvg, bAvg, redPct, greenPct, bluePct };

    // ROI 枠を描画
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,0,0.9)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    ctx.restore();

    updateUI();

    requestAnimationFrame(loop);
  }

  // ---------- 判定ロジック ----------
  function judge(mode, m) {
    if (!m) return false;

    if (mode === "day") {
      // 昼モード（赤 LED 優先）：暫定値
      return m.redPct > 36 && m.rAvg > 120;
    }
    if (mode === "night") {
      // 夜モード（暗めを想定）：暫定値
      return m.redPct > 32 && m.rAvg > 110;
    }
    return false;
  }

  function modeNameJa() {
    if (currentMode === "day") return "昼モード";
    if (currentMode === "night") return "夜モード";
    return "調査モード";
  }

  function updateUI() {
    modeLabel.textContent = modeNameJa();

    if (!lastMetrics) return;

    const m = lastMetrics;

    const text =
      `Ravg : ${m.rAvg.toFixed(1)}\n` +
      `Gavg : ${m.gAvg.toFixed(1)}\n` +
      `Bavg : ${m.bAvg.toFixed(1)}\n` +
      `red% : ${m.redPct.toFixed(2)}\n` +
      `green%: ${m.greenPct.toFixed(2)}\n` +
      `blue% : ${m.bluePct.toFixed(2)}`;

    inspectTxt.textContent = text;

    if (currentMode === "debug") {
      badge.style.display = "none";
      inspectBox.classList.remove("small");
      return;
    }

    inspectBox.classList.add("small");
    badge.style.display = "block";

    const ok = judge(currentMode, m);
    lastJudge = ok;

    badge.textContent = ok ? "OK" : "NG?";
    badge.classList.toggle("ok", ok);
    badge.classList.toggle("ng", !ok);
  }

  // ---------- シャッター ----------
  function triggerFlash() {
    flashEffect.classList.add("active");
    setTimeout(() => {
      flashEffect.classList.remove("active");
    }, 120);
  }

  function triggerVibration() {
    if (navigator.vibrate) {
      navigator.vibrate(120);
    }
  }

  function formatFileTimestamp() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return (
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  function saveCurrentFrame() {
    if (!stream || !lastMetrics || cam.readyState < 2) return;

    const vw = cam.videoWidth;
    const vh = cam.videoHeight;
    if (!vw || !vh) return;

    capture.width = vw;
    capture.height = vh;

    const ctx = capture.getContext("2d");
    ctx.drawImage(cam, 0, 0, vw, vh);

    const roi = calcRoi(vw, vh);

    // ROI 枠
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,0,0.9)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    ctx.restore();

    // 文字焼き込み（左上）
    const resultLabel =
      currentMode === "debug" ? "DBG" : lastJudge ? "OK" : "NG?";
    const stamp = `lamp ${formatFileTimestamp()} ${modeNameJa()} ${resultLabel}`;

    ctx.save();
    ctx.font = "24px -apple-system, BlinkMacSystemFont, sans-serif";
    const textWidth = ctx.measureText(stamp).width + 20;
    const boxHeight = 34;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(8, 8, textWidth, boxHeight);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(stamp, 18, 34);
    ctx.restore();

    // JPEG で保存（軽め）
    const dataUrl = capture.toDataURL("image/jpeg", 0.6);
    const filename = `lamp_${formatFileTimestamp()}_${resultLabel}.jpg`;

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  shutter.addEventListener("click", () => {
    if (!stream) return;
    triggerFlash();
    triggerVibration();
    saveCurrentFrame();
  });

  // ---------- モード選択 ----------
  function enterMode(mode) {
    currentMode = mode;
    modeSelect.style.display = "none";
    app.classList.remove("hidden");
    updateUI();
    startCameraOnce();
  }

  dayBtn.addEventListener("click", () => enterMode("day"));
  nightBtn.addEventListener("click", () => enterMode("night"));
  inspectBtn.addEventListener("click", () => enterMode("debug"));
})();
