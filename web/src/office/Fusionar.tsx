import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Firma de material: agrupa materiales equivalentes aunque sean instancias distintas. */
function firma(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  return [m.type, s.color?.getHexString(), s.map?.uuid, s.roughness, s.metalness, m.transparent, m.opacity, m.side, s.emissive?.getHexString(), s.emissiveIntensity].join('|');
}

/**
 * Fusiona la geometría ESTÁTICA de sus hijos en pocas mallas (una por material y modo de sombra).
 * Reduce las llamadas de dibujo de miles a decenas. Las mallas marcadas con userData.dinamico
 * (pantallas, suelos clicables, indicadores de actividad) no se fusionan y siguen reaccionando a eventos.
 * Las originales se ocultan (no se desmontan) para no interferir con React.
 */
export function Fusionar({ children }: { children: ReactNode }) {
  const grupo = useRef<THREE.Group>(null!);
  const fusion = useRef<THREE.Group | null>(null);
  useLayoutEffect(() => {
    const g = grupo.current;
    g.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const lotes = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[]; fuentes: THREE.Mesh[] }>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.dinamico || Array.isArray(m.material)) return;
      let p: THREE.Object3D | null = o;
      while (p && p !== g) {
        if (p.userData.dinamico) return;
        p = p.parent;
      }
      const k = `${firma(m.material)}|${m.castShadow}|${m.receiveShadow}`;
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const l = lotes.get(k) ?? { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, geos: [], fuentes: [] };
      l.geos.push(geo);
      l.fuentes.push(m);
      lotes.set(k, l);
    });
    const salida = new THREE.Group();
    for (const l of lotes.values()) {
      const merged = mergeGeometries(l.geos, false);
      l.geos.forEach((x) => x.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, l.mat);
      mesh.castShadow = l.cast;
      mesh.receiveShadow = l.recv;
      mesh.raycast = () => {}; // la geometría fusionada no captura clics
      salida.add(mesh);
      l.fuentes.forEach((f) => (f.visible = false));
    }
    g.add(salida);
    fusion.current = salida;
    return () => {
      salida.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
      g.remove(salida);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.dinamico) o.visible = true;
      });
    };
  }, []);
  return <group ref={grupo}>{children}</group>;
}
