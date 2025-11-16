//--------------------------------------------------
// 追加：モード管理
//--------------------------------------------------
let mode = "day"; // "day" | "night" | "debug"

//--------------------------------------------------
// モード切替（イラスト3枚が押された時に呼ぶ）
//--------------------------------------------------
function setMode(m){
  mode = m;

  if(mode==="day")   modeLabel.textContent = "昼モード";
  if(mode==="night") modeLabel.textContent = "夜モード";
  if(mode==="debug") modeLabel.textContent = "調査モード";

  debugPanel.hidden = (mode !== "debug");
}

//--------------------------------------------------
// カメラ起動（既存）
//--------------------------------------------------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d",{willReadFrequently:true});
const roiBox = document.getElementById("roi");
const flash = document.getElementById("flash");

async function startCamera(){
  const stream = await navigator.mediaDevices.getUserMedia({
    video:{facingMode:{ideal:"environment"}},
    audio:false
  });
  video.srcObject = stream;
  await video.play();
}

startCamera();

//--------------------------------------------------
// 既存のメインループ。
// ※判定ロジックには一切触らない
//--------------------------------------------------
function loop(){
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if(!vw || !vh){
    requestAnimationFrame(loop);
    return;
  }

  canvas.width = vw;
  canvas.height = vh;
  ctx.drawImage(video,0,0,vw,vh);

  // ROI計算（既存）
  const rw = Math.floor(vw * 0.58);
  const rh = Math.floor(vh * 0.26);
  const rx = vw - rw - Math.floor(vw*0.04);
  const ry = Math.floor(vh*0.06);

  const img = ctx.getImageData(rx,ry,rw,rh).data;

  //--------------------------------------------------
  // ★調査モード処理（追加）
  //--------------------------------------------------
  if(mode === "debug"){
    const dbg = debugMeasure(img);

    debugText.textContent =
      `Ravg:  ${dbg.Ravg}\n`+
      `Gavg:  ${dbg.Gavg}\n`+
      `Bavg:  ${dbg.Bavg}\n`+
      `L:     ${dbg.Lavg}\n`+
      `LED候補: ${dbg.ledCount} px\n`+
      `率:     ${dbg.ratio}%`;
  }

  requestAnimationFrame(loop);
}
loop();

//--------------------------------------------------
// ★調査モードの生データ取得（追加）
//--------------------------------------------------
function debugMeasure(img){
  let Rsum=0, Gsum=0, Bsum=0;
  let count=0, ledCount=0;

  for(let i=0; i<img.length; i+=4*6){
    const r=img[i], g=img[i+1], b=img[i+2];
    const L = r+g+b;
    const mx=Math.max(r,g,b);
    const mn=Math.min(r,g,b);

    Rsum+=r; Gsum+=g; Bsum+=b; count++;

    // LED候補（暫定）
    if(L>350 && (mx-mn)>25){
      ledCount++;
    }
  }

  const Ravg=Math.round(Rsum/count);
  const Gavg=Math.round(Gsum/count);
  const Bavg=Math.round(Bsum/count);
  const Lavg=Ravg+Gavg+Bavg;
  const ratio=(ledCount/count*100).toFixed(1);

  return {Ravg,Gavg,Bavg,Lavg,ledCount,ratio};
}

//--------------------------------------------------
// ショット撮影（★自動シャッター削除済み）
//--------------------------------------------------
const shutter = document.getElementById("shutter");

shutter.addEventListener("click", async ()=>{

  // ★バイブ & フラッシュ（共通仕様）
  try{ navigator.vibrate([50,50]); }catch{}
  flash.classList.add("fade");
  flash.addEventListener("animationend",()=>flash.classList.remove("fade"),{once:true});

  // そのまま静止画キャプチャ
  await capture();
});

//--------------------------------------------------
// 画像保存（既存の簡易化版）
//--------------------------------------------------
async function capture(){
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const c = document.createElement("canvas");
  c.width = vw;
  c.height = vh;
  const cx = c.getContext("2d");
  cx.drawImage(video,0,0,vw,vh);

  const blob = await new Promise(r=>c.toBlob(r,"image/png"));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `capture_${Date.now()}.png`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
