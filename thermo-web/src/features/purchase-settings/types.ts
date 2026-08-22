export interface PurchaseSubitem {
  id: number;
  nome: string;
}
export interface PurchaseCategory {
  id: number;
  nome: string;
  subitens: PurchaseSubitem[];
}
export interface PurchaseDepartment {
  id: number;
  nome: string;
  categorias: PurchaseCategory[];
}
export type PurchaseSettingKind = "departamento" | "categoria" | "subitem";
