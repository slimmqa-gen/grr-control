import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FileText, Upload, Drill, Wallet, Fuel, Users, Settings,
  Menu, X, Download, Moon, SunMedium, BookMarked, FlaskConical, Layers,
  SlidersHorizontal, ShieldCheck, LogOut, Database, FileCog, Smartphone,
  ChevronDown, ChevronRight, ClipboardList, ListTree, Wand2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { levelDot, levelText, type Level } from "@/lib/app";
import { useAuth } from "@/lib/auth";

export const NAV = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard, section: "dashboard" },
  { href: "/summary", label: "Сводка", icon: FileText, section: "summary" },
  { href: "/import", label: "Импорт данных", icon: Upload, section: "import" },
  { href: "/profiles", label: "Профили импорта", icon: SlidersHorizontal, section: "profiles" },
  { href: "/pbk", label: "Реальные данные ПБК", icon: Database, section: "pbk" },
  { href: "/drilling", label: "Бурение и простои", icon: Drill, section: "drilling" },
  { href: "/sampleprep", label: "Пробоподготовка", icon: FlaskConical, section: "sampleprep" },
  { href: "/core", label: "Керн и распиловка", icon: Layers, section: "core" },
  { href: "/economics", label: "Экономика", icon: Wallet, section: "economics" },
  { href: "/fuel", label: "ГСМ и запасы", icon: Fuel, section: "fuel" },
  { href: "/crew", label: "Сотрудники и вахты", icon: Users, section: "crew" },
  { href: "/references", label: "Справочники", icon: BookMarked, section: "references" },
  { href: "/templates", label: "Шаблоны Excel", icon: FileCog, section: "templates" },
  { href: "/users", label: "Пользователи", icon: ShieldCheck, section: "users" },
  { href: "/settings", label: "Настройки", icon: Settings, section: "settings" },
  { href: "/install", label: "Установка на устройства", icon: Smartphone, section: "install" },
];

/** Значки разделов по ключу (состав меню приходит с сервера) */
export const SECTION_ICONS: Record<string, any> = {
  LayoutDashboard, FileText, Upload, Drill, Wallet, Fuel, Users, Settings,
  BookMarked, FlaskConical, Layers, SlidersHorizontal, ShieldCheck, Database,
  FileCog, Smartphone, ClipboardList, ListTree, Wand2,
};

export type MenuItem = {
  key: string; label: string; href: string; icon: string; custom: boolean;
};
export type MenuGroup = { key: string; title: string; collapsed: boolean; items: MenuItem[] };

/** Состав меню: настраивается директором на экране «Разделы программы» */
export function useMenu() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<{ groups: MenuGroup[]; money: boolean }>({
    queryKey: ["/api/sections/menu"],
    enabled: !!user,
  });
  return { groups: data?.groups ?? [], isLoading };
}

/** Название организации из настроек (выводится в шапке) */
export function useOrgName() {
  const { data } = useQuery<any>({ queryKey: ["/api/branding"] });
  return (data?.orgName as string) || "ГРР-Контроль";
}

/** Брендирование: короткое название и логотип заказчика для шапки */
export function useBranding() {
  const { data } = useQuery<any>({ queryKey: ["/api/branding"] });
  return {
    orgName: (data?.orgName as string) || "ГРР-Контроль",
    orgShort: (data?.orgShort as string) || "",
    logo: (data?.logo as string) || "",
  };
}

/** Знак приложения либо загруженный логотип организации */
export function BrandMark({ className }: { className?: string }) {
  const { logo, orgName } = useBranding();
  if (logo) {
    return (
      <img
        src={logo}
        alt={orgName}
        className={cn("h-7 w-7 shrink-0 rounded object-contain", className)}
        data-testid="img-header-logo"
      />
    );
  }
  return <Logo className={className} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-7 w-7 shrink-0", className)}
      fill="none"
      aria-label="ГРР-Контроль"
      role="img"
    >
      <rect x="1" y="1" width="30" height="30" rx="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16 5v22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11h12M11.5 17h9M13 23h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function useDark() {
  const [dark, setDark] = useState(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };
  return { dark, toggle };
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useDark();
  const orgName = useOrgName();
  const { user, logout } = useAuth();
  const { groups } = useMenu();
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  // Свёрнутость групп берётся из настроек состава программы
  useEffect(() => {
    if (!groups.length) return;
    setFolded((prev) => {
      const next = { ...prev };
      for (const g of groups) if (next[g.key] === undefined) next[g.key] = g.collapsed;
      return next;
    });
  }, [groups.map((g) => `${g.key}:${g.collapsed}`).join("|")]);

  const flat = groups.flatMap((g) => g.items);
  const current = flat.find((n) => n.href === location)
    ?? (location === "/setup" ? { label: "Настройка за 5 шагов" } : undefined);

  const nav = (
    <nav className="flex-1 overflow-y-auto p-2" data-testid="nav-sections">
      {groups.map((group) => {
        const collapsed = !!folded[group.key];
        const hasActive = group.items.some((i) => i.href === location);
        return (
          <div key={group.key} className="mb-1">
            <button
              type="button"
              onClick={() => setFolded((p) => ({ ...p, [group.key]: !collapsed }))}
              data-testid={`button-group-${group.key}`}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55 hover:text-sidebar-foreground"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span className="truncate">{group.title}</span>
              {collapsed && hasActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
            {!collapsed && (
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = SECTION_ICONS[item.icon] ?? ClipboardList;
                  const active = location === item.href;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      data-testid={`link-nav-${item.key.replace("custom:", "c-")}`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Боковое меню — десктоп */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4 text-sidebar-foreground">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-sm font-semibold" data-testid="text-org-sidebar">{orgName}</div>
            <div className="text-xs text-sidebar-foreground/60" data-testid="text-role-sidebar">
              {user?.roleLabel ?? "Панель директора"}
            </div>
          </div>
        </div>
        {nav}
        <div className="mt-auto space-y-2 p-3 text-xs text-sidebar-foreground/60">
          <div data-testid="text-current-user" className="leading-snug">
            <div className="font-medium text-sidebar-foreground">{user?.fio}</div>
            <div>{user?.roleHint}</div>
          </div>
          <Button
            variant="outline" size="sm" className="w-full" onClick={logout} data-testid="button-logout"
          >
            <LogOut className="mr-2 h-3.5 w-3.5" /> Выйти
          </Button>
        </div>
      </aside>

      {/* Боковое меню — мобильное */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            data-testid="overlay-nav"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar">
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4 text-sidebar-foreground">
              <div className="flex items-center gap-3">
                <BrandMark />
                <div className="text-sm font-semibold">{orgName}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Закрыть меню"
                data-testid="button-close-nav"
                className="text-sidebar-foreground/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            <div className="mt-auto space-y-2 p-3 text-xs text-sidebar-foreground/60">
              <div className="font-medium text-sidebar-foreground">{user?.fio}</div>
              <div>{user?.roleLabel}</div>
              <Button variant="outline" size="sm" className="w-full" onClick={logout} data-testid="button-logout-mobile">
                <LogOut className="mr-2 h-3.5 w-3.5" /> Выйти
              </Button>
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <button
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Открыть меню"
            data-testid="button-open-nav"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base" data-testid="text-header-title">
            <span>{current?.label ?? orgName}</span>
            <span className="ml-2 hidden text-xs font-normal text-muted-foreground sm:inline" data-testid="text-org-header">
              {orgName}
            </span>
          </div>
          <span
            className="hidden shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground sm:inline"
            data-testid="text-role-header"
          >
            {user?.roleLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Сменить тему"
            data-testid="button-theme"
          >
            {dark ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5 sm:py-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ExportButton({
  onClick, label = "Скачать Excel", testId = "button-export",
}: { onClick: () => void; label?: string; testId?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} data-testid={testId}>
      <Download className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}

export function Kpi({
  label, value, hint, level, testId,
}: { label: string; value: string; hint?: string; level?: Level; testId?: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="flex items-start gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
        {level && <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", levelDot[level])} />}
        <span className="leading-snug">{label}</span>
      </div>
      <div
        className={cn(
          "num mt-2 text-lg font-semibold leading-tight sm:text-2xl",
          level ? levelText[level] : "",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Section({
  title, description, actions, children, className,
}: {
  title: string; description?: string; actions?: ReactNode;
  children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div
      className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
      data-testid="text-empty"
    >
      {text}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="state-loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      data-testid="text-error"
    >
      {text}
    </div>
  );
}

/** Горизонтальная прокрутка таблиц на телефоне */
export function TableWrap({ children, maxH = "60vh" }: { children: ReactNode; maxH?: string }) {
  return (
    <div className="sticky-head -mx-4 overflow-auto px-4" style={{ maxHeight: maxH }}>
      <div className="min-w-full">{children}</div>
    </div>
  );
}
