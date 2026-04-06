export type Theme = 'light' | 'dark';

export const Screen = {
  DASHBOARD: 'DASHBOARD',
  CDR_UPLOAD: 'CDR_UPLOAD',
  SDR_UPLOAD: 'SDR_UPLOAD',
  SDR_SEARCH: 'SDR_SEARCH',
  TOWER_DUMP: 'TOWER_DUMP',
  TOWER_DUMP_ANALYSIS: 'TOWER_DUMP_ANALYSIS',
  IPDR: 'IPDR',
  IPDR_ANALYSIS: 'IPDR_ANALYSIS',
  ILD: 'ILD',
  ILD_ANALYSIS: 'ILD_ANALYSIS',
  ANALYSIS: 'ANALYSIS',
  SETTINGS: 'SETTINGS',
  OSINT: 'OSINT',
} as const;

export type Screen = (typeof Screen)[keyof typeof Screen];

export interface NavItem {
  id: Screen;
  label: string;
  icon: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}
