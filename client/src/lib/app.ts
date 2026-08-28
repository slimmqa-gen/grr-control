import { apiRequest } from "@/lib/queryClient";

/** Числовые форматтеры для русского интерфейса */
export const nf = (v: number, d = 0) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("ru-RU", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

export const money = (v: number) => `${nf(Math.round(v || 0))} ₽`;
export const meters = (v: number, d = 0) => `${nf(v || 0, d)} м`;
export const pct = (v: number, d = 1) => `${nf(v || 0, d)} %`;

export function ruDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Уровни статуса: зелёный / жёлтый / красный */
export type Level = "ok" | "warn" | "bad";

export const levelText: Record<Level, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-700 dark:text-red-400",
};

export const levelBadge: Record<Level, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  warn: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  bad: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

export const levelDot: Record<Level, string> = {
  ok: "bg-emerald-600",
  warn: "bg-amber-500",
  bad: "bg-red-600",
};

/** Отклонение факта от плана: чем меньше — тем хуже */
export function planLevel(pct: number, threshold = 10): Level {
  if (pct >= 100 - threshold) return "ok";
  if (pct >= 100 - threshold * 2) return "warn";
  return "bad";
}

/** Превышение показателя над нормой: чем больше — тем хуже */
export function overLevel(deviationPct: number, threshold = 10): Level {
  if (deviationPct <= threshold) return "ok";
  if (deviationPct <= threshold * 2) return "warn";
  return "bad";
}

export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(213 20% 55%)",
  "hsl(28 40% 45%)",
  "hsl(260 25% 50%)",
];

/** Скачивание файла с сервера (Excel / Word) */
export async function downloadFile(url: string, fallbackName: string) {
  const res = await apiRequest("GET", url);
  const cd = res.headers.get("Content-Disposition") || "";
  let name = fallbackName;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      name = decodeURIComponent(star[1]);
    } catch {
      /* оставляем имя по умолчанию */
    }
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
