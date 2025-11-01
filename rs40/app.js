/* ===== ランプシャッター 共通 ===== */
const CFG = {
  sampleStep: 6,

  // ---- 色判定（黄色LEDと白反射を除外）----
  base: {
    red: (r,g,b) => {
      const sum = r + g + b;
      if (sum < 80) return false; // 暗すぎると無視
      const rn = r / sum, gn = g / sum, bn = b / sum;
      const sat = 1 - 3 * Math.min(rn, gn, bn); // 彩度（白反射対策）
      const isWhiteish = (r > 180 && g > 180 && b > 180) || sat < 0.25;
      const isYellowish = (r > 120 && g > 100 && b < 80 && r - b > 50); // 黄色除外
      return (!isWhiteish && !isYellowish &&
              r > 90 && rn > 0.40 && (r - g) > 18 && (r - b) > 18);
    },
    green: (r,g,b) => {
      const sum = r + g + b;
      if (sum < 80) return false;
      const rn = r / sum, gn = g / sum, bn = b / sum;
      const sat = 1 - 3 * Math.min(rn, gn, bn);
      const isWhiteish = (r > 180 && g > 180 && b > 180) || sat < 0.25;
      const isYellowish = (r > 120 && g > 100 && b < 80 && r - b > 50);
      return (!isWhiteish && !isYellowish &&
              g > 80 && gn > 0.40 && (g - r) > 10 && (g - b) > 10);
    },
  },

  // ---- モード別閾値 ----
  mode: {
    day:   { gRatioOK: 0.015, redAnyMin: 0.002, greenCellMin: 5 },
    night: { gRatioOK: 0.012, redAnyMin: 0.002, greenCellMin: 5 }
  },

  // ---- ファイル名 ----
  fileName: (ok)=>{
    const d=new Date(),z=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok?'OK':'NG?'}.jpg`;
  }
};

/* ======================== 本体 ======================== */
const v=document.getElementById('preview');
const roi=document.getElementById('roi');
const st=document.getElementById('status');
const cam=document.getElementById('cam');
const flash=document.getElementById('flash');

function updateLiveStats(redCount, greenCount, sampleCount){
  const redPct   = sampleCount ? (redCount   / sampleCount * 100) : 0;
  const greenPct = sampleCount ? (greenCount / sampleCount * 100) : 0;
  document.getElementById('stat-red').textContent   = redPct.toFixed(1) + '%';
  document.getElementById('stat-green').textContent = greenPct.toFixed(1) + '%';
}

if(v&&roi&&st&&cam){
 (async()=>{
  const s=await navigator.mediaDevices.getUserMedia({
   video:{facingMode:"environment"}, audio:false
  });
  v.srcObject=s;

  const c=document.createElement('canvas');
  const x=c.getContext('2d',{willReadFrequently:true});

  const loop=()=>{
    const w=v.videoWidth,h=v.videoHeight;
    if(w&&h){
      c.width=w;c.height=h;x.drawImage(v,0,0,w,h);

      // ---- ROI設定（右上 45%×25%）----
      const rx=Math.round(w*0.55);
      const ry=Math.round(h*0.06);
      const rw=Math.round(w*0.45);
      const rh=Math.round(h*0.25);

      let redCount=0,greenCount=0,sampleCount=0;
      const step=CFG.sampleStep;

      const COLS=5, ROWS=3;
      const cellHit=Array.from({length:ROWS},()=>Array(COLS).fill(0));
      const cellThresh=6;

      for(let y=ry;y<ry+rh;y+=step){
        for(let i=rx;i<rx+rw;i+=step){
          const d=x.getImageData(i,y,1,1).data;
          const r=d[0],g=d[1],b=d[2];

          if(CFG.base.red(r,g,b))   redCount++;
          if(CFG.base.green(r,g,b)){
            greenCount++;
            const cx=Math.floor((i-rx)/rw*COLS);
            const cy=Math.floor((y-ry)/rh*ROWS);
            if(cx>=0&&cx<COLS&&cy>=0&&cy<ROWS) cellHit[cy][cx]++;
          }
          sampleCount++;
        }
      }

      let greenCells=0;
      for(let r=0;r<ROWS;r++){
        for(let cidx=0;cidx<COLS;cidx++){
          if(cellHit[r][cidx]>=cellThresh) greenCells++;
        }
      }

      updateLiveStats(redCount,greenCount,sampleCount);

      const rr=sampleCount?redCount/sampleCount:0;
      const gr=sampleCount?greenCount/sampleCount:0;
      const M=CFG.mode[window.LS_MODE||'day'];

      const hasAnyRed=(rr>=M.redAnyMin);
      const enoughGreen=(gr>=M.gRatioOK);
      const spreadGreen=(greenCells>=M.greenCellMin);

      const ok=(!hasAnyRed)&&enoughGreen&&spreadGreen;

      st.textContent=ok?"OK":"NG?";
      st.className=`badge ${ok?'ok':'ng'}`;

      const now=performance.now();
      if(ok&&(!window._lsLast||now-window._lsLast>1200)){
        window._lsLast=now; takeShot("auto",x,w,h,ok);
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
 })();

 cam.addEventListener("click",()=>{
  if(!v.videoWidth)return;
  const c=document.createElement("canvas");
  c.width=v.videoWidth;c.height=v.videoHeight;
  const cx=c.getContext("2d");
  cx.drawImage(v,0,0,c.width,c.height);
  takeShot("manual",cx,c.width,c.height,(st.textContent==="OK"));
 });
}

/* ======================== 撮影処理 ======================== */
async function takeShot(type,ctx,w,h,ok){
  flash.style.opacity=.85;setTimeout(()=>flash.style.opacity=0,120);
  if(navigator.vibrate)navigator.vibrate(80);
  ctx.save();
  ctx.fillStyle=ok?"#17c964":"#e5484d";ctx.globalAlpha=.9;
  ctx.fillRect(18,18,ok?120:140,60);
  ctx.globalAlpha=1;ctx.fillStyle=ok?"#003300":"#fff";
  ctx.font="700 36px system-ui";ctx.fillText(ok?"OK":"NG?",30,60);
  const d=new Date(),z=n=>String(n).padStart(2,"0");
  const t=`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  ctx.font="600 24px system-ui";ctx.fillStyle="#fff";
  ctx.fillText(t,18,h-24);
  ctx.restore();
  if(ok){
    const u=new SpeechSynthesisUtterance("オーケー");
    u.lang="ja-JP";
    const v=speechSynthesis.getVoices().find(v=>/ja|Japanese/i.test(v.lang));
    if(v)u.voice=v;speechSynthesis.speak(u);
  }
  const url=ctx.canvas.toDataURL("image/jpeg",0.92);
  const a=document.createElement("a");
  a.href=url;a.download=CFG.fileName(ok);a.click();a.remove();
}
