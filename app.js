/* ===== ランプシャッター 共通ロジック ===== */
let MODE = 'day';
export function setMode(m){ MODE = m; }

/* 判定パラメータ（ユーザー確定値） */
const SAMPLE_STEP = 6;         // 6px間引き
const ROI = { xRatio: 0.62, yRatio: 0.06, wRatio: 0.35, hRatio: 0.16 }; // 右上横長（映像に対する割合）
const TH = {
  red:  { r:90, rn:0.40, rg:18, rb:18 },
  green:{ g:80, gn:0.40, gr:10, gb:10 }
};

const state = {
  video:null, overlay:null, octx:null, badge:null, btn:null, flash:null,
  vw:0, vh:0, verdict:'NG?'
};

export async function boot(){
  // 要素取得
  state.video   = document.getElementById('v');
  state.overlay = document.getElementById('overlay');
  state.octx    = state.overlay.getContext('2d');
  state.badge   = document.getElementById('badge');
  state.btn     = document.getElementById('shoot');
  state.flash   = document.getElementById('flash');

  // カメラ起動
  await startCamera();

  // ループ開始
  requestAnimationFrame(loop);

  // 撮影
  state.btn.addEventListener('click', onShoot);
}

async function startCamera(){
  // iPhone Safari向け：リアカメラ優先
  const constraints = {
    audio:false,
    video:{
      facingMode:'environment',
      width:{ideal:1280}, height:{ideal:720}
    }
  };
  // 夜モードは少し明るめ補正（CSSはnight側で実施済み）
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  state.video.srcObject = stream;
  await state.video.play();

  // キャンバス初期化
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(document.body);
}

function resizeCanvas(){
  state.vw = state.overlay.width  = state.video.videoWidth  || innerWidth;
  state.vh = state.overlay.height = state.video.videoHeight || innerHeight;
}

function loop(){
  drawOverlay();
  requestAnimationFrame(loop);
}

function drawOverlay(){
  const {octx:ctx, vw, vh} = state;
  if(!vw || !vh) return;

  ctx.clearRect(0,0,vw,vh);

  // ROI矩形（プレビューにのみ表示）
  const rx = Math.round(vw*ROI.xRatio);
  const ry = Math.round(vh*ROI.yRatio);
  const rw = Math.round(vw*ROI.wRatio);
  const rh = Math.round(vh*ROI.hRatio);

  // 現フレームを読み取るため、一旦小さな作業キャンバスに描画
  const work = drawVideoToWorkCanvas(vw, vh);
  const wctx = work.getContext('2d');
  const img  = wctx.getImageData(rx, ry, rw, rh).data;

  // 6px間引きで赤/緑ピクセルをカウント
  let rCnt=0, gCnt=0, total=0;
  const stride = SAMPLE_STEP*4;
  for(let y=0; y<rh; y+=SAMPLE_STEP){
    for(let x=0; x<rw; x+=SAMPLE_STEP){
      const i = (y*rw + x)*4;
      const r = img[i], g = img[i+1], b = img[i+2];
      const sum = r+g+b || 1;
      const rn = r/sum, gn = g/sum;
      if(r>TH.red.r && rn>TH.red.rn && (r-g)>TH.red.rg && (r-b)>TH.red.rb) rCnt++;
      if(g>TH.green.g && gn>TH.green.gn && (g-r)>TH.green.gr && (g-b)>TH.green.gb) gCnt++;
      total++;
    }
  }

  // 判定：緑3＞赤5 のロジックに対応（シンプルに緑優勢でOK）
  const ok = gCnt > rCnt;
  state.verdict = ok ? 'OK' : 'NG?';
  updateBadge(ok);

  // ROI枠（視認しやすい白）
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.strokeRect(rx+.5, ry+.5, rw-1, rh-1);
}

function updateBadge(ok){
  state.badge.textContent = ok ? 'OK' : 'NG?';
  state.badge.className = 'badge ' + (ok ? 'ok' : 'ng');
}

function drawVideoToWorkCanvas(w,h){
  if(!drawVideoToWorkCanvas.c){
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    drawVideoToWorkCanvas.c = c;
  }
  const c = drawVideoToWorkCanvas.c;
  if(c.width!==w || c.height!==h){ c.width=w; c.height=h; }
  const ctx = c.getContext('2d');
  // videoをミラーしてるので左右反転を戻して描画
  ctx.save();
  ctx.scale(-1,1);
  ctx.drawImage(state.video, -w, 0, w, h);
  ctx.restore();
  return c;
}

async function onShoot(){
  // フラッシュ&バイブ
  flash();
  try{ navigator.vibrate?.(80); }catch{}

  // 保存用キャンバス（ROIは描かない＝写り込まない）
  const w = state.vw || 1280, h = state.vh || 720;
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.scale(-1,1);
  ctx.drawImage(state.video, -w, 0, w, h);
  ctx.restore();

  // 文字焼き込み（日時＋判定）
  const ts = timeStamp();
  const verdict = state.verdict; // OK or NG?
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  const pad = 18, boxH=64, boxW = ctx.measureText?.(ts + '  ' + verdict).width || 480;
  ctx.fillRect(pad, h - boxH - pad, Math.max(360, boxW+32), boxH);
  ctx.font = 'bold 28px system-ui, -apple-system, "Segoe UI", Roboto';
  ctx.fillStyle = '#fff';
  ctx.fillText(ts + '   ' + verdict, pad+16, h - pad - 20);

  // ファイル名
  const fname = ts.replaceAll(/[^\d_]/g,'') + '_' + (verdict==='OK'?'OK':'NG?') + '.jpg';

  // Blob化して自動DL
  c.toBlob(blob=>{
    const a = document.createElement('a');
    a.download = fname;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, 'image/jpeg', 0.92);

  // OK時のみ女性音声で「オーケー」
  if(state.verdict==='OK'){
    try{
      const u = new SpeechSynthesisUtterance('オーケー');
      u.lang='ja-JP';
      // 女性声があれば優先
      const v = speechSynthesis.getVoices().find(v=>/ja|日本語/.test(v.lang)&&/Female|女性/i.test(v.name)) || null;
      if(v) u.voice = v;
      speechSynthesis.speak(u);
    }catch{}
  }
}

function flash(){
  const el = state.flash;
  el.style.transition='none';
  el.style.opacity='1';
  requestAnimationFrame(()=>{
    el.style.transition='opacity 180ms ease';
    el.style.opacity='0';
  });
}

function timeStamp(){
  const d = new Date();
  const z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
