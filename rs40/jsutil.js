// ===== カメラ起動 =====
async function startCamera(constraints = { facingMode: "environment" }) {
  return await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
}
function onceCanPlay(video) {
  return new Promise(res => {
    if (video.readyState >= 2) return res();
    video.onloadedmetadata = () => res();
    video.oncanplay = () => res();
  });
}
function resizeCanvasToVideo(canvas, video) {
  const r = video.getBoundingClientRect();
  canvas.width = video.videoWidth || r.width;
  canvas.height = video.videoHeight || r.height;
}

// ===== ROI（右上・横長） =====
function calcRoi(canvas, { anchor='top-right', widthRatio=0.5, heightRatio=0.12, margin=0.02 }) {
  const W = canvas.width, H = canvas.height;
  const w = Math.round(W * widthRatio);
  const h = Math.round(H * heightRatio);
  const m = Math.round(Math.min(W, H) * margin);
  let x, y;
  if (anchor === 'top-right') { x = W - w - m; y = m; }
  else { x = W - w - m; y = m; } // 拡張余地
  return { x, y, w, h };
}
function placeRoiElement(el, roi, canvas) {
  // Canvas座標→CSS座標（動画要素にフィットしている前提で近似）
  const rect = el.parentElement.getBoundingClientRect();
  const cw = canvas.width, ch = canvas.height;
  const pw = rect.width, ph = rect.height;
  const scale = Math.min(pw/cw, ph/ch);
  const ox = (pw - cw*scale)/2, oy = (ph - ch*scale)/2;
  el.style.left = (ox + roi.x*scale) + 'px';
  el.style.top  = (oy + roi.y*scale) + 'px';
  el.style.width  = (roi.w*scale) + 'px';
  el.style.height = (roi.h*scale) + 'px';
}

// ===== 演出 =====
function flashOnce(el){ el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function vibrate(pattern){ if (navigator.vibrate) navigator.vibrate(pattern); }
function nowStr() {
  const d = new Date();
  const z = n => ('0'+n).slice(-2);
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}
function timestamp() {
  const d = new Date();
  const z = n => ('0'+n).slice(-2);
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// ===== 画像保存（JPG） =====
function downloadJpeg(canvas, filename='capture.jpg') {
  canvas.toBlob((blob)=>{
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }, 'image/jpeg', 0.92);
}

// ===== オーディオ =====
function safeAudio(src){
  const a = new Audio(src);
  a.preload = 'auto';
  return a;
}

// ===== スタンプ描画（判定・日時を焼き込み） =====
function drawAndStamp(canvas, video, roi, resultText='OK'){
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, W, H);

  // 判定ラベル
  ctx.fillStyle = (resultText==='OK'?'rgba(0,150,0,0.85)':'rgba(180,0,0,0.85)');
  ctx.fillRect(10, 10, 130, 38);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Noto Sans JP"';
  ctx.fillText(resultText, 18, 36);

  // 日時
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const stamp = nowStr();
  const m = ctx.measureText(stamp).width + 16;
  ctx.fillRect(10, H-36, m, 26);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Noto Sans JP"';
  ctx.fillText(stamp, 18, H-18);

  // ROIを薄く囲う（写真には残さない仕様ならコメントアウト可）
  // ctx.strokeStyle = 'rgba(0,255,255,0.8)';
  // ctx.lineWidth = 3;
  // ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);

  return canvas;
}
