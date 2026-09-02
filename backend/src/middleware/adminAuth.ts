import type { RequestHandler } from "express";

// Guard das rotas de administração do portal. Exige o header `x-portal-token`
// igual à env var PORTAL_ADMIN_TOKEN.
//
// Se PORTAL_ADMIN_TOKEN não estiver definida (caso do backend embarcado no
// APK, que roda só em 127.0.0.1 dentro do próprio app), o guard é um no-op —
// a API fica aberta, como sempre foi nesse cenário.
//
// A rota POST /api/devices/heartbeat NÃO passa por aqui (ver server.ts): o
// Player não tem token e precisa se anunciar livremente.

const TOKEN = (process.env.PORTAL_ADMIN_TOKEN || "").trim();

export function portalTokenConfigured(): boolean {
  return TOKEN !== "";
}

export const adminAuth: RequestHandler = (req, res, next) => {
  if (!TOKEN) {
    next();
    return;
  }
  const provided = (req.get("x-portal-token") || "").trim();
  if (provided && provided === TOKEN) {
    next();
    return;
  }
  res.status(401).json({ error: "Não autorizado. Token do portal ausente ou inválido." });
};
