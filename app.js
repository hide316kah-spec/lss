/* ===== ランプシャッター（昼・夜 共通 完全版） ===== */
const CFG = {
  sampleStep: 6,
  fileName: (ok) => {
    const d = new Date(), z = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok?'OK':'NG?'}.jpg`;
  }
};

// 緑比率のモード別しきい値（昼1% / 夜4%）
const GREEN_RATIO_MIN = { day: 0.01, night: 0.04 };

const v = document.getElementById('preview');
const roi = document.getElementById('roi');
const st = document.getElementById('status');
const cam = document.getElementById('cam');
const flash = document.getElementById('flash');

if (v && roi && st && cam) {
  (async () => {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    v.srcObject = s;

    const c = document.createElement('canvas');
    const x = c.getContext('2d', { willReadFrequently: true });

    const loop = () => {
      const w = v.videoWidth, h = v.videoHeight;
      if (w && h) {
        c.width = w; c.height = h;
        x.drawImage(v, 0, 0, w, h);

        // ROIエリア
        const rx = Math.round(w * 0.55);
        const ry = Math.round(h * 0.06);
        const rw = Math.round(w * 0.45);
        const rh = Math.round(h * 0.25);

        const img = x.getImageData(rx, ry, rw, rh);
        const pixels = img.data;

        let greenCount = 0, redCount = 0, validSamples = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
          const brightness = (r + g + b) / 3;

          // 暗部・反射除外
          if (brightness > 50 && brightness < 240) {
            validSamples++;
            if (g > r * 1.4 && g > b * 1.2 && g > 90) greenCount++;
            if (r > g * 1.4 && r > b * 1.2 && r > 90) redCount++;
          }
        }

        // 灯数概算
        const gLampCount = Math.round(greenCount / 150);
        const rLampCount = Math.round(redCount / 150);

        // モード判定（昼 or 夜）
        const mode = (window.LS_MODE || 'day');
        const greenRatio = validSamples ? (greenCount / validSamples) : 0;

        // 判定
        let ok = false;
        if (gLampCount >= 5 && rLampCount === 0 && greenRatio >= GREEN_RATIO_MIN[mode]) {
          ok = true;
        }

        // 結果表示
        st.textContent = ok ? "OK" : "NG?";
        st.className = `badge ${ok ? 'ok' : 'ng'}`;

        // 自動シャッター
        const now = performance.now();
        if (ok && (!window._lsLast || now - window._lsLast > 1500)) {
          window._lsLast = now;
          takeShot(x, w, h, ok);
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  })();

  cam.addEventListener("click", () => {
    if (!v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const cx = c.getContext("2d");
    cx.drawImage(v, 0, 0, c.width, c.height);
    takeShot(cx, c.width, c.height, (st.textContent === "OK"));
  });
}

// ===== 撮影処理（写真保存対応） =====
async function takeShot(ctx, w, h, ok) {
  flash.style.opacity = .85;
  setTimeout(() => flash.style.opacity = 0, 120);
  if (navigator.vibrate) navigator.vibrate(80);

  // 焼き込み
  ctx.save();
  ctx.fillStyle = ok ? "#17c964" : "#e5484d";
  ctx.globalAlpha = .9;
  ctx.fillRect(18, 18, ok ? 120 : 140, 60);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ok ? "#003300" : "#fff";
  ctx.font = "700 36px system-ui";
  ctx.fillText(ok ? "OK" : "NG?", 30, 60);
  const d = new Date(), z = n => String(n).padStart(2, "0");
  const t = `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  ctx.font = "600 24px system-ui";
  ctx.fillStyle = "#fff";
  ctx.fillText(t, 18, h - 24);
  ctx.restore();

  // 音声OK
  if (ok) {
    const u = new SpeechSynthesisUtterance("オーケー");
    u.lang = "ja-JP";
    const v = speechSynthesis.getVoices().find(v => /ja|Japanese/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  // 保存処理（iPhoneはShareシートで写真保存）
  const url = ctx.canvas.toDataURL("image/jpeg", 0.92);
  const a = document.createElement('a');
  a.href = url;
  a.download = CFG.fileName(ok);

  // iPhone対応
  if (navigator.share) {
    fetch(url)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], CFG.fileName(ok), { type: 'image/jpeg' });
        navigator.share({
          files: [file],
          title: 'ランプシャッター撮影結果',
          text: 'この画像を写真アプリに保存してください。',
        }).catch(console.error);
      });
  } else {
    a.click();
  }
}
