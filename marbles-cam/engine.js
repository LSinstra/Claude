// Marbles Cam Look Engine
// One deterministic WebGL2 pipeline: white balance, centre-weighted exposure,
// S-curve tone, inverse-square falloff, vibrance and juicy boost, unsharp mask,
// grain. CPU fallback keeps capture working when WebGL2 is unavailable.

const VERT = `#version 300 es
layout(location=0) in vec2 pos;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG_COLOR = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D uTex;
uniform float uExposure, uWbTemp, uWbTint;
uniform float uBlack, uWhite, uContrast, uHr;
uniform float uFalloffStart, uFalloffStrength, uFalloffCurve;
uniform float uVibrance, uSaturation, uJuicy;
uniform vec2 uSubject;
uniform vec2 uAspect;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 c = texture(uTex, uv).rgb;

  // white balance toward warm-neutral
  c.r *= 1.0 + 0.12 * uWbTemp;
  c.b *= 1.0 - 0.12 * uWbTemp;
  c.g *= 1.0 + 0.06 * uWbTint;

  // centre-weighted exposure gain, computed on the CPU per image
  c *= uExposure;

  // highlight recovery: pull flash blowouts back without flattening
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= 1.0 - uHr * 0.3 * smoothstep(0.72, 1.25, lum);

  // black and white points
  c = (c - uBlack) / max(0.001, uWhite - uBlack);
  c = clamp(c, 0.0, 1.0);

  // S-curve contrast (smoothstep blend keeps it monotonic, no banding)
  c = mix(c, c * c * (3.0 - 2.0 * c), clamp(uContrast * 1.4, 0.0, 1.0));

  // colour: vibrance protects already saturated pixels, then flat saturation,
  // then the red-orange band boost
  vec3 hsv = rgb2hsv(c);
  float s = hsv.y;
  s += uVibrance * (1.0 - s) * s * 2.0;
  s *= 1.0 + uSaturation;
  float dRed = min(hsv.x, 1.0 - hsv.x); // wrapped hue distance from 0 deg
  float juicyBand = 1.0 - smoothstep(0.055, 0.12, dRed); // roughly 350 to 30 deg
  s += uJuicy * juicyBand * (1.0 - s);
  hsv.y = clamp(s, 0.0, 1.0);
  c = hsv2rgb(hsv);

  // inverse-square falloff centred on the subject point, long edge normalised.
  // Monotonic 1/(1+k*t^n): mathematically ring-free at any strength.
  vec2 p = (uv - uSubject) * uAspect;
  float r = length(p);
  float t = max(0.0, r - uFalloffStart) / max(0.05, 1.1 - uFalloffStart);
  float dim = 1.0 / (1.0 + uFalloffStrength * 5.0 * pow(t, uFalloffCurve));
  c *= dim;

  frag = vec4(c, 1.0);
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uDir; // (1/w,0)*radius or (0,1/h)*radius
void main() {
  vec3 acc = texture(uTex, uv).rgb * 0.3434;
  acc += texture(uTex, uv + uDir).rgb * 0.2426;
  acc += texture(uTex, uv - uDir).rgb * 0.2426;
  acc += texture(uTex, uv + uDir * 2.0).rgb * 0.0857;
  acc += texture(uTex, uv - uDir * 2.0).rgb * 0.0857;
  frag = vec4(acc, 1.0);
}`;

const FRAG_FINISH = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D uColor;
uniform sampler2D uBlur;
uniform float uAmount, uThreshold, uGrain;
uniform vec2 uRes;
uniform float uFlip;
void main() {
  vec2 suv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFlip));
  vec3 a = texture(uColor, suv).rgb;
  vec3 b = texture(uBlur, suv).rgb;
  vec3 d = a - b;
  vec3 mask = step(vec3(uThreshold), abs(d));
  vec3 c = a + uAmount * d * mask;
  // deterministic monochrome grain
  float n = fract(sin(dot(floor(suv * uRes), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += n * uGrain * 2.0;
  frag = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export const FALLBACK_PRESET = {
  name: "deli",
  version: 1,
  wbTemp: 0.12,
  wbTint: 0.0,
  targetLuma: 0.65,
  blackPoint: 8,
  whitePoint: 250,
  contrast: 0.25,
  highlightRecovery: 0.3,
  falloffStart: 0.35,
  falloffStrength: 0.6,
  falloffCurve: 2.0,
  vibrance: 0.2,
  saturation: 0.08,
  juicyBoost: 0.1,
  sharpenRadius: 1.2,
  sharpenAmount: 0.7,
  sharpenThreshold: 4,
  grain: 0.03,
};

export class LookEngine {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    this.mode = this.gl ? "webgl2" : "cpu";
    this.stage = document.createElement("canvas");
    this.stageCtx = this.stage.getContext("2d", { willReadFrequently: false });
    if (this.gl) this._initGL();
  }

  _initGL() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const program = (fragSrc) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p));
      }
      return p;
    };
    try {
      this.pColor = program(FRAG_COLOR);
      this.pBlur = program(FRAG_BLUR);
      this.pFinish = program(FRAG_FINISH);
    } catch (e) {
      this.mode = "cpu";
      this.gl = null;
      return;
    }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.texSrc = null;
    this.fbos = null;
    this.fboSize = null;
  }

  _makeTex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _ensureTargets(w, h) {
    const gl = this.gl;
    if (this.fboSize && this.fboSize[0] === w && this.fboSize[1] === h) return;
    if (this.fbos) {
      for (const f of this.fbos) {
        gl.deleteFramebuffer(f.fbo);
        gl.deleteTexture(f.tex);
      }
    }
    this.fbos = [0, 1, 2].map(() => {
      const tex = this._makeTex(w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    });
    this.fboSize = [w, h];
  }

  // centre-weighted mean luma of the staged image, 0..1
  _measure(w, h) {
    const m = document.createElement("canvas");
    m.width = 64;
    m.height = 64;
    const ctx = m.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(this.stage, 0, 0, w, h, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    let wsum = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        // centre-weighted: the middle 40 percent of the frame dominates
        const inCentre = x >= 19 && x < 45 && y >= 19 && y < 45;
        const weight = inCentre ? 1.0 : 0.12;
        sum += l * weight;
        wsum += weight;
      }
    }
    return sum / wsum / 255;
  }

  // source: CanvasImageSource; returns {canvas, width, height} with the result.
  // subject in normalised [0..1] coords. Deterministic for identical inputs.
  process(source, srcW, srcH, preset, subject, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));

    this.stage.width = w;
    this.stage.height = h;
    this.stageCtx.drawImage(source, 0, 0, w, h);

    const mean = this._measure(w, h);
    const exposure = Math.min(2.6, Math.max(0.55, (preset.targetLuma ?? 0.65) / Math.max(0.02, mean)));

    if (!this.gl) return this._processCPU(w, h, preset, subject, exposure);

    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    this._ensureTargets(w, h);

    if (this.texSrc) gl.deleteTexture(this.texSrc);
    this.texSrc = this._makeTex(w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.texSrc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.stage);

    gl.viewport(0, 0, w, h);
    const aspect = srcW >= srcH ? [1, h / w] : [w / h, 1];

    // pass 1: colour into fbo0
    gl.useProgram(this.pColor);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[0].fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texSrc);
    const u = (n) => gl.getUniformLocation(this.pColor, n);
    gl.uniform1i(u("uTex"), 0);
    gl.uniform1f(u("uExposure"), exposure);
    gl.uniform1f(u("uWbTemp"), preset.wbTemp ?? 0);
    gl.uniform1f(u("uWbTint"), preset.wbTint ?? 0);
    gl.uniform1f(u("uBlack"), (preset.blackPoint ?? 8) / 255);
    gl.uniform1f(u("uWhite"), (preset.whitePoint ?? 250) / 255);
    gl.uniform1f(u("uContrast"), preset.contrast ?? 0.25);
    gl.uniform1f(u("uHr"), preset.highlightRecovery ?? 0.3);
    gl.uniform1f(u("uFalloffStart"), preset.falloffStart ?? 0.35);
    gl.uniform1f(u("uFalloffStrength"), preset.falloffStrength ?? 0.6);
    gl.uniform1f(u("uFalloffCurve"), preset.falloffCurve ?? 2.0);
    gl.uniform1f(u("uVibrance"), preset.vibrance ?? 0.2);
    gl.uniform1f(u("uSaturation"), preset.saturation ?? 0.08);
    gl.uniform1f(u("uJuicy"), preset.juicyBoost ?? 0.1);
    gl.uniform2f(u("uSubject"), subject.x, subject.y);
    gl.uniform2f(u("uAspect"), aspect[0], aspect[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // passes 2 and 3: separable blur for the unsharp mask
    const radius = preset.sharpenRadius ?? 1.2;
    gl.useProgram(this.pBlur);
    const ub = (n) => gl.getUniformLocation(this.pBlur, n);
    gl.uniform1i(ub("uTex"), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[1].fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[0].tex);
    gl.uniform2f(ub("uDir"), radius / w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[2].fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[1].tex);
    gl.uniform2f(ub("uDir"), 0, radius / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 4: unsharp combine plus grain, to the visible buffer, flipped
    gl.useProgram(this.pFinish);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const uf = (n) => gl.getUniformLocation(this.pFinish, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[2].tex);
    gl.uniform1i(uf("uColor"), 0);
    gl.uniform1i(uf("uBlur"), 1);
    gl.uniform1f(uf("uAmount"), preset.sharpenAmount ?? 0.7);
    gl.uniform1f(uf("uThreshold"), (preset.sharpenThreshold ?? 4) / 255);
    gl.uniform1f(uf("uGrain"), preset.grain ?? 0);
    gl.uniform2f(uf("uRes"), w, h);
    gl.uniform1f(uf("uFlip"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return { canvas: this.canvas, width: w, height: h };
  }

  // Minimal CPU fallback: exposure, contrast and saturation via canvas filters,
  // falloff via a radial gradient multiply. No sharpen. Keeps capture working.
  _processCPU(w, h, preset, subject, exposure) {
    const out = this.canvas;
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    const sat = 1 + (preset.saturation ?? 0.08) + (preset.vibrance ?? 0.2) * 0.6;
    const con = 1 + (preset.contrast ?? 0.25) * 0.8;
    ctx.filter = `brightness(${exposure.toFixed(3)}) contrast(${con.toFixed(3)}) saturate(${sat.toFixed(3)})`;
    ctx.drawImage(this.stage, 0, 0, w, h);
    ctx.filter = "none";
    const long = Math.max(w, h);
    const g = ctx.createRadialGradient(
      subject.x * w, subject.y * h, long * (preset.falloffStart ?? 0.35) * 0.9,
      subject.x * w, subject.y * h, long * 1.05
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, (preset.falloffStrength ?? 0.6) * 1.1)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return { canvas: out, width: w, height: h };
  }
}
