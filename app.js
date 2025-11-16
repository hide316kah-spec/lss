let mode = "";
let stream = null;
let video = document.getElementById("video");
let roiBox = document.getElementById("roi");
let badge = document.getElementById("badge");
let modeLabel = document.getElementById("modeLabel");
let debugPanel = document.getElementById("debugPanel");
let debugText = document.getElementById("debugText");
let shutter = document.getElementById("shutter");
let flash = document.getElementById("flash");

const workCanvas = document.getElementById("workCanvas");
const wctx = workCanvas.getContext("2d");

/* モード選択 */
document.getElementById("dayBtn").onclick = () => startMode("day");
document.getElementById("nightBtn").onclick = () => startMode("night");
document.getElementById("debugBtn").onclick = () => startMode("debug");

async function startMode(m) {
  mode = m;
  document.getElementById("modeSelect").hidden = true;
  document.getElementById("app").hidden = false;

  modeLabel.hidden = false;
  modeLabel.textContent = 
    mode === "day" ? "昼モード" :
    mode === "night" ? "夜モード" :
    "調査モード";

  if (mode === "debug") badge.hidden = true;
  else badge.hidden = false;

  await startCamera();
  requestAnimationFrame(loop);

  /* Safari のURLバーを隠す */
  setTimeout(() => { window.scrollTo(0,1); }, 300);
}

/* カメラ起動 */
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode:"environment" },
    audio: false
  });
  video.srcObject = stream;

  await video.play();
}

/* ROI の B案サイズ（JS で video 座標に追従） */
function updateROI() {
  let vw = video.videoWidth;
  let vh = video.videoHeight;

  if (!vw || !vh) return;

  const boxW = vw * 0.63;   // 58% → 63%（横 +5%）
  const boxH = vh * 0.30;   // 26% → 30%（縦 +4%）

  const left = vw - boxW - vw * 0.04;
  const top  = vh * 0.05;

  /* video → CSS 変換 */
  const rect = video.getBoundingClientRect();
  const scaleX = rect.width / vw;
  const scaleY = rect.height / vh;

  roiBox.style.left = (left * scaleX + rect.left) + "px";
  roiBox.style.top  = (top  * scaleY + rect.top)  + "px";
  roiBox.style.width  = (boxW * scaleX) + "px";
  roiBox.style.height = (boxH * scaleY) + "px";

  return { left, top, boxW, boxH };
}

/* 判定ループ */
function loop() {
  const roi = updateROI();
  if (!roi) return requestAnimationFrame(loop);

  const { left, top, boxW, boxH } = roi;

  workCanvas.width = boxW;
  workCanvas.height = boxH;
  wctx.drawImage(video, left, top, boxW, boxH, 0, 0, boxW, boxH);

  const data = wctx.getImageData(0,0,boxW,boxH).data;

  let r=0,g=0,b=0, cnt = data.length/4;
  for (let i=0;i<data.length;i+=4){
    r+=data[i];
    g+=data[i+1];
    b+=data[i+2];
  }
  r/=cnt; g/=cnt; b/=cnt;

  const redp = (r/(r+g+b))*100;
  const greenp = (g/(r+g+b))*100;
  const bluep = (b/(r+g+b))*100;

  if (mode === "debug") {
    debugPanel.hidden = false;
    debugText.textContent =
      `Ravg : ${r.toFixed(1)}\n`+
      `Gavg : ${g.toFixed(1)}\n`+
      `Bavg : ${b.toFixed(1)}\n`+
      `red% : ${redp.toFixed(2)}\n`+
      `green%: ${greenp.toFixed(2)}\n`+
      `blue% : ${bluep.toFixed(2)}`;
  }

  /* 昼夜モードの判定だけ有効 */
  if (mode !== "debug") {
    if (redp > 1.0) {
      badge.textContent = "NG?";
      badge.className = "badge ng";
    } else if (greenp > 3.0) {
      badge.textContent = "OK";
      badge.className = "badge ok";
    } else {
      badge.textContent = "NG?";
      badge.className = "badge ng";
    }
  }

  requestAnimationFrame(loop);
}

/* シャッター */
shutter.onclick = () => {
  doFlash();
  doVibe();

  setTimeout(() => {
    saveImage();
  }, 200);
};

/* フラッシュ演出 */
function doFlash(){
  flash.style.opacity = 1;
  setTimeout(()=> flash.style.opacity=0,150);
}

/* バイブ */
function doVibe(){
  if (navigator.vibrate) navigator.vibrate([80,50,80]);
}

/* 保存（JPEG固定） */
function saveImage(){
  let canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  let ctx = canvas.getContext("2d");
  ctx.drawImage(video,0,0);

  let url = canvas.toDataURL("image/jpeg",0.92);

  const a = document.createElement("a");
  a.href = url;
  a.download = `lamp_${Date.now()}.jpg`;
  a.target = "_blank";
  a.click();
}
