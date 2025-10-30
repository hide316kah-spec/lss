/* ===== ランプシャッター 共通 ===== */

// ---- 設定（絶対に触らないUI仕様）----
const CFG = {
  sampleStep: 6,                 // サンプリング間隔(px)
  fileName: (ok)=> {
    const d = new Date();
    const z = n=> String(n).padStart(2,'0');
    return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok?'OK':'NG?'}.jpg`;
  },
  // 色判定の基本条件
  base: {
    red:  (r,g,b)=> (r>90) && (r/(r+g+b) > 0.40) && ((r-g)>18) && ((r-b)>18),
    green:(r,g,b)=> (g>80) && (g/(r+g+b) > 0.40) && ((g-r)>10) && ((g-b)>10),
  },
  // 昼/夜で閾値（厳しめ/甘め）の補正
  mode: {
    day:   { // 昼＝厳しめ（誤検知抑制）
      gRatioOK: 0.020,   // ROI内で緑画素割合がこれ以上
      rRatioMax:0.006    // かつ赤画素割合がこれ以下 → OK
    },
    night: { // 夜＝甘め（光飽和に配慮）
      gRatioOK: 0.015,
      rRatioMax:0.010
    }
  }
};

// ---- DOM 取得（モード画面でのみ動作）----
const video = document.getElementById('preview');
const roiEl = document.getElementById('roi');
const statusEl = document.getElementById('status');
const camBtn = document.getElementById('cam');
const flashEl = document.getElementById('flash');

if (video && roiEl && statusEl && camBtn) {
  (async () => {
    // 背面カメラ固定 / 非ミラー
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 }, height: { ideal: 1080 },
        focusMode: "continuous" // iOSは無視されてもOK
      },
      audio:false
    });
    video.srcObject = stream;

    // 解析ループ
    const off = document.createElement('canvas');
    const ctx = off.getContext('2d',{willReadFrequently:true});
    const loop = () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        off.width = vw; off.height = vh;
        ctx.drawImage(video, 0, 0, vw, vh);

        // ROI（右上・横長）を動画サイズから算出（UIの枠と一致）
        const rx = Math.round(vw*0.52), ry = Math.round(vh*0.06);
        const rw = Math.round(vw*0.46), rh = Math.round(vh*0.18);

        // 6px間隔でサンプリング
        const step = CFG.sampleStep;
        let rCount=0, gCount=0, total=0;
        for (let y=ry; y<ry+rh; y+=step){
          for (let x=rx; x<rx+rw; x+=step){
            const d = ctx.getImageData(x,y,1,1).data;
            const r=d[0], g=d[1], b=d[2];
            if (CFG.base.red(r,g,b))   rCount++;
            if (CFG.base.green(r,g,b)) gCount++;
            total++;
          }
        }
        const rRatio = rCount/total, gRatio = gCount/total;

        // 閾値（昼/夜）
        const M = CFG.mode[(window.LS_MODE||'day')];
        const isOK = (gRatio >= M.gRatioOK) && (rRatio <= M.rRatioMax);

        // HUD表示（動的更新）
        statusEl.textContent = isOK ? "OK" : "NG?";
        statusEl.className = `badge ${isOK?'ok':'ng'}`;

        // OKで自動撮影（1回/1.2秒まで）
        const now = performance.now();
        if (isOK && (!window.__lastShot || now - window.__lastShot > 1200)) {
          window.__lastShot = now;
          takeShot("auto", ctx, vw, vh, isOK);
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  })();

  // 手動撮影
  camBtn.addEventListener('click', async ()=>{
    const v = video;
    if (!v.videoWidth) return;
    const off = document.createElement('canvas');
    off.width = v.videoWidth; off.height = v.videoHeight;
    const c = off.getContext('2d');
    c.drawImage(v,0,0,off.width,off.height);
    const ok = (statusEl.textContent==="OK");
    await takeShot("manual", c, off.width, off.height, ok);
  });
}

// ---- 撮影・保存（ROIは焼き込まない・OK/NG?と日時のみ焼き込む）----
async function takeShot(kind, ctx, w, h, isOK){
  // フラッシュ＋バイブ
  flashEl.style.opacity = .85; setTimeout(()=>flashEl.style.opacity=0,120);
  if (navigator.vibrate) navigator.vibrate(80);

  // HUD焼き込み
  ctx.save();
  ctx.fillStyle = isOK ? "#17c964" : "#e5484d";
  ctx.globalAlpha = .9;
  ctx.fillRect(18,18, isOK?120:140, 60);
  ctx.globalAlpha = 1;
  ctx.fillStyle = isOK ? "#003300" : "#fff";
  ctx.font = "700 36px system-ui,-apple-system";
  ctx.fillText(isOK?"OK":"NG?", 30, 60);
  // 日時
  const d = new Date();
  const z=n=>String(n).padStart(2,"0");
  const stamp = `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  ctx.font = "600 24px system-ui,-apple-system";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(stamp, 18, h-24);
  ctx.restore();

  // 音声「OK」再生（Web Speech：女性声を優先）
  if (isOK) {
    try {
      const u = new SpeechSynthesisUtterance("オーケー");
      u.lang = "ja-JP";
      const voices = speechSynthesis.getVoices();
      const f = voices.find(v=>/ja|Japanese/i.test(v.lang) && /female|女|Microsoft Haruka|Kyoko/i.test(v.name));
      if (f) u.voice = f;
      speechSynthesis.speak(u);
    } catch(e){}
  }

  // JPG生成＆ダウンロード（iOSは共有シート）
  const dataUrl = ctx.canvas.toDataURL("image/jpeg", 0.92);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = CFG.fileName(isOK);
  document.body.appendChild(a);
  a.click();
  a.remove();
}
