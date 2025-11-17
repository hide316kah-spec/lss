(() => {

const cam = document.getElementById("cam");
const roi = document.getElementById("roi");
const badge = document.getElementById("badge");
const modeLabel = document.getElementById("modeLabel");
const inspectBox = document.getElementById("inspectBox");
const inspectTxt = document.getElementById("inspectTxt");
const shutter = document.getElementById("shutter");
const flash = document.getElementById("flash");

let currentMode = "day";
let stream = null;
let rafId = null;

/* ----------------------------------------------------
   モードごとの初期セット
---------------------------------------------------- */
window.selectMode = async function(mode) {
  currentMode = mode;

  // モード表示
  modeLabel.textContent =
    mode === "day" ? "昼モード" :
    mode === "night" ? "夜モード" :
    "調査モード";

  // UI切替
  if (mode === "inspect") {
    badge.style.display = "none";
    inspectBox.style.display = "block";
  } else {
    badge.style.display = "block";
    inspectBox.style.display = "none";
    badge.textContent = "NG?";
    badge.className = "ng";
  }

  // カメラ画面表示
  document.getElementById("app").hidden = false;

  // カメラ開始
  if (!stream) await startCamera();

  // ループ開始
  if (!rafId) rafId = requestAnimationFrame(loop);
};

/* ----------------------------------------------------
   カメラ起動
---------------------------------------------------- */
async function startCamera(){
  const cList = [
    { video:{facingMode:{exact:"environment"}}, audio:false },
    { video:{facingMode:"environment"}, audio:false },
    { video:true, audio:false }
  ];
  for(const c of cList){
    try{
      stream = await navigator.mediaDevices.getUserMedia(c);
      break;
    }catch(e){}
  }
  if(!stream) throw new Error("カメラが見つかりません");

  cam.srcObject = stream;
  await cam.play();
}

/* ----------------------------------------------------
   ROI(Aサイズ) の座標計算
---------------------------------------------------- */
function getROI(){
  const vw = cam.videoWidth;
  const vh = cam.videoHeight;
  if(!vw || !vh) return null;

  // Aサイズ
  const rw = vw * 0.52;
  const rh = vw * 0.28;

  const rx = vw - rw - vw*0.04;
  const ry = vh * 0.06;

  return {rx, ry, rw, rh};
}

/* ----------------------------------------------------
   メインループ
---------------------------------------------------- */
function loop(){
  rafId = requestAnimationFrame(loop);

  const roiData = getROI();
  if(!roiData) return;

  const {rx, ry, rw, rh} = roiData;

  const vw = cam.videoWidth;
  const vh = cam.videoHeight;

  const cvs = loop.cvs || (loop.cvs = document.createElement("canvas"));
  cvs.width = vw;
  cvs.height = vh;
  const ctx = cvs.getContext("2d", { willReadFrequently:true });

  ctx.drawImage(cam, 0, 0, vw, vh);

  // ROI 抽出
  const imgData = ctx.getImageData(rx, ry, rw, rh).data;

  let Rsum=0, Gsum=0, Bsum=0;
  let Rhit=0, Ghit=0, Bhit=0;
  let total=0;

  for(let i=0;i<imgData.length;i+=4*6){
    const r = imgData[i];
    const g = imgData[i+1];
    const b = imgData[i+2];
    const sum = r+g+b+1;
    const rn=r/sum, gn=g/sum, bn=b/sum;

    Rsum+=r; Gsum+=g; Bsum+=b; total++;

    const isRed = (r>90 && rn>0.40 && r-g>18 && r-b>18);
    if(isRed) Rhit++;

    const isGreen = (g>80 && gn>0.40 && g-r>10 && g-b>10);
    if(isGreen) Ghit++;

    const isBlue = (b>80 && bn>0.40 && b-r>10 && b-g>10);
    if(isBlue) Bhit++;
  }

  const Ravg = Rsum/total;
  const Gavg = Gsum/total;
  const Bavg = Bsum/total;

  const Rfrac = Rhit/total;
  const Gfrac = Ghit/total;
  const Bfrac = Bhit/total;

  /* --------- 調査モードの表示 --------- */
  if(currentMode==="inspect"){
    inspectTxt.textContent =
      `Ravg : ${Ravg.toFixed(1)}\n`+
      `Gavg : ${Gavg.toFixed(1)}\n`+
      `Bavg : ${Bavg.toFixed(1)}\n`+
      `red% : ${(Rfrac*100).toFixed(2)}\n`+
      `green%: ${(Gfrac*100).toFixed(2)}\n`+
      `blue% : ${(Bfrac*100).toFixed(2)}`;
  }

  /* --------- 昼/夜の判定 --------- */
  if(currentMode==="day" || currentMode==="night"){
    const NG = Rfrac>0.010;
    const OK = !NG && Gfrac>0.030;

    if(OK){
      badge.textContent="OK";
      badge.className="ok";
    }else{
      badge.textContent="NG?";
      badge.className="ng";
    }
  }
}

/* ----------------------------------------------------
   フラッシュ & バイブ
---------------------------------------------------- */
function doFlash(){
  flash.classList.remove("flash-on");
  void flash.offsetWidth;
  flash.classList.add("flash-on");
}

function doVibe(){
  try{
    if(navigator.vibrate) navigator.vibrate([40,40,40]);
  }catch(e){}
}

/* ----------------------------------------------------
   シャッター
---------------------------------------------------- */
shutter.addEventListener("click", ()=>{
  doFlash();
  doVibe();

  setTimeout(()=>{
    const mark = getResultMark();
    saveImage(mark);
  },350);
});

function getResultMark(){
  if(currentMode==="inspect") return "DBG";
  const t = badge.textContent || "NG?";
  return t;
}

/* ----------------------------------------------------
   JPEG保存（軽量）
---------------------------------------------------- */
function saveImage(mark){
  const vw = cam.videoWidth;
  const vh = cam.videoHeight;
  if(!vw||!vh) return;

  const cvs = document.createElement("canvas");
  cvs.width=vw; cvs.height=vh;
  const ctx = cvs.getContext("2d");

  ctx.drawImage(cam,0,0,vw,vh);

  // ラベル
  const now = new Date();
  const y=now.getFullYear();
  const m=String(now.getMonth()+1).padStart(2,"0");
  const d=String(now.getDate()).padStart(2,"0");
  const hh=String(now.getHours()).padStart(2,"0");
  const mm=String(now.getMinutes()).padStart(2,"0");
  const ss=String(now.getSeconds()).padStart(2,"0");

  const ts=`${y}/${m}/${d} ${hh}:${mm}:${ss}`;

  const barH = Math.floor(vh*0.06);
  ctx.fillStyle="rgba(0,0,0,0.6)";
  ctx.fillRect(0,vh-barH,vw,barH);

  ctx.fillStyle="#fff";
  ctx.font=`bold ${Math.floor(vw/26)}px -apple-system`;
  ctx.textBaseline="middle";
  ctx.fillText(`日時:${ts}   結果:${mark}`,18,vh-barH/2);

  // JPEG（軽量）
  const quality = 0.70;
  const dataURL = cvs.toDataURL("image/jpeg",quality);

  const fname = `lamp_${y}${m}${d}_${hh}${mm}${ss}_${mark}.jpg`;

  const a=document.createElement("a");
  a.href=dataURL;
  a.download=fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

})();
