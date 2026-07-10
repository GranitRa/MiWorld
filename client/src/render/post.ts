import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { Vector2, Vector3 } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// HD-2D flavour: a pixelated 3D base (DQ3/Octopath), a soft bloom, a tilt-shift blur that
// fakes a miniature-diorama depth of field, and a warm filmic colour grade + vignette.

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
  private readonly tilt: ShaderPass;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    pixelSize = 4,
  ) {
    this.composer = new EffectComposer(renderer);

    const pixel = new RenderPixelatedPass(pixelSize, scene, camera);
    pixel.normalEdgeStrength = 0.12;
    pixel.depthEdgeStrength = 0.18;
    this.composer.addPass(pixel);

    const size = renderer.getSize(new Vector2());
    const bloom = new UnrealBloomPass(size, 0.4, 0.7, 0.85); // strength, radius, threshold
    this.composer.addPass(bloom);

    this.tilt = new ShaderPass(TiltShiftShader);
    this.composer.addPass(this.tilt);

    const grade = new ShaderPass(GradeShader);
    this.composer.addPass(grade);

    this.setSize(size.x, size.y);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const texel = this.tilt.uniforms.texel;
    if (texel) (texel.value as Vector2).set(1 / width, 1 / height);
  }

  render(): void {
    this.composer.render();
  }
}
