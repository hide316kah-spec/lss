// ランプシャッター（横取り装置判定 Web アプリ / PWA版）
// 仕様：ROI右上固定 / 手動シャッター / フラッシュ+擬似バイブ / OK音声(OKのみ) / iOSはShare保存

let currentMode = null; // 'day' | 'night' | 'inspect'
let videoStream = null;

const THRESHOLDS = {
  // 昼：紙デモ用（当面は甘めでもOK）
  day: {
    redStrongPct: 40,
    redMaybePct: 35,
    redDominanceMargin: 3,
    hotRedMinCount: 8,
    hotR: 210,
    hotRatio: 1.35,
    hotMaxR: 245
  },
  // 夜：本番用（赤が小さくても拾う）
  night: {
    redStrongPct: 40,
    redMaybePct: 35,
    redDominanceMargin: 3,
    hotRedMinCount: 2,
    hotR: 180,
    hotRatio: 1.35,
    hotMaxR: 225
  }
};

const ROI_CONFIG = {
  // 右上固定・横長
  wRatio: 0.50,
  hRatio: 0.18,
  margin: 10
};

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|od|ad)/.test(ua);
}

function fmtOverlayDate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  const hh=String(d.getHours()).padStart(2,'0');
  const mm=String(d.getMinutes()).padStart(2,'0');
  const ss=String(d.getSeconds()).padStart(2,'0');
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}
function fmtFileDate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  const hh=String(d.getHours()).padStart(2,'0');
  const mm=String(d.getMinutes()).padStart(2,'0');
  const ss=String(d.getSeconds()).padStart(2,'0');
  return `${y}${m}${day}_${hh}${mm}${ss}`;
}

window.addEventListener('DOMContentLoaded', () => {
  const modeSelect = document.getElementById('modeSelect');
  const app = document.getElementById('app');

  const modeButtons = document.querySelectorAll('.mode-card');
  const backBtn = document.getElementById('backToModeSelect');
  const modeNameEl = document.getElementById('modeName');
  const judgeBadge = document.getElementById('judgeBadge');

  const video = document.getElementById('video');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const overlayCtx = overlayCanvas.getContext('2d');

  const captureCanvas = document.getElementById('captureCanvas');
  const captureCtx = captureCanvas.getContext('2d');

  const flashOverlay = document.getElementById('flashOverlay');
  const videoWrapper = document.getElementById('videoWrapper');
  const shutterButton = document.getElementById('shutterButton');
  const shutterImage = document.getElementById('shutterImage');
  const okSound = document.getElementById('okSound');
  const statusEl = document.getElementById('status');

  // 数値表示
  const rAvgVal = document.getElementById('rAvgVal');
  const gAvgVal = document.getElementById('gAvgVal');
  const bAvgVal = document.getElementById('bAvgVal');
  const redPctVal = document.getElementById('redPctVal');
  const greenPctVal = document.getElementById('greenPctVal');
  const bluePctVal = document.getElementById('bluePctVal');

  const roi = { x:0, y:0, w:0, h:0 };

  const setStatus = (s, show=false) => {
    if (!statusEl) return;
    statusEl.textContent = `status: ${s}`;
    if (show) statusEl.classList.remove('hidden');
  };

  function setModeUI(mode){
    currentMode = mode;
    document.body.setAttribute('data-mode', mode);

    if (mode === 'day') modeNameEl.textContent = '昼モード';
    else if (mode === 'night') modeNameEl.textContent = '夜モード';
    else modeNameEl.textContent = '調査モード';

    // バッジ：調査は出さない
    if (mode === 'inspect') {
      judgeBadge.classList.add('hidden');
    } else {
      judgeBadge.classList.remove('hidden');
      judgeBadge.textContent = '…';
      judgeBadge.classList.remove('ng');
    }
  }

  function resizeAll(){
    const rect = videoWrapper.getBoundingClientRect();

    overlayCanvas.width = Math.floor(rect.width);
    overlayCanvas.height = Math.floor(rect.height);

    captureCanvas.width = Math.floor(rect.width);
    captureCanvas.height = Math.floor(rect.height);

    // ROI（右上固定）
    roi.w = rect.width * ROI_CONFIG.wRatio;
    roi.h = rect.height * ROI_CONFIG.hRatio;
    roi.x = rect.width - roi.w - ROI_CONFIG.margin;
    roi.y = ROI_CONFIG.margin;

    // 画面外に出ない保険
    roi.x = Math.max(0, roi.x);
    roi.y = Math.max(0, roi.y);
    roi.w = Math.max(10, roi.w);
    roi.h = Math.max(10, roi.h);
  }

  window.addEventListener('resize', resizeAll);

  // ★重要：videoの表示（object-fit:cover）と同じ切り出しでcanvasに描く
  function drawCover(ctx, vw, vh){
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    if (!vw || !vh || !cw || !ch) return;

    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.drawImage(video, dx, dy, dw, dh);
  }

  // ROI統計（平均/支配率 + hotRedCount + maxR）
  function computeRoiStats(ctx, roiRect, mode){
    const th = THRESHOLDS[mode] || THRESHOLDS.night;
    const step = 6;

    const x = Math.floor(roiRect.x);
    const y = Math.floor(roiRect.y);
    const w = Math.floor(roiRect.w);
    const h = Math.floor(roiRect.h);

    const img = ctx.getImageData(x, y, w, h);
    const data = img.data;

    let sumR=0,sumG=0,sumB=0,count=0;
    let rd=0,gd=0,bd=0;
    let hot=0;
    let maxR=0;

    for(let yy=0; yy<h; yy+=step){
      for(let xx=0; xx<w; xx+=step){
        const i=((yy*w)+xx)*4;
        const r=data[i], g=data[i+1], b=data[i+2];

        sumR+=r; sumG+=g; sumB+=b; count++;

        if (r>g && r>b) rd++;
        else if (g>r && g>b) gd++;
        else if (b>r && b>g) bd++;

        if (r>maxR) maxR=r;

        if (r >= th.hotR && r >= g*th.hotRatio && r >= b*th.hotRatio) {
          hot++;
        }
      }
    }

    if (!count){
      return { rAvg:0,gAvg:0,bAvg:0, redPct:0,greenPct:0,bluePct:0, hotRedCount:0, maxR:0 };
    }

    return {
      rAvg: sumR/count,
      gAvg: sumG/count,
      bAvg: sumB/count,
      redPct: rd/count,
      greenPct: gd/count,
      bluePct: bd/count,
      hotRedCount: hot,
      maxR
    };
  }

  function isRedStrong(mode, stats){
    const th = THRESHOLDS[mode] || THRESHOLDS.night;

    const rp = stats.redPct * 100;
    const gp = stats.greenPct * 100;
    const bp = stats.bluePct * 100;

    // 1) 面積が強い
    if (rp >= th.redStrongPct) return true;

    // 2) 小さくても“強い赤”が少数出たらNG
    if (stats.hotRedCount >= th.hotRedMinCount) return true;

    // 3) 最大赤が強烈（点灯の芯）
    if (stats.maxR >= th.hotMaxR) return true;

    // 4) 中間：赤が他より明確に優勢
    const dom = rp - Math.max(gp, bp);
    if (rp >= th.redMaybePct && dom >= th.redDominanceMargin && stats.rAvg >= stats.gAvg && stats.rAvg >= stats.bAvg) {
      return true;
    }

    return false;
  }

  function decide(mode, stats){
    if (mode === 'inspect') return { code:'DBG', label:'調査', playOk:false };

    if (isRedStrong(mode, stats)) return { code:'NG', label:'NG?', playOk:false };
    return { code:'OK', label:'OK', playOk:true };
  }

  function drawRoiFrame(){
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;

    overlayCtx.clearRect(0,0,w,h);

    // ROI枠のみ（映像はvideo要素に任せる）
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(0,255,0,.9)';
    overlayCtx.setLineDash([10,6]);
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    overlayCtx.restore();
  }

  function updateBadge(dec){
    if (currentMode === 'inspect') return;
    judgeBadge.textContent = dec.label;
    if (dec.code === 'NG') judgeBadge.classList.add('ng');
    else judgeBadge.classList.remove('ng');
  }

  function updatePanel(stats){
    rAvgVal.textContent = stats.rAvg.toFixed(1);
    gAvgVal.textContent = stats.gAvg.toFixed(1);
    bAvgVal.textContent = stats.bAvg.toFixed(1);
    redPctVal.textContent = (stats.redPct*100).toFixed(2);
    greenPctVal.textContent = (stats.greenPct*100).toFixed(2);
    bluePctVal.textContent = (stats.bluePct*100).toFixed(2);
  }

  // 解析は「coverと同じ切り出し」でオフスクリーンに描いてからやる
  const analysisCanvas = document.createElement('canvas');
  const analysisCtx = analysisCanvas.getContext('2d');

  function analysisFrame(){
    if (!videoStream || !currentMode) return;

    // サイズ同期
    analysisCanvas.width = overlayCanvas.width;
    analysisCanvas.height = overlayCanvas.height;

    analysisCtx.clearRect(0,0,analysisCanvas.width,analysisCanvas.height);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw && vh) {
      drawCover(analysisCtx, vw, vh);

      const stats = computeRoiStats(analysisCtx, roi, currentMode);
      updatePanel(stats);

      const dec = decide(currentMode, stats);
      updateBadge(dec);
    }

    drawRoiFrame();
    requestAnimationFrame(analysisFrame);
  }

  async function initCamera(){
    try{
      setStatus('camera starting');
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = videoStream;

      video.addEventListener('loadedmetadata', () => {
        resizeAll();
        setStatus('camera OK');
        requestAnimationFrame(analysisFrame);
      }, { once:true });

    }catch(err){
      setStatus(`camera ERROR: ${err && err.name ? err.name : err}`, true);
      alert('カメラが起動できません。\nSafariの「aA→Webサイトの設定→カメラ→許可」を確認して。');
    }
  }

  function stopCamera(){
    if (videoStream){
      videoStream.getTracks().forEach(t=>t.stop());
      videoStream=null;
    }
  }

  function flash(){
    flashOverlay.classList.add('active');
    setTimeout(()=>flashOverlay.classList.remove('active'), 120);
  }

  function pseudoVibe(){
    // iOS振動は期待しない（擬似で統一）
    document.getElementById('app').classList.add('shake');
    videoWrapper.classList.add('ls-blink-border');
    shutterImage.classList.add('ls-pulse');
    setTimeout(()=>{
      document.getElementById('app').classList.remove('shake');
      videoWrapper.classList.remove('ls-blink-border');
      shutterImage.classList.remove('ls-pulse');
    }, 300);
  }

  function overlayText(ctx, w, h, dateStr, label){
    const boxH = 50;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, h-boxH, w, boxH);
    ctx.fillStyle = '#fff';
    ctx.font = '18px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(dateStr, 12, h - boxH/2);
    if (label){
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, w - tw - 12, h - boxH/2);
    }
    ctx.restore();
  }

  function overlayInspectStats(ctx, w, h, stats){
    const panelW = Math.min(240, w*0.38);
    const panelH = 150;
    const px = 12;
    const py = h * 0.30;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(px, py, panelW, panelH);

    ctx.fillStyle = '#fff';
    ctx.font = '14px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'top';

    const lh = 20;
    let y = py + 8;
    ctx.fillText(`Ravg : ${stats.rAvg.toFixed(1)}`, px+10, y); y+=lh;
    ctx.fillText(`Gavg : ${stats.gAvg.toFixed(1)}`, px+10, y); y+=lh;
    ctx.fillText(`Bavg : ${stats.bAvg.toFixed(1)}`, px+10, y); y+=lh;
    ctx.fillText(`red% : ${(stats.redPct*100).toFixed(2)}`, px+10, y); y+=lh;
    ctx.fillText(`green%: ${(stats.greenPct*100).toFixed(2)}`, px+10, y); y+=lh;
    ctx.fillText(`blue% : ${(stats.bluePct*100).toFixed(2)}`, px+10, y);
    ctx.restore();
  }

  function capture(){
    flash();
    pseudoVibe();
    if (navigator.vibrate) navigator.vibrate(80); // iOSは期待しない

    // 保存も「coverと同じ切り出し」で描く（ズレ防止）
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const w = captureCanvas.width;
    const h = captureCanvas.height;

    captureCtx.clearRect(0,0,w,h);
    if (vw && vh) {
      drawCover(captureCtx, vw, vh);
    } else {
      // まれにメタデータ未確定
      captureCtx.drawImage(video, 0,0,w,h);
    }

    // 同じ切り出しで統計を取る
    const stats = computeRoiStats(captureCtx, roi, currentMode);
    const dec = decide(currentMode, stats);

    const now = new Date();
    const dateStr = fmtOverlayDate(now);
    const base = fmtFileDate(now);

    overlayText(captureCtx, w, h, dateStr, dec.label);

    // 調査だけ数値焼き込み
    if (currentMode === 'inspect'){
      overlayInspectStats(captureCtx, w, h, stats);
    }

    if (dec.playOk && okSound){
      okSound.currentTime = 0;
      okSound.play().catch(()=>{});
    }

    let fileName;
    if (currentMode === 'inspect') fileName = `${base}_DBG.jpg`;
    else if (dec.code === 'OK') fileName = `${base}_OK.jpg`;
    else fileName = `${base}_NG?.jpg`;

    const url = captureCanvas.toDataURL('image/jpeg', 0.92);

    if (isIOS()){
      const win = window.open(url, '_blank');
      if (!win) location.href = url;
      try{
        if (!localStorage.getItem('ls_ios_save_hint_shown')){
          alert('iPhoneでは自動で写真アプリに保存できません。\n開いた画像の共有ボタンから「写真に保存」を選んでください。');
          localStorage.setItem('ls_ios_save_hint_shown','1');
        }
      }catch(e){}
    }else{
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // ===== イベント =====
  modeButtons.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const mode = btn.getAttribute('data-mode');
      setModeUI(mode);

      modeSelect.classList.add('hidden');
      app.classList.remove('hidden');

      if (!videoStream){
        await initCamera();
      }else{
        resizeAll();
      }
    });
  });

  backBtn.addEventListener('click', ()=>{
    stopCamera();
    currentMode = null;
    document.body.removeAttribute('data-mode');
    app.classList.add('hidden');
    modeSelect.classList.remove('hidden');
  });

  shutterButton.addEventListener('click', ()=>{
    if (!videoStream || !currentMode) return;
    capture();
  });

  // SW
  if ('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
    });
  }
});
