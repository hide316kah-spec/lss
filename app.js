// ランプシャッター（横取り装置判定 Web アプリ / PWA版）
// 【修正内容】
// ・初回アクセス時の ROI形状ズレ修正
// ・初回アクセス時の レイアウト差修正
// ・カメライラストを押しても反応しない問題修正
// ※ 判定ロジック（上下分離・点滅対応）は前回のまま

let currentMode = null;
let videoStream = null;
let cameraReady = false;   // ★追加：カメラ準備完了フラグ

const ROI_CONFIG = {
  wRatio: 0.50,
  hRatio: 0.18,
  margin: 10,
  upperRatio: 0.45
};

const TH = {
  redPct: 35,
  hotR: 180,
  hotRatio: 1.35,
  lowerHotCount: 2
};

const BLINK = {
  windowMs: 400,
  redRate: 0.6
};

let upperHistory = [];

// ★追加：シャッター連打や二重実行で固まるのを防ぐ
let shotBusy = false;

function isIOS(){
  return /iP(hone|od|ad)/.test(navigator.userAgent || '');
}

function fmtFileDate(d){
  const z=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function fmtOverlayDate(d){
  const z=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}/${z(d.getMonth()+1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

window.addEventListener('DOMContentLoaded',()=>{
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

  const rAvgVal = document.getElementById('rAvgVal');
  const gAvgVal = document.getElementById('gAvgVal');
  const bAvgVal = document.getElementById('bAvgVal');
  const redPctVal = document.getElementById('redPctVal');
  const greenPctVal = document.getElementById('greenPctVal');
  const bluePctVal = document.getElementById('bluePctVal');

  const roi = {x:0,y:0,w:0,h:0};

  function resizeAll(){
    const rect = videoWrapper.getBoundingClientRect();
    overlayCanvas.width = rect.width;
    overlayCanvas.height = rect.height;
    captureCanvas.width = rect.width;
    captureCanvas.height = rect.height;

    roi.w = rect.width * ROI_CONFIG.wRatio;
    roi.h = rect.height * ROI_CONFIG.hRatio;
    roi.x = rect.width - roi.w - ROI_CONFIG.margin;
    roi.y = ROI_CONFIG.margin;
  }

  window.addEventListener('resize', resizeAll);

  function drawCover(ctx){
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if(!vw || !vh) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const scale = Math.max(cw/vw, ch/vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  function roiStats(ctx, r){
    const img = ctx.getImageData(r.x,r.y,r.w,r.h).data;
    let sr=0,sg=0,sb=0,c=0,rd=0,gd=0,bd=0,hot=0;
    for(let i=0;i<img.length;i+=24){
      const r0=img[i], g0=img[i+1], b0=img[i+2];
      sr+=r0; sg+=g0; sb+=b0; c++;
      if(r0>g0&&r0>b0) rd++;
      else if(g0>r0&&g0>b0) gd++;
      else if(b0>r0&&b0>g0) bd++;
      if(r0>=TH.hotR && r0>=g0*TH.hotRatio && r0>=b0*TH.hotRatio) hot++;
    }
    return {
      rAvg: sr/c, gAvg: sg/c, bAvg: sb/c,
      redPct: rd/c, greenPct: gd/c, bluePct: bd/c,
      hotCount: hot
    };
  }

  function upperLowerStats(ctx){
    const uh = Math.floor(roi.h * ROI_CONFIG.upperRatio);
    const upper = {x:roi.x, y:roi.y, w:roi.w, h:uh};
    const lower = {x:roi.x, y:roi.y+uh, w:roi.w, h:roi.h-uh};
    return { upper: roiStats(ctx,upper), lower: roiStats(ctx,lower) };
  }

  function updateBlink(redNow){
    const now = performance.now();
    upperHistory.push({t:now, red:redNow});
    upperHistory = upperHistory.filter(e=>e.t >= now - BLINK.windowMs);
    const redFrames = upperHistory.filter(e=>e.red).length;
    return redFrames / upperHistory.length >= BLINK.redRate;
  }

  function decide(stats){
    if(currentMode==='inspect') return {code:'DBG',label:'調査',ok:false};
    if(stats.lower.redPct*100>=TH.redPct || stats.lower.hotCount>=TH.lowerHotCount){
      return {code:'NG',label:'NG?',ok:false};
    }
    const upperRedNow = stats.upper.redPct*100>=TH.redPct;
    if(updateBlink(upperRedNow)){
      return {code:'NG',label:'NG?',ok:false};
    }
    return {code:'OK',label:'OK',ok:true};
  }

  function drawROI(){
    overlayCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
    overlayCtx.strokeStyle='rgba(0,255,0,.9)';
    overlayCtx.setLineDash([10,6]);
    overlayCtx.lineWidth=3;
    overlayCtx.strokeRect(roi.x,roi.y,roi.w,roi.h);
    overlayCtx.setLineDash([]);
  }

  const analysisCanvas = document.createElement('canvas');
  const analysisCtx = analysisCanvas.getContext('2d');

  function loop(){
    if(!videoStream || !currentMode || !cameraReady) return;
    analysisCanvas.width = overlayCanvas.width;
    analysisCanvas.height = overlayCanvas.height;
    analysisCtx.clearRect(0,0,analysisCanvas.width,analysisCanvas.height);
    drawCover(analysisCtx);

    const stats = upperLowerStats(analysisCtx);
    rAvgVal.textContent = stats.upper.rAvg.toFixed(1);
    gAvgVal.textContent = stats.upper.gAvg.toFixed(1);
    bAvgVal.textContent = stats.upper.bAvg.toFixed(1);
    redPctVal.textContent = (stats.upper.redPct*100).toFixed(2);
    greenPctVal.textContent = (stats.upper.greenPct*100).toFixed(2);
    bluePctVal.textContent = (stats.upper.bluePct*100).toFixed(2);

    const dec = decide(stats);
    if(currentMode!=='inspect'){
      judgeBadge.textContent = dec.label;
      judgeBadge.classList.toggle('ng', dec.code==='NG');
    }
    drawROI();
    requestAnimationFrame(loop);
  }

  async function initCamera(){
    cameraReady = false;
    videoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    video.srcObject = videoStream;

    video.addEventListener('loadedmetadata', ()=>{
      // ★ここが今回のキモ
      requestAnimationFrame(()=>{
        resizeAll();
        cameraReady = true;
        upperHistory = [];
        requestAnimationFrame(loop);
      });
    }, { once:true });
  }

  function flash(){
    flashOverlay.classList.add('active');
    setTimeout(()=>flashOverlay.classList.remove('active'),120);
  }
  function pseudoVibe(){
    app.classList.add('shake');
    videoWrapper.classList.add('ls-blink-border');
    shutterImage.classList.add('ls-pulse');
    setTimeout(()=>{
      app.classList.remove('shake');
      videoWrapper.classList.remove('ls-blink-border');
      shutterImage.classList.remove('ls-pulse');
    },300);
  }

  function capture(){
    if(!cameraReady) return; // ★初期化前は無視
    if(shotBusy) return;     // ★二重実行防止
    shotBusy = true;

    flash(); pseudoVibe();
    captureCtx.clearRect(0,0,captureCanvas.width,captureCanvas.height);
    drawCover(captureCtx);
    const stats = upperLowerStats(captureCtx);
    const dec = decide(stats);

    const now = new Date();
    captureCtx.fillStyle='rgba(0,0,0,.6)';
    captureCtx.fillRect(0,captureCanvas.height-50,captureCanvas.width,50);
    captureCtx.fillStyle='#fff';
    captureCtx.font='18px -apple-system';
    captureCtx.fillText(fmtOverlayDate(now),12,captureCanvas.height-25);
    captureCtx.fillText(dec.label,captureCanvas.width-80,captureCanvas.height-25);

    if(dec.ok && okSound){
      okSound.currentTime=0; okSound.play().catch(()=>{});
    }

    const name = currentMode==='inspect'
      ? `${fmtFileDate(now)}_DBG.jpg`
      : dec.code==='OK'
        ? `${fmtFileDate(now)}_OK.jpg`
        : `${fmtFileDate(now)}_NG?.jpg`;

    // ★修正：toDataURL(重い/固まりやすい)→toBlob(軽い) + iOSは先に空タブを開く
    const w = isIOS() ? window.open('about:blank','_blank') : null;

    captureCanvas.toBlob((blob)=>{
      try{
        if(!blob){
          if(w) w.close();
          return;
        }

        const blobUrl = URL.createObjectURL(blob);

        if(isIOS()){
          // iOSは別タブに画像を表示 → 共有から写真に保存
          if(w) w.location.href = blobUrl;
          else window.location.href = blobUrl;
        }else{
          const a=document.createElement('a');
          a.href = blobUrl;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

        setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000);
      } finally {
        shotBusy = false;
      }
    }, 'image/jpeg', 0.92);
  }

  modeButtons.forEach(btn=>{
    btn.onclick = async ()=>{
      currentMode = btn.dataset.mode;
      document.body.setAttribute('data-mode',currentMode);
      modeNameEl.textContent = currentMode==='day'?'昼モード':currentMode==='night'?'夜モード':'調査モード';
      judgeBadge.classList.toggle('hidden', currentMode==='inspect');
      modeSelect.classList.add('hidden');
      app.classList.remove('hidden');
      if(!videoStream) await initCamera();
    };
  });

  backBtn.onclick = ()=>{
    if(videoStream){ videoStream.getTracks().forEach(t=>t.stop()); videoStream=null; }
    cameraReady = false;
    currentMode = null;
    document.body.removeAttribute('data-mode');
    app.classList.add('hidden');
    modeSelect.classList.remove('hidden');
  };

  shutterButton.onclick = capture;
});
