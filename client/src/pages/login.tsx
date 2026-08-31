import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogIn, AlertTriangle, KeyRound, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

type Demo = {
  login: string;
  password: string;
  role: string;
  label: string;
};

function StartLogo() {
  return (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border bg-background shadow-sm">
      <img
        src="/logo.png"
        alt="Логотип организации"
        className="h-full w-full object-contain p-1"
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.parentElement?.classList.add("logo-fallback");
        }}
      />
      <Building2 className="hidden h-7 w-7 text-primary logo-fallback:block" />
    </div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery<{ demo: Demo[]; note: string }>({
    queryKey: ["/api/auth/demo-users"],
  });

  const submit = async (e?: React.FormEvent, l?: string, p?: string) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(l ?? name, p ?? pass);
    } catch (err: any) {
      setError(err?.message ?? "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-3 py-6">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <StartLogo />
          <div>
            <div className="text-lg font-semibold leading-tight">
              Производственная система
            </div>
            <div className="text-xs text-muted-foreground">
              Управление буровыми и геологическими работами
            </div>
          </div>
        </div>

        <Card className="p-5">
          <h1 className="text-base font-semibold">Вход в программу</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Доступ к разделам и денежным показателям зависит от вашей роли.
          </p>

          <form className="mt-4 space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="login">Логин</Label>
              <Input
                id="login"
                value={name}
                autoComplete="username"
                onChange={(e) => setName(e.target.value)}
                placeholder="director"
                data-testid="input-login"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={pass}
                autoComplete="current-password"
                onChange={(e) => setPass(e.target.value)}
                placeholder="Введите пароль"
                data-testid="input-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-login-error">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy} data-testid="button-submit-login">
              <LogIn className="mr-2 h-4 w-4" />
              {busy ? "Входим…" : "Войти"}
            </Button>
          </form>
        </Card>

        <Card className="mt-4 p-4" data-testid="card-demo-users">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Быстрый вход для демонстрации
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Нажмите на строку, чтобы войти сразу. Логин и пароль совпадают.
          </p>
          <div className="mt-3 space-y-1.5">
            {data?.demo?.map((d) => (
              <button
                key={d.login}
                type="button"
                onClick={() => submit(undefined, d.login, d.password)}
                data-testid={`button-demo-${d.login}`}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-accent"
              >
                <span className="min-w-0 truncate font-medium">{d.label}</span>
                <span className="shrink-0 text-muted-foreground">{d.login}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {data?.note ?? "Смените пароли перед рабочим запуском."}
          </p>
        </Card>
      </div>
    </div>
  );
}
