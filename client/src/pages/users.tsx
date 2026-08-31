import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, ShieldCheck, KeyRound, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReference } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { ruDate } from "@/lib/app";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = [
  { value: "director", label: "Генеральный директор" },
  { value: "analyst", label: "Аналитик" },
  { value: "geolog", label: "Начальник участка / геолог" },
  { value: "lab", label: "Пробоподготовка" },
  { value: "supply", label: "Снабжение" },
  { value: "viewer", label: "Наблюдатель" },
];

export default function UsersPage() {
  const { toast } = useToast();
  const users = useQuery<any[]>({ queryKey: ["/api/users"] });
  const audit = useQuery<any[]>({ queryKey: ["/api/audit"] });
  const { data: ref } = useReference();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ login: "", password: "", fio: "", role: "viewer", objectId: "все" });
  const [error, setError] = useState("");
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ fio: "", password: "" });
  const [editError, setEditError] = useState("");

  const objects: any[] = ref?.objects ?? [];

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/users", {
      login: form.login.trim(), password: form.password, fio: form.fio, role: form.role,
      objectIds: form.objectId === "все" ? [] : [Number(form.objectId)], active: true,
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShow(false);
      setForm({ login: "", password: "", fio: "", role: "viewer", objectId: "все" });
      toast({ title: "Пользователь создан" });
    },
    onError: (e: any) => setError(e.message),
  });

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) =>
      (await apiRequest("PATCH", `/api/users/${id}`, body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Изменения сохранены" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/users/${id}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries(); toast({ title: "Пользователь удалён" }); },
    onError: (e: any) => toast({ title: "Не удалось удалить", description: e.message, variant: "destructive" }),
  });

  const openEdit = (u: any) => {
    setEditError("");
    setEditUser(u);
    setEditForm({ fio: u.fio ?? "", password: "" });
  };

  const saveEdit = () => {
    const fio = editForm.fio.trim();
    const password = editForm.password;
    if (!fio) { setEditError("Укажите ФИО и должность"); return; }
    if (password && password.length < 4) { setEditError("Пароль должен содержать минимум 4 символа"); return; }
    if (!editUser) return;
    const body: any = { fio };
    if (password) body.password = password;
    patch.mutate({ id: editUser.id, body }, {
      onSuccess: () => { setEditUser(null); setEditForm({ fio: "", password: "" }); },
    } as any);
  };

  if (users.error) return <ErrorBox text="Раздел «Пользователи» доступен только генеральному директору." />;

  return (
    <>
      <PageHeader
        title="Пользователи и доступы"
        subtitle="Роли определяют разделы, право изменять данные и видимость денежных показателей"
        actions={
          <Button size="sm" onClick={() => setShow((v) => !v)} data-testid="button-add-user">
            <Plus className="mr-2 h-4 w-4" /> Добавить пользователя
          </Button>
        }
      />

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="users" data-testid="tab-users">Пользователи</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Журнал действий</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-0 space-y-4">
          {show && (
            <Card className="p-4" data-testid="form-user">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <label className="mb-1 block text-xs font-medium">Логин</label>
                  <Input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} data-testid="input-user-login" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Пароль</label>
                  <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="input-user-password" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">ФИО и должность</label>
                  <Input value={form.fio} onChange={(e) => setForm({ ...form, fio: e.target.value })} data-testid="input-user-fio" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Роль</label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Объект</label>
                  <Select value={form.objectId} onValueChange={(v) => setForm({ ...form, objectId: v })}>
                    <SelectTrigger data-testid="select-user-object"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="все">все объекты</SelectItem>
                      {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {error && <div className="mt-3"><ErrorBox text={error} /></div>}
              <div className="mt-4 flex gap-2">
                <Button onClick={() => { setError(""); create.mutate(); }} disabled={create.isPending} data-testid="button-save-user">
                  Сохранить
                </Button>
                <Button variant="ghost" onClick={() => setShow(false)}>Отмена</Button>
              </div>
            </Card>
          )}

          <Section title="Учётные записи" description="Пароли хранятся только в зашифрованном виде (bcrypt)">
            {users.isLoading ? <Loading rows={3} /> : (users.data ?? []).length === 0 ? <Empty text="Пользователей нет." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm" data-testid="table-users">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Логин</th>
                      <th className="py-2 pr-3 font-medium">ФИО и должность</th>
                      <th className="py-2 pr-3 font-medium">Роль</th>
                      <th className="py-2 pr-3 font-medium">Объекты</th>
                      <th className="py-2 pr-3 font-medium">Последний вход</th>
                      <th className="py-2 pr-3 font-medium">Доступ</th>
                      <th className="py-2 text-right font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users.data ?? []).map((u: any) => (
                      <tr key={u.id} className="border-b last:border-0" data-testid={`row-user-${u.login}`}>
                        <td className="py-2 pr-3 font-medium">{u.login}</td>
                        <td className="py-2 pr-3">{u.fio}</td>
                        <td className="py-2 pr-3">
                          <Select value={u.role} onValueChange={(v) => patch.mutate({ id: u.id, body: { role: v } })}>
                            <SelectTrigger className="h-8 w-52" data-testid={`select-role-${u.login}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {u.objectIds?.length
                            ? u.objectIds.map((id: number) => objects.find((o) => o.id === id)?.name ?? id).join(", ")
                            : "все"}
                        </td>
                        <td className="num py-2 pr-3 whitespace-nowrap text-muted-foreground">
                          {u.lastLogin ? ruDate(u.lastLogin.slice(0, 10)) : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Button
                            variant={u.active ? "secondary" : "outline"} size="sm"
                            onClick={() => patch.mutate({ id: u.id, body: { active: !u.active } })}
                            data-testid={`button-toggle-${u.login}`}
                          >
                            {u.active ? "включён" : "отключён"}
                          </Button>
                        </td>
                        <td className="py-2 text-right">
                          <Button variant="ghost" size="icon" aria-label="Изменить ФИО и пароль"
                            onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.login}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Удалить"
                            onClick={() => remove.mutate(u.id)} data-testid={`button-delete-user-${u.login}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Что видит каждая роль" description="Ограничения действуют и в интерфейсе, и на сервере">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Генеральный директор", "Все разделы, деньги, пользователи, изменение данных"],
                ["Аналитик", "Все разделы кроме пользователей, деньги видит, данные меняет"],
                ["Начальник участка / геолог", "Свой объект: бурение, керн, пробы, импорт. Деньги скрыты"],
                ["Пробоподготовка", "Только пробоподготовка. Деньги скрыты"],
                ["Снабжение", "Только ГСМ и запасы. Деньги скрыты"],
                ["Наблюдатель", "Дашборд, сводка, бурение — только просмотр, без денег"],
              ].map(([role, desc]) => (
                <Card key={role} className="p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" /> {role}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
                </Card>
              ))}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="audit" className="mt-0">
          <Section title="Журнал действий" description="Входы, изменения данных, отказы в доступе и выгрузки">
            {audit.isLoading ? <Loading rows={3} /> : (audit.data ?? []).length === 0 ? <Empty text="Записей нет." /> : (
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full min-w-[760px] text-sm" data-testid="table-audit">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Когда</th>
                      <th className="py-2 pr-3 font-medium">Пользователь</th>
                      <th className="py-2 pr-3 font-medium">Действие</th>
                      <th className="py-2 pr-3 font-medium">Объект действия</th>
                      <th className="py-2 font-medium">Итог</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit.data ?? []).map((a: any) => (
                      <tr key={a.id} className="border-b last:border-0" data-testid={`row-audit-${a.id}`}>
                        <td className="num py-2 pr-3 whitespace-nowrap text-muted-foreground">
                          {new Date(a.at).toLocaleString("ru-RU")}
                        </td>
                        <td className="py-2 pr-3">{a.login}</td>
                        <td className="py-2 pr-3">{a.action}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{a.entity} {a.details}</td>
                        <td className="py-2">
                          <Badge variant={a.ok ? "secondary" : "destructive"}>{a.ok ? "выполнено" : "отказано"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle>Изменить пользователя</DialogTitle>
            <DialogDescription>
              Изменение ФИО и пароля пользователя {editUser?.login ?? ""}.
              Оставьте пароль пустым, если менять его не нужно.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">ФИО и должность</label>
              <Input value={editForm.fio}
                onChange={(e) => setEditForm({ ...editForm, fio: e.target.value })}
                data-testid="input-edit-user-fio" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Новый пароль</label>
              <Input type="password" value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Оставьте пустым без изменений"
                data-testid="input-edit-user-password" />
            </div>
            {editError && <ErrorBox text={editError} />}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditUser(null)}>Отмена</Button>
            <Button onClick={saveEdit} disabled={patch.isPending} data-testid="button-save-edit-user">
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
