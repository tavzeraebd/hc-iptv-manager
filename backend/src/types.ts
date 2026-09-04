export interface IptvUser {
  id: string;
  host: string;
  username: string;
  password: string;
  createdAt: number;
}

export type IptvStatus = "ATIVO" | "VENCE_EM_BREVE" | "EXPIRADO" | "OFFLINE";

export interface CheckResult {
  status: IptvStatus;
  expDate: number | null;
  checkedAt: number;
  message?: string;
  /** Conexões simultâneas ativas AGORA nessa linha, segundo o próprio painel
   * (`active_cons`/`max_connections` do Xtream) — conta qualquer aparelho
   * usando essas credenciais, não só os Players cadastrados aqui. null =
   * painel não informou (ex.: conta "só M3U", ou não verificado ainda). */
  activeConns?: number | null;
  maxConnections?: number | null;
}

export interface IptvUserWithStatus extends IptvUser {
  check: CheckResult | null;
}
