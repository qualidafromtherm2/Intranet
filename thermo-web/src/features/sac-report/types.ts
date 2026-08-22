export type SacReportRow=Record<string,string|number|null|undefined>;export type SacReport={ok:true;rows?:SacReportRow[];kpis?:Record<string,number>;[key:string]:unknown}
