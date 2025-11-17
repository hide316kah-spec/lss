// ===== グローバル状態 =====
let currentMode = null; // 'day' | 'night' | 'inspect'
let videoStream = null;
let video = null;
let previewCanvas = null;
let previewCtx = null;
let captureCanvas = null;
let captureCtx = null;
let okSound = null;

let roi = { x: 0, y: 0, w: 0, h: 0 }; // プレビュー上の ROI 情報

// 閾値（仮置き / 後から調整用）
const THRESHOLDS = {
  day: {
    redMin: 90,
    redRatio: 0.4
  },
  night: {
    redMin: 60,
    redRatio: 0.35
  },
  greenMin: 60,
  greenRatio: 0.35
};

// ===== 初期化 =====
window.addEventListener('DOMContentLoaded', () => {
  // DOM
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

  // モード選択
  modeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.getAttribute('data-mode'); // day/night/inspect
      currentMode = mode;

      // モード名表示
      if (mode === 'day') {
        modeNameEl.textContent = '昼モード';
      } else if (mode === 'night') {
        modeNameEl.textContent = '夜モード';
      } else {
        modeNameEl.textContent = '調査モード';
      }
      document.body.setAttribute('data-mode', mode);

      // UI 切り替え
      modeSelect.classList.add('hidden');
      app.classList.remove('hidden');

      // カメラ起動（初回のみ）
      if (!videoStream) {
        await initCamera();
      }
    });
  });

  // モード選択画面に戻る
  backBtn.addEventListener('click', () => {
    stopCamera();
    currentMode = null;
    document.body.removeAttribute('data-mode');
    app.classList.add('hidden');
    document.getElementById('modeSelect').classList.remove('hidden');
  });

  // 撮影ボタン（100% 手動）
  shutterButton.addEventListener('click', () => {
    if (!videoStream || !currentMode) return;
    captureAndSave();
  });

  // サービスワーカー登録（PWA）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    });
  }

  // ===== カメラ初期化 =====
  async function initCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment'
        },
        audio: false
      });
      video.srcObject = videoStream;

      video.addEventListener('loadedmetadata', () => {
        resizeCanvases();
        startPreviewLoop();
      });
    } catch (err) {
      console.error('カメラ起動エラー', err);
      alert('カメラにアクセスできませんでした。ブラウザ設定とHTTPSを確認してください。');
    }
  }

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
  }

  // 画面サイズに合わせて canvas 調整
  function resizeCanvases() {
    const wrapper = document.getElementById('videoWrapper');
    const rect = wrapper.getBoundingClientRect();
    previewCanvas.width = rect.width;
    previewCanvas.height = rect.height;

    // captureCanvas は実際の保存サイズに合わせる
    // （ここではプレビューと同じにしておく）
    captureCanvas.width = rect.width;
    captureCanvas.height = rect.height;

    // ROI 設定：右上・横長固定
    const margin = 10;
    const roiWidth = rect.width * 0.5;
    const roiHeight = rect.height * 0.18;
    roi.w = roiWidth;
    roi.h = roiHeight;
    roi.x = rect.width - roiWidth - margin;
    roi.y = margin;
  }

  window.addEventListener('resize', resizeCanvases);

  // プレビュー描画ループ（ROI・数値更新）
  function startPreviewLoop() {
    function loop() {
      if (!videoStream) return;

      const w = previewCanvas.width;
      const h = previewCanvas.height;
      previewCtx.clearRect(0, 0, w, h);

      // 現フレームをプレビュー canvas に描画
      previewCtx.drawImage(video, 0, 0, w, h);

      // ROI 枠表示
      previewCtx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
      previewCtx.lineWidth = 2;
      previewCtx.strokeRect(roi.x, roi.y, roi.w, roi.h);

      // ROI 内の数値計算（調査モード用）
      const stats = computeRoiStats(previewCtx, roi);
      updateInspectPanel(stats);

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // ROI の平均値など計算
  function computeRoiStats(ctx, roi) {
    const step = 6; // 6px 間隔
    const { x, y, w, h } = roi;

    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;
    let redDominant = 0;
    let greenDominant = 0;
    let blueDominant = 0;

    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;

    for (let yy = 0; yy < h; yy += step) {
      for (let xx = 0; xx < w; xx += step) {
        const idx = ((yy * w) + xx) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        sumR += r;
        sumG += g;
        sumB += b;
        count++;

        if (r > g && r > b) redDominant++;
        else if (g > r && g > b) greenDominant++;
        else if (b > r && b > g) blueDominant++;
      }
    }

    if (count === 0) {
      return {
        rAvg: 0,
        gAvg: 0,
        bAvg: 0,
        redPct: 0,
        greenPct: 0,
        bluePct: 0
      };
    }

    const rAvg = sumR / count;
    const gAvg = sumG / count;
    const bAvg = sumB / count;
    const redPct = redDominant / count;
    const greenPct = greenDominant / count;
    const bluePct = blueDominant / count;

    return { rAvg, gAvg, bAvg, redPct, greenPct, bluePct };
  }

  function updateInspectPanel(stats) {
    const { rAvg, gAvg, bAvg, redPct, greenPct, bluePct } = stats;

    rAvgVal.textContent = rAvg.toFixed(1);
    gAvgVal.textContent = gAvg.toFixed(1);
    bAvgVal.textContent = bAvg.toFixed(1);
    redPctVal.textContent = (redPct * 100).toFixed(1);
    greenPctVal.textContent = (greenPct * 100).toFixed(1);
    bluePctVal.textContent = (bluePct * 100).toFixed(1);
  }

  // 撮影＋保存（100% 手動）
  function captureAndSave() {
    // バイブ（サイレントでも原則動作）
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // フラッシュ演出
    flashOverlay.classList.add('active');
    setTimeout(() => {
      flashOverlay.classList.remove('active');
    }, 150);

    // 現フレームを captureCanvas に描画
    const w = captureCanvas.width;
    const h = captureCanvas.height;
    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(video, 0, 0, w, h);

    // ROI 認識は captureCanvas 上で再度計算
    const roiOnCapture = {
      x: roi.x,
      y: roi.y,
      w: roi.w,
      h: roi.h
    };
    const stats = computeRoiStats(captureCtx, roiOnCapture);

    // モード別判定
    const decision = decideResult(currentMode, stats);
    // decision: { code: 'OK' | 'NG' | 'DBG', label: 'OK' | 'NG?' | '調査' | '', playOk: boolean }

    // 画像に日付＋結果を焼き込み
    const now = new Date();
    const dateStr = formatDateForOverlay(now);  // YYYY/MM/DD HH:MM:SS
    const fileBase = formatDateForFile(now);    // YYYYMMDD_HHMMSS

    overlayText(captureCtx, w, h, dateStr, decision.label);

    // OK のときだけ音声（昼/夜モードのみ）
    if (decision.playOk && okSound) {
      okSound.currentTime = 0;
      okSound.play().catch(() => {});
    }

    // ファイル名
    let fileName;
    if (currentMode === 'inspect') {
      fileName = `${fileBase}_DBG.jpg`; // 調査用
    } else if (decision.code === 'OK') {
      fileName = `${fileBase}_OK.jpg`;
    } else {
      fileName = `${fileBase}_NG?.jpg`;
    }

    // 自動ダウンロード（→ iOS ではここから Share シートで保存）
    const url = captureCanvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // 判定ロジック
  function decideResult(mode, stats) {
    const { rAvg, redPct, gAvg, greenPct } = stats;

    if (mode === 'inspect') {
      // 調査モード：OK/NG は出さない、ラベルのみ「調査」
      return {
        code: 'DBG',
        label: '調査',
        playOk: false
      };
    }

    // 赤 LED 優先
    const dayTh = THRESHOLDS.day;
    const nightTh = THRESHOLDS.night;

    const th = mode === 'day' ? dayTh : nightTh;

    const redOn = (rAvg >= th.redMin) && (redPct >= th.redRatio);
    const greenOn = (gAvg >= (THRESHOLDS.greenMin || 60)) && (greenPct >= (THRESHOLDS.greenRatio || 0.35));

    // ここは「赤LEDが点いていたらOK」と仮置き。
    // 実際の OK/NG ロジックが逆の場合は、この if を書き換える。
    if (redOn) {
      return {
        code: 'OK',
        label: 'OK',
        playOk: true
      };
    } else {
      return {
        code: 'NG',
        label: 'NG?',
        playOk: false
      };
    }
  }

  // 日付フォーマット（オーバーレイ用）
  function formatDateForOverlay(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
  }

  // 日付フォーマット（ファイル名用）
  function formatDateForFile(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${y}${m}${day}_${hh}${mm}${ss}`;
  }

  // 画像に日付＋ラベルを焼き込み
  function overlayText(ctx, w, h, dateStr, label) {
    const boxHeight = 50;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, h - boxHeight, w, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = '18px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    ctx.fillText(dateStr, 12, h - boxHeight / 2);

    if (label && label.length > 0) {
      const textWidth = ctx.measureText(label).width;
      ctx.fillText(label, w - textWidth - 12, h - boxHeight / 2);
    }
    ctx.restore();
  }
});
