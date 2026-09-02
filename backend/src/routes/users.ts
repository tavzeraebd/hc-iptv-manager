import { Router, Request, Response } from "express";
import { readUsers, createUser, updateUser, deleteUser, findUser } from "../storage";
import { checkIptvUser } from "../iptvCheck";
import { DEFAULT_IMPORT_URL, fetchImportCandidates } from "../importSource";

const router = Router();

const MAX_FIELD_LENGTH = 255;

export function validateInput(body: unknown): { host: string; username: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const { host, username, password } = body as Record<string, unknown>;
  if (
    typeof host !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }
  const trimmedHost = host.trim();
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();
  if (!trimmedHost || !trimmedUsername || !trimmedPassword) return null;
  if (
    trimmedHost.length > MAX_FIELD_LENGTH ||
    trimmedUsername.length > MAX_FIELD_LENGTH ||
    trimmedPassword.length > MAX_FIELD_LENGTH
  ) {
    return null;
  }
  return { host: trimmedHost, username: trimmedUsername, password: trimmedPassword };
}

router.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = await readUsers();
    res.json(users);
  } catch {
    res.status(500).json({ error: "Não foi possível carregar os usuários." });
  }
});

router.post("/users", async (req: Request, res: Response) => {
  const input = validateInput(req.body);
  if (!input) {
    res.status(400).json({ error: "Host, usuário e senha são obrigatórios." });
    return;
  }
  try {
    const user = await createUser(input);
    const check = await checkIptvUser(user.host, user.username, user.password);
    res.status(201).json({ ...user, check });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar usuário.";
    res.status(400).json({ error: message });
  }
});

router.put("/users/:id", async (req: Request, res: Response) => {
  const input = validateInput(req.body);
  if (!input) {
    res.status(400).json({ error: "Host, usuário e senha são obrigatórios." });
    return;
  }
  try {
    const updated = await updateUser(req.params.id, input);
    if (!updated) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    const check = await checkIptvUser(updated.host, updated.username, updated.password);
    res.json({ ...updated, check });
  } catch {
    res.status(500).json({ error: "Erro ao atualizar usuário." });
  }
});

router.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const removed = await deleteUser(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Erro ao excluir usuário." });
  }
});

router.get("/users/:id/check", async (req: Request, res: Response) => {
  try {
    const user = await findUser(req.params.id);
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    const check = await checkIptvUser(user.host, user.username, user.password);
    res.json(check);
  } catch {
    res.status(500).json({ error: "Erro ao verificar usuário." });
  }
});

router.post("/check-all", async (_req: Request, res: Response) => {
  try {
    const users = await readUsers();
    const results = await Promise.all(
      users.map(async (user) => ({
        id: user.id,
        check: await checkIptvUser(user.host, user.username, user.password),
      }))
    );
    res.json(results);
  } catch {
    res.status(500).json({ error: "Erro ao verificar usuários." });
  }
});

router.post("/import/preview", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : DEFAULT_IMPORT_URL;
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "URL inválida." });
    return;
  }
  try {
    const [candidates, users] = await Promise.all([fetchImportCandidates(url), readUsers()]);
    const withExisting = candidates.map((c) => ({
      ...c,
      alreadyExists: users.some((u) => u.host === c.host && u.username === c.username),
    }));
    res.json(withExisting);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar candidatos para importação.";
    res.status(502).json({ error: message });
  }
});

router.post("/import", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawUsers = Array.isArray(body.users) ? body.users : null;
  if (!rawUsers) {
    res.status(400).json({ error: "Lista de usuários é obrigatória." });
    return;
  }
  const inputs = rawUsers.map(validateInput).filter((u): u is NonNullable<typeof u> => u !== null);

  const added = [];
  let skipped = rawUsers.length - inputs.length;
  for (const input of inputs) {
    try {
      added.push(await createUser(input));
    } catch {
      skipped += 1;
    }
  }
  res.status(201).json({ added, skipped });
});

export default router;
