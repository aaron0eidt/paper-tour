import type { CompanionMood } from '../presence';
import { createNoiseTexture } from './noise';
import { advectionShader, fragmentShader, vertexShader } from './shaders';

export interface OrbState {
  mood: CompanionMood;
  word: number;
  engaged: boolean;
}
export interface OrbRenderer {
  update(state: OrbState): void;
  dispose(): void;
}

const DYE_SIZE = 128;
const IDLE_SPEED = 0.04;

/** Two GPU dye buffers: update the previous field, swap, display. No audio is inferred. */
export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: true, premultipliedAlpha: false,
    powerPreference: 'low-power', preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const floatingPoint = !!gl.getExtension('EXT_color_buffer_float');
  const shaders: WebGLShader[] = [];
  const programs: WebGLProgram[] = [];
  const textures: WebGLTexture[] = [];
  const framebuffers: WebGLFramebuffer[] = [];
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  const release = () => {
    shaders.forEach((shader) => gl.deleteShader(shader));
    programs.forEach((program) => gl.deleteProgram(program));
    textures.forEach((texture) => gl.deleteTexture(texture));
    framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
  };
  const compile = (source: string) => {
    const program = gl.createProgram();
    if (!program) throw new Error('Orb program allocation failed');
    programs.push(program);
    for (const [type, text] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, source]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Orb shader allocation failed');
      shaders.push(shader);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Orb shader compilation failed');
      gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Orb shader link failed');
    return program;
  };
  const makeTexture = () => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Orb texture allocation failed');
    textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };
  const makeTarget = () => {
    const texture = makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, floatingPoint ? gl.RGBA32F : gl.RGBA8, DYE_SIZE, DYE_SIZE, 0,
      gl.RGBA, floatingPoint ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Orb framebuffer allocation failed');
    framebuffers.push(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Orb framebuffer unsupported');
    return { texture, framebuffer };
  };
  let simulation: WebGLProgram;
  let display: WebGLProgram;
  let noise: WebGLTexture;
  let read: ReturnType<typeof makeTarget>;
  let write: ReturnType<typeof makeTarget>;
  try {
    if (!buffer || !vao) throw new Error('Orb geometry allocation failed');
    simulation = compile(advectionShader);
    display = compile(fragmentShader);
    noise = makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 128, 0, gl.RED, gl.UNSIGNED_BYTE, createNoiseTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    read = makeTarget();
    write = makeTarget();
  } catch (error) {
    console.warn('Fluid orb is using its static fallback.', error);
    release();
    return null;
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const location = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
  const timeUniform = location(simulation, 'uTime');
  const deltaUniform = location(simulation, 'uDelta');
  const gestureUniform = location(simulation, 'uGesture');
  const initializeUniform = location(simulation, 'uInitialize');
  const detailUniform = location(display, 'uDetail');
  gl.useProgram(simulation);
  gl.uniform1i(location(simulation, 'uSource'), 0);
  gl.uniform1i(location(simulation, 'uNoise'), 1);
  gl.useProgram(display);
  gl.uniform1i(location(display, 'uDye'), 0);
  gl.uniform1i(location(display, 'uNoise'), 1);
  const bind = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  bind(1, noise);
  bind(0, noise); // Initialization never samples its own render target.
  gl.useProgram(simulation);
  gl.uniform1i(initializeUniform, 1);
  gl.uniform1f(timeUniform, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, read.framebuffer);
  gl.viewport(0, 0, DYE_SIZE, DYE_SIZE);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.uniform1i(initializeUniform, 0);
  // Begin with a gently folded pigment field, including the reduced-motion still.
  // This happens only at creation; the live simulation is never reset or looped.
  if (floatingPoint) {
    for (let step = 0; step < 12; step++) {
      gl.uniform1f(timeUniform, step * .08);
      gl.uniform1f(deltaUniform, .08);
      bind(0, read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      [read, write] = [write, read];
    }
  }

  let state: OrbState = { mood: 'ready', word: -1, engaged: false };
  let disposed = false;
  let visible = true;
  let frame = 0;
  let lastDraw = 0;
  let time = floatingPoint ? .96 : 0;
  let wordUntil = 0;
  let gesture = 0;
  let speed = IDLE_SPEED;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stopped = () => disposed || document.hidden || !visible || gl.isContextLost();
  const animate = () => !motion.matches && floatingPoint;
  const draw = (now: number) => {
    frame = 0;
    if (stopped()) return;
    const delta = lastDraw ? Math.min((now - lastDraw) / 1000, .05) : 1 / 60;
    lastDraw = now;
    const speaking = state.mood === 'speaking';
    const wordGesture = speaking ? Math.max(0, (wordUntil - now) / 420) : 0;
    const targetSpeed = speaking ? .30 : state.mood === 'working' ? .14 : state.engaged ? .05 : IDLE_SPEED;
    const smoothing = 1 - Math.exp(-delta * 8);
    gesture += (wordGesture - gesture) * smoothing;
    speed += (targetSpeed - speed) * smoothing;
    gl.bindVertexArray(vao);
    if (animate()) {
      const step = delta * (speed + (speaking ? gesture * .05 : 0));
      time += step;
      gl.useProgram(simulation);
      gl.uniform1f(timeUniform, time);
      gl.uniform1f(deltaUniform, step);
      gl.uniform1f(gestureUniform, gesture);
      bind(0, read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
      gl.viewport(0, 0, DYE_SIZE, DYE_SIZE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      [read, write] = [write, read];
    }
    const cssSize = canvas.clientWidth;
    const size = Math.min(384, Math.max(32, Math.round(cssSize * Math.min(devicePixelRatio || 1, 2))));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(display);
    gl.uniform1f(detailUniform, Math.max(0, Math.min(1, (cssSize - 64) / 128)));
    bind(0, read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Native RAF targets the display's 60Hz cadence, including very slow idle flow.
    if (animate()) frame = requestAnimationFrame(draw);
  };
  const wake = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastDraw = 0;
    if (!stopped()) frame = requestAnimationFrame(draw);
  };
  const resize = new ResizeObserver(wake);
  resize.observe(canvas);
  const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  });
  intersection?.observe(canvas);
  document.addEventListener('visibilitychange', wake);
  motion.addEventListener('change', wake);
  wake();
  return {
    update(next) {
      if (next.mood === 'speaking' && next.word >= 0 && (next.word !== state.word || state.mood !== 'speaking')) wordUntil = performance.now() + 420;
      state = next;
      if (!frame) wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', wake);
      motion.removeEventListener('change', wake);
      release();
    },
  };
}
