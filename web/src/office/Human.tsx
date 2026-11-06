import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ESTADO_PRESENCIA_COLOR, type PresenciaSnapshot } from '@shared/domain';
import { ENTRADA, SIN_PASEO, elegirParada, ruta, type Parada, type Pose, type Slot, type V2 } from './layout';

/** Posición viva de cada avatar (la usan las etiquetas inteligentes y las pruebas visuales). */
export const registroAvatares = new Map<string, { x: number; z: number; visible: boolean; caminando: boolean; sentado: number; pose: string; paseo: boolean }>();

// ---------- Apariencia (estilo profesional por persona; colores desde el registro profesional) ----------
interface Estilo {
  pelo: 'corto' | 'largo' | 'mono' | 'ondulado';
  lentes: boolean;
  bata: boolean; // personal clínico (Psicología y Medicina)
  saco: string; // color de la prenda superior
  camisa: string;
  pantalon: string;
}
const ESTILOS: Record<string, Partial<Estilo>> = {
  'gabriel-ordonez': { pelo: 'corto', saco: '#1e3a6e', camisa: '#e8eef8' },
  'maria-alcivar': { pelo: 'largo', lentes: true, saco: '#f1f5f9', camisa: '#cbd5e1', pantalon: '#334155' },
  'hugo-cuenca': { pelo: 'corto', lentes: true, saco: '#0f5e5a', camisa: '#e2e8f0' },
  'sofia-guerra': { pelo: 'mono', saco: '#e7e5e4', camisa: '#a8a29e' },
  'betsabe-cordova': { pelo: 'ondulado', saco: '#5b3fa0', camisa: '#ede9fe' },
  'zally-pamela': { pelo: 'largo', saco: '#9d2a5c', camisa: '#fce7f3' },
  'demetrio-magallanes': { pelo: 'corto', camisa: '#93c5fd' },
  'diego-estrella': { pelo: 'corto', lentes: true, camisa: '#1e3a8a' },
  'andrea-mayorga': { pelo: 'mono', saco: '#c2410c', camisa: '#ffedd5' },
};
const PIELES = ['#c58c6a', '#a8714f', '#d9a07c', '#8d5a3b', '#e0ac85', '#b67b58'];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------- Geometrías compartidas (memoria) ----------
const G = {
  muslo: new THREE.CapsuleGeometry(0.075, 0.3, 6, 12),
  pierna: new THREE.CapsuleGeometry(0.058, 0.32, 6, 12),
  pie: new THREE.BoxGeometry(0.1, 0.07, 0.25),
  cadera: new THREE.CapsuleGeometry(0.13, 0.06, 6, 16),
  torso: new THREE.CapsuleGeometry(0.15, 0.26, 8, 18),
  saco: new THREE.CapsuleGeometry(0.162, 0.25, 8, 18),
  bata: new THREE.CylinderGeometry(0.17, 0.21, 0.78, 18, 1, true),
  brazo: new THREE.CapsuleGeometry(0.055, 0.2, 6, 12),
  antebrazo: new THREE.CapsuleGeometry(0.047, 0.19, 6, 12),
  mano: new THREE.SphereGeometry(0.048, 12, 10),
  cuello: new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12),
  cabeza: new THREE.SphereGeometry(0.105, 24, 20),
  pelo: new THREE.SphereGeometry(0.113, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
  peloLargo: new THREE.CapsuleGeometry(0.1, 0.18, 6, 14),
  mono: new THREE.SphereGeometry(0.058, 14, 12),
  ojo: new THREE.SphereGeometry(0.011, 8, 6),
  ceja: new THREE.BoxGeometry(0.03, 0.006, 0.006),
  nariz: new THREE.ConeGeometry(0.013, 0.035, 8),
  oreja: new THREE.SphereGeometry(0.02, 8, 8),
  lente: new THREE.TorusGeometry(0.024, 0.0035, 6, 18),
  puente: new THREE.BoxGeometry(0.022, 0.004, 0.004),
  credencial: new THREE.BoxGeometry(0.06, 0.085, 0.01),
  cuelloCamisa: new THREE.ConeGeometry(0.07, 0.09, 3),
  anillo: new THREE.RingGeometry(0.38, 0.5, 40),
  boligrafo: new THREE.CylinderGeometry(0.008, 0.008, 0.075, 8),
  estetoscopio: new THREE.TorusGeometry(0.105, 0.009, 6, 24, Math.PI * 1.15),
  campana: new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14),
  solapa: new THREE.BoxGeometry(0.035, 0.26, 0.012),
  disco: new THREE.CircleGeometry(0.75, 40),
};

const SPEED = 3.2; // m/s ante eventos reales (acelerado para que el traslado se perciba sin tardar demasiado)
const SPEED_PASEO = 1.7; // m/s en paseos ambientales (andar tranquilo)
const SENTADO: Pose[] = ['sentado_trabajo', 'sentado_teclear', 'sentado_conversar', 'sentado_relajado'];

interface Props {
  p: PresenciaSnapshot;
  slot: Slot | null;
  seleccionado: boolean;
  onSelect: (pos: V2) => void;
  reducirMovimiento: boolean;
  sombras: boolean;
  /** Paseos breves mientras no atiende (no cambian el estado real). */
  ambiente?: boolean;
}

/**
 * Avatar humano articulado. El destino y la postura dependen EXCLUSIVAMENTE del estado real informado por el
 * backend: al cambiar la zona se levanta, recorre los pasillos, entra por la puerta y adopta la postura de la
 * actividad (consulta, documentación, reunión…). Si se desconecta, sale por la entrada.
 */
export function Human({ p, slot, seleccionado, onSelect, reducirMovimiento, sombras, ambiente = false }: Props) {
  const R = {
    root: useRef<THREE.Group>(null!),
    pelvis: useRef<THREE.Group>(null!),
    torso: useRef<THREE.Group>(null!),
    cabeza: useRef<THREE.Group>(null!),
    musloI: useRef<THREE.Group>(null!),
    musloD: useRef<THREE.Group>(null!),
    rodillaI: useRef<THREE.Group>(null!),
    rodillaD: useRef<THREE.Group>(null!),
    hombroI: useRef<THREE.Group>(null!),
    hombroD: useRef<THREE.Group>(null!),
    codoI: useRef<THREE.Group>(null!),
    codoD: useRef<THREE.Group>(null!),
    anillo: useRef<THREE.Mesh>(null!),
  };
  const seed = useMemo(() => (hash(p.clave) % 1000) / 1000, [p.clave]);
  const estilo: Estilo = useMemo(
    () => {
      const e: Estilo = { pelo: 'corto', lentes: false, bata: false, saco: p.color ?? '#0e7490', camisa: '#e2e8f0', pantalon: '#1f2937', ...(ESTILOS[p.profesional_id ?? ''] ?? {}) };
      // Bata blanca para todo el personal clínico: psicólogas/os y médicos (Telemedicina y Psiquiatría).
      if (p.especialidad) {
        e.bata = true;
        e.saco = '#f5f7fa';
      }
      return e;
    },
    [p.profesional_id, p.color, p.especialidad],
  );
  const mat = useMemo(() => {
    const m = (color: string, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    return {
      piel: m(PIELES[hash(p.clave) % PIELES.length], 0.55),
      pelo: m(p.cabello ?? '#2b1d14', 0.85),
      saco: m(estilo.saco, estilo.bata ? 0.6 : 0.8),
      camisa: m(estilo.camisa, 0.7),
      pantalon: m(estilo.pantalon, 0.85),
      zapato: m('#111827', 0.4),
      oscuro: new THREE.MeshBasicMaterial({ color: '#111827' }),
      lente: new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.7, roughness: 0.3 }),
      credencial: m('#e0f2fe', 0.4),
      solapa: m('#e2e8f0', 0.6),
      boligrafo: m('#1d4ed8', 0.3),
      estetoscopio: m('#1f2937', 0.5),
      metal: new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.9, roughness: 0.25 }),
      estado: new THREE.MeshBasicMaterial({ color: ESTADO_PRESENCIA_COLOR[p.estado], transparent: true, opacity: 0.9, depthWrite: false }),
      sel: new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.22, depthWrite: false }),
    };
  }, [p.clave, p.cabello, estilo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    mat.estado.color.set(ESTADO_PRESENCIA_COLOR[p.estado]);
  }, [p.estado, mat]);

  const st = useRef({
    pos: (slot?.pos ?? ENTRADA) as V2,
    path: [] as V2[],
    pendiente: null as V2[] | null,
    visible: !!slot,
    rot: slot?.rot ?? 0,
    rotTarget: slot?.rot ?? 0,
    sit: slot && SENTADO.includes(slot.pose) ? 1 : 0,
    sitTarget: slot && SENTADO.includes(slot.pose) ? 1 : 0,
    pose: (slot?.pose ?? 'de_pie') as Pose,
    puertaActual: slot?.puerta as V2 | undefined,
    init: false,
    /** Paseo ambiental en curso: ida → acción → vuelta. Un evento real lo cancela. */
    paseo: null as null | { fase: 'ida' | 'accion' | 'vuelta'; parada: Parada; hasta: number },
    proximo: -1,
  });

  useEffect(() => {
    const s = st.current;
    // Un cambio real de estado o de lugar tiene prioridad sobre cualquier paseo ambiental.
    if (s.paseo) s.puertaActual = undefined; // estaba fuera de su puesto: la ruta parte del pasillo
    s.paseo = null;
    s.proximo = -1;
    if (!s.init) {
      // Carga inicial = recuperación de estado: se ubica sin simular desplazamientos que no ocurrieron ahora.
      s.init = true;
      return;
    }
    const destino = slot?.pos ?? ENTRADA;
    if (!s.visible) {
      if (!slot) return;
      s.pos = ENTRADA;
      s.visible = true;
      s.sit = 0;
      s.puertaActual = undefined;
    }
    const camino = ruta(s.pos, destino, s.puertaActual, slot?.puerta);
    if (reducirMovimiento) {
      s.pos = destino;
      s.path = [];
      s.pendiente = null;
      s.visible = !!slot;
      s.rot = s.rotTarget = slot?.rot ?? 0;
      s.pose = slot?.pose ?? 'de_pie';
      s.sit = s.sitTarget = slot && SENTADO.includes(slot.pose) ? 1 : 0;
      s.puertaActual = slot?.puerta;
      return;
    }
    // Primero se levanta; luego camina.
    s.pendiente = camino;
    s.sitTarget = 0;
    s.pose = slot?.pose ?? 'de_pie';
    s.rotTarget = slot?.rot ?? Math.PI;
    s.puertaActual = slot?.puerta;
  }, [slot?.pos[0], slot?.pos[1], slot?.rot, slot?.pose, !!slot, reducirMovimiento]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dtRaw) => {
    const s = st.current;
    const g = R.root.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.5); // basado en tiempo real: la velocidad no depende de los FPS
    g.visible = s.visible;
    const tc = state.clock.elapsedTime;
    const volver = () => {
      if (!slot || !s.paseo) return;
      s.paseo.fase = 'vuelta';
      s.pendiente = ruta(s.pos, slot.pos, undefined, slot.puerta);
      s.rotTarget = slot.rot;
      s.puertaActual = slot.puerta;
    };
    const elegible = ambiente && !reducirMovimiento && !!slot && s.visible && !SIN_PASEO.has(p.estado) && slot.pose !== 'de_pie_presentar';
    if (!elegible && s.paseo && s.paseo.fase !== 'vuelta') volver();
    if (elegible && slot && !s.paseo && !s.path.length && !s.pendiente && Math.abs(s.sit - s.sitTarget) < 0.02) {
      // Espera en su puesto antes del siguiente paseo: más larga si está documentando.
      if (s.proximo < 0) s.proximo = tc + (p.estado === 'en_documentacion' ? 18 + Math.random() * 17 : 6 + Math.random() * 8);
      else if (tc >= s.proximo) {
        const parada = elegirParada(slot, p.estado, Math.random());
        s.paseo = { fase: 'ida', parada, hasta: 0 };
        s.pendiente = ruta(s.pos, parada.pos, s.puertaActual, undefined);
        s.sitTarget = 0;
        s.rotTarget = parada.rot;
        s.puertaActual = undefined;
      }
    }
    if (s.paseo?.fase === 'accion' && tc >= s.paseo.hasta) volver();
    if (s.pendiente && s.sit < 0.05) {
      s.path = s.pendiente;
      s.pendiente = null;
    }
    let moving = false;
    if (s.path.length && s.sit < 0.05) {
      let step = dt * (s.paseo ? SPEED_PASEO : SPEED);
      while (step > 0 && s.path.length) {
        const [tx, tz] = s.path[0];
        const dx = tx - s.pos[0];
        const dz = tz - s.pos[1];
        const dist = Math.hypot(dx, dz);
        if (dist <= step) {
          s.pos = [tx, tz];
          s.path.shift();
          step -= dist;
        } else {
          s.pos = [s.pos[0] + (dx / dist) * step, s.pos[1] + (dz / dist) * step];
          s.rot = lerpAngle(s.rot, Math.atan2(dx, dz), Math.min(1, dt * 10));
          step = 0;
          moving = true;
        }
      }
      if (!s.path.length) {
        if (!slot) s.visible = false; // salió por la entrada
        else if (s.paseo?.fase === 'ida') {
          s.paseo.fase = 'accion';
          s.paseo.hasta = tc + 3.5 + Math.random() * 3.5;
          s.sitTarget = 0;
        } else {
          s.paseo = null;
          s.proximo = -1;
          s.sitTarget = SENTADO.includes(slot.pose) ? 1 : 0;
        }
      }
    }
    if (!moving && !s.path.length && !s.pendiente) s.rot = lerpAngle(s.rot, s.rotTarget, Math.min(1, dt * 6));
    // Sentarse / levantarse (solo cuando está quieto y orientado)
    const listo = !moving && !s.path.length && Math.abs(angDiff(s.rot, s.rotTarget)) < 0.15;
    const objetivo = s.pendiente ? 0 : listo ? s.sitTarget : 0;
    s.sit += Math.sign(objetivo - s.sit) * Math.min(Math.abs(objetivo - s.sit), dt * 2.4);

    g.position.set(s.pos[0], 0, s.pos[1]);
    g.rotation.y = s.rot;

    // ---------------- Animación de esqueleto ----------------
    const t = state.clock.elapsedTime + seed * 10;
    const quieto = reducirMovimiento ? 0 : 1;
    const sit = s.sit;
    const walk = moving ? 1 : 0;
    const ph = t * 7.5;
    const sw = Math.sin(ph) * 0.55 * walk;
    // Pelvis: altura y respiración
    R.pelvis.current.position.y = THREE.MathUtils.lerp(0.92, 0.5, sit) + (moving ? Math.abs(Math.sin(ph)) * 0.035 : 0);
    R.pelvis.current.position.z = -0.08 * sit;
    // Piernas: caminar o sentado
    R.musloI.current.rotation.x = sw - 1.5 * sit;
    R.musloD.current.rotation.x = -sw - 1.5 * sit;
    R.rodillaI.current.rotation.x = Math.max(0, -Math.sin(ph)) * 0.9 * walk + 1.5 * sit;
    R.rodillaD.current.rotation.x = Math.max(0, Math.sin(ph)) * 0.9 * walk + 1.5 * sit;
    // Torso y cabeza
    const resp = Math.sin(t * 1.7) * 0.012 * quieto;
    let torsoX = moving ? 0.06 : 0;
    let cabX = 0;
    let cabY = 0;
    let hI = { x: -sw * 0.8, z: 0.08 };
    let hD = { x: sw * 0.8, z: -0.08 };
    let cI = moving ? -0.25 : -0.1;
    let cD = moving ? -0.25 : -0.1;
    const pose = s.path.length || s.pendiente ? 'de_pie' : s.paseo ? 'de_pie' : s.pose;
    const accion = !moving && s.paseo?.fase === 'accion' ? s.paseo.parada.accion : null;
    if (!moving && sit > 0.5) {
      if (pose === 'sentado_teclear' || pose === 'sentado_trabajo') {
        // Manos sobre el teclado; tecleo (documentación) o uso ocasional del ratón y giro de cabeza.
        const tecleo = pose === 'sentado_teclear' ? 1 : 0.35;
        hI = { x: -0.75 + Math.sin(t * 13) * 0.05 * tecleo * quieto, z: 0.15 };
        hD = { x: -0.75 + Math.sin(t * 11 + 1) * 0.05 * tecleo * quieto, z: -0.15 };
        cI = -0.95;
        cD = -0.95;
        torsoX = 0.12;
        cabX = 0.18;
        const mirar = Math.sin(t * 0.35) > 0.82 ? Math.sin(t * 0.35 * 6) * 0.5 : 0;
        cabY = (pose === 'sentado_trabajo' ? mirar : 0) * quieto;
        // De vez en cuando se recuesta y estira los brazos (pausa activa breve en su silla).
        const estira = Math.max(0, Math.sin(t * 0.21 + seed * 9) - 0.9) * 10 * quieto;
        if (estira > 0) {
          hI = { x: THREE.MathUtils.lerp(hI.x, -2.7, estira), z: 0.3 };
          hD = { x: THREE.MathUtils.lerp(hD.x, -2.7, estira), z: -0.3 };
          cI = THREE.MathUtils.lerp(cI, -0.2, estira);
          cD = THREE.MathUtils.lerp(cD, -0.2, estira);
          torsoX = THREE.MathUtils.lerp(torsoX, -0.15, estira);
          cabX = THREE.MathUtils.lerp(cabX, -0.2, estira);
        }
      } else if (pose === 'sentado_conversar') {
        // Consulta / reunión: asiente, gesticula con una mano, mira al interlocutor o la pantalla.
        const gesto = Math.max(0, Math.sin(t * 0.9)) * quieto;
        hI = { x: -0.45, z: 0.12 };
        hD = { x: -0.5 - gesto * 0.7, z: -0.25 - gesto * 0.25 };
        cI = -1.1;
        cD = -1.2 - gesto * 0.4;
        torsoX = 0.05 + Math.sin(t * 0.6) * 0.04 * quieto;
        cabX = Math.sin(t * 2.2) * 0.06 * quieto;
        cabY = Math.sin(t * 0.45) * 0.25 * quieto;
      } else if (pose === 'sentado_relajado') {
        hI = { x: -0.25, z: 0.35 };
        hD = { x: -0.25, z: -0.35 };
        cI = -0.6;
        cD = -0.6;
        torsoX = -0.18;
        cabY = Math.sin(t * 0.3) * 0.4 * quieto;
      }
    } else if (accion) {
      // Acciones del paseo ambiental, de pie frente al punto de interés.
      if (accion === 'beber') {
        const k = Math.max(0, Math.sin(t * 1.2)) * quieto;
        hD = { x: -0.9 - 0.55 * k, z: -0.12 };
        cD = -1.5 - 0.7 * k;
        hI = { x: 0.05, z: 0.1 };
        cabX = -0.15 * k;
      } else if (accion === 'imprimir') {
        hI = { x: -0.75, z: 0.12 };
        hD = { x: -0.75 + Math.sin(t * 3) * 0.08 * quieto, z: -0.12 };
        cI = -0.55;
        cD = -0.6;
        cabX = 0.35;
        torsoX = 0.15;
      } else if (accion === 'leer') {
        hI = { x: 0.1, z: 0.06 };
        hD = { x: -0.45, z: -0.12 };
        cD = -1.75; // mano en el mentón
        cabX = -0.1;
        cabY = Math.sin(t * 0.6) * 0.35 * quieto;
      } else {
        const k = ((Math.sin(t * 1.1) + 1) / 2) * quieto;
        hI = { x: -2.6 * k, z: 0.28 };
        hD = { x: -2.6 * k, z: -0.28 };
        cI = -0.3 * k;
        cD = -0.3 * k;
        torsoX = -0.1 * k;
        cabX = -0.15 * k;
      }
    } else if (!moving && pose === 'de_pie_presentar') {
      // Facilitador: señala la pantalla y gira hacia el público.
      const g2 = (Math.sin(t * 0.8) + 1) / 2;
      hD = { x: -1.2 * g2 - 0.3, z: -0.5 };
      cD = -0.4;
      hI = { x: -0.3 * quieto, z: 0.1 };
      cI = -0.5;
      cabY = (g2 - 0.5) * 0.7 * quieto;
      R.torso.current.rotation.y = (g2 - 0.5) * 0.4 * quieto;
    } else if (!moving) {
      // De pie, reposo: respiración y cambio de peso.
      hI = { x: 0.05, z: 0.1 };
      hD = { x: 0.05, z: -0.1 };
      cabY = Math.sin(t * 0.4) * 0.3 * quieto;
    }
    if (pose !== 'de_pie_presentar') R.torso.current.rotation.y = 0;
    R.torso.current.rotation.x = torsoX;
    R.torso.current.scale.set(1 + resp, 1 + resp * 0.5, 1 + resp);
    R.cabeza.current.rotation.x = cabX;
    R.cabeza.current.rotation.y = cabY;
    R.hombroI.current.rotation.set(hI.x, 0, -hI.z);
    R.hombroD.current.rotation.set(hD.x, 0, -hD.z);
    R.codoI.current.rotation.x = cI;
    R.codoD.current.rotation.x = cD;
    if (R.anillo.current) {
      const pulso = (p.estado === 'en_consulta' || p.estado === 'en_reunion') && !reducirMovimiento ? 1 + Math.sin(t * 3) * 0.06 : 1;
      R.anillo.current.scale.setScalar(seleccionado ? 1.25 : pulso);
    }
    registroAvatares.set(p.clave, { x: s.pos[0], z: s.pos[1], visible: s.visible, caminando: moving, sentado: sit, pose: accion ? `paseo:${accion}` : pose, paseo: !!s.paseo });
  });
  useEffect(() => () => void registroAvatares.delete(p.clave), [p.clave]);

  const sh = sombras;
  const pierna = (lado: 1 | -1, muslo: React.RefObject<THREE.Group>, rodilla: React.RefObject<THREE.Group>) => (
    <group ref={muslo} position={[0.095 * lado, -0.02, 0]}>
      <mesh geometry={G.muslo} material={estilo.bata ? mat.pantalon : mat.pantalon} position={[0, -0.21, 0]} castShadow={sh} />
      <group ref={rodilla} position={[0, -0.43, 0]}>
        <mesh geometry={G.pierna} material={mat.pantalon} position={[0, -0.2, 0]} castShadow={sh} />
        <mesh geometry={G.pie} material={mat.zapato} position={[0, -0.42, 0.05]} castShadow={sh} />
      </group>
    </group>
  );
  const brazo = (lado: 1 | -1, hombro: React.RefObject<THREE.Group>, codo: React.RefObject<THREE.Group>) => (
    <group ref={hombro} position={[0.215 * lado, 0.5, 0]}>
      <mesh geometry={G.brazo} material={mat.saco} position={[0, -0.14, 0]} castShadow={sh} />
      <group ref={codo} position={[0, -0.28, 0]}>
        <mesh geometry={G.antebrazo} material={mat.saco} position={[0, -0.12, 0]} castShadow={sh} />
        <mesh geometry={G.mano} material={mat.piel} position={[0, -0.27, 0]} />
      </group>
    </group>
  );

  return (
    <group
      ref={R.root}
      position={[st.current.pos[0], 0, st.current.pos[1]]}
      rotation={[0, st.current.rot, 0]}
      visible={st.current.visible}
      scale={1.3}
      onClick={(e) => {
        e.stopPropagation();
        onSelect([st.current.pos[0], st.current.pos[1]]);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh ref={R.anillo} geometry={G.anillo} material={mat.estado} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={2} />
      {seleccionado && <mesh geometry={G.disco} material={mat.sel} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} renderOrder={1} />}
      <group ref={R.pelvis} position={[0, 0.92, 0]}>
        {pierna(-1, R.musloI, R.rodillaI)}
        {pierna(1, R.musloD, R.rodillaD)}
        <mesh geometry={G.cadera} material={mat.pantalon} position={[0, 0.02, 0]} scale={[1.2, 1, 0.9]} castShadow={sh} />
        <group ref={R.torso}>
          <mesh geometry={G.torso} material={mat.camisa} position={[0, 0.31, 0]} scale={[1.22, 1, 0.8]} castShadow={sh} />
          {estilo.bata ? (
            <>
              <mesh geometry={G.bata} material={mat.saco} position={[0, 0.15, -0.005]} scale={[1.18, 1, 0.82]} castShadow={sh} />
              {[-1, 1].map((l) => (
                <mesh key={l} geometry={G.solapa} material={mat.solapa} position={[0.055 * l, 0.42, 0.142]} rotation={[0.12, 0, 0.32 * l]} />
              ))}
              <mesh geometry={G.boligrafo} material={mat.boligrafo} position={[-0.11, 0.37, 0.147]} />
              {p.especialidad && p.especialidad !== 'psicologia' && (
                <>
                  <mesh geometry={G.estetoscopio} material={mat.estetoscopio} position={[0, 0.5, 0.06]} rotation={[Math.PI * 0.42, 0, Math.PI * 1.43]} />
                  <mesh geometry={G.campana} material={mat.metal} position={[0.06, 0.33, 0.15]} rotation={[Math.PI / 2, 0, 0]} />
                </>
              )}
            </>
          ) : (
            <mesh geometry={G.saco} material={mat.saco} position={[0, 0.3, -0.012]} scale={[1.24, 1, 0.8]} castShadow={sh} />
          )}
          {/* cuello de camisa visible en el escote del saco */}
          <mesh geometry={G.cuelloCamisa} material={mat.camisa} position={[0, 0.5, 0.11]} rotation={[Math.PI * 0.6, 0, 0]} scale={[1, 1, 0.4]} />
          <mesh geometry={G.credencial} material={mat.credencial} position={[0.09, 0.36, 0.135]} />
          {brazo(-1, R.hombroI, R.codoI)}
          {brazo(1, R.hombroD, R.codoD)}
          <mesh geometry={G.cuello} material={mat.piel} position={[0, 0.62, 0]} />
          <group ref={R.cabeza} position={[0, 0.77, 0]}>
            <mesh geometry={G.cabeza} material={mat.piel} scale={[0.92, 1.08, 0.98]} castShadow={sh} />
            <mesh geometry={G.pelo} material={mat.pelo} position={[0, 0.018, -0.008]} rotation={[-0.25, 0, 0]} scale={[0.96, 1.05, 1.02]} />
            {(estilo.pelo === 'largo' || estilo.pelo === 'ondulado') && (
              <mesh geometry={G.peloLargo} material={mat.pelo} position={[0, -0.09, -0.06]} scale={[estilo.pelo === 'ondulado' ? 1.25 : 1.08, 1, 0.55]} />
            )}
            {estilo.pelo === 'mono' && <mesh geometry={G.mono} material={mat.pelo} position={[0, 0.05, -0.115]} />}
            {[-1, 1].map((l) => (
              <group key={l}>
                <mesh geometry={G.ojo} material={mat.oscuro} position={[0.036 * l, 0.012, 0.094]} />
                <mesh geometry={G.ceja} material={mat.pelo} position={[0.036 * l, 0.04, 0.095]} />
                <mesh geometry={G.oreja} material={mat.piel} position={[0.098 * l, 0, 0]} scale={[0.5, 1, 0.8]} />
                {estilo.lentes && <mesh geometry={G.lente} material={mat.lente} position={[0.036 * l, 0.012, 0.104]} />}
              </group>
            ))}
            {estilo.lentes && <mesh geometry={G.puente} material={mat.lente} position={[0, 0.014, 0.106]} />}
            <mesh geometry={G.nariz} material={mat.piel} position={[0, -0.012, 0.104]} rotation={[Math.PI / 2, 0, 0]} />
          </group>
        </group>
      </group>
    </group>
  );
}

function angDiff(a: number, b: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function lerpAngle(a: number, b: number, t: number) {
  return a + angDiff(a, b) * t;
}
