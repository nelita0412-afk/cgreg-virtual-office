import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';

/* =====================================================================================
 * Mobiliario y materiales de la oficina (recursos 100 % locales, generados en tiempo de ejecución).
 * Texturas en espacio de color sRGB, con mipmaps y filtro anisotrópico máximo para evitar el
 * desenfoque en ángulos rasantes de la vista isométrica.
 * ===================================================================================== */

export function useCanvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, deps: unknown[] = [], repeat?: [number, number]) {
  const gl = useThree((s) => s.gl);
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = gl.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(...repeat);
    }
    return t;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Porcelanato claro de gran formato (zonas comunes). */
export function usePorcelanato() {
  return useCanvasTexture((g, w, h) => {
    const r = rnd(7);
    g.fillStyle = '#e4e6e9';
    g.fillRect(0, 0, w, h);
    const n = 4;
    const s = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 226 + Math.floor(r() * 10);
        g.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(150,160,175,${0.03 + r() * 0.04})`;
          g.fillRect(i * s + r() * s, j * s + r() * s, 1 + r() * 30, 1);
        }
      }
    g.strokeStyle = 'rgba(120,130,145,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, h);
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
  }, 1024, 1024, [], [16, 10]);
}

/** Alfombra modular (consultorios y salas). */
export function useAlfombra(color: string) {
  return useCanvasTexture((g, w, h) => {
    const r = rnd(11);
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.06)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo((i * w) / 4, 0);
      g.lineTo((i * w) / 4, h);
      g.moveTo(0, (i * h) / 4);
      g.lineTo(w, (i * h) / 4);
      g.stroke();
    }
  }, 512, 512, [color], [4, 3]);
}

/** Parqué de madera clara (salas de reunión). */
export function useParquet() {
  return useCanvasTexture((g, w, h) => {
    const r = rnd(3);
    const tabla = 32;
    for (let y = 0; y < h; y += tabla) {
      let x = -r() * 200;
      while (x < w) {
        const l = 160 + r() * 160;
        const v = 175 + r() * 35;
        g.fillStyle = `rgb(${v},${v * 0.78},${v * 0.55})`;
        g.fillRect(x, y, l - 2, tabla - 2);
        g.fillStyle = 'rgba(90,60,30,0.08)';
        for (let k = 0; k < 4; k++) g.fillRect(x + r() * l, y + r() * tabla, r() * 60, 1);
        x += l;
      }
    }
  }, 1024, 1024, [], [3, 2]);
}

/** Ventanal panorámico: cielo, Pacífico e islas volcánicas de Galápagos (pintado, sin imágenes externas). */
export function useVentanal() {
  return useCanvasTexture((g, w, h) => {
    const r = rnd(5);
    const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#5fb3ec');
    sky.addColorStop(0.7, '#bfe3f8');
    sky.addColorStop(1, '#eaf6fd');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h * 0.62);
    // nubes
    for (let i = 0; i < 14; i++) {
      const x = r() * w;
      const y = 30 + r() * h * 0.3;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.ellipse(x + k * 28 - 70, y + Math.sin(k) * 8, 60 - k * 4, 18, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // islas volcánicas (perfiles en capas para dar profundidad)
    const isla = (x: number, ancho: number, alto: number, color: string, base: number) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, base);
      for (let k = 0; k <= 30; k++) {
        const px = x + (k / 30) * ancho;
        const py = base - Math.sin((k / 30) * Math.PI) ** 1.4 * alto - (r() - 0.5) * alto * 0.08;
        g.lineTo(px, py);
      }
      g.lineTo(x + ancho, base);
      g.fill();
    };
    const mar = h * 0.6;
    isla(-100, 900, 120, '#7d8f9c', mar);
    isla(1300, 1100, 150, '#7f909c', mar);
    isla(2700, 700, 90, '#8495a1', mar);
    isla(500, 600, 70, '#566458', mar + 4);
    isla(2050, 520, 130, '#4d5a4b', mar + 4); // cono tipo Bartolomé
    isla(3200, 600, 60, '#5a6655', mar + 4);
    // mar
    const sea = g.createLinearGradient(0, mar, 0, h);
    sea.addColorStop(0, '#3aa6cf');
    sea.addColorStop(0.5, '#1d7fae');
    sea.addColorStop(1, '#0d5e88');
    g.fillStyle = sea;
    g.fillRect(0, mar, w, h - mar);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
      const y = mar + 6 + r() * (h - mar);
      g.fillRect(r() * w, y, 6 + r() * 26 * (y / h), 1.5);
    }
    // costa de lava y vegetación en primer plano
    g.fillStyle = '#2e2a28';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 40) g.lineTo(x, h - 30 - Math.abs(Math.sin(x * 0.004)) * 40 - r() * 14);
    g.lineTo(w, h);
    g.fill();
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() > 0.5 ? '#3f6b3a' : '#56804a';
      g.beginPath();
      g.ellipse(r() * w, h - 40 - r() * 30, 14 + r() * 24, 8 + r() * 10, 0, 0, Math.PI * 2);
      g.fill();
    }
  }, 4096, 768);
}

/** Texto nítido como textura (señalética en paredes). */
export function useTextoTextura(lineas: { t: string; f: string; c: string }[], w = 1024, h = 256, fondo?: string) {
  return useCanvasTexture((g) => {
    if (fondo) {
      g.fillStyle = fondo;
      g.fillRect(0, 0, w, h);
    }
    let y = 0;
    for (const l of lineas) {
      g.font = l.f;
      g.fillStyle = l.c;
      const m = parseInt(l.f.match(/(\d+)px/)?.[1] ?? '40', 10);
      y += m * 1.1;
      g.fillText(l.t, 24, y);
    }
  }, w, h, [JSON.stringify(lineas), fondo]);
}

/** Pantalla de monitor: interfaz de trabajo o videollamada (consulta). */
export function usePantallas() {
  const trabajo = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#0b1d42';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#123170';
    g.fillRect(0, 0, w, 26);
    g.fillStyle = '#C5A989';
    g.fillRect(10, 8, 60, 10);
    const r = rnd(9);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(148,163,184,0.5)';
      g.fillRect(14, 40 + i * 26, 120 + r() * 120, 8);
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = ['#3987e5', '#199e70', '#c98500'][i % 3];
      const bh = 20 + r() * 70;
      g.fillRect(300 + i * 30, 180 - bh, 20, bh);
    }
  }, 512, 200);
  const video = useCanvasTexture((g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#dbeafe');
    bg.addColorStop(1, '#a7c7e7');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0ac85';
    g.beginPath();
    g.arc(w / 2, h * 0.42, h * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3b2417';
    g.beginPath();
    g.arc(w / 2, h * 0.37, h * 0.17, Math.PI, 0);
    g.fill();
    g.fillStyle = '#334155';
    g.beginPath();
    g.ellipse(w / 2, h * 0.95, h * 0.32, h * 0.32, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = '#0f172a';
    g.fillRect(0, h - 26, w, 26);
    ['#ef4444', '#94a3b8', '#94a3b8'].forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(w / 2 - 30 + i * 30, h - 13, 8, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#1e293b';
    g.fillRect(w - 110, 12, 96, 70);
  }, 512, 300);
  return { trabajo, video };
}

/* ------------------------------- Materiales compartidos ------------------------------- */
export function useMateriales() {
  return useMemo(
    () => ({
      blanco: new THREE.MeshStandardMaterial({ color: '#f4f5f7', roughness: 0.35 }),
      madera: new THREE.MeshStandardMaterial({ color: '#b98a5e', roughness: 0.55 }),
      maderaOscura: new THREE.MeshStandardMaterial({ color: '#7a5434', roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: '#9aa3ae', roughness: 0.3, metalness: 0.85 }),
      negro: new THREE.MeshStandardMaterial({ color: '#1b1f27', roughness: 0.45, metalness: 0.2 }),
      malla: new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.9 }),
      tela: new THREE.MeshStandardMaterial({ color: '#5b6b80', roughness: 0.95 }),
      ceramica: new THREE.MeshStandardMaterial({ color: '#efe9e1', roughness: 0.4 }),
      tierra: new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 1 }),
      hoja1: new THREE.MeshStandardMaterial({ color: '#2f7d3b', roughness: 0.7 }),
      hoja2: new THREE.MeshStandardMaterial({ color: '#4c9a45', roughness: 0.7 }),
      vidrio: new THREE.MeshPhysicalMaterial({ color: '#cfe9f5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
      aluminio: new THREE.MeshStandardMaterial({ color: '#6b7684', roughness: 0.35, metalness: 0.8 }),
      pantallaOff: new THREE.MeshStandardMaterial({ color: '#0d1320', roughness: 0.15, metalness: 0.4 }),
    }),
    [],
  );
}
export type Mats = ReturnType<typeof useMateriales>;

/* ----------------------------------- Muebles ----------------------------------- */

/** Silla ergonómica: base de cinco radios, pistón, asiento, respaldo de malla y apoyabrazos. */
export function Silla({ position, rot = 0, m, color }: { position: [number, number, number]; rot?: number; m: Mats; color?: THREE.Material }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <mesh position={[0, 0.07, 0.17]} material={m.negro}>
              <boxGeometry args={[0.05, 0.035, 0.34]} />
            </mesh>
            <mesh position={[0, 0.03, 0.33]} material={m.negro}>
              <sphereGeometry args={[0.03, 8, 6]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.25, 0]} material={m.metal}>
        <cylinderGeometry args={[0.025, 0.03, 0.34, 10]} />
      </mesh>
      <RoundedBox smoothness={2} args={[0.5, 0.08, 0.48]} radius={0.035} position={[0, 0.46, 0.02]} material={color ?? m.malla} castShadow />
      <RoundedBox smoothness={2} args={[0.46, 0.55, 0.05]} radius={0.04} position={[0, 0.8, -0.23]} rotation={[-0.12, 0, 0]} material={color ?? m.malla} castShadow />
      {[-1, 1].map((l) => (
        <group key={l}>
          <mesh position={[0.25 * l, 0.58, 0.02]} material={m.negro}>
            <boxGeometry args={[0.03, 0.2, 0.04]} />
          </mesh>
          <RoundedBox smoothness={2} args={[0.06, 0.03, 0.26]} radius={0.012} position={[0.25 * l, 0.69, 0.04]} material={m.negro} />
        </group>
      ))}
    </group>
  );
}

/** Escritorio moderno: tablero, estructura metálica, panel frontal, monitores, teclado, ratón y taza. */
export function Escritorio({
  position,
  rot = 0,
  w = 1.6,
  d = 0.75,
  m,
  pantalla,
  textura,
  monitores = 2,
  tablero,
}: {
  position: [number, number, number];
  rot?: number;
  w?: number;
  d?: number;
  m: Mats;
  pantalla: boolean;
  textura: THREE.Texture;
  monitores?: number;
  tablero?: THREE.Material;
}) {
  const matPantalla = useMemo(
    () => (pantalla ? new THREE.MeshStandardMaterial({ map: textura, emissive: '#ffffff', emissiveMap: textura, emissiveIntensity: 0.85, roughness: 0.2 }) : m.pantallaOff),
    [pantalla, textura, m],
  );
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <RoundedBox smoothness={2} args={[w, 0.045, d]} radius={0.015} position={[0, 0.74, 0]} material={tablero ?? m.blanco} castShadow receiveShadow />
      {[-1, 1].map((l) => (
        <group key={l} position={[(l * (w - 0.1)) / 2, 0, 0]}>
          <mesh position={[0, 0.37, 0]} material={m.aluminio} castShadow>
            <boxGeometry args={[0.05, 0.72, 0.05]} />
          </mesh>
          <mesh position={[0, 0.02, 0]} material={m.aluminio}>
            <boxGeometry args={[0.06, 0.03, d * 0.9]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.5, d / 2 - 0.03]} material={tablero ?? m.blanco}>
        <boxGeometry args={[w - 0.12, 0.38, 0.02]} />
      </mesh>
      {Array.from({ length: monitores }).map((_, i) => {
        const x = monitores === 1 ? 0 : (i - (monitores - 1) / 2) * 0.62;
        const ry = monitores === 1 ? 0 : (i === 0 ? 0.18 : -0.18);
        return (
          <group key={i} position={[x, 0.76, 0.18]} rotation={[0, Math.PI + ry, 0]}>
            <mesh position={[0, 0.3, 0]} material={m.negro}>
              <boxGeometry args={[0.6, 0.36, 0.025]} />
            </mesh>
            <mesh position={[0, 0.3, 0.014]} material={matPantalla} userData={{ dinamico: true }}>
              <planeGeometry args={[0.57, 0.33]} />
            </mesh>
            <mesh position={[0, 0.07, 0.03]} material={m.aluminio}>
              <boxGeometry args={[0.04, 0.14, 0.03]} />
            </mesh>
            <mesh position={[0, 0.005, 0.03]} material={m.aluminio}>
              <boxGeometry args={[0.2, 0.012, 0.14]} />
            </mesh>
          </group>
        );
      })}
      <RoundedBox smoothness={2} args={[0.44, 0.02, 0.14]} radius={0.006} position={[0, 0.77, -0.12]} material={m.negro} />
      <RoundedBox smoothness={2} args={[0.06, 0.02, 0.1]} radius={0.01} position={[0.34, 0.77, -0.12]} material={m.negro} />
      <mesh position={[-0.6, 0.81, -0.15]} material={m.ceramica}>
        <cylinderGeometry args={[0.04, 0.035, 0.1, 14]} />
      </mesh>
    </group>
  );
}

/** Planta ornamental en maceta de cerámica (follaje en capas). */
export function Planta({ position, scale = 1, m, tipo = 0 }: { position: [number, number, number]; scale?: number; m: Mats; tipo?: number }) {
  const hojas = useMemo(() => {
    const r = rnd(17 + tipo * 13 + Math.round(position[0] * 10));
    return Array.from({ length: tipo === 1 ? 9 : 14 }, () => [r() * Math.PI * 2, 0.5 + r() * 0.75, 0.1 + r() * 0.2, r()]);
  }, [tipo, position[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.24, 0]} material={m.ceramica} castShadow>
        <cylinderGeometry args={[0.26, 0.19, 0.48, 20]} />
      </mesh>
      <mesh position={[0, 0.47, 0]} material={m.tierra}>
        <cylinderGeometry args={[0.24, 0.24, 0.02, 20]} />
      </mesh>
      {tipo === 1
        ? hojas.map(([a, hgt, , k], i) => (
            <mesh key={i} position={[Math.cos(a) * 0.07, 0.48 + hgt * 0.45, Math.sin(a) * 0.07]} rotation={[Math.cos(a) * 0.18, a, Math.sin(a) * 0.18]} material={k > 0.5 ? m.hoja1 : m.hoja2} castShadow>
              <boxGeometry args={[0.07, hgt * 0.95, 0.015]} />
            </mesh>
          ))
        : hojas.map(([a, hgt, rad, k], i) => (
            <mesh key={i} position={[Math.cos(a) * rad, 0.5 + hgt * 0.6, Math.sin(a) * rad]} rotation={[Math.sin(a) * 0.5, a, Math.cos(a) * 0.5]} scale={[1, 0.35, 1.6]} material={k > 0.5 ? m.hoja1 : m.hoja2} castShadow>
              <sphereGeometry args={[0.16, 10, 8]} />
            </mesh>
          ))}
    </group>
  );
}

export function Sofa({ position, rot = 0, m, color = '#64748b' }: { position: [number, number, number]; rot?: number; m: Mats; color?: string }) {
  const tela = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }), [color]);
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <RoundedBox smoothness={2} args={[2.6, 0.32, 0.95]} radius={0.08} position={[0, 0.28, 0]} material={tela} castShadow />
      {[-0.64, 0.64].map((x) => (
        <RoundedBox key={x} args={[1.22, 0.16, 0.8]} radius={0.07} position={[x, 0.5, 0.05]} material={tela} />
      ))}
      <RoundedBox smoothness={2} args={[2.6, 0.55, 0.22]} radius={0.09} position={[0, 0.62, -0.38]} material={tela} castShadow />
      {[-1.25, 1.25].map((x) => (
        <RoundedBox key={x} args={[0.2, 0.48, 0.95]} radius={0.08} position={[x, 0.45, 0]} material={tela} />
      ))}
      {[-1.15, 1.15].map((x) => (
        <mesh key={'p' + x} position={[x, 0.06, 0]} material={m.negro}>
          <boxGeometry args={[0.05, 0.12, 0.8]} />
        </mesh>
      ))}
    </group>
  );
}

export function Estanteria({ position, rot = 0, m }: { position: [number, number, number]; rot?: number; m: Mats }) {
  const libros = useMemo(() => {
    const r = rnd(23);
    const cols = ['#1e3a8a', '#9a3412', '#065f46', '#7c2d12', '#334155', '#a16207'];
    return Array.from({ length: 36 }, (_, i) => ({ fila: Math.floor(i / 9), x: (i % 9) * 0.16 - 0.66, h: 0.22 + r() * 0.1, c: cols[Math.floor(r() * cols.length)] }));
  }, []);
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh position={[0, 1.05, 0]} material={m.maderaOscura} castShadow>
        <boxGeometry args={[1.6, 2.1, 0.38]} />
      </mesh>
      {libros.map((b, i) => (
        <mesh key={i} position={[b.x, 0.22 + b.fila * 0.48 + b.h / 2, 0.12]}>
          <boxGeometry args={[0.12, b.h, 0.22]} />
          <meshStandardMaterial color={b.c} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Sala con muros de cristal y perfilería de aluminio. Muros altos al fondo y laterales; frente bajo con
 * puerta (para ver el interior desde la cámara isométrica).
 */
export function SalaCristal({
  center,
  size,
  m,
  suelo,
  activo,
  color,
  onClick,
  onOver,
}: {
  center: [number, number];
  size: [number, number];
  m: Mats;
  suelo: THREE.Texture;
  activo: boolean;
  color: string;
  onClick?: () => void;
  onOver?: (v: boolean) => void;
}) {
  const [cx, cz] = center;
  const [w, d] = size;
  const h = 3;
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }), [color]);
  const perfil = (x: number, z: number, alto: number, k: string) => (
    <mesh key={k} position={[x, alto / 2, z]} material={m.aluminio}>
      <boxGeometry args={[0.07, alto, 0.07]} />
    </mesh>
  );
  const puerta = 1.6;
  return (
    <group position={[cx, 0, cz]}>
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        userData={{ dinamico: true }}
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
        <meshStandardMaterial map={suelo} roughness={0.9} />
      </mesh>
      {/* fondo y laterales de cristal */}
      <mesh position={[0, h / 2, -d / 2]} material={m.vidrio}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={m.vidrio}>
          <planeGeometry args={[d, h]} />
        </mesh>
      ))}
      {/* frente bajo con puerta central */}
      {[-1, 1].map((s) => (
        <mesh key={'f' + s} position={[s * (w / 4 + puerta / 4), 0.55, d / 2]} material={m.vidrio}>
          <planeGeometry args={[w / 2 - puerta / 2, 1.1]} />
        </mesh>
      ))}
      {perfil(-w / 2, -d / 2, h, 'a')}
      {perfil(w / 2, -d / 2, h, 'b')}
      {perfil(-w / 2, d / 2, 1.1, 'c')}
      {perfil(w / 2, d / 2, 1.1, 'd')}
      {perfil(-puerta / 2, d / 2, 1.1, 'e')}
      {perfil(puerta / 2, d / 2, 1.1, 'f')}
      {Array.from({ length: Math.floor(w / 3) - 1 }).map((_, i) => perfil(-w / 2 + (i + 1) * (w / Math.floor(w / 3)), -d / 2, h, 'm' + i))}
      <mesh position={[0, h, -d / 2]} material={m.aluminio}>
        <boxGeometry args={[w, 0.07, 0.07]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={'t' + s} position={[(s * w) / 2, h, 0]} material={m.aluminio}>
          <boxGeometry args={[0.07, 0.07, d]} />
        </mesh>
      ))}
      <mesh position={[0, 1.1, d / 2]} material={m.aluminio}>
        <boxGeometry args={[w, 0.05, 0.05]} />
      </mesh>
      {/* franja de estado (actividad real en la sala) */}
      <mesh position={[0, 0.03, d / 2 - 0.06]} material={glow} visible={activo} userData={{ dinamico: true }}>
        <boxGeometry args={[w - 0.2, 0.02, 0.06]} />
      </mesh>
    </group>
  );
}

/* ------------------- Puntos de interés de los paseos ambientales ------------------- */
export function Dispensador({ position, rot = 0, m }: { position: [number, number, number]; rot?: number; m: Mats }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.5, 0]} material={m.blanco} castShadow>
        <boxGeometry args={[0.42, 1.0, 0.42]} />
      </mesh>
      <mesh position={[0, 0.72, 0.215]} material={m.negro}>
        <boxGeometry args={[0.22, 0.14, 0.02]} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.5, 20]} />
        <meshPhysicalMaterial color="#7cc4f2" transparent opacity={0.55} roughness={0.05} />
      </mesh>
    </group>
  );
}

export function Impresora({ position, rot = 0, m }: { position: [number, number, number]; rot?: number; m: Mats }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.38, 0]} material={m.blanco} castShadow>
        <boxGeometry args={[0.7, 0.76, 0.6]} />
      </mesh>
      <mesh position={[0, 0.88, 0]} material={m.aluminio} castShadow>
        <boxGeometry args={[0.62, 0.24, 0.54]} />
      </mesh>
      <mesh position={[0, 1.005, -0.05]} material={m.blanco}>
        <boxGeometry args={[0.3, 0.01, 0.4]} />
      </mesh>
      <mesh position={[0.22, 0.95, 0.275]} material={m.negro}>
        <boxGeometry args={[0.14, 0.08, 0.02]} />
      </mesh>
    </group>
  );
}

export function Tablero({ position, rot = 0, m }: { position: [number, number, number]; rot?: number; m: Mats }) {
  const notas = ['#fde68a', '#bfdbfe', '#bbf7d0', '#fecaca', '#e9d5ff', '#fde68a'];
  return (
    <group position={position} rotation={[0, rot, 0]}>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.75, 0]} material={m.aluminio}>
          <boxGeometry args={[0.05, 1.5, 0.05]} />
        </mesh>
      ))}
      <mesh position={[0, 1.4, 0]} material={m.madera} castShadow>
        <boxGeometry args={[1.2, 0.8, 0.04]} />
      </mesh>
      {notas.map((c, i) => (
        <mesh key={i} position={[-0.38 + (i % 3) * 0.38, 1.55 - Math.floor(i / 3) * 0.32, 0.025]}>
          <boxGeometry args={[0.22, 0.2, 0.005]} />
          <meshStandardMaterial color={c} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}
