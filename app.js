/**
 * Nebula Garden — app.js
 * 目に優しい癒しの宇宙アクションゲーム
 * 引力でゆっくり小惑星を星に引き寄せる
 */

'use strict';

// ============================================================
// 定数・設定
// ============================================================
const CONFIG = {
  // 背景の星
  STAR_COUNT_RATIO: 7000,              // 画面面積あたりの星の数（脳リフレクソ仕様）

  ASTEROID_MIN_RADIUS: 11,
  ASTEROID_MAX_RADIUS: 18,
  ASTEROID_SPEED_MIN: 0.18,
  ASTEROID_SPEED_MAX: 0.52,
  ASTEROID_SPAWN_INTERVAL_BASE: 4500,  // ms（4.5秒ごと）
  ASTEROID_SPAWN_INTERVAL_MIN: 2000,   // ms（最速でも2秒以上）
  ASTEROID_MAX_COUNT: 2,               // 最大同時出現数
  ASTEROID_POINTS: 6,                  // 多角形の頂点数

  // Planet（あなたの星＝月）
  PLANET_INIT_RADIUS: 38,
  PLANET_GROW_PER_ABSORB: 0.15,        // 吸収するたびに成長する量(px)（もっとずっとゆっくり成長）
  PLANET_MAX_RADIUS: 90,

  // 引力フィールド
  GRAVITY_RADIUS: 160,                 // 引力の届く距離(px)
  GRAVITY_STRENGTH: 0.28,             // 引力の強さ係数
  VELOCITY_DAMPING: 0.978,            // 速度の減衰（慣性）

  // 吸収エフェクト
  ABSORB_RING_DURATION: 900,          // ms
  ABSORB_RING_MAX_RADIUS_MULT: 3.0,

  // 音
  REVERB_DURATION: 2.5,               // s（リバーブの長さ）
  TONE_FREQ: 720,                     // Hz（高めの柔らかい周波数）
  TONE_DURATION: 0.18,                // s（音の発音時間）
};

// 肯定的フィードバックワード
const FEEDBACK_WORDS = [
  'ほっ… / Whew...', 'やさしい / Gentle', 'きもちいい / Relaxing', 'いいね / Nice', 'すっきり / Clear',
  '癒される / Soothing', 'そっと / Softly', 'つながった / Connected', '✦', 'しずか / Silent',
];

// 脳リフレクソの星の色
const STAR_COLORS = [
  'rgba(255, 255, 255, ', // 純白
  'rgba(224, 242, 254, ', // 青白い星
  'rgba(254, 240, 138, ', // 黄色い星
  'rgba(253, 244, 245, '  // 淡いピンクの星
];

// ============================================================
// ユーティリティ
// ============================================================
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

// ============================================================
// Web Audio API — リバーブ感のある包み込む音
// ============================================================
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.reverbNode = null;
    this.reverbReady = false;
    this.carbonatedBuffer = null;
  }

  /**
   * ユーザー操作（クリック・タッチ）のコールスタックで呼ぶ。
   * AudioContext を生成/resume し、初回のみリバーブを初期化する。
   */
  unlock() {
    // すでにAudioContextが作成され、アクティブ（running）状態であれば何もしないで早期リターン
    if (this.ctx && this.ctx.state === 'running') {
      return;
    }

    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('Web Audio API not available:', e);
        return;
      }
    }

    // iOS Safariの制限を突破するため、ユーザー操作の「同期的コールスタック内」でダミー音を即座に再生
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      osc.start(0);
      osc.stop(this.ctx.currentTime + 0.04);
    } catch (err) {
      console.warn("Synchronous dummy sound play failed:", err);
    }

    // 非同期で音声コンテキストのレジュームとリバーブバッファ等の構築を行う
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this._ensureReverb();
        this._ensureCarbonated();
      }).catch(e => console.warn('AudioContext resume failed:', e));
    } else {
      this._ensureReverb();
      this._ensureCarbonated();
    }
  }

  /** 後方互換: init() は unlock() に委譲 */
  init() { this.unlock(); }

  /** リバーブ（ConvolverNode）を初回のみ構築 */
  _ensureReverb() {
    if (this.reverbReady || !this.ctx) return;
    try {
      this._buildReverb();
      this.reverbReady = true;
    } catch (e) {
      console.warn('Failed to build reverb:', e);
    }
  }

  /** 炭酸水バッファを初回のみ生成 */
  _ensureCarbonated() {
    if (this.carbonatedBuffer || !this.ctx) return;
    try {
      this._pregenerateCarbonated();
    } catch (e) {
      console.warn('Failed to generate carbonated buffer:', e);
    }
  }

  /** インパルス応答を生成してConvolverNodeを作る */
  _buildReverb() {
    const sampleRate = this.ctx.sampleRate;
    const duration = CONFIG.REVERB_DURATION;
    const length = sampleRate * duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        // リバーブ自体の振幅を1.8倍にして音量を底上げする
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, 2.8) * 1.8;
      }
    }

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = impulse;
    this.reverbNode.normalize = false; // 自動ノーマライズを無効にして音量を維持
    this.reverbNode.connect(this.ctx.destination);
  }

  _pregenerateCarbonated() {
    try {
      const durationSeconds = 6.5;
      const sampleRate = this.ctx.sampleRate;
      const bufferSize = sampleRate * durationSeconds;
      
      const audioBuffer = this.ctx.createBuffer(2, bufferSize, sampleRate);
      const leftData = audioBuffer.getChannelData(0);
      const rightData = audioBuffer.getChannelData(1);
      
      // 1. ベースノイズの合成
      for (let i = 0; i < bufferSize; i++) {
        const time = i / sampleRate;
        const amp = Math.min(1.0, time / 0.15) * Math.exp(-time / 2.0) * 0.032;
        const noise = Math.random() * 2 - 1;
        leftData[i] = noise * amp;
        rightData[i] = noise * amp;
      }
      
      // 2. パチパチ音（400個）を一括加算
      const bubbleCount = 400;
      const clickDuration = durationSeconds - 0.2;
      
      for (let i = 0; i < bubbleCount; i++) {
        let timeOffset;
        if (i < 320) {
          timeOffset = Math.pow(Math.random(), 1.4) * 4.0;
        } else {
          timeOffset = 4.0 + Math.random() * (clickDuration - 4.0);
        }
        
        const isNoise = Math.random() < 0.35;
        const clickLen = isNoise 
          ? (0.003 + Math.random() * 0.006) 
          : (0.004 + Math.random() * 0.012);

        const startSample = Math.floor(timeOffset * sampleRate);
        const lengthSamples = Math.floor(clickLen * sampleRate);

        let volumeMultiplier = 1.0;
        if (timeOffset <= 4.0) {
          volumeMultiplier = 1.7 - (timeOffset / 4.0) * 0.5;
        } else {
          const postRatio = (timeOffset - 4.0) / (clickDuration - 4.0);
          volumeMultiplier = Math.max(0.12, 1.0 - postRatio * 0.88);
        }

        const maxVolume = (isNoise
          ? (0.026 + Math.random() * 0.028)
          : (0.020 + Math.random() * 0.022)) * volumeMultiplier * 0.85;

        // 各個別の泡の定位（ステレオの広がり）
        const clickPan = (Math.random() * 2 - 1);
        const gainL = Math.cos((clickPan + 1) * Math.PI / 4);
        const gainR = Math.sin((clickPan + 1) * Math.PI / 4);

        const clickFreq = 2800 + Math.random() * 6800;

        for (let j = 0; j < lengthSamples; j++) {
          const idx = startSample + j;
          if (idx >= bufferSize) break;

          const progress = j / lengthSamples;
          const env = Math.exp(-progress * 4.5) * (1.0 - progress);

          let val = 0;
          if (isNoise) {
            val = (Math.random() * 2 - 1) * maxVolume * env;
          } else {
            const angle = (j / sampleRate) * clickFreq * Math.PI * 2;
            val = Math.sin(angle) * maxVolume * env;
          }

          leftData[idx] += val * gainL;
          rightData[idx] += val * gainR;
        }
      }
      
      this.carbonatedBuffer = audioBuffer;
    } catch (e) {
      console.warn("炭酸バブルバッファの事前生成エラー:", e);
    }
  }

  playCarbonated() {
    if (!this.ctx || !this.carbonatedBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const durationSeconds = 6.5;

      // AudioBufferSourceNode の作成
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = this.carbonatedBuffer;

      // ハイパスフィルターで高音のシュワシュワ成分のみを取り出す（一括適用）
      const filterNode = this.ctx.createBiquadFilter();
      filterNode.type = 'highpass';
      filterNode.frequency.setValueAtTime(4200, now);
      filterNode.frequency.exponentialRampToValueAtTime(2200, now + durationSeconds - 0.5);

      // ディレイ空間エコー回路
      const delayNodeL = this.ctx.createDelay(1.5);
      const delayNodeR = this.ctx.createDelay(1.5);

      const delayFeedbackL = this.ctx.createGain();
      const delayFeedbackR = this.ctx.createGain();
      
      delayNodeL.delayTime.setValueAtTime(0.16, now); 
      delayNodeR.delayTime.setValueAtTime(0.26, now); 
      
      delayFeedbackL.gain.setValueAtTime(0.42, now); 
      delayFeedbackR.gain.setValueAtTime(0.42, now);

      const delayFilterL = this.ctx.createBiquadFilter();
      const delayFilterR = this.ctx.createBiquadFilter();
      delayFilterL.type = 'bandpass';
      delayFilterL.frequency.setValueAtTime(3600, now);
      delayFilterL.Q.setValueAtTime(0.8, now); 
      
      delayFilterR.type = 'bandpass';
      delayFilterR.frequency.setValueAtTime(4200, now);
      delayFilterR.Q.setValueAtTime(0.8, now);

      let delayPannerL = null;
      let delayPannerR = null;
      try {
        if (this.ctx.createStereoPanner) {
          delayPannerL = this.ctx.createStereoPanner();
          delayPannerR = this.ctx.createStereoPanner();
          delayPannerL.pan.setValueAtTime(-0.9, now); 
          delayPannerR.pan.setValueAtTime(0.9, now);
        }
      } catch (e) {}

      // 接続
      noiseNode.connect(filterNode);
      
      // ディレイへの接続（センド）
      filterNode.connect(delayNodeL);
      filterNode.connect(delayNodeR);

      delayNodeL.connect(delayFilterL);
      delayFilterL.connect(delayFeedbackL);
      delayFeedbackL.connect(delayNodeL);
      
      delayNodeR.connect(delayFilterR);
      delayFilterR.connect(delayFeedbackR);
      delayFeedbackR.connect(delayNodeR);

      // クロスフィードバック
      const delayCrossL = this.ctx.createGain();
      const delayCrossR = this.ctx.createGain();
      delayCrossL.gain.setValueAtTime(0.18, now); 
      delayCrossR.gain.setValueAtTime(0.18, now);
      delayFilterL.connect(delayCrossL);
      delayCrossL.connect(delayNodeR);
      delayFilterR.connect(delayCrossR);
      delayCrossR.connect(delayNodeL);

      // 出力ゲイン（フェードイン・フェードアウトのエンベロープ）
      const outputGain = this.ctx.createGain();
      // 最初は小さめ
      outputGain.gain.setValueAtTime(0.01, now);
      // 0.8秒かけて爽快に立ち上げる（脳リフレクソの爽快感を活かすためピークはやや抑えめの1.15）
      outputGain.gain.linearRampToValueAtTime(1.15, now + 0.8);
      // その後、ゆっくり消えていくフェードアウト
      outputGain.gain.setValueAtTime(1.15, now + 1.8);
      outputGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

      filterNode.connect(outputGain);
      outputGain.connect(this.ctx.destination);

      if (delayPannerL && delayPannerR) {
        delayFilterL.connect(delayPannerL);
        delayPannerL.connect(this.ctx.destination);
        delayFilterR.connect(delayPannerR);
        delayPannerR.connect(this.ctx.destination);
      } else {
        delayFilterL.connect(this.ctx.destination);
        delayFilterR.connect(this.ctx.destination);
      }

      noiseNode.start(now);
      noiseNode.stop(now + durationSeconds + 0.1);
    } catch (e) {
      console.warn("炭酸音再生エラー:", e);
    }
  }

  /** 小惑星吸収時に呼ぶ — 深く包み込む高音リバーブ（720Hz）*/
  playAbsorb() {
    if (!this.ctx) return;

    const ctx = this.ctx;

    const _play = () => {
      if (!this.reverbNode) return; // リバーブ未構築なら無音でスキップ

      const now = ctx.currentTime;

      const dryGain = ctx.createGain();
      dryGain.gain.setValueAtTime(0.05, now);
      dryGain.gain.exponentialRampToValueAtTime(0.001, now + CONFIG.TONE_DURATION);
      dryGain.connect(ctx.destination);

      const wetGain = ctx.createGain();
      wetGain.gain.setValueAtTime(1.2, now);
      wetGain.gain.exponentialRampToValueAtTime(0.001, now + CONFIG.REVERB_DURATION);
      wetGain.connect(this.reverbNode);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(CONFIG.TONE_FREQ, now);
      osc.frequency.linearRampToValueAtTime(CONFIG.TONE_FREQ * 0.95, now + CONFIG.TONE_DURATION);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, now);
      env.gain.exponentialRampToValueAtTime(0.60, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, now + CONFIG.TONE_DURATION);

      osc.connect(env);
      env.connect(dryGain);
      env.connect(wetGain);
      osc.start(now);
      osc.stop(now + CONFIG.TONE_DURATION + 0.05);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(_play).catch(e => console.warn('resume error:', e));
    } else {
      _play();
    }
  }
}

// ============================================================
// class: BackgroundStar（背景の星屑）
// ============================================================
class BackgroundStar {
  constructor(canvasW, canvasH) {
    this.reset(canvasW, canvasH, true);
  }

  reset(canvasW, canvasH, initial = false) {
    this.x = rand(0, canvasW);
    this.y = rand(0, canvasH);
    this.r = rand(0.5, 1.8);
    this.baseOpacity = rand(0.15, 0.7);
    this.opacity = this.baseOpacity;
    this.twinkleSpeed = rand(0.008, 0.02);
    this.twinkleOffset = initial ? rand(0, Math.PI * 2) : 0;
    this.color = this._pickColor();
  }

  _pickColor() {
    return STAR_COLORS[randInt(0, STAR_COLORS.length - 1)];
  }

  update(frame) {
    this.opacity = this.baseOpacity
      + Math.sin(frame * this.twinkleSpeed + this.twinkleOffset) * 0.18;
    this.opacity = Math.max(0.1, Math.min(0.85, this.opacity));
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = `${this.color}${this.opacity.toFixed(2)})`;
    ctx.fill();
  }
}

// ============================================================
// class: ShootingStar（流れ星）
// ============================================================
class ShootingStar {
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    
    const startFromLeft = Math.random() < 0.5;
    if (startFromLeft) {
      this.x = -100;
      this.y = rand(0, canvasH * 0.45);
    } else {
      this.x = rand(0, canvasW * 0.55);
      this.y = -100;
    }

    const angle = rand(18, 40) * Math.PI / 180;
    this.speed = rand(12, 18);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;

    this.length = rand(120, 200);
    this.width = rand(1.0, 1.6);
    this.alpha = 0;
    this.targetAlpha = rand(0.5, 0.75);
    this.fadeSpeed = 0.08;
    this.alive = true;
    this.maxLife = rand(25, 40);
    this.life = 0;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life++;

    if (this.life > this.maxLife * 0.6) {
      this.alpha = this.targetAlpha * (1 - (this.life - this.maxLife * 0.6) / (this.maxLife * 0.4));
    } else if (this.alpha < this.targetAlpha) {
      this.alpha = Math.min(this.targetAlpha, this.alpha + this.fadeSpeed);
    }

    if (this.life >= this.maxLife) {
      this.alive = false;
    }
  }

  draw(ctx) {
    const tailX = this.x - this.vx * (this.length / this.speed);
    const tailY = this.y - this.vy * (this.length / this.speed);

    const grad = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
    grad.addColorStop(0, `rgba(255, 255, 255, ${this.alpha})`);
    grad.addColorStop(0.3, `rgba(240, 245, 255, ${this.alpha * 0.8})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(tailX, tailY);
    ctx.strokeStyle = grad;
    ctx.lineWidth = this.width;
    ctx.stroke();

    const glowGrad = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
    glowGrad.addColorStop(0, `rgba(224, 242, 254, ${this.alpha * 0.25})`);
    glowGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0)');
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(tailX, tailY);
    ctx.strokeStyle = glowGrad;
    ctx.lineWidth = this.width * 3;
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================
// class: Planet（あなたの星＝月）
// ============================================================
class Planet {
  constructor(x, y, scale = 1.0) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.radius = CONFIG.PLANET_INIT_RADIUS * scale;
    this.breathPhase = 0;
    this.absorbing = false;
    this.absorbTimer = 0;

    this.craters = [
      { rx: -0.35, ry: -0.3,  r: 0.18, depth: 0.08, shadowAngle: 0.8 },
      { rx: 0.25,  ry: -0.4,  r: 0.15, depth: 0.06, shadowAngle: 0.6 },
      { rx: 0.45,  ry: 0.2,   r: 0.22, depth: 0.09, shadowAngle: 0.9 },
      { rx: -0.2,  ry: 0.4,   r: 0.12, depth: 0.05, shadowAngle: 0.7 },
      { rx: -0.5,  ry: 0.1,   r: 0.16, depth: 0.07, shadowAngle: 0.8 },
      { rx: 0.05,  ry: 0.1,   r: 0.28, depth: 0.12, shadowAngle: 0.5 },
      { rx: -0.05, ry: -0.5,  r: 0.10, depth: 0.05, shadowAngle: 0.7 }
    ];
  }

  grow() {
    this.radius = Math.min(this.radius + CONFIG.PLANET_GROW_PER_ABSORB * this.scale, CONFIG.PLANET_MAX_RADIUS * this.scale);
    this.absorbing = true;
    this.absorbTimer = 0;
  }

  update() {
    this.breathPhase += 0.018;
    if (this.absorbing) {
      this.absorbTimer++;
      if (this.absorbTimer > 30) this.absorbing = false;
    }
  }

  draw(ctx, stage = 1, rockCount = 0) {
    const breathScale = 1 + Math.sin(this.breathPhase) * 0.015;
    const r = this.radius * breathScale;
    const glowMult = this.absorbing ? 1.2 : 0.8;

    // ステージごとの惑星の色相 (Stage 1 = 220 コバルトブルー、以後50度ずつシフトして色が変わる)
    const stageHue = (220 + (stage - 1) * 50) % 360;

    // 小惑星を集める（エネルギーが溜まる）ほど微小に光量が増す係数（増加率をわずかに引き上げ）
    const energyFactor = 1.0 + (rockCount / 39) * 1.8;
    const midToneAlpha = 0.12 + (rockCount / 39) * 0.26;
    const innerGlowAlpha = 0.22 + (rockCount / 39) * 0.52;

    // 1. 最外オーラ（眩しさを抑えつつ、エネルギー量に応じてほのかに光量が増す）
    const outerGlow = ctx.createRadialGradient(this.x, this.y, r * 0.8, this.x, this.y, r * 2.8);
    outerGlow.addColorStop(0, `hsla(${stageHue}, 100%, 60%, ${(0.04 * glowMult * energyFactor).toFixed(2)})`);
    outerGlow.addColorStop(0.5, `hsla(${stageHue}, 100%, 40%, ${(0.01 * glowMult * energyFactor).toFixed(2)})`);
    outerGlow.addColorStop(1, `hsla(${stageHue}, 100%, 40%, 0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = outerGlow;
    ctx.fill();

    // 2. マスクをかけて月の内部だけに精緻なテクスチャを描画
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.clip();

    // 2-a. 月の本体グラデーション（純白に近い輝度を抑え、目に優しい深みのあるグラデーションへ）
    const bodyGrad = ctx.createRadialGradient(
      this.x - r * 0.12, this.y - r * 0.15, r * 0.15,
      this.x, this.y, r
    );
    bodyGrad.addColorStop(0, `hsl(${stageHue}, 75%, 58%)`);   // 明度を 65% -> 58% に抑えマイルドに
    bodyGrad.addColorStop(0.25, `hsl(${stageHue}, 80%, 45%)`); // 49% -> 45%
    bodyGrad.addColorStop(0.6, `hsl(${stageHue}, 90%, 32%)`);  // 36% -> 32%
    bodyGrad.addColorStop(0.88, `hsl(${stageHue}, 95%, 20%)`); // 23% -> 20%
    bodyGrad.addColorStop(1, `hsl(${stageHue}, 100%, 10%)`);    // 12% -> 10%
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 2-a-2. 輪郭の白いベールから中心に向けてのインナーグラデーション（明度と不透明度を抑えて眩しさを完全にカット）
    ctx.save();
    ctx.filter = 'blur(6.0px)';
    const innerGlow = ctx.createRadialGradient(this.x, this.y, r * 0.55, this.x, this.y, r);
    innerGlow.addColorStop(0, `hsla(${stageHue}, 30%, 80%, 0)`); // 明度を 95% -> 80% に落とす
    innerGlow.addColorStop(0.5, `hsla(${stageHue}, 30%, 80%, ${(innerGlowAlpha * 0.12).toFixed(2)})`); // 不透明度を半分以下に
    innerGlow.addColorStop(1, `hsla(${stageHue}, 30%, 80%, ${(innerGlowAlpha * 0.35).toFixed(2)})`);   // 1.0 -> 0.35倍へ
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2-b. 月の海のパターン（不規則に重なり合う暗い影模様）
    ctx.save();
    ctx.filter = 'blur(8.5px)';
    ctx.fillStyle = `hsla(${stageHue}, 80%, 15%, 0.32)`;
    
    ctx.beginPath();
    ctx.arc(this.x + r * 0.15, this.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.arc(this.x + r * 0.35, this.y - r * 0.05, r * 0.28, 0, Math.PI * 2);
    ctx.arc(this.x - r * 0.05, this.y - r * 0.42, r * 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.x - r * 0.35, this.y - r * 0.05, r * 0.4, 0, Math.PI * 2);
    ctx.arc(this.x - r * 0.1, this.y + r * 0.25, r * 0.45, 0, Math.PI * 2);
    ctx.arc(this.x + r * 0.25, this.y + r * 0.22, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 中間の明るさを補正する薄青のレイヤー（エネルギーに応じて微増）
    const midTone = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    midTone.addColorStop(0, `hsla(${stageHue}, 100%, 50%, ${midToneAlpha.toFixed(2)})`);
    midTone.addColorStop(0.7, `hsla(${stageHue}, 100%, 45%, ${(midToneAlpha * 0.4).toFixed(2)})`);
    midTone.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = midTone;
    ctx.fill();

    // 2-c. ティコクレーターとコペルニクスクレーターから放射状に伸びる光条（Rays）
    ctx.save();
    ctx.filter = 'blur(2.2px)';
    ctx.strokeStyle = `hsla(${stageHue}, 80%, 85%, 0.12)`;
    ctx.lineWidth = 0.8;
    const rayCenters = [
      { cx: this.x + r * 0.12, cy: this.y + r * 0.58, rayCount: 16, lenMult: 1.1 },
      { cx: this.x - r * 0.32, cy: this.y - r * 0.12, rayCount: 10, lenMult: 0.6 }
    ];
    rayCenters.forEach(center => {
      for (let i = 0; i < center.rayCount; i++) {
        const angle = (i / center.rayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
        const length = r * center.lenMult * rand(0.5, 1.0);
        ctx.beginPath();
        ctx.moveTo(center.cx, center.cy);
        ctx.lineTo(center.cx + Math.cos(angle) * length, center.cy + Math.sin(angle) * length);
        ctx.stroke();
      }
    });
    ctx.restore();

    // 2-d. クレーターの立体描画（ぼかしを効かせ、まばゆさをカット）
    ctx.save();
    ctx.filter = 'blur(3.2px)';
    this.craters.forEach(c => {
      const cx = this.x + c.rx * r;
      const cy = this.y + c.ry * r;
      const cr = c.r * r;

      // クレーター自体の窪みの影
      const shadowGrad = ctx.createRadialGradient(
        cx + cr * 0.1, cy + cr * 0.1, 0,
        cx, cy, cr
      );
      shadowGrad.addColorStop(0, `hsla(${stageHue}, 80%, 15%, 0.1)`);
      shadowGrad.addColorStop(0.6, `hsla(${stageHue}, 80%, 40%, 0.02)`);
      shadowGrad.addColorStop(1, `hsla(${stageHue}, 80%, 60%, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fillStyle = shadowGrad;
      ctx.fill();

      // クレーター周囲の「淡い水色の輝き」
      const whiteGlow = ctx.createRadialGradient(
        cx - cr * 0.1, cy - cr * 0.1, 0,
        cx, cy, cr * 2.4
      );
      whiteGlow.addColorStop(0, `hsla(${stageHue}, 80%, 85%, 0.12)`);
      whiteGlow.addColorStop(0.4, `hsla(${stageHue}, 80%, 85%, 0.04)`);
      whiteGlow.addColorStop(1, `hsla(${stageHue}, 80%, 85%, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = whiteGlow;
      ctx.fill();

      // クレーターの明るい縁（立体感を少し出すために不透明度をほんの少し上げる）
      ctx.strokeStyle = 'rgba(219, 234, 254, 0.14)';
      ctx.lineWidth = cr * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, cr - ctx.lineWidth/2, c.shadowAngle - Math.PI*0.35, c.shadowAngle + Math.PI*0.35);
      ctx.stroke();

      // クレーターの暗い縁
      ctx.strokeStyle = `hsla(${stageHue}, 80%, 15%, 0.06)`;
      ctx.lineWidth = cr * 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy, cr - ctx.lineWidth/2, c.shadowAngle + Math.PI*0.65, c.shadowAngle + Math.PI*1.35);
      ctx.stroke();
    });
    ctx.restore();

    // 2-e. 写真に見られる月面の微細なざらつき・テクスチャ感（ノイズ）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 35; i++) {
      const noiseX = this.x + rand(-r * 0.9, r * 0.9);
      const noiseY = this.y + rand(-r * 0.9, r * 0.9);
      const noiseR = rand(0.8, 3.0);
      ctx.beginPath();
      ctx.arc(noiseX, noiseY, noiseR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // マスク解除

    // 3. 月の外周を際立たせる薄い光 of ベール（ベールの太さを0.9にして、不透明度を調整）
    ctx.save();
    ctx.filter = 'blur(0.9px)';
    ctx.strokeStyle = `hsla(${stageHue}, 80%, 90%, 0.55)`; // 白寄りのカラー
    ctx.lineWidth = 0.9; // 太さ0.9
    ctx.beginPath();
    ctx.arc(this.x, this.y, r - 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ぼかしのないクッキリした細いエッジを重ねて輪郭をシャープに保つ
    ctx.strokeStyle = `hsla(${stageHue}, 80%, 90%, 0.3)`;
    ctx.lineWidth = 0.6; // 太さ0.6
    ctx.beginPath();
    ctx.arc(this.x, this.y, r - 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ============================================================
// class: Asteroid（小惑星）
// ============================================================
class Asteroid {
  constructor(canvasW, canvasH, scale = 1.0, stage = 1, isInitial = false) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.scale = scale;
    // 小惑星が小さくなりすぎないよう、スケーリングの下限を 0.85 に設定
    const asteroidScale = Math.max(0.85, scale);
    this.radius = rand(CONFIG.ASTEROID_MIN_RADIUS, CONFIG.ASTEROID_MAX_RADIUS) * asteroidScale;

    const speed = rand(CONFIG.ASTEROID_SPEED_MIN, CONFIG.ASTEROID_SPEED_MAX) * 0.38; // 浮遊感のあるゆっくり速度
    let angle;

    if (isInitial) {
      this._spawnInScreen();
      angle = rand(0, Math.PI * 2);
    } else {
      this._spawnAtEdge();
      // 画面中央（月）の方向を計算し、ブレ（±25度 ≒ ±0.43ラジアン）を加える
      const dx = this.canvasW / 2 - this.x;
      const dy = this.canvasH / 2 - this.y;
      angle = Math.atan2(dy, dx) + rand(-0.43, 0.43);
    }

    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.rotation = rand(0, Math.PI * 2);
    this.rotSpeed = rand(-0.008, 0.008);
    this.wobblePhase = rand(0, 100);
    this.opacity = 1;      // 最初から完全に実体化
    this.fadeIn = false;
    this.alive = true;

    this._buildShape();
    
    // ステージが進むほど小惑星の色彩がさまざまな色合い（広範囲のHue）に変化していく
    const baseMinHue = 160;
    const baseMaxHue = 220;
    const hueSpread = (stage - 1) * 35; // ステージごとに35度ずつブレ幅を拡大
    const hueMin = Math.max(0, baseMinHue - hueSpread);
    const hueMax = Math.min(360, baseMaxHue + hueSpread);
    const hue = randInt(hueMin, hueMax);
    const sat = randInt(5, 18 + (stage - 1) * 5); // 彩度も少しずつ豊かに
    const lit = randInt(45, 65);
    this.color = `hsl(${hue}, ${sat}%, ${lit}%)`;
  }

  _spawnInScreen() {
    const centerX = this.canvasW / 2;
    const centerY = this.canvasH / 2;
    const minDistance = 200 * this.scale;
    const margin = 40 * this.scale;

    for (let attempt = 0; attempt < 50; attempt++) {
      const rx = rand(margin, this.canvasW - margin);
      const ry = rand(margin, this.canvasH - margin);
      const dx = rx - centerX;
      const dy = ry - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= minDistance) {
        this.x = rx;
        this.y = ry;
        return;
      }
    }
    this.x = rand(margin, this.canvasW - margin);
    this.y = rand(margin, this.canvasH - margin);
  }

  _spawnAtEdge() {
    const side = randInt(0, 3);
    const pad = 15;
    switch (side) {
      case 0: this.x = rand(-pad, this.canvasW + pad); this.y = -pad; break;
      case 1: this.x = this.canvasW + pad; this.y = rand(-pad, this.canvasH + pad); break;
      case 2: this.x = rand(-pad, this.canvasW + pad); this.y = this.canvasH + pad; break;
      case 3: this.x = -pad; this.y = rand(-pad, this.canvasH + pad); break;
    }
  }

  _buildShape() {
    const n = CONFIG.ASTEROID_POINTS;
    this.shapePoints = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const r = this.radius * rand(0.72, 1.28);
      this.shapePoints.push({ r, angle });
    }
  }

  applyGravity(mx, my) {
    const dx = mx - this.x;
    const dy = my - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const gravityRadius = CONFIG.GRAVITY_RADIUS * this.scale;
    if (dist < gravityRadius && dist > 1) {
      const strength = (1 - dist / gravityRadius) * CONFIG.GRAVITY_STRENGTH;
      this.vx += (dx / dist) * strength;
      this.vy += (dy / dist) * strength;
    }
  }

  update() {
    // 慣性による減衰
    this.vx *= CONFIG.VELOCITY_DAMPING;
    this.vy *= CONFIG.VELOCITY_DAMPING;

    // フワフワしたゆらゆら揺らぎを追加
    this.wobblePhase += 0.012;
    const wobbleForce = 0.006;
    this.vx += Math.cos(this.wobblePhase) * wobbleForce;
    this.vy += Math.sin(this.wobblePhase * 0.82) * wobbleForce;

    // 完全に静止するのを防ぐため、最低速度（0.15px/frame）を保証
    let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const minSpeed = 0.15;
    if (speed < minSpeed) {
      if (speed === 0) {
        const angle = rand(0, Math.PI * 2);
        this.vx = Math.cos(angle) * minSpeed;
        this.vy = Math.sin(angle) * minSpeed;
      } else {
        this.vx = (this.vx / speed) * minSpeed;
        this.vy = (this.vy / speed) * minSpeed;
      }
    }

    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotSpeed;

    if (this.fadeIn) {
      this.opacity = Math.min(1, this.opacity + 0.025);
      if (this.opacity >= 1) this.fadeIn = false;
    }
  }

  isOutOfBounds(w, h) {
    const margin = 120;
    return this.x < -margin || this.x > w + margin
      || this.y < -margin || this.y > h + margin;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.globalAlpha = this.opacity;

    const aura = ctx.createRadialGradient(0, 0, this.radius * 0.3, 0, 0, this.radius * 1.8);
    aura.addColorStop(0, 'rgba(200,215,220,0.08)');
    aura.addColorStop(1, 'rgba(200,215,220,0)');
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = aura;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < this.shapePoints.length; i++) {
      const p = this.shapePoints[i];
      const px = Math.cos(p.angle) * p.r;
      const py = Math.sin(p.angle) * p.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const bodyGrad = ctx.createRadialGradient(-this.radius * 0.2, -this.radius * 0.2, 0, 0, 0, this.radius);
    bodyGrad.addColorStop(0, '#b0b8b8');
    bodyGrad.addColorStop(1, this.color);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,15,20,0.42)'; // 発光パーティクルと区別するため、暗くくっきりした輪郭線で立体感を強調
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.restore();
  }
}

// ============================================================
// class: AbsorbEffect（吸収時の波紋エフェクト）
// ============================================================
class AbsorbEffect {
  constructor(x, y, baseRadius) {
    this.x = x;
    this.y = y;
    this.maxRadius = baseRadius * CONFIG.ABSORB_RING_MAX_RADIUS_MULT;
    this.duration = CONFIG.ABSORB_RING_DURATION;
    this.elapsed = 0;
    this.alive = true;
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) this.alive = false;
  }

  draw(ctx) {
    const t = easeOutQuart(Math.min(this.elapsed / this.duration, 1));
    const r = this.maxRadius * t;
    const opacity = (1 - t) * 0.55;

    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(240,210,160,${opacity.toFixed(3)})`;
    ctx.lineWidth = 1.5 * (1 - t * 0.6);
    ctx.stroke();

    if (r > 10) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,235,190,${(opacity * 0.4).toFixed(3)})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
}

// ============================================================
// class: TrailParticle（軌道の光の粒の波紋）
// ============================================================
class TrailParticle {
  constructor(x, y, scale = 1.0, stage = 1, isMoving = true) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    
    // 円周上のランダムな角度
    const angle = rand(0, Math.PI * 2);
    
    // 波動円の範囲（波紋の広がりに同期するように初期配置距離を設定）
    const startDist = (isMoving ? rand(8, 24) : rand(12, 42)) * scale;
    
    this.x += Math.cos(angle) * startDist;
    this.y += Math.sin(angle) * startDist;
    
    // 速度：外側に向かう速度 ＋ 円周を回るような接線（回転）方向の速度を加えて美しく渦巻くようにする
    const normalSpeed = rand(0.12, 0.42) * scale;
    const tangentSpeed = rand(-0.48, 0.48) * scale;
    
    this.vx = Math.cos(angle) * normalSpeed - Math.sin(angle) * tangentSpeed;
    this.vy = Math.sin(angle) * normalSpeed + Math.cos(angle) * tangentSpeed;
    
    // 宇宙のチリのようにわずかに漂う摩擦と極小重力
    this.gravity = 0.002 * scale;
    this.friction = 0.965;
    
    // 粒サイズを0.8倍に調整（2.2〜4.8 -> 1.7〜3.8）
    this.radius = rand(1.7, 3.8) * scale;
    this.maxLife = rand(36, 58); // 寿命を少し長くして軌跡を美しく残す
    this.life = 0;
    this.alive = true;
    
    // きらめきタイプ（星型か円形か）
    this.type = Math.random() < 0.45 ? 'sparkle' : 'circle';
    this.angle = rand(0, Math.PI * 2);
    this.spin = rand(-0.06, 0.06);
    
    // ステージごとのテーマカラーに色相を合わせ、わずかにゆらぎを与える
    const stageHue = (220 + (stage - 1) * 50) % 360;
    this.hue = (stageHue + rand(-15, 15) + 360) % 360;
  }

  update() {
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy += this.gravity;
    
    this.x += this.vx;
    this.y += this.vy;
    
    this.angle += this.spin;
    this.life++;
    if (this.life >= this.maxLife) {
      this.alive = false;
    }
  }

  draw(ctx) {
    const t = this.life / this.maxLife;
    const opacity = (1 - t) * 1.36; // 光量を1.4倍（0.97 * 1.4 ≈ 1.36）
    const r = this.radius * (1 + t * 0.85); // 緩やかに拡大する
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    const color = `hsla(${this.hue}, 95%, 85%, ${opacity.toFixed(3)})`;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    
    if (this.type === 'sparkle') {
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      
      // 美しい4点星型のパス
      ctx.beginPath();
      ctx.moveTo(0, -r * 2.2);
      ctx.lineTo(r * 0.32, 0);
      ctx.lineTo(r * 2.2, 0);
      ctx.lineTo(0, r * 0.32);
      ctx.lineTo(0, r * 2.2);
      ctx.lineTo(-r * 0.32, 0);
      ctx.lineTo(-r * 2.2, 0);
      ctx.lineTo(0, -r * 0.32);
      ctx.closePath();
      ctx.fill();
      
      // 擬似的なグロー発光
      ctx.fillStyle = `hsla(${this.hue}, 95%, 80%, ${(opacity * 0.22).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 4.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 幻想的な微細光サークル
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill();
      
      // 光の輪郭線
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 1.7, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${this.hue}, 90%, 80%, ${(opacity * 0.45).toFixed(3)})`;
      ctx.lineWidth = 0.6 * this.scale;
      ctx.stroke();
    }
    
    ctx.restore();
  }
}

// ============================================================
// class: FloatingText（フィードバックテキスト）
// ============================================================
class FloatingText {
  constructor(x, y, text) {
    this.el = document.createElement('div');
    this.el.className = 'feedback-text';
    this.el.textContent = text;
    this.el.style.left = `${x - 30}px`;
    this.el.style.top = `${y - 20}px`;
    document.getElementById('feedback-container').appendChild(this.el);

    this.el.addEventListener('animationend', () => this.el.remove());
  }
}

// ============================================================
// class: GameEngine（メインゲームループ）
// ============================================================
class GameEngine {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cursor = document.getElementById('gravity-cursor');
    this.hudRockCount = document.getElementById('rock-count-display');
    this.hudPlanetSize = document.getElementById('planet-size-display');
    this.hudTime = document.getElementById('time-display');
    this.resultCount = document.getElementById('result-count');
    this.resultTime = document.getElementById('result-time');
    this.resultTitle = document.getElementById('result-title');
    this.controlPanel = document.getElementById('control-panel');
    this.quitBtn = document.getElementById('quit-btn');

    this.mouse = { x: -1000, y: -1000 };
    this.stars = [];
    this.shootingStars = [];
    this.asteroids = [];
    this.effects = [];
    this.trailParticles = [];
    this.planet = null;
    this.sound = new SoundEngine();
    this.cursorMoveTimeout = null;

    this.stage = 1;
    this.stageCleared = false;
    this.paused = false;
    this.pauseStartTime = 0;
    this.rockCount = 0;
    this.startTime = 0;
    this.accumulatedTime = 0; // セーブから引き継いだ経過時間(ms)
    this.frame = 0;
    this.lastTimestamp = 0;
    this.running = true;
    this.gameStarted = false;
    this.scale = 1.0;
    this.spawnTimer = 0;
    this.spawnInterval = CONFIG.ASTEROID_SPAWN_INTERVAL_BASE;

    this.lastShootingStarTime = Date.now();
    this.nextShootingStarDelay = 10000 + Math.random() * 20000;

    this._resize();
    this._bindEvents();

    // 初期化とメニュー描画ループの開始
    this._initGame(false);
    this._checkSaveData();
    this.startTime = performance.now();
    this.lastTimestamp = this.startTime;
    requestAnimationFrame(ts => this._loop(ts));
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    
    // 画面幅に応じたスケーリング因数を計算（基準幅 900px）
    this.scale = Math.max(0.48, Math.min(1.2, this.W / 900));
    
    if (this.running) {
      this.stars = Array.from({ length: Math.floor((this.W * this.H) / CONFIG.STAR_COUNT_RATIO) },
        () => new BackgroundStar(this.W, this.H)
      );
    }
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());

    // 戻るボタン/スワイプバック防止ハック (popstateを利用して履歴内で留まらせる)
    history.pushState(null, null, location.href);
    window.addEventListener('popstate', () => {
      history.pushState(null, null, location.href);
    });

    // iOSスワイプバック防止用のエッジガード（左右の透明な壁）のタッチイベントを完全に無効化
    const preventBack = e => {
      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
    };
    const leftGuard = document.getElementById('ios-edge-guard-left');
    const rightGuard = document.getElementById('ios-edge-guard-right');
    if (leftGuard && rightGuard) {
      ['touchstart', 'touchmove', 'touchend'].forEach(evtName => {
        leftGuard.addEventListener(evtName, preventBack, { passive: false });
        rightGuard.addEventListener(evtName, preventBack, { passive: false });
      });
    }

    // 音声の同期的アンロック処理を各種ボタンのタップ/クリック時にフック
    const startAudio = () => {
      this.sound.init();
    };
    const startBtn = document.getElementById('start-btn');
    const resumeBtn = document.getElementById('resume-save-btn');
    const retryBtn = document.getElementById('retry-btn');
    if (startBtn) {
      startBtn.addEventListener('touchstart', startAudio, { passive: true });
      startBtn.addEventListener('mousedown', startAudio);
    }
    if (resumeBtn) {
      resumeBtn.addEventListener('touchstart', startAudio, { passive: true });
      resumeBtn.addEventListener('mousedown', startAudio);
    }
    if (retryBtn) {
      retryBtn.addEventListener('touchstart', startAudio, { passive: true });
      retryBtn.addEventListener('mousedown', startAudio);
    }

    window.addEventListener('mousemove', e => {
      if (this.running) {
        this.sound.init(); // マウス移動中も音声コンテキストがsuspendedになるのを防止
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this._moveCursor(e.clientX, e.clientY);
      this._createCursorTrail(e.clientX, e.clientY);
    });

    window.addEventListener('touchmove', e => {
      e.preventDefault();
      if (this.running) {
        this.sound.init(); // ドラッグ中も音声コンテキストがsuspendedになるのを防止
      }
      const t = e.touches[0];
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this._moveCursor(t.clientX, t.clientY);
      this._createCursorTrail(t.clientX, t.clientY);
    }, { passive: false });

    window.addEventListener('touchstart', e => {
      // UI部分（ボタン、設定パネル、オーバーレイ等）以外へのタッチ時はデフォルトジェスチャー（スワイプバック等）を無効化
      if (e.target.tagName !== 'BUTTON' && !e.target.closest('#control-panel') && !e.target.closest('#hud') && !e.target.closest('.overlay-content')) {
        if (e.cancelable) e.preventDefault();
      }
      const t = e.touches[0];
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this._createCursorTrail(t.clientX, t.clientY);
      if (this.running) {
        this.sound.init();
      }
    }, { passive: false });

    window.addEventListener('touchend', () => {
      if (this.running) {
        this.sound.init();
      }
    });

    window.addEventListener('mousedown', () => {
      if (this.running) {
        this.sound.init();
      }
    });

    document.getElementById('start-btn').addEventListener('click', () => this._startGame(false));
    document.getElementById('resume-save-btn').addEventListener('click', () => this._startGame(true));
    document.getElementById('retry-btn').addEventListener('click', () => {
      if (this.stageCleared) {
        // 次のステージへ遷移
        this.stage++;
        document.getElementById('result-screen').classList.add('hidden');
        this._initGame(true);
        this.gameStarted = true;
        this.startTime = performance.now();
        this.lastTimestamp = this.startTime;
        this.controlPanel.classList.remove('hidden');
        document.body.classList.add('game-active');
      } else {
        this._resetGame();
      }
    });
    this.quitBtn.addEventListener('click', () => {
      this.gameStarted = false;
      this.showResult(performance.now(), false);
    });
    document.getElementById('save-btn').addEventListener('click', () => this._saveGame());
  }

  _createCursorTrail(x, y) {
    if (!this.gameStarted || this.paused || x < -500 || y < -500) return;
    // 軌道上にパーティクルを発生させる（生成量をさらに3分の2：平均0.53個に削減）
    if (Math.random() < 0.53) {
      this.trailParticles.push(new TrailParticle(x, y, this.scale, this.stage, true));
    }
  }

  _moveCursor(x, y) {
    // 画面外や無効値の場合は処理しない
    if (x < -500 || y < -500) return;
    
    this.cursor.style.left = `${x}px`;
    this.cursor.style.top = `${y}px`;
    this.cursor.style.opacity = '1'; // 実際に動かしたら表示する

    const near = this.asteroids.some(a => {
      const dx = a.x - x, dy = a.y - y;
      return Math.sqrt(dx * dx + dy * dy) < CONFIG.GRAVITY_RADIUS * this.scale;
    });
    this.cursor.classList.toggle('active', near);

    // カーソル移動を検知して波紋の表示状態をトグル
    this.cursor.classList.add('moving');
    this.cursor.classList.remove('stopped');
    
    if (this.cursorMoveTimeout) {
      clearTimeout(this.cursorMoveTimeout);
    }
    
    this.cursorMoveTimeout = setTimeout(() => {
      this.cursor.classList.remove('moving');
      this.cursor.classList.add('stopped');
    }, 120); // 120ms間動きが止まれば「停止」と判定
  }

  _startGame(isResume = false) {
    this.sound.init();

    const startScreen = document.getElementById('start-screen');
    startScreen.classList.add('fade-out');
    setTimeout(() => startScreen.classList.add('hidden'), 600);

    if (isResume) {
      this._loadGame();
    } else {
      localStorage.removeItem('nebula_garden_save');
      this.accumulatedTime = 0;
      this._initGame(false);
    }

    // スタート時に、1個だけ浮遊していた状態から2個目を即時追加スポーンさせる
    // 画面外からゆっくり入る演出にするため isInitial = false で生成
    if (this.asteroids.length < CONFIG.ASTEROID_MAX_COUNT) {
      this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage, false));
    }

    // すでに初期化されているため、時間の起点を設定してゲームを開始する
    this.gameStarted = true;
    this.paused = false;
    this.startTime = performance.now();
    this.lastTimestamp = this.startTime;
    this.controlPanel.classList.remove('hidden');
    document.body.classList.add('game-active');
  }

  _initGame(keepStage = false) {
    if (!keepStage) {
      this.stage = 1;
    }
    this.stageCleared = false;
    this.paused = false;
    this.frame = 0;
    this.rockCount = 0;
    this.asteroids = [];
    this.effects = [];
    this.trailParticles = [];
    this.shootingStars = [];
    this.spawnTimer = 0;
    this.spawnInterval = CONFIG.ASTEROID_SPAWN_INTERVAL_BASE;
    this.lastShootingStarTime = Date.now();
    this.nextShootingStarDelay = 10000 + Math.random() * 20000;

    const count = Math.floor((this.W * this.H) / CONFIG.STAR_COUNT_RATIO);
    this.stars = Array.from({ length: count },
      () => new BackgroundStar(this.W, this.H)
    );

    // すでに惑星があり、keepStage が true の場合はサイズを維持して引き継ぐ
    const prevRadius = (this.planet && keepStage) ? this.planet.radius : CONFIG.PLANET_INIT_RADIUS * this.scale;
    this.planet = new Planet(this.W / 2, this.H / 2, this.scale);
    this.planet.radius = prevRadius;

    // 初期小惑星を画面内にスポーン配置
    this.asteroids = [];
    if (!this.gameStarted) {
      // 最初は1個だけ浮遊させる
      this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage, true));
    } else {
      // 自動ステージ遷移時などは、最初から最大数（2個）を画面内に配置
      for (let i = 0; i < CONFIG.ASTEROID_MAX_COUNT; i++) {
        this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage, true));
      }
    }

    this._updateHUD();
    this._checkSaveData();

    if (!this.gameStarted) {
      document.body.classList.remove('game-active');
    }

    // ゲーム開始/初期化時はカーソルの表示と状態を完全にリセット
    this.mouse = { x: -1000, y: -1000 };
    this.cursor.classList.remove('moving', 'stopped', 'active');
    this.cursor.style.opacity = '0'; // 画面をタッチして動かすまでは表示しない
  }

  _resetGame() {
    document.getElementById('result-screen').classList.add('hidden');
    document.getElementById('pause-screen').classList.add('hidden');
    document.getElementById('start-screen').classList.remove('hidden');
    document.getElementById('start-screen').classList.remove('fade-out', 'hidden');
    this.controlPanel.classList.add('hidden');
    this.gameStarted = false;
    this.running = true;
    this.stage = 1;
    this._initGame(false);
    document.body.classList.remove('game-active');
  }

  _getElapsedTime(timestamp) {
    if (!timestamp) timestamp = performance.now();
    if (!this.startTime) return this.accumulatedTime;
    return this.accumulatedTime + (timestamp - this.startTime);
  }

  _saveGame() {
    if (!this.gameStarted) return;
    const elapsedMs = this._getElapsedTime(performance.now());
    const saveData = {
      stage: this.stage,
      rockCount: this.rockCount,
      planetRadius: this.planet ? this.planet.radius : CONFIG.PLANET_INIT_RADIUS,
      accumulatedTime: elapsedMs
    };
    try {
      localStorage.setItem('nebula_garden_save', JSON.stringify(saveData));
      
      this.sound.playAbsorb();
      this._checkSaveData();
      this._resetGame();
    } catch (e) {
      console.warn("保存に失敗しました:", e);
    }
  }

  _loadGame() {
    const dataStr = localStorage.getItem('nebula_garden_save');
    if (!dataStr) return;
    try {
      const data = JSON.parse(dataStr);
      this.stage = data.stage || 1;
      this.accumulatedTime = data.accumulatedTime || 0;
      
      this._initGame(true);
      this.rockCount = data.rockCount || 0;
      if (this.planet && data.planetRadius) {
        this.planet.radius = data.planetRadius;
      }
      this._updateHUD(performance.now());
    } catch (e) {
      console.warn("セーブデータのロードエラー:", e);
      this.accumulatedTime = 0;
      this._initGame(false);
    }
  }

  _checkSaveData() {
    const resumeBtn = document.getElementById('resume-save-btn');
    if (!resumeBtn) return;
    if (localStorage.getItem('nebula_garden_save')) {
      resumeBtn.classList.remove('hidden');
    } else {
      resumeBtn.classList.add('hidden');
    }
  }

  _loop(timestamp) {
    // running が false でも、メニュー背景描画のためにループを継続
    const dt = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.frame++;

    this._update(dt, timestamp);
    this._draw();

    requestAnimationFrame(ts => this._loop(ts));
  }

  _update(dt, timestamp) {
    this.stars.forEach(s => s.update(this.frame));

    const now = Date.now();
    if (now - this.lastShootingStarTime >= this.nextShootingStarDelay) {
      this.shootingStars.push(new ShootingStar(this.W, this.H));
      this.lastShootingStarTime = now;
      this.nextShootingStarDelay = 10000 + Math.random() * 30000;
    }

    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const s = this.shootingStars[i];
      s.update();
      if (!s.alive) {
        this.shootingStars.splice(i, 1);
      }
    }

    this.planet.update();

    if (!this.paused) {
      // ゲーム本編中のみ、新規の自動スポーン処理を行う
      if (this.gameStarted) {
        this.spawnTimer += dt;
        if (this.spawnTimer >= this.spawnInterval
          && this.asteroids.length < CONFIG.ASTEROID_MAX_COUNT) {
          this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage));
          this.spawnTimer = 0;

          const elapsed = (timestamp - this.startTime) / 1000;
          const reduction = Math.min(elapsed / 180, 1) * 5000;
          this.spawnInterval = Math.max(
            CONFIG.ASTEROID_SPAWN_INTERVAL_MIN,
            CONFIG.ASTEROID_SPAWN_INTERVAL_BASE - reduction
          );
        }
      }

      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const a = this.asteroids[i];

        // 引力の適用はゲーム本編中のみ
        if (this.gameStarted) {
          a.applyGravity(this.mouse.x, this.mouse.y);
        }
        
        a.update();

        if (a.isOutOfBounds(this.W, this.H)) {
          this.asteroids.splice(i, 1);
          // スタート画面で画面外に出た場合は即座に1個補充
          if (!this.gameStarted) {
            this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage, true));
          } else {
            // ゲーム中も、画面外に出たら即座に1個補充
            if (this.asteroids.length < CONFIG.ASTEROID_MAX_COUNT) {
              this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage));
            }
          }
          continue;
        }

        // 吸収判定はゲーム本編中のみ
        if (this.gameStarted) {
          const dx = a.x - this.planet.x;
          const dy = a.y - this.planet.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < this.planet.radius + a.radius * 0.8) {
            this._absorbAsteroid(i, a);
          }
        }
      }

      for (let i = this.effects.length - 1; i >= 0; i--) {
        this.effects[i].update(dt);
        if (!this.effects[i].alive) this.effects.splice(i, 1);
      }

      // 静止時の自動生成を廃止し、パーティクルはカーソル移動時のみ発生して消滅するように変更

      // 軌道パーティクルの更新
      for (let i = this.trailParticles.length - 1; i >= 0; i--) {
        const p = this.trailParticles[i];
        p.update();
        if (!p.alive) this.trailParticles.splice(i, 1);
      }
    }

    this._updateHUD(timestamp);
  }

  _absorbAsteroid(index, asteroid) {
    this.planet.grow();

    this.effects.push(new AbsorbEffect(
      this.planet.x, this.planet.y, this.planet.radius
    ));

    const word = FEEDBACK_WORDS[Math.floor(Math.random() * FEEDBACK_WORDS.length)];
    const tx = this.planet.x + rand(-60, 60);
    const ty = this.planet.y + rand(-80, -20);
    new FloatingText(tx, ty, word);

    this.sound.playAbsorb();

    this.rockCount++;
    this.asteroids.splice(index, 1);

    // 18個になった時点で、自動で次のステージへ移行する
    if (this.rockCount >= 18) {
      this.sound.playCarbonated();
      this.stage++;
      this._initGame(true); // ステージ数とgameStartedを維持して再初期化

      // 画面中央にステージ進行 of フィードバックを表示
      const stx = this.planet.x;
      const sty = this.planet.y - 120;
      new FloatingText(stx, sty, `✦ Stage ${this.stage} ✦`);
    } else {
      // まだクリアしていない場合、吸収した分を即座に1個補充する
      if (this.asteroids.length < CONFIG.ASTEROID_MAX_COUNT) {
        this.asteroids.push(new Asteroid(this.W, this.H, this.scale, this.stage));
      }
    }
  }

  _updateHUD(timestamp) {
    this.hudRockCount.textContent = this.rockCount;

    const ratio = (this.planet.radius - CONFIG.PLANET_INIT_RADIUS)
      / (CONFIG.PLANET_MAX_RADIUS - CONFIG.PLANET_INIT_RADIUS);
    const stars = Math.min(5, Math.round(ratio * 5));
    this.hudPlanetSize.textContent = '✦'.repeat(Math.max(1, stars))
      + '✧'.repeat(Math.max(0, 5 - Math.max(1, stars)));

    const elapsedMs = this._getElapsedTime(timestamp);
    const sec = Math.floor(elapsedMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.hudTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  _draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;

    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#0e0e2c');
    bg.addColorStop(0.6, '#080c20');
    bg.addColorStop(1, '#060b18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const nebula = ctx.createRadialGradient(W * 0.3, H * 0.4, 0, W * 0.3, H * 0.4, W * 0.5);
    nebula.addColorStop(0, 'rgba(80,60,140,0.035)');
    nebula.addColorStop(1, 'rgba(80,60,140,0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, W, H);

    this.stars.forEach(s => s.draw(ctx));

    this.shootingStars.forEach(s => s.draw(ctx));

    this.effects.forEach(e => e.draw(ctx));

    // 軌道パーティクルの描画
    this.trailParticles.forEach(p => p.draw(ctx));

    this.planet.draw(ctx, this.stage, this.rockCount);

    this.asteroids.forEach(a => a.draw(ctx));
  }

  showResult(timestamp, stageCleared = false) {
    const elapsedMs = this._getElapsedTime(timestamp);
    const sec = Math.floor(elapsedMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.resultCount.textContent = this.rockCount;
    this.resultTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.controlPanel.classList.add('hidden');
    document.body.classList.remove('game-active');

    const retryBtn = document.getElementById('retry-btn');
    this.stageCleared = false;
    
    // ゲームが結果画面で終了した場合はセーブデータをクリア
    localStorage.removeItem('nebula_garden_save');
    this._checkSaveData();
    
    this.resultTitle.innerHTML = `今日もお疲れ様でした / Thank you for your time today<br>`
      + `<span style="font-size: 0.92rem; opacity: 0.88; margin-top: 10px; display: inline-block; letter-spacing: 0.05em;">`
      + `到達ステージ: ${this.stage} &nbsp;|&nbsp; 今回のステージ吸収数: ${this.rockCount}個`
      + `</span>`;
    retryBtn.innerHTML = `最初からもう一度育てる / Play Again`;

    document.getElementById('result-screen').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new GameEngine();
});
