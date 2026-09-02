const TIMEZONE = "America/Sao_Paulo";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatExpDate(expDate: number | null): string {
  if (expDate === null) return "—";
  return dateFormatter.format(new Date(expDate * 1000));
}

export function formatTimeRemaining(expDate: number | null): string {
  if (expDate === null) return "—";
  const diffSeconds = expDate - Math.floor(Date.now() / 1000);
  if (diffSeconds <= 0) return "Expirado";

  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h restantes`;
  if (hours > 0) return `${hours}h ${minutes}min restantes`;
  return `${minutes}min restantes`;
}
