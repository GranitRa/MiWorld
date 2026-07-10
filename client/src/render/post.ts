import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { MathUtils, Vector2, Vector3 } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// True HD-2D: the "pixel" lives in the ART (low-res NearestFilter textures + sprites), not
// in a screen-space filter — so the image never crawls as the camera orbits. We render the
// pixel-art crisply at native resolution, smooth geometry silhouettes with SMAA, then apply
// a soft bloom, a tilt-shift "miniature" depth of field, and a warm filmic grade + vignette.

const COPY_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    texel: { value: new Vector2(1 / 1024, 1 / 1024) },
    focus: { value: 0.58 }, // screen-y of the sharp band
    range: { value: 0.42 },
    strength: { value: 0.6 },
  },
  vertexShader: COPY_VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 texel;
    uniform float focus; uniform float range; uniform float strength;
    varying vec2 vUv;
    void main() {
      float d = clamp(abs(vUv.y - focus) / range, 0.0, 1.0);
      float amt = d * d * strength;
      vec2 o = texel * amt * 3.5;
      vec4 c = texture2D(tDiffuse, vUv) * 0.227;
      c += texture2D(tDiffuse, vUv + vec2(o.x, 0.0)) * 0.152;
      c += texture2D(tDiffuse, vUv - vec2(o.x, 0.0)) * 0.152;
      c += texture2D(tDiffuse, vUv + vec2(0.0, o.y)) * 0.152;
      c += texture2D(tDiffuse, vUv - vec2(0.0, o.y)) * 0.152;
      c += texture2D(tDiffuse, vUv + o) * 0.0575;
      c += texture2D(tDiffuse, vUv - o) * 0.0575;
      c += texture2D(tDiffuse, vUv + vec2(o.x, -o.y)) * 0.0575;
      c += texture2D(tDiffuse, vUv + vec2(-o.x, o.y)) * 0.0575;
      gl_FragColor = c;
    }
  `,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    warm: { value: new Vector3(1.03, 1.0, 0.96) },
    contrast: { value: 1.07 },
    saturation: { value: 1.06 },
    vignette: { value: 0.8 },
  },
  vertexShader: COPY_VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 warm;
    uniform float contrast; uniform float saturation; uniform float vignette;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = aces(col * 1.05);
      col *= warm;
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);
      vec2 q = vUv - 0.5;
      col *= 1.0 - dot(q, q) * vignette;
      col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly smaa: SMAAPass;
  private readonly tilt: ShaderPass;
  private readonly baseStrength = 0.6;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.composer = new EffectComposer(renderer);
    const size = renderer.getSize(new Vector2());

    this.composer.addPass(new RenderPass(scene, camera));

    this.smaa = new SMAAPass(size.x, size.y);
    this.composer.addPass(this.smaa);

    this.composer.addPass(new UnrealBloomPass(size, 0.4, 0.7, 0.85)); // strength, radius, threshold

    this.tilt = new ShaderPass(TiltShiftShader);
    this.composer.addPass(this.tilt);

    this.composer.addPass(new ShaderPass(GradeShader));

    this.setSize(size.x, size.y);
  }

  /**
   * Ease the tilt-shift ("miniature") strength by how far the camera is from its subject:
   * strong up close for the diorama feel, off at overview altitude so the map isn't smeared.
   */
  setFocusDistance(distanceMeters: number): void {
    const t = MathUtils.clamp((distanceMeters - 900) / (2500 - 900), 0, 1);
    const s = this.tilt.uniforms.strength;
    if (s) s.value = MathUtils.lerp(this.baseStrength, 0, t);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.smaa.setSize(width, height);
    const texel = this.tilt.uniforms.texel;
    if (texel) (texel.value as Vector2).set(1 / width, 1 / height);
  }

  render(): void {
    this.composer.render();
  }
}
