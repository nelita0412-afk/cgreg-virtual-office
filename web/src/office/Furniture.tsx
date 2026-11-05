import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';

const WHITE = '#f1f5f9';
const DARK = '#1f2937';
const WOOD = '#b98a5e';

export function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.5, 12]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
      </mesh>
      {[
        [0, 0.85, 0, 0.42],
        [0.2, 1.15, 0.1, 0.32],
        [-0.18, 1.05, -0.1, 0.34],
        [0.05, 1.42, -0.05, 0.26],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={i % 2 ? '#2f9e44' : '#237a36'} flatShading roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function Chair({ position, rot = 0, color = '#111827' }: { position: [number, number, number]; rot?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.8, -0.25]} castShadow>
        <boxGeometry args={[0.55, 0.6, 0.07]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.45, 6]} />
        <meshStandardMaterial color="#6b7280" metalness={0.6} />
      </mesh>
    </group>
  );
}

/** Escritorio con monitor; `pantalla` define si el monitor está encendido (actividad real). */
export function Desk({ position, rot = 0, w = 2.2, d = 1, pantalla = false, colorPantalla = '#22d3ee', monitores = 1 }: { position: [number, number, number]; rot?: number; w?: number; d?: number; pantalla?: boolean; colorPantalla?: string; monitores?: number }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <RoundedBox args={[w, 0.08, d]} radius={0.03} position={[0, 0.76, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={WHITE} roughness={0.4} />
      </RoundedBox>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (w - 0.12)) / 2, 0.38, 0]} castShadow>
          <boxGeometry args={[0.06, 0.76, d * 0.9]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      ))}
      {Array.from({ length: monitores }).map((_, i) => {
        const x = monitores === 1 ? 0 : (i - (monitores - 1) / 2) * 0.75;
        return (
          <group key={i} position={[x, 0.8, 0.15]}>
            <mesh position={[0, 0.38, 0]} castShadow>
              <boxGeometry args={[0.7, 0.45, 0.04]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
            <mesh position={[0, 0.38, -0.025]}>
              <planeGeometry args={[0.64, 0.39]} />
              <meshStandardMaterial color={pantalla ? colorPantalla : '#0f172a'} emissive={pantalla ? colorPantalla : '#000'} emissiveIntensity={pantalla ? 0.9 : 0} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0.08, 0]}>
              <boxGeometry args={[0.06, 0.16, 0.06]} />
              <meshStandardMaterial color="#475569" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Sala con paredes de vidrio: alta al fondo y laterales, baja al frente (para ver el interior). */
export function GlassRoom({ center, size, color, activo, onClick, onOver }: { center: [number, number]; size: [number, number]; color: string; activo: boolean; onClick?: () => void; onOver?: (v: boolean) => void }) {
  const [cx, cz] = center;
  const [w, d] = size;
  const h = 2.6;
  const glass = (
    <meshStandardMaterial color={color} transparent opacity={0.14} depthWrite={false} roughness={0.1} metalness={0.2} side={THREE.DoubleSide} />
  );
  const marco = <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />;
  return (
    <group position={[cx, 0, cz]}>
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onOver?.(true);
        }}
        onPointerOut={() => onOver?.(false)}
      >
        <planeGeometry args={[w - 0.1, d - 0.1]} />
        <meshStandardMaterial color={activo ? color : '#cfd8e3'} emissive={activo ? color : '#000'} emissiveIntensity={activo ? 0.18 : 0} transparent opacity={activo ? 0.55 : 0.45} />
      </mesh>
      {/* fondo */}
      <mesh position={[0, h / 2, -d / 2]}>
        <planeGeometry args={[w, h]} />
        {glass}
      </mesh>
      {/* laterales */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d, h]} />
          {glass}
        </mesh>
      ))}
      {/* frente bajo con puerta */}
      {[-1, 1].map((s) => (
        <mesh key={'f' + s} position={[s * (w / 4 + 0.45), 0.55, d / 2]}>
          <planeGeometry args={[w / 2 - 0.9, 1.1]} />
          {glass}
        </mesh>
      ))}
      {/* perfiles */}
      {[
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ].map(([x, z], i) => (
        <mesh key={'p' + i} position={[x, (i < 2 ? h : 1.1) / 2, z]}>
          <boxGeometry args={[0.07, i < 2 ? h : 1.1, 0.07]} />
          {marco}
        </mesh>
      ))}
      <mesh position={[0, h, -d / 2]}>
        <boxGeometry args={[w, 0.06, 0.06]} />
        {marco}
      </mesh>
      {activo && <pointLight position={[0, 2.2, 0]} color={color} intensity={6} distance={7} decay={1.6} />}
    </group>
  );
}

export function Sofa({ position, rot = 0, color = '#64748b' }: { position: [number, number, number]; rot?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <RoundedBox args={[2.4, 0.45, 0.9]} radius={0.12} position={[0, 0.3, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[2.4, 0.6, 0.25]} radius={0.1} position={[0, 0.7, -0.35]} castShadow>
        <meshStandardMaterial color={color} roughness={0.9} />
      </RoundedBox>
    </group>
  );
}

/** Textura del ventanal: cielo, mar e islas (generada en tiempo de ejecución, sin imágenes externas). */
export function useVentanalTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 80);
    sky.addColorStop(0, '#7cc4f2');
    sky.addColorStop(1, '#cfeaf9');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1024, 80);
    const sea = g.createLinearGradient(0, 70, 0, 128);
    sea.addColorStop(0, '#2a9fd0');
    sea.addColorStop(1, '#0b5f8f');
    g.fillStyle = sea;
    g.fillRect(0, 72, 1024, 56);
    g.fillStyle = '#5b6b55';
    const isla = (x: number, w: number, h: number) => {
      g.beginPath();
      g.moveTo(x, 74);
      g.quadraticCurveTo(x + w * 0.45, 74 - h, x + w, 74);
      g.fill();
    };
    isla(80, 220, 26);
    isla(420, 160, 16);
    isla(700, 260, 34);
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 1024, 80 + Math.random() * 44, 14, 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

export function useFloorTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#dfe5ec';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(100,116,139,.18)';
    g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 9);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

export { WOOD };
