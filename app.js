/* ランプシャッター共通：背面カメラ固定/非ミラー、ROIはプレビューのみ
   OK/NG?バッジは大きめ（OK=緑背景、NG?=赤背景）
   OKが一定時間継続で自動撮影＋女性音声＋フラッシュ＋バイブ
   保存は JPG ／ 例: 20251030_221530_OK.jpg または 20251030_221530_NG?.jpg
*/
(function(){
  function qs(s){return document.querySelector(s)}
  function pct(n,base){return Math.round((n/base)*1000)/10}

  async function initCamera(v){
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:"environment"}, // 背面
        width:{ideal:1920}, height:{ideal:1080}
      },
      audio:false
    });
    v.srcObject = stream;
    await v.play();
    return stream;
  }

  function layoutROI(v, roiEl, spec){
    const W = v.clientWidth, H = v.clientHeight;
    const w = Math.round(W * (spec.widthPct/100));
    const h = Math.round(H * (spec.heightPct/100));
    const top = Math.round(H * (spec.topPct/100));
    const right = Math.round(W * (spec.rightPct/100));
    roiEl.style.width = w+"px";
    roiEl.style.height = h+"px";
    roiEl.style.top = top+"px";
    roiEl.style.left = (W - right - w) +"px"; // 右上
  }

  function analyzeROI(ctx, x,y,w,h, step, th){
    let rHit=0,gHit=0,total=0;
    const data = ctx.getImageData(x,y,w,h).data;
    for(let j=0;j<h;j+=step){
      for(let i=0;i<w;i+=step){
        const idx=((j*w)+i)*4;
        const r=data[idx], g=data[idx+1], b=data[idx+2];
        const s=r+g+b || 1;
        const rn=r/s, gn=g/s;
        // 赤
        if(r>th.red.r && rn>th.red.rn && (r-g)>th.red.rg && (r-b)>th.red.rb){ rHit++; }
        // 緑
        if(g>th.green.g && gn>th.green.gn && (g-r)>th.green.gr && (g-b)>th.green.gb){ gHit++; }
        total++;
      }
    }
    return { rPct: pct(rHit,total), gPct: pct(gHit,total) };
  }

  function drawToCanvas(video, canvas){
    const vw = video.videoWidth, vh = video.videoHeight;
    canvas.width = vw; canvas.height = vh;
    const c = canvas.getContext("2d");
    c.drawImage(video,0,0,vw,vh); // 非ミラー
    return c;
  }

  function stamp(c, verdict){
    const pad = 18;
    const t = new Date();
    const ts = t.getFullYear().toString().padStart(4,"0")
      + (t.getMonth()+1).toString().padStart(2,"0")
      + t.getDate().toString().padStart(2,"0")
      + "_" + t.getHours().toString().padStart(2,"0")
      + t.getMinutes().toString().padStart(2,"0")
      + t.getSeconds().toString().padStart(2,"0");
    const W=c.canvas.width, H=c.canvas.height;
    c.font = Math.round(W*0.035)+"px system-ui";
    c.fillStyle="rgba(0,0,0,.55)";
    c.fillRect(pad, H-pad-70, W*0.6, 60);
    c.fillStyle="#fff";
    c.fillText(ts+"  "+verdict, pad+14, H-pad-24);
    return { ts };
  }

  async function captureAndSave(video, badge, flashEl, voice, verdict){
    // フラッシュ
    flashEl.style.opacity="1"; requestAnimationFrame(()=>flashEl.style.opacity="0");
    // バイブ
    if(navigator.vibrate) navigator.vibrate([40,30,40]);
    // 音声（OK時のみ）
    if(verdict==="OK"){
      try{ voice.currentTime=0; await voice.play(); }catch(_){}
    }

    const canvas = qs("#grab");
    const ctx = drawToCanvas(video, canvas);   // ROIは焼き込まない
    const meta = stamp(ctx, verdict);

    canvas.toBlob(blob=>{
      const name = `${meta.ts}_${verdict}.jpg`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    },"image/jpeg",0.92);
  }

  window.startLampShutter = async function(CONFIG){
    const v = qs("#v"), roiEl=qs("#roi"), badge=qs("#badge");
    const shutterBtn = qs("#shutter"); const flashEl=qs("#flash"); const voice=qs("#okvoice");

    const stream = await initCamera(v);
    const onResize = ()=> layoutROI(v, roiEl, CONFIG.roi);
    addEventListener("resize", onResize); v.addEventListener("loadedmetadata", onResize);
    onResize();

    let okStableSince = 0, lastVerdict = "NG?";
    const tmp = document.createElement("canvas"); const tctx = tmp.getContext("2d");

    function tick(){
      if(v.readyState>=2){
        // draw video frame to temp canvas matching ROI area
        const W=v.videoWidth, H=v.videoHeight;
        tmp.width=W; tmp.height=H; tctx.drawImage(v,0,0,W,H);

        // ROI座標（DOMとビデオの座標系をスケール変換）
        const scaleX = W / v.clientWidth;
        const scaleY = H / v.clientHeight;
        const rx = roiEl.offsetLeft * scaleX;
        const ry = roiEl.offsetTop  * scaleY;
        const rw = roiEl.clientWidth * scaleX;
        const rh = roiEl.clientHeight* scaleY;

        const pr = analyzeROI(tctx, rx,ry,rw,rh, CONFIG.sampleStep, CONFIG.thresholds);
        const isOK = (pr.gPct >= CONFIG.okRule.greenMinPct*100) && (pr.rPct <= CONFIG.okRule.redMaxPct*100);

        // バッジ
        if(isOK){ badge.textContent="OK"; badge.classList.add("ok"); }
        else    { badge.textContent="NG?"; badge.classList.remove("ok"); }

        // オートシャッター（OKがautoHoldMs継続）
        const now = performance.now();
        if(isOK){
          if(lastVerdict!=="OK"){ okStableSince = now; }
          if(now - okStableSince >= CONFIG.autoHoldMs){
            // 一回だけ切る
            captureAndSave(v, badge, flashEl, voice, "OK");
            okStableSince = Number.POSITIVE_INFINITY; // 連写は別仕様
          }
        }else{
          okStableSince = 0;
        }
        lastVerdict = isOK ? "OK" : "NG?";
      }
      requestAnimationFrame(tick);
    }
    tick();

    // 手動撮影（OK/NG? どちらでも撮影）
    shutterBtn.addEventListener("click", ()=> {
      const verdict = badge.classList.contains("ok") ? "OK" : "NG?";
      captureAndSave(v, badge, flashEl, voice, verdict);
    });

    // ページ離脱時に停止
    addEventListener("pagehide", ()=> stream.getTracks().forEach(t=>t.stop()), {once:true});
  }
})();
