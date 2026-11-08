import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, esErrorDeRed, onAuthError } from './api';
import { realtime } from './realtime';
import { can, type Permiso } from '@shared/permissions';
import type { Rol, Especialidad } from '@shared/domain';

export interface Me {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  profesional_id: string | null;
  especialidad: Especialidad | null;
  es_teleatencion: boolean;
  debe_cambiar_password: boolean;
  emergencia_texto: string;
}

const Ctx = createContext<{ me: Me | null; loading: boolean; sinConexion: boolean; refetch: () => void }>({ me: null, loading: true, sinConexion: false, refetch: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me | null>('/api/auth/me'), retry: false, staleTime: 60_000 });
  const me = q.data ?? null;
  // Sin señal al abrir la app no se sabe si hay sesión: se informa la falta de conexión en lugar de pedir ingresar.
  const sinConexion = !q.data && (esErrorDeRed(q.error) || q.fetchStatus === 'paused');

  useEffect(() => onAuthError(() => qc.setQueryData<Me | null>(['me'], null)), [qc]);
  useEffect(() => {
    realtime.onUnauthorized = () => qc.invalidateQueries({ queryKey: ['me'] });
    if (me && !me.debe_cambiar_password) realtime.start(qc);
    else realtime.stop();
  }, [me, qc]);

  // Mantiene viva la sesión solo ante actividad real del usuario (el heartbeat no extiende la sesión).
  const last = useRef(0);
  useEffect(() => {
    if (!me) return;
    const f = () => {
      if (Date.now() - last.current > 4 * 60_000) {
        last.current = Date.now();
        api.post('/api/auth/ping').catch(() => {});
      }
    };
    window.addEventListener('pointerdown', f);
    window.addEventListener('keydown', f);
    return () => {
      window.removeEventListener('pointerdown', f);
      window.removeEventListener('keydown', f);
    };
  }, [me]);

  return <Ctx.Provider value={{ me, loading: q.isLoading, sinConexion, refetch: () => q.refetch() }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export function useCan(p: Permiso) {
  const { me } = useAuth();
  return can(me?.rol, p);
}
