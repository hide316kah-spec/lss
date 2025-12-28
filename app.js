// ランプシャッター（横取り装置判定 Web アプリ / PWA版）
// ① 上下論理分離
//   - 上エリア：右上の点滅ランプ → 時間評価
//   - 下エリア：3連ランプ → 即NG
// 表示・解析・保存はすべて object-fit: cover と一致

let currentMode = null; // 'day' | 'night' | 'inspect'
let videoStream = null;

const ROI_CONFIG = {
  wRatio: 0.50,
  hRatio: 0.18,
  margin: 10,
  upperRatio: 0.45 // ROI上側45%を「点滅ランプ領域」
};

// 夜モード基準（本番）
const TH = {
  redPct: 35,
  hotR: 180,
  hotRatio: 1.35,
  lowerHotCount: 2
};

// 上エリア（点滅）用の時間評価
const BLINK = {
  windowMs: 400,   // 0.4秒
  redRate: 0.6     // 60%以上 赤なら「赤あり」
};

let upperHistory = []; // [{t, red}]
let lastTime = 0;

function isIOS() {
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

window.addEventListener('DOMContentLoaded', ()=>{
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
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if(!vw||!vh) return;
    const scale = Math.max(cw/vw, ch/vh);
    const dw = vw*scale;
    const dh = vh*scale;
    const dx = (cw-dw)/2;
    const dy = (ch-dh)/2;
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
    return {
      upper: roiStats(ctx, upper),
      lower: roiStats(ctx, lower)
    };
  }

  function updateBlink(redNow){
    const now = performance.now();
    upperHistory.push({t:now, red:redNow});
    const limit = now - BLINK.windowMs;
    upperHistory = upperHistory.filter(e=>e.t>=limit);
    const redFrames = upperHistory.filter(e=>e.red).length;
    return (redFrames / upperHistory.length) >= BLINK.redRate;
  }

  function decide(stats){
    if(currentMode==='inspect') return {code:'DBG',label:'調査',ok:false};

    // 下エリア：即NG
    if(stats.lower.redPct*100 >= TH.redPct || stats.lower.hotCount>=TH.lowerHotCount){
      return {code:'NG',label:'NG?',ok:false};
    }

    // 上エリア：点滅を時間評価
    const upperRedNow = stats.upper.redPct*100 >= TH.redPct;
    const upperRed = updateBlink(upperRedNow);
    if(upperRed){
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
    if(!videoStream||!currentMode) return;
    analysisCanvas.width=overlayCanvas.width;
    analysisCanvas.height=overlayCanvas.height;
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
    videoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    video.srcObject = videoStream;
    video.onloadedmetadata=()=>{
      resizeAll();
      upperHistory=[];
      requestAnimationFrame(loop);
    };
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

    const url = captureCanvas.toDataURL('image/jpeg',0.92);
    if(isIOS()){
      window.open(url,'_blank');
    }else{
      const a=document.createElement('a');
      a.href=url; a.download=name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
  }

  modeButtons.forEach(btn=>{
    btn.onclick=async()=>{
      currentMode=btn.dataset.mode;
      document.body.setAttribute('data-mode',currentMode);
      modeNameEl.textContent = currentMode==='day'?'昼モード':currentMode==='night'?'夜モード':'調査モード';
      judgeBadge.classList.toggle('hidden', currentMode==='inspect');
      modeSelect.classList.add('hidden');
      app.classList.remove('hidden');
      if(!videoStream) await initCamera();
    };
  });

  backBtn.onclick=()=>{
    if(videoStream){ videoStream.getTracks().forEach(t=>t.stop()); videoStream=null; }
    currentMode=null;
    document.body.removeAttribute('data-mode');
    app.classList.add('hidden');
    modeSelect.classList.remove('hidden');
  };

  shutterButton.onclick=()=>{
    if(videoStream&&currentMode) capture();
  };
});
