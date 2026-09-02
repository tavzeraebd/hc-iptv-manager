import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { IptvUser } from "./types";
import { supabaseEnabled, getSupabase } from "./db/supabase";

// No app Android, o launcher embarcado define DATA_DIR para o diretório
// interno de dados do app (a pasta ao lado do backend não existe/não é
// gravável ali). Fora desse cenário, comportamento inalterado.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "usuarios.txt");
const TABLE = "iptv_users";

export interface NewUserInput {
  host: string;
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Armazenamento em arquivo (JSON-lines) — backend embarcado no APK e qualquer
// execução sem SUPABASE_URL/SUPABASE_SECRET_KEY definidos.
// ---------------------------------------------------------------------------

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "", "utf-8");
  }
}

function parseLine(line: string): IptvUser | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      typeof parsed.id === "string" &&
      typeof parsed.host === "string" &&
      typeof parsed.username === "string" &&
      typeof parsed.password === "string"
    ) {
      return {
        id: parsed.id,
        host: parsed.host,
        username: parsed.username,
        password: parsed.password,
        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      };
    }
  } catch {
    // linha corrompida é ignorada
  }
  return null;
}

async function fileReadUsers(): Promise<IptvUser[]> {
  await ensureDataFile();
  const content = await fs.readFile(DATA_FILE, "utf-8");
  return content
    .split("\n")
    .map(parseLine)
    .filter((u): u is IptvUser => u !== null);
}

async function fileWriteUsers(users: IptvUser[]): Promise<void> {
  await ensureDataFile();
  const content = users.map((u) => JSON.stringify(u)).join("\n") + (users.length ? "\n" : "");
  const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpFile, content, "utf-8");
  await fs.rename(tmpFile, DATA_FILE);
}

async function fileCreateUser(input: NewUserInput): Promise<IptvUser> {
  const users = await fileReadUsers();
  const duplicate = users.find(
    (u) => u.host === input.host && u.username === input.username
  );
  if (duplicate) {
    throw new Error("Já existe um usuário cadastrado com este host e usuário.");
  }
  const user: IptvUser = {
    id: crypto.randomUUID(),
    host: input.host,
    username: input.username,
    password: input.password,
    createdAt: Date.now(),
  };
  users.push(user);
  await fileWriteUsers(users);
  return user;
}

async function fileUpdateUser(id: string, input: NewUserInput): Promise<IptvUser | null> {
  const users = await fileReadUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return null;
  const updated: IptvUser = { ...users[index], ...input };
  users[index] = updated;
  await fileWriteUsers(users);
  return updated;
}

async function fileDeleteUser(id: string): Promise<boolean> {
  const users = await fileReadUsers();
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) return false;
  await fileWriteUsers(filtered);
  return true;
}

async function fileFindUser(id: string): Promise<IptvUser | null> {
  const users = await fileReadUsers();
  return users.find((u) => u.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Armazenamento no Supabase (Postgres) — portal hospedado. Mesma semântica
// dos helpers de arquivo acima.
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  host: string;
  username: string;
  password: string;
  created_at: number | string | null;
}

function rowToUser(r: UserRow): IptvUser {
  return {
    id: r.id,
    host: r.host,
    username: r.username,
    password: r.password,
    createdAt: Number(r.created_at) || Date.now(),
  };
}

async function sbReadUsers(): Promise<IptvUser[]> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToUser(r as UserRow));
}

async function sbCreateUser(input: NewUserInput): Promise<IptvUser> {
  const sb = await getSupabase();
  const { data: dup, error: dupErr } = await sb
    .from(TABLE)
    .select("id")
    .eq("host", input.host)
    .eq("username", input.username)
    .maybeSingle();
  if (dupErr) throw new Error(dupErr.message);
  if (dup) {
    throw new Error("Já existe um usuário cadastrado com este host e usuário.");
  }
  const user: IptvUser = {
    id: crypto.randomUUID(),
    host: input.host,
    username: input.username,
    password: input.password,
    createdAt: Date.now(),
  };
  const { error } = await sb.from(TABLE).insert({
    id: user.id,
    host: user.host,
    username: user.username,
    password: user.password,
    created_at: user.createdAt,
  });
  if (error) throw new Error(error.message);
  return user;
}

async function sbUpdateUser(id: string, input: NewUserInput): Promise<IptvUser | null> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from(TABLE)
    .update({ host: input.host, username: input.username, password: input.password })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToUser(data as UserRow) : null;
}

async function sbDeleteUser(id: string): Promise<boolean> {
  const sb = await getSupabase();
  const { data, error } = await sb.from(TABLE).delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function sbFindUser(id: string): Promise<IptvUser | null> {
  const sb = await getSupabase();
  const { data, error } = await sb.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToUser(data as UserRow) : null;
}

// ---------------------------------------------------------------------------
// API pública — despacha para o Supabase ou para o arquivo.
// ---------------------------------------------------------------------------

export function readUsers(): Promise<IptvUser[]> {
  return supabaseEnabled() ? sbReadUsers() : fileReadUsers();
}

export function createUser(input: NewUserInput): Promise<IptvUser> {
  return supabaseEnabled() ? sbCreateUser(input) : fileCreateUser(input);
}

export function updateUser(id: string, input: NewUserInput): Promise<IptvUser | null> {
  return supabaseEnabled() ? sbUpdateUser(id, input) : fileUpdateUser(id, input);
}

export function deleteUser(id: string): Promise<boolean> {
  return supabaseEnabled() ? sbDeleteUser(id) : fileDeleteUser(id);
}

export function findUser(id: string): Promise<IptvUser | null> {
  return supabaseEnabled() ? sbFindUser(id) : fileFindUser(id);
}
