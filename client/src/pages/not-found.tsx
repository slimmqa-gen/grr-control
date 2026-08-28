import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md p-6" data-testid="page-not-found">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-6 w-6 text-amber-600" />
        <h1 className="text-xl font-semibold">Раздел не найден</h1>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Такой страницы в программе нет. Вернитесь на дашборд и выберите нужный раздел в меню слева.
      </p>
      <Link href="/">
        <Button className="mt-4" data-testid="button-go-home">На дашборд</Button>
      </Link>
    </Card>
  );
}
