import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import {
  fetchUsers,
  createUser as apiCreateUser,
  editUser as apiEditUser,
  removeUser as apiRemoveUser,
  checkUser as apiCheckUser,
  checkAllUsers as apiCheckAllUsers,
  clientCheckUser,
  importUsers as apiImportUsers,
  waitForEmbeddedBackend,
} from "@/lib/api";
import type { CheckResult, IptvUser, IptvUserWithCheck } from "@/lib/types";
import type { UserInput } from "@/lib/api";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

// No app nativo, checa o painel direto do aparelho (conexão residencial, a
// mesma dos Players dos clientes). Só cai pro check via portal se der erro de
// rede/CORS — o portal roda em IP de datacenter, que vários painéis (ex.:
// dns.explouddev.com) devolvem 404, marcando tudo OFFLINE por engano.
async function resolveCheck(u: IptvUser): Promise<CheckResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      return await clientCheckUser(u.host, u.username, u.password);
    } catch {
      /* rede/CORS/timeout no aparelho — tenta pelo portal */
    }
  }
  return apiCheckUser(u.id);
}

export function useIptvUsers() {
  const [users, setUsers] = useState<IptvUserWithCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const loadedOnce = useRef(false);
  const usersRef = useRef<IptvUserWithCheck[]>([]);
  usersRef.current = users;

  const checkOne = useCallback(async (user: IptvUser) => {
    const id = user.id;
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, checking: true } : u)));
    try {
      const check = await resolveCheck(user);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, check, checking: false } : u)));
    } catch {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, checking: false } : u)));
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      await waitForEmbeddedBackend();
      // O backend embarcado pode levar uma fração de segundo a mais para
      // começar a aceitar conexões depois do runtime ficar "pronto"; algumas
      // tentativas rápidas absorvem essa pequena janela sem exigir lógica
      // adicional de sincronização com o runtime Node.
      let data: Awaited<ReturnType<typeof fetchUsers>> | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 5 && data === null; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
        try {
          data = await fetchUsers();
        } catch (err) {
          lastError = err;
        }
      }
      if (data === null) throw lastError;
      setUsers(data.map((u) => ({ ...u, check: null, checking: true })));
      data.forEach((u) => {
        checkOne(u);
      });
    } catch {
      toast.error("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, [checkOne]);

  const refreshAll = useCallback(async () => {
    if (usersRef.current.length === 0) return;
    setRefreshingAll(true);
    setUsers((prev) => prev.map((u) => ({ ...u, checking: true })));
    try {
      let results: { id: string; check: CheckResult }[];
      if (Capacitor.isNativePlatform()) {
        // Checa cada painel direto do aparelho, em paralelo (é o que os
        // Players dos clientes fazem). resolveCheck já cai pro portal se
        // o aparelho não conseguir falar com o painel.
        const snapshot = usersRef.current;
        results = await Promise.all(
          snapshot.map(async (u) => ({ id: u.id, check: await resolveCheck(u) }))
        );
      } else {
        results = await apiCheckAllUsers();
      }
      setUsers((prev) =>
        prev.map((u) => {
          const result = results.find((r) => r.id === u.id);
          return result ? { ...u, check: result.check, checking: false } : { ...u, checking: false };
        })
      );
      toast.success("Status atualizados.");
    } catch {
      toast.error("Não foi possível atualizar os status.");
      setUsers((prev) => prev.map((u) => ({ ...u, checking: false })));
    } finally {
      setRefreshingAll(false);
    }
  }, []);

  const addUser = useCallback(async (input: UserInput) => {
    const created = await apiCreateUser(input);
    setUsers((prev) => [...prev, { ...created, checking: false }]);
  }, []);

  const importUsers = useCallback(
    async (inputs: UserInput[]) => {
      const { added, skipped } = await apiImportUsers(inputs);
      setUsers((prev) => [...prev, ...added.map((u) => ({ ...u, check: null, checking: true }))]);
      added.forEach((u) => {
        checkOne(u);
      });
      return { added: added.length, skipped };
    },
    [checkOne]
  );

  const updateUser = useCallback(async (id: string, input: UserInput) => {
    const updated = await apiEditUser(id, input);
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...updated, checking: false } : u)));
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    await apiRemoveUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAll();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refreshAll]);

  return {
    users,
    loading,
    refreshingAll,
    refreshAll,
    checkOne,
    addUser,
    updateUser,
    deleteUser,
    importUsers,
  };
}
