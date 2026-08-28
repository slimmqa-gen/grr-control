import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ShieldAlert } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { Shell } from "@/components/shell";
import { AuthProvider, useAuth } from "@/lib/auth";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Summary from "@/pages/summary";
import ImportPage from "@/pages/import";
import ProfilesPage from "@/pages/profiles";
import TemplatesPage from "@/pages/templates";
import InstallPage from "@/pages/install";
import PbkPage from "@/pages/pbk";
import Drilling from "@/pages/drilling";
import Economics from "@/pages/economics";
import FuelPage from "@/pages/fuel";
import SamplePrep from "@/pages/sampleprep";
import CorePage from "@/pages/core";
import Crew from "@/pages/crew";
import UsersPage from "@/pages/users";
import SettingsPage from "@/pages/settings";
import ReferencesPage from "@/pages/references";
import SetupPage from "@/pages/setup";
import CustomSectionPage from "@/pages/custom";
import NotFound from "@/pages/not-found";

/** Заглушка для раздела, закрытого по роли (прямой переход по адресу тоже перехватывается) */
function Denied({ section }: { section: string }) {
  const { user } = useAuth();
  return (
    <Card className="p-6" data-testid="page-denied">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <h1 className="text-base font-semibold">Раздел недоступен</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Роль «{user?.roleLabel}» не имеет доступа к разделу «{section}». Данные не загружаются
            и на стороне сервера: прямой запрос к API вернёт отказ.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Если доступ нужен для работы — обратитесь к генеральному директору.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Guarded({
  section, label, component: Component,
}: { section: string; label: string; component: () => JSX.Element }) {
  const { can } = useAuth();
  return can(section) ? <Component /> : <Denied section={label} />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={() => <Guarded section="dashboard" label="Дашборд" component={Dashboard} />} />
      <Route path="/summary" component={() => <Guarded section="summary" label="Сводка" component={Summary} />} />
      <Route path="/import" component={() => <Guarded section="import" label="Импорт данных" component={ImportPage} />} />
      <Route path="/profiles" component={() => <Guarded section="profiles" label="Профили импорта" component={ProfilesPage} />} />
      <Route path="/pbk" component={() => <Guarded section="pbk" label="Реальные данные ПБК" component={PbkPage} />} />
      <Route path="/drilling" component={() => <Guarded section="drilling" label="Бурение и простои" component={Drilling} />} />
      <Route path="/economics" component={() => <Guarded section="economics" label="Экономика" component={Economics} />} />
      <Route path="/fuel" component={() => <Guarded section="fuel" label="ГСМ и запасы" component={FuelPage} />} />
      <Route path="/sampleprep" component={() => <Guarded section="sampleprep" label="Пробоподготовка" component={SamplePrep} />} />
      <Route path="/core" component={() => <Guarded section="core" label="Керн и распиловка" component={CorePage} />} />
      <Route path="/crew" component={() => <Guarded section="crew" label="Сотрудники и вахты" component={Crew} />} />
      <Route path="/references" component={() => <Guarded section="references" label="Справочники" component={ReferencesPage} />} />
      <Route path="/templates" component={() => <Guarded section="templates" label="Шаблоны Excel" component={TemplatesPage} />} />
      <Route path="/install" component={() => <Guarded section="install" label="Установка на устройства" component={InstallPage} />} />
      <Route path="/users" component={() => <Guarded section="users" label="Пользователи" component={UsersPage} />} />
      <Route path="/setup" component={() => <Guarded section="setup" label="Настройка за 5 шагов" component={SetupPage} />} />
      <Route path="/settings" component={() => <Guarded section="settings" label="Настройки" component={SettingsPage} />} />
      {/* Пользовательские разделы-журналы, созданные заказчиком (доступ проверяет сервер) */}
      <Route path="/c/:key" component={CustomSectionPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Authenticated() {
  const { user } = useAuth();
  useLocation();
  if (!user) return <LoginPage />;
  return (
    <Shell>
      <AppRouter />
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthProvider>
          <Router hook={useHashLocation}>
            <Authenticated />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
