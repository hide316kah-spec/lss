/* ====== グローバル ====== */
let video, canvas, ctx, overlay, octx;
let statusBadge, shutterBtn, flashLayer;
let running=false, mode='day', lastAutoShot=0;

/* ROI: 右上・横長（LED 8個分） */
function roiRect() {
  const W = video.videoWidth || 1280;
  const H = video.videoHeight || 720;
  const w = Math.round(W * 0.36), h = Math.round(H * 0.26);
  const x = W - w - 10, y = 10;
  return {x,y,w,h};
}

/* 閾値設定 */
const THRESH = {
  day:   { R:{r:90, rn:0.40, rg:18, rb:18, ratio:0.010}, G:{g:80, gn:0.40, gr:10, gb:10, ratio:0.010} },
  night: { R:{r:120,rn:0.50, rg:25, rb:25, ratio:0.015}, G:{g:110,gn:0.50, gr:18, gb:18, ratio:0.015} }
};

/* ====== 初期化 ====== */
async function initCamera(selectedMode) {
  mode = (selectedMode === 'night') ? 'night' : 'day';
  document.body.innerHTML='';
  document.body.style.background='#000';
  document.body.style.margin='0';

  video = document.createElement('video');
  Object.assign(video.style,{
    position:'fixed', inset:0, width:'100vw', height:'100vh',
    objectFit:'cover', zIndex:1
  });
  document.body.appendChild(video);

  overlay = document.createElement('canvas');
  Object.assign(overlay.style,{
    position:'fixed', inset:0, width:'100vw', height:'100vh',
    pointerEvents:'none', zIndex:2
  });
  document.body.appendChild(overlay);

  statusBadge = document.createElement('div');
  Object.assign(statusBadge.style,{
    position:'fixed', left:'8px', top:'8px', zIndex:3,
    padding:'6px 10px', borderRadius:'8px',
    background:'rgba(0,0,0,.55)', color:'#fff', fontWeight:'700',
    border:'1px solid rgba(255,255,255,.25)'
  });
  statusBadge.textContent='待機中…';
  document.body.appendChild(statusBadge);

  shutterBtn = document.createElement('img');
  shutterBtn.src='assets/instant_camera.png';
  Object.assign(shutterBtn.style,{
    position:'fixed', left:'50%', bottom:'7vh', transform:'translateX(-50%)',
    width:'25vw', maxWidth:'160px', opacity:'0.7', zIndex:4
  });
  shutterBtn.addEventListener('click', manualCapture);
  document.body.appendChild(shutterBtn);

  flashLayer = document.createElement('div');
  Object.assign(flashLayer.style,{
    position:'fixed', inset:0, background:'#fff', opacity:'0', pointerEvents:'none',
    transition:'opacity .15s', zIndex:5
  });
  document.body.appendChild(flashLayer);

  // カメラ起動（背面）
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact:'environment' }, width:{ideal:1280}, height:{ideal:720} },
      audio: false
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} },
      audio:false
    });
  }
  video.srcObject = stream;

  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d');
  octx = overlay.getContext('2d');

  await new Promise(r=>video.onloadedmetadata=r);
  resizeCanvases();
  window.onresize = resizeCanvases;
  running = true;
  loop();
}

/* ====== 判定ループ ====== */
function loop(){
  if(!running) return;
  if(video.videoWidth===0){ requestAnimationFrame(loop); return; }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video,0,0,canvas.width,canvas.height);

  const {x,y,w,h}=roiRect();
  const img=ctx.getImageData(x,y,w,h).data;
  const T=THRESH[mode];
  let rCnt=0,gCnt=0,total=0;

  for(let py=0;py<h;py+=6){
    for(let px=0;px<w;px+=6){
      const i=(py*w+px)*4;
      const r=img[i],g=img[i+1],b=img[i+2];
      const sum=r+g+b||1;
      const rn=r/sum,gn=g/sum;
      const isR=(r>T.R.r)&&(rn>T.R.rn)&&((r-g)>T.R.rg)&&((r-b)>T.R.rb);
      const isG=(g>T.G.g)&&(gn>T.G.gn)&&((g-r)>T.G.gr)&&((g-b)>T.G.gb);
      if(isR) rCnt++;
      if(isG) gCnt++;
      total++;
    }
  }

  const rRatio=rCnt/total, gRatio=gCnt/total;
  const ok=(gRatio>=T.G.ratio)&&(gRatio>rRatio);
  const statusText=ok?'OK':'NG?';
  renderOverlay(statusText);

  const now=performance.now();
  if(ok && (now-lastAutoShot)>1200){
    lastAutoShot=now;
    takeShot('OK');
  }
  requestAnimationFrame(loop);
}

/* ====== オーバーレイ ====== */
function renderOverlay(statusText){
  statusBadge.textContent=statusText;

  shutterBtn.style.filter = (statusText==='OK')?'grayscale(100%)':'none';
  shutterBtn.style.opacity = (statusText==='OK')?'0.5':'1';
  shutterBtn.style.pointerEvents = (statusText==='OK')?'none':'auto';

  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
  octx.clearRect(0,0,overlay.width,overlay.height);

  const vw=video.videoWidth, vh=video.videoHeight;
  const cw=overlay.width, ch=overlay.height;
  const scale=Math.min(cw/vw,ch/vh);
  const dx=(cw-vw*scale)/2, dy=(ch-vh*scale)/2;
  const {x,y,w,h}=roiRect();

  octx.strokeStyle='rgba(255,255,255,0.9)';
  octx.lineWidth=6;
  octx.shadowColor='rgba(255,255,255,0.6)';
  octx.shadowBlur=15;
  octx.strokeRect(Math.round(dx+x*scale),Math.round(dy+y*scale),Math.round(w*scale),Math.round(h*scale));
  octx.shadowBlur=0;
}

/* ====== 手動撮影（NG?時） ====== */
function manualCapture(){
  if(statusBadge.textContent==='OK') return;
  takeShot('NG?');
}

/* ====== 撮影・保存（JPG） ====== */
function takeShot(result){
  try{navigator.vibrate&&navigator.vibrate(120);}catch{}
  flashLayer.style.opacity='1';
  setTimeout(()=>flashLayer.style.opacity='0',90);

  const w=video.videoWidth,h=video.videoHeight;
  const shot=document.createElement('canvas');
  shot.width=w;shot.height=h;
  const sctx=shot.getContext('2d');
  sctx.drawImage(video,0,0,w,h);

  const {x,y,w:rw,h:rh}=roiRect();
  sctx.lineWidth=8;
  sctx.strokeStyle='rgba(255,255,255,0.95)';
  sctx.strokeRect(x,y,rw,rh);

  const t=new Date();
  const z=n=>String(n).padStart(2,'0');
  const stamp=`${t.getFullYear()}-${z(t.getMonth()+1)}-${z(t.getDate())}_${z(t.getHours())}-${z(t.getMinutes())}-${z(t.getSeconds())}`;
  const label=`${stamp}  ${result}`;
  sctx.font=Math.round(h*0.035)+'px system-ui,Arial';
  sctx.fillStyle='rgba(0,0,0,0.6)';
  sctx.fillRect(12,h-52,sctx.measureText(label).width+24,44);
  sctx.fillStyle='#fff';
  sctx.fillText(label,24,h-20);

  const dataUrl=shot.toDataURL('image/jpeg',0.92);
  const a=document.createElement('a');
  a.href=dataUrl;
  a.download=`${stamp}_${result}.jpg`;
  a.click();
}

/* ====== リサイズ ====== */
function resizeCanvases(){
  if(!video)return;
  overlay.width=overlay.clientWidth*devicePixelRatio;
  overlay.height=overlay.clientHeight*devicePixelRatio;
}
