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
import type { Planet } from "@miworld/shared";
import { surfaceColor } from "./palette";

const SEGMENTS = 240; // 8 km / 240 ≈ 33 m facets — macro terrain; detail LOD arrives in WP-12

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
  const c = { r: 0, g: 0, b: 0 };
  const col = surfaceColor(0, 0);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = planet.height(x, z);
    pos.setY(i, y);
    surfaceColor(y, planet.slopeAt(x, z), col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  void c;

  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0,
    flatShading: false,
  });
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
