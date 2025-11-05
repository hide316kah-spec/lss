function triggerShot(auto) {
  // --- フラッシュ演出（Safari安定版） ---
  flash.style.opacity = "1";
  requestAnimationFrame(() => {
    setTimeout(() => {
      flash.style.opacity = "0";
    }, 80);
  });

  // --- バイブ演出 ---
  try {
    navigator.vibrate?.([150, 100, 150]);
  } catch(e){}

  // --- 音声 ---
  if (auto) {
    setTimeout(() => okSound.play().catch(()=>{}), 200);
  }

  // --- 撮影処理（省略せず安定版） ---
  const canvas = document.createElement("canvas");
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw === 0 || vh === 0) return; // video未初期化防止
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, vw, vh);

  const ok = statusEl.textContent === "OK";
  ctx.fillStyle = ok ? "#17c964" : "#e5484d";
  ctx.globalAlpha = 0.85;
  ctx.fillRect(18, 18, ok ? 120 : 140, 60);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ok ? "#003300" : "#fff";
  ctx.font = "700 36px system-ui";
  ctx.fillText(ok ? "OK" : "NG?", 30, 60);

  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  const t = `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  ctx.font = "600 24px system-ui";
  ctx.fillStyle = "#fff";
  ctx.fillText(t, 18, vh - 24);

  const ts = `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok ? "OK" : "NG?"}.jpg`;

  canvas.toBlob((blob) => {
    pendingFile = new File([blob], ts, { type: "image/jpeg" });

    if (auto) {
      // 保存誘導メッセージ
      const msg = document.createElement("div");
      msg.textContent = "📸 画面をタップして保存";
      Object.assign(msg.style, {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "14px 22px",
        borderRadius: "10px",
        font: "600 18px system-ui",
        zIndex: "999",
      });
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
    }
  }, "image/jpeg", 0.92);
}
