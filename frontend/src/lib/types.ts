export type IptvStatus = "ATIVO" | "VENCE_EM_BREVE" | "EXPIRADO" | "OFFLINE";

export interface CheckResult {
  status: IptvStatus;
  expDate: number | null;
  checkedAt: number;
  message?: string;
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
