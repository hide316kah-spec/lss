//---------------------------------------------------------
// 基本変数
//---------------------------------------------------------
let mode = null;                  // "day" / "night" / "debug"
let video = null;
let roiBox = null;
let badge = null;
let shutterBtn = null;
let debugPanel = null;
let debugText = null;
let flash = null;

let stream = null;
let wCanvas = null;
let wCtx = null;

// ROI 実寸（判定は JS 側で video 座標にフィットさせる）
let roi = { x: 0, y: 0, w: 0, h: 0 };

// 判定間隔
const INTERVAL = 200;   // 速い & 実用重視

//---------------------------------------------------------
// 起動
//---------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
    video       = document.getElementById("video");
    roiBox      = document.getElementById("roi");
    badge       = document.getElementById("badge");
    shutterBtn  = document.getElementById("shutter");
    debugPanel  = document.getElementById("debugPanel");
    debugText   = document.getElementById("debugText");
    flash       = document.getElementById("flash");
    wCanvas     = document.getElementById("workCanvas");
    wCtx        = wCanvas.getContext("2d");

    document.getElementById("dayBtn").onclick   = () => startMode("day");
    document.getElementById("nightBtn").onclick = () => startMode("night");
    document.getElementById("debugBtn").onclick = () => startMode("debug");

    shutterBtn.onclick = () => takePhoto();
});

//---------------------------------------------------------
// モード開始
//---------------------------------------------------------
async function startMode(m) {
    mode = m;

    document.getElementById("modeSelect").hidden = true;
    document.getElementById("app").hidden = false;

    document.getElementById("modeLabel").innerText =
        mode === "day"   ? "昼モード" :
        mode === "night" ? "夜モード" :
                           "調査モード";
    document.getElementById("modeLabel").hidden = false;

    if (mode === "debug") debugPanel.hidden = false;
    else debugPanel.hidden = true;

    await startCamera();
    startLoop();
}

//---------------------------------------------------------
// カメラ開始
//---------------------------------------------------------
async function startCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }

    stream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: false
    });

    video.srcObject = stream;

    return new Promise(resolve => {
        video.onloadedmetadata = () => {
            video.play();
            updateROI();   // video サイズ確定後に ROI 初期化
            resolve();
        };
    });
}

//---------------------------------------------------------
// ROI を “以前と同じ形” に復元（右上・横長）
// video の縦横比にフィットさせる
//---------------------------------------------------------
function updateROI() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // 以前の実用サイズに合わせてチューニング
    roi.w = Math.floor(vw * 0.45);   // 横 45%
    roi.h = Math.floor(vh * 0.22);   // 縦 22%
    roi.x = vw - roi.w - Math.floor(vw * 0.02);  // 右端 2%
    roi.y = Math.floor(vh * 0.15);               // 上 15%

    // 画面上に ROI を反映（CSS ≠ 判定位置、JSで絶対座標配置）
    const rect = video.getBoundingClientRect();
    const sx = rect.width / vw;
    const sy = rect.height / vh;

    roiBox.style.width  = `${roi.w * sx}px`;
    roiBox.style.height = `${roi.h * sy}px`;
    roiBox.style.left   = `${rect.left + roi.x * sx}px`;
    roiBox.style.top    = `${rect.top  + roi.y * sy}px`;
}

//---------------------------------------------------------
// 判定ループ
//---------------------------------------------------------
function startLoop() {
    setInterval(() => {
        if (!video.videoWidth) return;
        updateROI();   // 各フレームごとに ROI 再フィット

        const result = analyzeROI();

        if (mode !== "debug") {
            if (result.redPct > 1.0) {
                showNG();
            } else if (result.greenPct > 3.0) {
                showOK();
            } else {
                showNG();
            }
        } else {
            badge.hidden = true;
        }

    }, INTERVAL);
}

//---------------------------------------------------------
// ROI解析
//---------------------------------------------------------
function analyzeROI() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return { redPct:0, greenPct:0 };

    wCanvas.width  = roi.w;
    wCanvas.height = roi.h;

    wCtx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
    const img = wCtx.getImageData(0, 0, roi.w, roi.h).data;

    let rSum=0, gSum=0, bSum=0;
    const skip = 6; // 軽量化
    let count=0;

    for (let i=0; i<img.length; i+=4*skip) {
        const r = img[i];
        const g = img[i+1];
        const b = img[i+2];
        rSum += r; gSum += g; bSum += b;
        count++;
    }

    const Ravg = rSum / count;
    const Gavg = gSum / count;
    const Bavg = bSum / count;

    const redPct   = (Ravg / (Ravg+Gavg+Bavg)) * 100;
    const greenPct = (Gavg / (Ravg+Gavg+Bavg)) * 100;

    if (mode === "debug") {
        debugText.innerText =
          `Ravg : ${Ravg.toFixed(1)}\n` +
          `Gavg : ${Gavg.toFixed(1)}\n` +
          `Bavg : ${Bavg.toFixed(1)}\n` +
          `red% : ${redPct.toFixed(2)}\n` +
          `green%: ${greenPct.toFixed(2)}`;
    }

    return { redPct, greenPct };
}

//---------------------------------------------------------
// 表示：OK / NG
//---------------------------------------------------------
function showOK() {
    badge.hidden = false;
    badge.classList.remove("ng");
    badge.classList.add("ok");
    badge.innerText = "OK";
}

function showNG() {
    badge.hidden = false;
    badge.classList.remove("ok");
    badge.classList.add("ng");
    badge.innerText = "NG?";
}

//---------------------------------------------------------
// 撮影
//---------------------------------------------------------
function takePhoto() {
    if (!video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    wCanvas.width  = vw;
    wCanvas.height = vh;
    wCtx.drawImage(video, 0, 0, vw, vh);

    // フラッシュ
    flash.style.opacity = 1;
    setTimeout(() => flash.style.opacity = 0, 120);

    // バイブ
    if (navigator.vibrate) navigator.vibrate([80]);

    // レンダリング＆保存
    wCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = Date.now();

        const tag = (badge.innerText === "OK") ? "_OK" : "_NG";
        a.download = `lamp_${ts}${tag}.png`;

        a.href = url;
        a.target = "_blank";  // iOS 写真アプリに乗りやすくする
        a.click();

        URL.revokeObjectURL(url);
    }, "image/png");
}
