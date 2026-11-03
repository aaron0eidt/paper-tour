/** Local ink material: semi-Lagrangian pigment advection, then a circular display.
 * Architecture references and distinctions are documented in README.md.
 */
export const vertexShader = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const advectionShader = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSource;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uDelta;
uniform float uGesture;
uniform bool uInitialize;
in vec2 vUv;
out vec4 fragColor;

// Explicit bilinear sampling keeps 32-bit pigment precision without requiring
// the optional floating-point linear-filter extension.
vec3 sampleInk(sampler2D field, vec2 uv) {
  ivec2 size = textureSize(field, 0);
  vec2 point = uv * vec2(size) - 0.5;
  ivec2 low = ivec2(floor(point));
  ivec2 high = low + ivec2(1);
  vec2 fraction = fract(point);
  low = clamp(low, ivec2(0), size - 1);
  high = clamp(high, ivec2(0), size - 1);
  vec3 bottom = mix(texelFetch(field, low, 0).rgb,
    texelFetch(field, ivec2(high.x, low.y), 0).rgb, fraction.x);
  vec3 top = mix(texelFetch(field, ivec2(low.x, high.y), 0).rgb,
    texelFetch(field, high, 0).rgb, fraction.x);
  return mix(bottom, top, fraction.y);
}

// An evolving stream function produces a divergence-free velocity field.
// Its boundary envelope holds the ink inside the circle without a rotating body.
vec2 velocity(vec2 p, float t) {
  float a = 1.7 * p.x + t * 0.17;
  float b = 1.9 * p.y - t * 0.13;
  float c = 2.4 * p.x - 1.2 * p.y + t * 0.11 + 1.3;
  float d = -1.3 * p.x + 2.7 * p.y - t * 0.073 + 0.7;
  float potential = sin(a) * sin(b) + 0.5 * sin(c) + 0.35 * cos(d);
  vec2 gradient = vec2(
    1.7 * cos(a) * sin(b) + 1.2 * cos(c) + 0.455 * sin(d),
    1.9 * sin(a) * cos(b) - 0.6 * cos(c) - 0.945 * sin(d)
  );
  float envelope = max(0.0, 1.0 - dot(p, p));
  gradient = envelope * envelope * gradient - 4.0 * envelope * p * potential;
  return vec2(gradient.y, -gradient.x) * (0.18 + uGesture * 0.065);
}

// Broad pigmented regions supply the starting field and a very slow replenishment.
vec3 pigment(vec2 p, float t) {
  vec2 warp = vec2(
    texture(uNoise, p * 0.16 + vec2(0.2 + t * 0.003, 0.7)).r,
    texture(uNoise, p * 0.16 + vec2(0.7, 0.3 - t * 0.002)).r
  ) - 0.5;
  vec2 q = p + warp * 0.85;
  vec2 a = q - vec2(-0.62, 0.45);
  vec2 b = q - vec2(0.48, 0.55);
  vec2 c = q - vec2(-0.42, -0.54);
  vec2 d = q - vec2(0.55, -0.38);
  vec2 e = q - vec2(0.02, 0.06);
  float wa = exp(-dot(a, a) * 2.7);
  float wb = exp(-dot(b, b) * 3.0);
  float wc = exp(-dot(c, c) * 3.1);
  float wd = exp(-dot(d, d) * 3.0);
  float we = exp(-dot(e, e) * 5.2) * 0.6;
  vec3 color = vec3(0.54, 0.42, 0.80) * wa
    + vec3(0.78, 0.72, 0.93) * wb
    + vec3(0.96, 0.65, 0.80) * wc
    + vec3(0.64, 0.79, 0.96) * wd
    + vec3(0.99, 0.95, 0.91) * we;
  return color / (wa + wb + wc + wd + we);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec3 fresh = pigment(p, uTime);
  if (uInitialize) {
    fragColor = vec4(fresh, 1.0);
    return;
  }
  // Midpoint backtrace transports the previous frame's pigment, rather than
  // reevaluating a looping gradient. Linear filtering supplies gentle mixing.
  vec2 firstVelocity = velocity(p, uTime);
  vec2 midpoint = p - firstVelocity * uDelta * 0.5;
  vec2 backtrace = p - velocity(midpoint, uTime - uDelta * 0.5) * uDelta;
  vec3 advected = sampleInk(uSource, backtrace * 0.5 + 0.5);
  // Long-lived ink stays varied during lengthy reading sessions; never reset.
  float renewal = 1.0 - exp(-uDelta * 0.055);
  fragColor = vec4(mix(advected, fresh, renewal), 1.0);
}
`;

export const fragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDye;
uniform sampler2D uNoise;
uniform float uDetail;
in vec2 vUv;
out vec4 fragColor;

// Explicit bilinear sampling keeps 32-bit pigment precision without requiring
// the optional floating-point linear-filter extension.
vec3 sampleInk(sampler2D field, vec2 uv) {
  ivec2 size = textureSize(field, 0);
  vec2 point = uv * vec2(size) - 0.5;
  ivec2 low = ivec2(floor(point));
  ivec2 high = low + ivec2(1);
  vec2 fraction = fract(point);
  low = clamp(low, ivec2(0), size - 1);
  high = clamp(high, ivec2(0), size - 1);
  vec3 bottom = mix(texelFetch(field, low, 0).rgb,
    texelFetch(field, ivec2(high.x, low.y), 0).rgb, fraction.x);
  vec3 top = mix(texelFetch(field, ivec2(low.x, high.y), 0).rgb,
    texelFetch(field, high, 0).rgb, fraction.x);
  return mix(bottom, top, fraction.y);
}
void main() {
  float radius = length(vUv * 2.0 - 1.0);
  vec3 color = sampleInk(uDye, vUv);
  // Stable, very fine analog texture; it never flashes or masquerades as speech.
  float grain = texture(uNoise, gl_FragCoord.xy / 79.0).r - 0.5;
  color += grain * mix(0.009, 0.025, uDetail);
  float alpha = 1.0 - smoothstep(1.0 - max(fwidth(radius), 0.004), 1.0, radius);
  fragColor = vec4(color, alpha);
}
`;
