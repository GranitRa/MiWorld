import {
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  Mesh,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import {
  DUST_FOG,
  SKY_DAY_HORIZON,
  SKY_DAY_TOP,
  SKY_NIGHT_HORIZON,
  SKY_NIGHT_TOP,
  SUN_COLOR,
} from "./palette";

const DOME_RADIUS = 9000;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Sky dome + sun/moon light + dust fog + stars, driven by the fraction through a sol. */
export class Sky {
  readonly sun = new DirectionalLight(0xffffff, 2.2);
  readonly sunDirection = new Vector3(0, 1, 0);
  // Warm sky fill, cool ground bounce → painterly warm tops / cool shadows.
  private readonly hemi = new HemisphereLight(0xffe0b0, 0x3a2c47, 0.55);
  private readonly dome: Mesh;
  private readonly stars: Points;
  private readonly uniforms;
  private readonly fog: FogExp2;

  constructor(scene: Scene) {
    this.uniforms = {
      topColor: { value: SKY_DAY_TOP.clone() },
      horizonColor: { value: SKY_DAY_HORIZON.clone() },
      sunDir: { value: new Vector3(0, 1, 0) },
      sunColor: { value: SUN_COLOR.clone() },
      sunUp: { value: 1 },
    };

    this.dome = new Mesh(
      new SphereGeometry(DOME_RADIUS, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        fog: false,
        depthWrite: false,
        uniforms: this.uniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec3 vDir;
          uniform vec3 topColor; uniform vec3 horizonColor;
          uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunUp;
          void main() {
            vec3 d = normalize(vDir);
            float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(horizonColor, topColor, pow(t, 0.55));
            float s = max(dot(d, normalize(sunDir)), 0.0);
            col += sunColor * pow(s, 220.0) * 1.6;              // sun disc
            col += sunColor * pow(s, 6.0) * 0.18 * sunUp;        // halo, fades at night
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 9000;
    this.sun.shadow.camera.left = -2600;
    this.sun.shadow.camera.right = 2600;
    this.sun.shadow.camera.top = 2600;
    this.sun.shadow.camera.bottom = -2600;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.stars = makeStars();
    scene.add(this.stars);

    this.fog = new FogExp2(DUST_FOG.getHex(), 0.00007);
    scene.fog = this.fog;

    this.update(0.5);
  }

  /** solFraction in [0,1): 0 = midnight, 0.5 = noon. */
  update(solFraction: number): void {
    const phase = solFraction * Math.PI * 2;
    const dir = new Vector3(Math.sin(phase), -Math.cos(phase), 0.28).normalize();
    this.sunDirection.copy(dir);
    const day = clamp01(dir.y * 1.25 + 0.12);

    // A default position; the app repositions the sun each frame to track the view so the
    // shadow frustum stays over what the camera is looking at.
    this.sun.position.copy(dir).multiplyScalar(4000);
    this.sun.intensity = 0.2 + day * 2.5;
    this.hemi.intensity = 0.28 + day * 0.55;

    this.uniforms.sunDir.value.copy(dir);
    this.uniforms.sunUp.value = day;
    this.uniforms.topColor.value.copy(SKY_NIGHT_TOP).lerp(SKY_DAY_TOP, day);
    this.uniforms.horizonColor.value.copy(SKY_NIGHT_HORIZON).lerp(SKY_DAY_HORIZON, day);

    const fogCol = new Color(SKY_NIGHT_HORIZON).lerp(DUST_FOG, day);
    this.fog.color.copy(fogCol);

    const starMat = this.stars.material as PointsMaterial;
    starMat.opacity = clamp01(1 - day * 2);
  }
}

function makeStars(): Points {
  const n = 900;
  const arr = new Float32Array(n * 3);
  // Deterministic-ish scatter on the upper hemisphere of the dome.
  let s = 987654321;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    arr[i * 3] = Math.cos(theta) * r * (DOME_RADIUS - 200);
    arr[i * 3 + 1] = Math.abs(u) * (DOME_RADIUS - 200);
    arr[i * 3 + 2] = Math.sin(theta) * r * (DOME_RADIUS - 200);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(arr, 3));
  const mat = new PointsMaterial({
    color: 0xffffff,
    size: 26,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  return new Points(geo, mat);
}
