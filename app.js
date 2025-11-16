const video   = document.getElementById("video");
const canvas  = document.getElementById("canvas");
const roi     = document.getElementById("roi");
const shutter = document.getElementById("shutter");
const modeSelect = document.getElementById("modeSelect");
const modeLabel  = document.getElementById("modeLabel");
const debugPanel = document.getElementById("debugPanel");
const debugText  = document.getElementById("debugText");

const dayBtn   = document.getElementById("dayBtn");
const nightBtn = document.getElementById("nightBtn");
const debugBtn = document.getElementById("debugBtn");

let currentMode = "day";
let stream = null;

/* ───────────── モード切替 ───────────── */
function setMode(m) {
  currentMode = m;
  modeLabel.textContent = 
    m === "day" ? "昼モード" :
    m === "night" ? "夜モード" :
    "調査モード";

  debugPanel.hidden = (m !== "debug");
}

/* ───────────── カメラ起動 ───────────── */
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video:{facingMode:"environment"},
    audio:false
  });
  video.srcObject = stream;
  await video.play();
}

/* ───────────── 調査モードの表示 ───────────── */
function updateDebug(data){
  debugText.textContent =
    `R:${(data.rFrac*100).toFixed(1)}%
G:${(data.gFrac*100).toFixed(1)}%
B:${(data.bFrac*100).toFixed(1)}%`;
}

/* ───────────── 判定ループ（簡易版） ───────────── */
function loop(){
  const w = video.videoWidth;
  const h = video.videoHeight;
  if(w===0 || h===0){
    requestAnimationFrame(loop);
    return;
  }

  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video,0,0,w,h);

  const rw = Math.floor(w * 0.58);
  const rh = Math.floor(h * 0.26);
  const rx = w - rw - Math.floor(w*0.04);
  const ry = Math.floor(h*0.06);

  roi.style.left   = rx+"px";
  roi.style.top    = ry+"px";
  roi.style.width  = rw+"px";
  roi.style.height = rh+"px";

  const img = ctx.getImageData(rx, ry, rw, rh).data;
  let r=0,g=0,b=0,n=0;

  for(let i=0;i<img.length;i+=4*6){
    r += img[i];
    g += img[i+1];
    b += img[i+2];
    n++;
  }

  const rFrac = r/(r+g+b+1);
  const gFrac = g/(r+g+b+1);
  const bFrac = b/(r+g+b+1);

  if(currentMode==="debug"){
    updateDebug({rFrac,gFrac,bFrac});
  }

  requestAnimationFrame(loop);
}

/* ───────────── シャッター撮影 ───────────── */
shutter.addEventListener("click",()=>{
  try{navigator.vibrate([40,40,40]);}catch{}
  flash.classList.add("fade");
  setTimeout(()=>flash.classList.remove("fade"),250);
});

/* ───────────── モード選択イベント ───────────── */
dayBtn.addEventListener("click",()=>{
  setMode("day");
  modeSelect.style.display="none";
  modeLabel.style.display="block";
  app.style.display="block";
  startCamera().then(loop);
});

nightBtn.addEventListener("click",()=>{
  setMode("night");
  modeSelect.style.display="none";
  modeLabel.style.display="block";
  app.style.display="block";
  startCamera().then(loop);
});

debugBtn.addEventListener("click",()=>{
  setMode("debug");
  modeSelect.style.display="none";
  modeLabel.style.display="block";
  app.style.display="block";
  startCamera().then(loop);
});
