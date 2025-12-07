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

// 閾値（現状は昼/夜共通。必要になったら別々にする）
const THRESHOLDS = {
  day: {
    redStrongPct: 40,      // red% がこれ以上なら「強い赤」
    redMaybePct: 35,       // この範囲は他条件と組み合わせて NG
    redDominanceMargin: 3  // red% が他色より何ポイント高いか
  },
  night: {
    redStrongPct: 40,
    redMaybePct: 35,
    redDominanceMargin: 3
  }
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
  const videoWrapper = document.getElementById('videoWrapper');
  const shutterImage = document.getElementById('shutterImage');

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
      previewCtx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
      previewCtx.setLineDash([6, 4]);
      previewCtx.lineWidth = 2;
      previewCtx.strokeRect(roi.x, roi.y, roi.w, roi.h);
      previewCtx.setLineDash([]);

      // ROI 内の数値計算
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
    redPctVal.textContent = (redPct * 100).toFixed(2);
    greenPctVal.textContent = (greenPct * 100).toFixed(2);
    bluePctVal.textContent = (bluePct * 100).toFixed(2);
  }

  // ===== 撮影＋保存（100% 手動） =====
  function captureAndSave() {
    // 物理バイブ（Androidなどのみ）：iOS Safari は非対応
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // フラッシュ演出
    flashOverlay.classList.add('active');
    setTimeout(() => {
      flashOverlay.classList.remove('active');
    }, 150);

    // 疑似バイブ：画面シェイク + 赤枠点滅 + シャッターボタン拡大
    app.classList.add('shake');
    videoWrapper.classList.add('ls-blink-border');
    shutterImage.classList.add('ls-pulse');
    setTimeout(() => {
      app.classList.remove('shake');
      videoWrapper.classList.remove('ls-blink-border');
      shutterImage.classList.remove('ls-pulse');
    }, 300);

    // 現フレームを captureCanvas に描画
    const w = captureCanvas.width;
    const h = captureCanvas.height;
    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(video, 0, 0, w, h);

    // ROI 認識は captureCanvas 上で再度計算（保存画像には枠は描かない）
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

    // 保存処理
    const url = captureCanvas.toDataURL('image/jpeg', 0.92);
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|od|ad)/.test(ua);

    if (isIOS) {
      // iPhone/iPad：画像を表示 → 共有ボタンから「写真に保存」
      const win = window.open(url, '_blank');
      if (!win) {
        // PWAなどで window.open がブロックされた場合
        location.href = url;
      }
      try {
        if (!localStorage.getItem('ls_ios_save_hint_shown')) {
          alert('iPhoneでは自動で写真アプリに保存できません。\n開いた画像の共有ボタンから「写真に保存」を選んでください。');
          localStorage.setItem('ls_ios_save_hint_shown', '1');
        }
      } catch (e) {}
    } else {
      // PC / Android：ダウンロード
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // ===== 赤優勢かどうかの判定 =====
  function isRedStrong(mode, stats) {
    const { rAvg, gAvg, bAvg, redPct, greenPct, bluePct } = stats;
    const th = THRESHOLDS[mode] || THRESHOLDS.day;

    // % 表示と同じスケールに合わせる
    const rp = redPct * 100;
    const gp = greenPct * 100;
    const bp = bluePct * 100;

    const dominance = rp - Math.max(gp, bp);

    // ① 明確に高い赤
    if (rp >= th.redStrongPct) {
      return true;
    }

    // ② 中間ゾーンだが赤が他より明確に上で、平均値も赤寄り
    if (
      rp >= th.redMaybePct &&
      dominance >= th.redDominanceMargin &&
      rAvg >= gAvg &&
      rAvg >= bAvg
    ) {
      return true;
    }

    return false;
  }

  // ===== 判定ロジック（昼/夜） =====
  function decideResult(mode, stats) {
    const { redPct, greenPct, bluePct } = stats;

    if (mode === 'inspect') {
      // 調査モード：OK/NG は出さない、ラベルのみ「調査」
      return {
        code: 'DBG',
        label: '調査',
        playOk: false
      };
    }

    const redStrong = isRedStrong(mode, stats);

    if (redStrong) {
      // 赤ランプが優勢 → NG?
      return {
        code: 'NG',
        label: 'NG?',
        playOk: false
      };
    } else {
      // 赤優勢ではない（緑優勢 or 中立）→ OK
      return {
        code: 'OK',
        label: 'OK',
        playOk: true
      };
    }
  }

  // ===== 日付フォーマット =====
  function formatDateForOverlay(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
  }

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
