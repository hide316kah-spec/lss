// DOM
const video      = document.getElementById("video");
const modeSelect = document.getElementById("modeSelect");
const app        = document.getElementById("app");
const modeLabel  = document.getElementById("modeLabel");
const roiBox     = document.getElementById("roi");
const flash      = document.getElementById("flash");
const badge      = document.getElementById("badge");
const shutter    = document.getElementById("shutter");
const debugPanel = document.getElementById("debugPanel");
const debugText  = document.getElementById("debugText");
const workCanvas = document.getElementById("workCanvas");
const wctx       = workCanvas.getContext("2d",{willReadFrequently:true});

const dayBtn   = document.getElementById("dayBtn");
const nightBtn = document.getElementById("nightBtn");
const debugBtn = document.getElementById("debugBtn");

// モード
let currentMode = "day";     // "day" | "night" | "debug"
let running     = false;
let lastResult  = "NG?";
let lastStats   = null;

// 閾値（暫定。調査モードで後で詰める）
const THRESHOLDS = {
  day:   { redFracMax:0.010, greenFracMin:0.030 },
  night: { redFracMax:0.010, greenFracMin:0.030 }
};

function setMode(mode){
  currentMode = mode;
  if(mode === "day")   modeLabel.textContent = "昼モード";
  if(mode === "night") modeLabel.textContent = "夜モード";
  if(mode === "debug") modeLabel.textContent = "調査モード";
  debugPanel.hidden = (mode !== "debug");
}

// カメラ起動
async function startCamera(){
  const cands = [
    { video:{ facingMode:{ exact:"environment" } }, audio:false },
    { video:{ facingMode:"environment" }, audio:false },
    { video:true, audio:false }
  ];
  let stream = null;
  for(const opt of cands){
    try{
      stream = await navigator.mediaDevices.getUserMedia(opt);
      break;
    }catch(e){}
  }
  if(!stream) throw new Error("カメラが利用できません");
  video.srcObject = stream;
  await video.play();
}

// ROI（video座標系。以前と同じ比率）
function getRoiRect(){
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if(!vw || !vh) return null;

  const rw = Math.floor(vw * 0.58);
  const rh = Math.floor(vh * 0.26);
  const rx = vw - rw - Math.floor(vw * 0.04);
  const ry = Math.floor(vh * 0.06);
  return {rx, ry, rw, rh};
}

// 1フレーム判定
function judgeFrame(){
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if(!vw || !vh) return {result:"NG?", stats:null};

  workCanvas.width  = vw;
  workCanvas.height = vh;
  wctx.drawImage(video,0,0,vw,vh);

  const rect = getRoiRect();
  if(!rect) return {result:"NG?", stats:null};
  const {rx, ry, rw, rh} = rect;

  const img = wctx.getImageData(rx,ry,rw,rh).data;
  let reds=0, greens=0, total=0;
  let Rsum=0,Gsum=0,Bsum=0;

  for(let i=0;i<img.length;i+=4*6){ // 6px間引き
    const r = img[i];
    const g = img[i+1];
    const b = img[i+2];
    const sum = r+g+b+1;
    const rn = r/sum;
    const gn = g/sum;

    Rsum += r; Gsum += g; Bsum += b; total++;

    const isRed   = (r>90 && rn>0.40 && r-g>18 && r-b>18);
    const isGreen = (g>80 && gn>0.40 && g-r>10 && g-b>10);
    if(isRed)   reds++;
    if(isGreen) greens++;
  }

  const redFrac   = reds/Math.max(1,total);
  const greenFrac = greens/Math.max(1,total);
  const Ravg = Rsum/Math.max(1,total);
  const Gavg = Gsum/Math.max(1,total);
  const Bavg = Bsum/Math.max(1,total);

  const th = THRESHOLDS[currentMode] || THRESHOLDS.day;
  const isNG = redFrac > th.redFracMax;
  const isOK = !isNG && greenFrac > th.greenFracMin;

  const result = isOK ? "OK" : "NG?";
  const stats  = {redFrac, greenFrac, Ravg, Gavg, Bavg};
  return {result, stats};
}

// バッジ更新
function updateBadge(result){
  badge.textContent = result;
  badge.classList.remove("ok","ng");
  badge.classList.add(result==="OK" ? "ok" : "ng");
}

// 調査モード表示
function updateDebug(stats){
  if(!stats) return;
  const {redFrac, greenFrac, Ravg, Gavg, Bavg} = stats;
  debugText.textContent =
    `Ravg : ${Ravg.toFixed(1)}\n`+
    `Gavg : ${Gavg.toFixed(1)}\n`+
    `Bavg : ${Bavg.toFixed(1)}\n`+
    `red% : ${(redFrac*100).toFixed(2)}\n`+
    `green%: ${(greenFrac*100).toFixed(2)}`;
}

// 判定ループ
function loop(){
  if(!running) return;
  const {result, stats} = judgeFrame();
  lastResult = result;
  lastStats  = stats;
  updateBadge(result);
  if(currentMode === "debug") updateDebug(stats);
  requestAnimationFrame(loop);
}

// シャッター押下（バイブ＋フラッシュ＋撮影）
shutter.addEventListener("click", async () => {
  // バイブ（iOS Safari は非対応だが入れておく）
  try{ navigator.vibrate && navigator.vibrate([40,40,40]); }catch(e){}

  // フラッシュ（CSSアニメをやめて確実に白くする）
  flash.style.opacity = "0.9";
  setTimeout(()=>{ flash.style.opacity = "0"; }, 120);

  // 音声
  if(lastResult === "OK"){
    speak("判定オーケー。");
  }else{
    speak("確認してください。");
  }

  // 撮影保存
  try{
    await captureAndSave(lastResult);
  }catch(e){
    console.error(e);
  }
});

// 撮影＆保存（OK ／ NG? の焼き込み）
async function captureAndSave(mark){
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if(!vw || !vh) return;

  const c = document.createElement("canvas");
  c.width = vw;
  c.height = vh;
  const ctx = c.getContext("2d");
  ctx.drawImage(video,0,0,vw,vh);

  const label = `${new Date().toLocaleString("ja-JP",{hour12:false})}  結果:${mark}`;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(0, vh-40, vw, 40);
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.floor(vw/30)}px -apple-system,system-ui`;
  ctx.textBaseline = "middle";
  ctx.fillText(label, 16, vh-20);

  const blob = await new Promise(res => c.toBlob(res,"image/png",0.95));
  if(!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lamp_${Date.now()}_${mark==="OK"?"OK":"NG"}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

// 音声（女性ボイス優先）
function speak(text){
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1;
    u.pitch = 1.2;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(v=>v.lang.startsWith("ja") && /female|女/i.test(v.name))
             || vs.find(v=>v.lang.startsWith("ja"));
    if(v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){}
}

// モード選択から起動
async function startMode(mode){
  setMode(mode);
  modeSelect.hidden = true;
  app.hidden = false;
  modeLabel.hidden = false;

  if(!running){
    try{
      await startCamera();
    }catch(e){
      alert("カメラ起動に失敗: "+e.message);
      location.reload();
      return;
    }
    running = true;
    loop();
  }
}

dayBtn.addEventListener("click",  ()=>startMode("day"));
nightBtn.addEventListener("click",()=>startMode("night"));
debugBtn.addEventListener("click",()=>startMode("debug"));
