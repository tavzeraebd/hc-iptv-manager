import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDevices,
  updateDevice as apiUpdateDevice,
  deleteDevice as apiDeleteDevice,
  type DevicePatch,
  type DeviceStatus,
  type PortalDevice,
} from "@/lib/api";

const POLL_MS = 20 * 1000;

export function useDevices(enabled: boolean) {
  const [devices, setDevices] = useState<PortalDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await fetchDevices();
      setDevices(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dispositivos.");
    } finally {
      setLoading(false);
    }
  }, []);

  const patch = useCallback(async (mac: string, p: DevicePatch) => {
    const updated = await apiUpdateDevice(mac, p);
    setDevices((prev) => {
      const i = prev.findIndex((d) => d.mac === updated.mac);
      if (i === -1) return [updated, ...prev];
      const next = [...prev];
      next[i] = updated;
      return next;
    });
    return updated;
  }, []);

  const bind = useCallback((mac: string, boundServerId: string | null) => patch(mac, { boundServerId }), [patch]);
  const rename = useCallback((mac: string, name: string) => patch(mac, { name }), [patch]);
  const setStatus = useCallback((mac: string, status: DeviceStatus) => patch(mac, { status }), [patch]);

  const remove = useCallback(async (mac: string) => {
    await apiDeleteDevice(mac);
    setDevices((prev) => prev.filter((d) => d.mac !== mac));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      reload();
    }
    const id = setInterval(() => reload(true), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, reload]);

  return { devices, loading, error, reload, patch, bind, rename, setStatus, remove };
}
