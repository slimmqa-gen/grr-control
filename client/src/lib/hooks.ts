import { useQuery } from "@tanstack/react-query";

export function useAnalytics() {
  return useQuery<any>({ queryKey: ["/api/analytics"] });
}

export function useReference() {
  return useQuery<any>({ queryKey: ["/api/reference"] });
}

/** Заполненность программы: есть ли справочники, рапорты, название организации */
export function useStatus() {
  return useQuery<any>({ queryKey: ["/api/status"] });
}

export function useRefBook() {
  return useQuery<any>({ queryKey: ["/api/ref/all"] });
}

export function useList<T = any>(url: string) {
  return useQuery<T[]>({ queryKey: [url] });
}
