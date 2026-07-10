import {
  BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  CircleGeometry,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import { fbm, type Planet } from "@miworld/shared";
import { surfaceColor } from "./palette";
import { ProceduralSpriteSource } from "../pixelart/source";

const SEGMENTS = 200; // faceted low-poly forms; detail LOD arrives in WP-12

/**
 * Build the Mars terrain mesh from the deterministic planet. Heights come from
 * `planet.height`, so this exactly matches any server-side sampling. Vertex colours encode
 * elevation + slope; ice deposits get a faint pale disc so the surface reads as "resourced".
 */
export function buildTerrain(planet: Planet): Group {
  const group = new Group();

  const geo = new PlaneGeometry(planet.size, planet.size, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2); // XZ ground plane, Y up

  const pos = geo.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = surfaceColor(0, 0);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = planet.height(x, z);
    pos.setY(i, y);
    // Low-frequency painterly tint patches, in [-1, 1].
    const variation = fbm(x / 900, z / 900, planet.seed ^ 0x0c010, { octaves: 3 }) * 2 - 1;
    surfaceColor(y, planet.slopeAt(x, z), variation, col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true, // faceted low-poly forms
  });

  // Micro pixel-art regolith grain (RWP-3): two seeded tiles sampled in world space at
  // different scales and multiplied onto the vertex colour, so crisp texels stay glued to
  // the ground while orbiting (no screen-space pixel crawl).
  const source = new ProceduralSpriteSource(planet.seed);
  const tile0 = source.terrainTile(0);
  const tile1 = source.terrainTile(1);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile0 = { value: tile0 };
    shader.uniforms.uTile1 = { value: tile1 };
    shader.vertexShader =
      "varying vec3 vWorldPos;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader =
      "uniform sampler2D uTile0;\nuniform sampler2D uTile1;\nvarying vec3 vWorldPos;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 w = vWorldPos.xz;
          vec3 t1 = texture2D(uTile0, w / 32.0).rgb;
          vec3 t2 = texture2D(uTile1, w / 17.0 + vec2(0.37)).rgb;
          vec3 grain = t1 * t2 * 1.7;
          diffuseColor.rgb *= mix(vec3(1.0), grain, 0.6);
        }`,
      );
  };

  const mesh = new Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  group.add(mesh);

  // Faint ice discs (pale, slightly emissive) laid on the surface.
  for (const dep of planet.deposits) {
    if (dep.kind !== "ice") continue;
    const disc = new Mesh(
      new CircleGeometry(dep.radius, 24),
      new MeshBasicMaterial({ color: "#bcd7e8", transparent: true, opacity: 0.16, side: DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(dep.x, planet.height(dep.x, dep.z) + 0.6, dep.z);
    group.add(disc);
  }

  return group;
}
