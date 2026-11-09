import { useQuery } from '@tanstack/react-query';

/** Entorno de demostración (MODO_DEMO=true en el servidor): la interfaz lo advierte siempre. */
export function useModoDemo() {
  const q = useQuery<{ modo_demo?: boolean }>({
    queryKey: ['config-publica'],
    queryFn: () => fetch('/api/publico/config', { cache: 'no-store' }).then((r) => r.json()),
    staleTime: 10 * 60_000,
  });
  return !!q.data?.modo_demo;
}
