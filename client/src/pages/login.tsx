import { useState } from "react";
import { LogIn, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shell";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(name, pass);
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
          <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-xl border bg-white shadow-sm">
            <img
              src="/pbk_logo.jpg"
              alt="Логотип Производственно - Буровой компании"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight">
              Производственно - Буровая компания
            </div>
            <div className="text-xs text-muted-foreground">
              Панель управления генерального директора
            </div>
          </div>
        </div>

        <Card className="p-5">
          <h1 className="text-base font-semibold">Вход в программу</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Введите логин и пароль для входа в систему.
          </p>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="login">Логин</Label>
              <Input
                id="login"
                value={name}
                autoComplete="username"
                onChange={(e) => setName(e.target.value)}
                placeholder="Введите логин"
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
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              <LogIn className="mr-2 h-4 w-4" />
              {busy ? "Входим…" : "Войти"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
