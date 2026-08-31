import { useState } from "react";
import { LogIn, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    try { await login(name, pass); }
    catch (err: any) { setError(err?.message ?? "Не удалось войти"); }
    finally { setBusy(false); }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-background.jpg')" }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-slate-950/55" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-5 text-center text-white drop-shadow-lg">
          <div className="mb-4 text-2xl font-bold">ПБК</div>
          <h1 className="text-xl font-semibold">Производственно - Буровая компания</h1>
          <p className="mt-1 text-sm text-slate-100">Панель управления генерального директора</p>
        </div>
        <Card className="bg-white/95 p-5 shadow-2xl backdrop-blur-sm">
          <h2 className="text-base font-semibold">Вход в программу</h2>
          <p className="mt-1 text-xs text-muted-foreground">Введите логин и пароль для входа в систему.</p>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <div className="space-y-1.5"><Label htmlFor="login">Логин</Label><Input id="login" value={name} autoComplete="username" onChange={(e) => setName(e.target.value)} placeholder="Введите логин" /></div>
            <div className="space-y-1.5"><Label htmlFor="password">Пароль</Label><Input id="password" type="password" value={pass} autoComplete="current-password" onChange={(e) => setPass(e.target.value)} placeholder="Введите пароль" /></div>
            {error && <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span></div>}
            <Button type="submit" className="w-full" disabled={busy}><LogIn className="mr-2 h-4 w-4" />{busy ? "Входим…" : "Войти"}</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
