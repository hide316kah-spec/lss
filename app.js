/* ===== ランプシャッター 共通 ===== */
const CFG={
 sampleStep:6,
 base:{
   red:(r,g,b)=>(r>90)&&(r/(r+g+b)>0.40)&&((r-g)>18)&&((r-b)>18),
   green:(r,g,b)=>(g>80)&&(g/(r+g+b)>0.40)&&((g-r)>10)&&((g-b)>10),
 },
 mode:{
   // 昼＝かなり緩く
   day:{ gRatioOK:0.010, rRatioMax:0.020 },
   // 夜＝甘め
   night:{ gRatioOK:0.015, rRatioMax:0.010 }
 },
 fileName:(ok)=>{
   const d=new Date(),z=n=>String(n).padStart(2,"0");
   return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_${ok?'OK':'NG?'}.jpg`;
 }
};

// --- ライブ統計表示 ---
function updateLiveStats(redCount, greenCount, sampleCount){
  const redPct   = sampleCount ? (redCount   / sampleCount * 100) : 0;
  const greenPct = sampleCount ? (greenCount / sampleCount * 100) : 0;
  const rEl = document.getElementById('stat-red');
  const gEl = document.getElementById('stat-green');
  if(rEl) rEl.textContent = redPct.toFixed(1) + '%';
  if(gEl) gEl.textContent = greenPct.toFixed(1) + '%';
}

const v=document.getElementById('preview');
const roi=document.getElementById('roi');
const st=document.getElementById('status');
const cam=document.getElementById('cam');
const flash=document.getElementById('flash');

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
    const rx=Math.round(w*0.53),ry=Math.round(h*0.06);
    const rw=Math.round(w*0.45),rh=Math.round(h*0.25);
    let rc=0,gc=0,t=0,step=CFG.sampleStep;
    for(let y=ry;y<ry+rh;y+=step){
     for(let i=rx;i<rx+rw;i+=step){
      const d=x.getImageData(i,y,1,1).data;
      const r=d[0],g=d[1],b=d[2];
      if(CFG.base.red(r,g,b))rc++;
      if(CFG.base.green(r,g,b))gc++;
      t++;
     }
    }
    const rr=rc/t,gr=gc/t;
    const M=CFG.mode[window.LS_MODE||'day'];
    const ok=(gr>=M.gRatioOK)&&(rr<=M.rRatioMax);
    st.textContent=ok?"OK":"NG?";
    st.className=`badge ${ok?'ok':'ng'}`;
    updateLiveStats(rc,gc,t);
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
