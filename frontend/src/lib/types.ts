export type IptvStatus = "ATIVO" | "VENCE_EM_BREVE" | "EXPIRADO" | "OFFLINE";

export interface CheckResult {
  status: IptvStatus;
  expDate: number | null;
  checkedAt: number;
  message?: string;
  /** Conexões simultâneas ativas AGORA nessa linha, segundo o próprio painel
   * (conta qualquer aparelho usando essas credenciais, não só os dispositivos
   * cadastrados aqui). null = painel não informou. */
  activeConns?: number | null;
  maxConnections?: number | null;
}

export interface IptvUser {
  id: string;
  host: string;
  username: string;
  password: string;
  createdAt: number;
}

export interface IptvUserWithCheck extends IptvUser {
  check: CheckResult | null;
  checking: boolean;
}
