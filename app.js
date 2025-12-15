// ===== グローバル状態 =====
let currentMode = null; // 'day' | 'night' | 'inspect'
let videoStream = null;
let video = null;
let previewCanvas = null;
let previewCtx = null;
let captureCanvas = null;
let captureCtx = null;
let okSound = null;

let roi = { x: 0, y: 0, w: 0, h: 0 };

// 閾値（昼/夜で分けて持つ：昼は紙デモなので基本いじらない）
const THRESHOLDS = {
  day: {
    redStrongPct: 40,
    redMaybePct: 35,
    redDominanceMargin: 3,

    // “ホット赤”は昼は弱め（紙デモで暴れないように）
    hotRedMinCount: 6,
    hotR: 200,
    hotRatio: 1.35,
    hotMaxR: 240
  },
  night: {
    redStrongPct: 40,
    redMaybePct: 35,
    redDominanceMargin: 3,

    // ★夜はここが本命：赤が小さくても強く光ったらNG?にする
    hotRedMinCount: 2,
    hotR: 180,
    hotRatio: 1.35,
    hotMaxR: 220
  }
};

window.addEventListener('DOMContentLoaded', () => {
  const modeSelect = document.getElementById('modeSelect');
  const app = document.getElementById('app');
  const modeButtons = document.querySelectorAll('.mode-card');
  const modeNameEl = document.getElementById('modeName');
  const backBtn = document.getElementById('backToModeSelect');
  const shutterButton = document.getElementById('shutterButton');

  video = document.getElementById('video');
  previewCanvas = document.getElementById('previewCanvas');
  previewCtx = previewCanvas.getContext('2d');
  captureCanvas = document.getElementById('captureCanvas');
  captureCtx = captureCanvas.getContext('2d');
  okSound = document.getElementById('okSound');

  // 数値表示
  const rAvgVal = document.getElementById('rAvgVal');
  const gAvgVal = document.getElementById('gAvgVal');
  const bAvgVal = document.getElementById('bAvgVal');
  const redPctVal = document.getElementById('redPctVal');
  const greenPctVal = document.getElementById('greenPctVal');
  const bluePctVal = document.getElementById('bluePctVal');

  const flashOverlay = document.getElementById('flashOverlay');
  const videoWrapper = document.getElementById('videoWrapper');
  const shutterImage = document.getElementById('shutterImage');

  // モード選択
  modeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.getAttribute('data-mode'); // day/night/inspect
      currentMode = mode;

      if (mode === 'day') modeNameEl.textContent = '昼モード';
      else if (mode === 'night') modeNameEl.textContent = '夜モード';
      else modeNameEl.textContent = '調査モード';

      document.body.setAttribute('data-mode', mode);

      modeSelect.classList.add('hidden');
      app.classList.remove('hidden');

      if (!videoStream) {
        await initCamera();
      }
    });
  });

  backBtn.addEventListener('click', () => {
    stopCamera();
    currentMode = null;
    document.body.removeAttribute('data-mode');
    app.classList.add('hidden');
    document.getElementById('modeSelect').classList.remove('hidden');
  });

  shutterButton.addEventListener('click', () => {
    if (!videoStream || !currentMode) return;
    captureAndSave();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    });
  }

  async function initCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = videoStream;

      video.addEventListener('loadedmetadata', () => {
        resizeCanvases();
        startPreviewLoop();
      });
    } catch (err) {
      console.error('カメラ起動エラー', err);
      alert('カメラにアクセスできませんでした。HTTPSと許可設定を確認してください。');
    }
  }

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
  }

  function resizeCanvases() {
    const wrapper = document.getElementById('videoWrapper');
    const rect = wrapper.getBoundingClientRect();

    previewCanvas.width = rect.width;
    previewCanvas.height = rect.height;

    captureCanvas.width = rect.width;
    captureCanvas.height = rect.height;

    // ROI：右上・横長固定
    const margin = 10;
    const roiWidth = rect.width * 0.5;
    const roiHeight = rect.height * 0.18;
    roi.w = roiWidth;
    roi.h = roiHeight;
    roi.x = rect.width - roiWidth - margin;
    roi.y = margin;
  }

  window.addEventListener('resize', resizeCanvases);

  function startPreviewLoop() {
    function loop() {
      if (!videoStream) return;

      const w = previewCanvas.width;
      const h = previewCanvas.height;

      previewCtx.clearRect(0, 0, w, h);
      previewCtx.drawImage(video, 0, 0, w, h);

      // ROI枠はプレビューのみ
      previewCtx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
      previewCtx.setLineDash([6, 4]);
      previewCtx.lineWidth = 2;
      previewCtx.strokeRect(roi.x, roi.y, roi.w, roi.h);
      previewCtx.setLineDash([]);

      const stats = computeRoiStats(previewCtx, roi, currentMode || 'night');

      // 表示は今まで通り6項目だけ（UIは変えない）
      rAvgVal.textContent = stats.rAvg.toFixed(1);
      gAvgVal.textContent = stats.gAvg.toFixed(1);
      bAvgVal.textContent = stats.bAvg.toFixed(1);
      redPctVal.textContent = (stats.redPct * 100).toFixed(2);
      greenPctVal.textContent = (stats.greenPct * 100).toFixed(2);
      bluePctVal.textContent = (stats.bluePct * 100).toFixed(2);

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // ROI統計：平均 + 支配率 + ★ホット赤カウント + maxR
  function computeRoiStats(ctx, roiRect, modeForHot) {
    const step = 6;
    const { x, y, w, h } = roiRect;

    const th = THRESHOLDS[modeForHot] || THRESHOLDS.night;

    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;
    let redDominant = 0, greenDominant = 0, blueDominant = 0;

    let hotRedCount = 0;
    let maxR = 0;

    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;

    for (let yy = 0; yy < h; yy += step) {
      for (let xx = 0; xx < w; xx += step) {
        const idx = ((yy * w) + xx) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        sumR += r; sumG += g; sumB += b;
        count++;

        if (r > g && r > b) redDominant++;
        else if (g > r && g > b) greenDominant++;
        else if (b > r && b > g) blueDominant++;

        if (r > maxR) maxR = r;

        // ★ホット赤：Rが高く、RがG/Bより比率で優勢
        if (
          r >= th.hotR &&
          r >= g * th.hotRatio &&
          r >= b * th.hotRatio
        ) {
          hotRedCount++;
        }
      }
    }

    if (count === 0) {
      return { rAvg: 0, gAvg: 0, bAvg: 0, redPct: 0, greenPct: 0, bluePct: 0, hotRedCount: 0, maxR: 0 };
    }

    return {
      rAvg: sumR / count,
      gAvg: sumG / count,
      bAvg: sumB / count,
      redPct: redDominant / count,
      greenPct: greenDominant / count,
      bluePct: blueDominant / count,
      hotRedCount,
      maxR
    };
  }

  function captureAndSave() {
    // 物理バイブ（iOS Safariは基本無理）
    if (navigator.vibrate) navigator.vibrate(100);

    // フラッシュ
    flashOverlay.classList.add('active');
    setTimeout(() => flashOverlay.classList.remove('active'), 150);

    // 擬似バイブ
    app.classList.add('shake');
    videoWrapper.classList.add('ls-blink-border');
    shutterImage.classList.add('ls-pulse');
    setTimeout(() => {
      app.classList.remove('shake');
      videoWrapper.classList.remove('ls-blink-border');
      shutterImage.classList.remove('ls-pulse');
    }, 300);

    const w = captureCanvas.width;
    const h = captureCanvas.height;

    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(video, 0, 0, w, h);

    const stats = computeRoiStats(captureCtx, roi, currentMode);

    const decision = decideResult(currentMode, stats);

    const now = new Date();
    const dateStr = formatDateForOverlay(now);
    const fileBase = formatDateForFile(now);

    overlayText(captureCtx, w, h, dateStr, decision.label);

    // 調査モードだけ数値焼き込み
    if (currentMode === 'inspect') {
      overlayInspectStats(captureCtx, w, h, stats);
    }

    if (decision.playOk && okSound) {
      okSound.currentTime = 0;
      okSound.play().catch(() => {});
    }

    let fileName;
    if (currentMode === 'inspect') fileName = `${fileBase}_DBG.jpg`;
    else if (decision.code === 'OK') fileName = `${fileBase}_OK.jpg`;
    else fileName = `${fileBase}_NG?.jpg`;

    const url = captureCanvas.toDataURL('image/jpeg', 0.92);
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|od|ad)/.test(ua);

    if (isIOS) {
      const win = window.open(url, '_blank');
      if (!win) location.href = url;
      try {
        if (!localStorage.getItem('ls_ios_save_hint_shown')) {
          alert('iPhoneでは自動で写真アプリに保存できません。\n開いた画像の共有ボタンから「写真に保存」を選んでください。');
          localStorage.setItem('ls_ios_save_hint_shown', '1');
        }
      } catch (e) {}
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // ★赤優勢判定：面積 + ホット赤 + maxR
  function isRedStrong(mode, stats) {
    const th = THRESHOLDS[mode] || THRESHOLDS.night;

    const rp = stats.redPct * 100;
    const gp = stats.greenPct * 100;
    const bp = stats.bluePct * 100;

    // 1) 面積で強い赤
    if (rp >= th.redStrongPct) return true;

    // 2) “ホット赤”が少数でも出てたらNG?（赤ランプ小さくても拾う）
    if (stats.hotRedCount >= th.hotRedMinCount) return true;

    // 3) maxRが高い（瞬間的に強い赤が入った）
    if (stats.maxR >= th.hotMaxR) return true;

    // 4) 中間ゾーン：赤が他より明確に優勢
    const dominance = rp - Math.max(gp, bp);
    if (
      rp >= th.redMaybePct &&
      dominance >= th.redDominanceMargin &&
      stats.rAvg >= stats.gAvg &&
      stats.rAvg >= stats.bAvg
    ) {
      return true;
    }

    return false;
  }

  function decideResult(mode, stats) {
    if (mode === 'inspect') {
      return { code: 'DBG', label: '調査', playOk: false };
    }

    const redStrong = isRedStrong(mode, stats);

    if (redStrong) {
      return { code: 'NG', label: 'NG?', playOk: false };
    }
    return { code: 'OK', label: 'OK', playOk: true };
  }

  function formatDateForOverlay(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
  }

  function formatDateForFile(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}${m}${day}_${hh}${mm}${ss}`;
  }

  function overlayText(ctx, w, h, dateStr, label) {
    const boxHeight = 50;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, h - boxHeight, w, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = '18px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    ctx.fillText(dateStr, 12, h - boxHeight / 2);

    if (label) {
      const textWidth = ctx.measureText(label).width;
      ctx.fillText(label, w - textWidth - 12, h - boxHeight / 2);
    }
    ctx.restore();
  }

  function overlayInspectStats(ctx, w, h, stats) {
    const panelWidth = Math.min(240, w * 0.38);
    const panelHeight = 150;
    const x = 12;
    const y = h * 0.3;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x, y, panelWidth, panelHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = '14px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'top';

    const lh = 20;
    let yy = y + 8;

    ctx.fillText(`Ravg : ${stats.rAvg.toFixed(1)}`, x + 10, yy); yy += lh;
    ctx.fillText(`Gavg : ${stats.gAvg.toFixed(1)}`, x + 10, yy); yy += lh;
    ctx.fillText(`Bavg : ${stats.bAvg.toFixed(1)}`, x + 10, yy); yy += lh;
    ctx.fillText(`red% : ${(stats.redPct * 100).toFixed(2)}`, x + 10, yy); yy += lh;
    ctx.fillText(`green%: ${(stats.greenPct * 100).toFixed(2)}`, x + 10, yy); yy += lh;
    ctx.fillText(`blue% : ${(stats.bluePct * 100).toFixed(2)}`, x + 10, yy);

    ctx.restore();
  }
});
