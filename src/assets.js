// Базо-независимые пути к ассетам из public/ (работает и под сабпатом).
export const asset = (p) => {
  const base = import.meta.env.BASE_URL || "/";
  return base + String(p).replace(/^\/+/, "");
};
export const MODELS_BASE = () => asset("assets/models/");
