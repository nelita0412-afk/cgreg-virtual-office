import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';

/* ------------------------------------------------------------------------------------------------
 * App instalable (PWA): registro del service worker, instalación, actualización y notificaciones push.
 * El service worker solo guarda la interfaz; los datos (/api) nunca pasan por su caché.
 * ---------------------------------------------------------------------------------------------- */

type EventoInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

type EstadoPwa = {
  registro: ServiceWorkerRegistration | null;
  esperando: ServiceWorker | null; // nueva versión lista para activarse
  instalacion: EventoInstalacion | null; // Android/escritorio (Chromium)
};

let estado: EstadoPwa = { registro: null, esperando: null, instalacion: null };
const subs = new Set<() => void>();
const actualizar = (parcial: Partial<EstadoPwa>) => {
  estado = { ...estado, ...parcial };
  subs.forEach((f) => f());
};
const suscribir = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const usePwa = () => useSyncExternalStore(suscribir, () => estado);

/** Navegación pedida por el service worker al tocar una notificación push. */
let navegarDesdeSw: ((enlace: string) => void) | null = null;
export const alNavegarDesdeNotificacion = (fn: (enlace: string) => void) => {
  navegarDesdeSw = fn;
};

export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    actualizar({ instalacion: e as EventoInstalacion });
  });
  window.addEventListener('appinstalled', () => actualizar({ instalacion: null }));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'navegar' && typeof e.data.enlace === 'string' && e.data.enlace.startsWith('/')) navegarDesdeSw?.(e.data.enlace);
  });
  // Solo se recarga al reemplazar una versión anterior (botón «Actualizar»). En la primera visita el service
  // worker toma el control sin recargar: recargar ahí interrumpiría a quien está escribiendo (p. ej. al ingresar).
  const habiaVersionAnterior = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !habiaVersionAnterior) return;
    recargando = true;
    window.location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      actualizar({ registro: reg, esperando: reg.waiting && navigator.serviceWorker.controller ? reg.waiting : null });
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) actualizar({ esperando: nuevo });
        });
      });
      // Busca versiones nuevas al volver a la app (las apps instaladas pueden quedar abiertas días).
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    } catch {
      /* sin service worker la plataforma sigue funcionando en el navegador */
    }
  });
}

const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const esAppInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Instalación: en Android/Chrome muestra el diálogo del sistema; en iPhone hay que usar «Compartir → Agregar a inicio». */
export function useInstalacion() {
  const { instalacion } = usePwa();
  const [instalada, setInstalada] = useState(esAppInstalada);
  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const f = () => setInstalada(esAppInstalada());
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const instalar = useCallback(async () => {
    if (!instalacion) return false;
    await instalacion.prompt();
    const r = await instalacion.userChoice;
    actualizar({ instalacion: null });
    return r.outcome === 'accepted';
  }, [instalacion]);
  return { instalada, puedeInstalar: !!instalacion, requiereGuiaIos: !instalada && esIos(), instalar };
}

export function useActualizacion() {
  const { esperando } = usePwa();
  return { disponible: !!esperando, aplicar: () => esperando?.postMessage('SKIP_WAITING') };
}

/* ------------------------------------ Notificaciones push ------------------------------------ */
const base64AUint8 = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export type EstadoPush = 'no_disponible' | 'no_configurado' | 'bloqueado' | 'inactivo' | 'activo' | 'cargando';

export function usePush() {
  const { registro } = usePwa();
  const [estadoPush, setEstado] = useState<EstadoPush>('cargando');
  const [clave, setClave] = useState<string | null>(null);

  const revisar = useCallback(async () => {
    if (!registro || !('PushManager' in window) || !('Notification' in window)) return setEstado('no_disponible');
    const r = await api.get<{ activo: boolean; clave: string | null }>('/api/push/clave').catch(() => null);
    if (!r?.activo || !r.clave) return setEstado('no_configurado');
    setClave(r.clave);
    if (Notification.permission === 'denied') return setEstado('bloqueado');
    const sub = await registro.pushManager.getSubscription();
    setEstado(sub ? 'activo' : 'inactivo');
  }, [registro]);

  useEffect(() => {
    void revisar();
  }, [revisar]);

  const activar = useCallback(async () => {
    if (!registro || !clave) return;
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return setEstado(permiso === 'denied' ? 'bloqueado' : 'inactivo');
    const sub = (await registro.pushManager.getSubscription()) ?? (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(clave) }));
    await api.post('/api/push/suscribir', sub.toJSON());
    setEstado('activo');
  }, [registro, clave]);

  const desactivar = useCallback(async () => {
    const sub = await registro?.pushManager.getSubscription();
    if (sub) {
      await api.post('/api/push/anular', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setEstado('inactivo');
  }, [registro]);

  /** Pide al servidor un aviso de prueba para las suscripciones de esta cuenta. */
  const probar = useCallback(async () => {
    const r = await api.post<{ enviadas: number; fallidas: number }>('/api/push/prueba');
    return r;
  }, []);

  return { estado: estadoPush, activar, desactivar, probar };
}

/** Al cerrar sesión, el teléfono deja de recibir avisos de esa cuenta. */
export async function anularPushDeEsteDispositivo() {
  const sub = await estado.registro?.pushManager?.getSubscription().catch(() => null);
  if (!sub) return;
  await api.post('/api/push/anular', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/* ------------------------------------------ Conexión ------------------------------------------ */
export function useEnLinea() {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener('online', f);
      window.addEventListener('offline', f);
      return () => {
        window.removeEventListener('online', f);
        window.removeEventListener('offline', f);
      };
    },
    () => navigator.onLine,
  );
}

/** Pantallas de teléfono y tableta vertical: navegación inferior y vistas compactas. */
export function useEsMovil(ancho = 1023) {
  return useSyncExternalStore(
    (f) => {
      const mq = window.matchMedia(`(max-width: ${ancho}px)`);
      mq.addEventListener('change', f);
      return () => mq.removeEventListener('change', f);
    },
    () => window.matchMedia(`(max-width: ${ancho}px)`).matches,
  );
}
