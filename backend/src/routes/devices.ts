import { Router, Request, Response } from "express";
import { findUser } from "../storage";
import {
  readDevices,
  findDevice,
  upsertFromHeartbeat,
  updateDevice,
  deleteDevice,
  normalizeMac,
  accessOf,
  isExpired,
  type Device,
} from "../deviceStore";

const router = Router();

interface ServerCreds {
  host: string;
  username: string;
  password: string;
}

// Monta a resposta pública do device + (quando liberado E dentro da validade)
// as credenciais das linhas vinculadas, pra o Player conectar sozinho.
// `servers` vem em ordem de prioridade (principal + reservas de failover);
// `server` é a principal, mantido pra compatibilidade com Players antigos.
async function withServer(device: Device) {
  const ids = device.boundServerIds;
  const base = {
    mac: device.mac,
    name: device.name,
    model: device.model,
    platform: device.platform,
    status: device.status,
    access: accessOf(device),
    boundServerId: ids[0] ?? null,
    boundServerIds: ids,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    expiresAt: device.expiresAt,
  };
  if (device.status !== "active" || ids.length === 0 || isExpired(device)) {
    return { ...base, server: null as ServerCreds | null, servers: [] as ServerCreds[] };
  }
  const resolved = await Promise.all(ids.map((id) => findUser(id)));
  const servers: ServerCreds[] = resolved
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => ({ host: u.host, username: u.username, password: u.password }));
  return { ...base, server: servers[0] ?? null, servers };
}

// --- chamado pelo Player -----------------------------------------------------
router.post("/devices/heartbeat", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const mac = normalizeMac(body.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  try {
    const device = await upsertFromHeartbeat({
      mac,
      name: typeof body.name === "string" ? body.name : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      platform: typeof body.platform === "string" ? body.platform : undefined,
    });
    const payload = await withServer(device);
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao registrar o dispositivo.";
    res.status(500).json({ error: message });
  }
});

// --- usados pelo Manager ----------------------------------------------------
function withAccess(d: Device) {
  return {
    ...d,
    boundServerId: d.boundServerIds[0] ?? null,
    boundServerIds: d.boundServerIds,
    access: accessOf(d),
  };
}

router.get("/devices", async (_req: Request, res: Response) => {
  try {
    const devices = await readDevices();
    devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    res.json(devices.map(withAccess));
  } catch {
    res.status(500).json({ error: "Não foi possível carregar os dispositivos." });
  }
});

router.get("/devices/:mac", async (req: Request, res: Response) => {
  const device = await findDevice(req.params.mac);
  if (!device) {
    res.status(404).json({ error: "Dispositivo não encontrado." });
    return;
  }
  res.json(withAccess(device));
});

router.put("/devices/:mac", async (req: Request, res: Response) => {
  const mac = normalizeMac(req.params.mac);
  if (!mac) {
    res.status(400).json({ error: "MAC inválido." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  let boundServerId: string | null | undefined;
  if (body.boundServerId === null || body.boundServerId === "") {
    boundServerId = null;
  } else if (typeof body.boundServerId === "string") {
    const user = await findUser(body.boundServerId);
    if (!user) {
      res.status(400).json({ error: "Servidor vinculado não existe." });
      return;
    }
    boundServerId = body.boundServerId;
  }

  // Lista ordenada de linhas (principal + reservas). Tem prioridade sobre
  // `boundServerId`. `null` ou `[]` desvincula todas.
  let boundServerIds: string[] | null | undefined;
  if (body.boundServerIds === null) {
    boundServerIds = null;
  } else if (Array.isArray(body.boundServerIds)) {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const raw of body.boundServerIds) {
      if (typeof raw !== "string" || !raw || seen.has(raw)) continue;
      if (!(await findUser(raw))) {
        res.status(400).json({ error: `Servidor ${raw} não existe.` });
        return;
      }
      seen.add(raw);
      ids.push(raw);
    }
    boundServerIds = ids;
  }

  const status =
    body.status === "pending" || body.status === "active" || body.status === "disabled"
      ? body.status
      : undefined;

  // Validade: `expiresAt` absoluto (número | null p/ vitalício | undefined = não mexe);
  // `extendDays` renova somando dias; `validityDays` = padrão ao ativar.
  let expiresAt: number | null | undefined;
  if (body.expiresAt === null) {
    expiresAt = null;
  } else if (typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt)) {
    expiresAt = body.expiresAt;
  }
  const extendDays =
    typeof body.extendDays === "number" && body.extendDays > 0 ? body.extendDays : undefined;
  const defaultValidityDays =
    typeof body.validityDays === "number" && body.validityDays > 0
      ? body.validityDays
      : undefined;

  try {
    const updated = await updateDevice(mac, {
      name: typeof body.name === "string" ? body.name : undefined,
      boundServerId,
      boundServerIds,
      status,
      expiresAt,
      extendDays,
      defaultValidityDays,
    });
    res.json(updated ? withAccess(updated) : updated);
  } catch {
    res.status(500).json({ error: "Erro ao atualizar o dispositivo." });
  }
});

router.delete("/devices/:mac", async (req: Request, res: Response) => {
  const ok = await deleteDevice(req.params.mac);
  if (!ok) {
    res.status(404).json({ error: "Dispositivo não encontrado." });
    return;
  }
  res.status(204).end();
});

export default router;
