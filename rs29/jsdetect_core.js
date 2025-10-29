class Detector {
  constructor(video, canvas, ctx, roi, thresholds, onDecision){
    this.v = video; this.c = canvas; this.ctx = ctx; this.roi = roi;
    this.th = thresholds; this.onDecision = onDecision;
    this.timer = null;
    this.lastDecision = null;
    this.cooldown = 650;   // 連写間隔（ms）
    this._lastShotAt = 0;
  }
  start(){
    if (this.timer) return;
    this.timer = setInterval(()=> this._tick(), 140); // 判定周期
  }
  stop(){
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  _tick(){
    const { v, c, ctx, roi } = this;
    if (!v.videoWidth) return;

    ctx.drawImage(v, 0, 0, c.width, c.height);
    const img = ctx.getImageData(roi.x, roi.y, roi.w, roi.h).data;

    let rCnt=0, gCnt=0, lumCnt=0;
    const len = img.length;
    for (let i=0; i<len; i+=4){
      const r=img[i], g=img[i+1], b=img[i+2];
      const lum = (r*0.2126 + g*0.7152 + b*0.0722);
      if (lum >= this.th.minLuminance) lumCnt++;
      // 簡易色判定（強めの赤/緑）
      if (r>150 && r>g*1.2 && r>b*1.2) rCnt++;
      if (g>150 && g>r*1.1 && g>b*1.2) gCnt++;
    }
    const total = (roi.w*roi.h);
    const greenRatio = gCnt / total;
    const redRatio   = rCnt / total;

    // ルール：赤が一定以上ならNG、緑が一定以上ならOK、どちらでもないなら前回維持
    let decision = this.lastDecision || 'NG?';
    if (redRatio >= this.th.redRatioNG)     decision = 'NG?';
    else if (greenRatio >= this.th.greenRatioOK) decision = 'OK';

    // バッジ更新だけは外からやるので保持
    this.lastDecision = decision;

    // 自動撮影：前回と変わった瞬間だけ or 一定時間ごと
    const now = performance.now();
    if (this._shouldShoot(decision, now)) {
      this._lastShotAt = now;
      this.onDecision && this.onDecision(decision, 'auto');
    }
  }
  _shouldShoot(decision, now){
    // 直近の撮影からcooldown経過、かつOK/NG? いずれでも可（変更時優先）
    if ((now - this._lastShotAt) < this.cooldown) return false;
    return true;
  }
}
