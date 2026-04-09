import {
  AlertTriangle,
  BellRing,
  Database,
  FileCog,
  FileSpreadsheet,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  ShieldEllipsis,
  Users,
} from 'lucide-react'
import { adminPaths } from './paths'

export interface AdminNavItem {
  label: string
  to: string
  icon: typeof LayoutDashboard
}

export const primaryAdminNavigation: AdminNavItem[] = [
  { label: 'Dashboard', to: adminPaths.dashboard, icon: LayoutDashboard },
  { label: 'Cases', to: adminPaths.cases, icon: ShieldCheck },
  { label: 'Ingestion Pipeline', to: adminPaths.ingestion, icon: FileCog },
  { label: 'Normalization & Processing', to: adminPaths.normalization, icon: ShieldEllipsis },
  { label: 'Table Editor', to: adminPaths.tableEditor, icon: FileSpreadsheet },
  { label: 'Database', to: adminPaths.database, icon: Database },
  { label: 'Users & Roles', to: adminPaths.users, icon: Users },
  { label: 'Audit Trail', to: adminPaths.audit, icon: BellRing },
  { label: 'Alerts & Incidents', to: adminPaths.alerts, icon: AlertTriangle },
  { label: 'Settings', to: adminPaths.settings, icon: Settings2 },
]

export interface AdminRouteMeta {
  eyebrow: string
  title: string
  description: string
}

export const resolveAdminRouteMeta = (pathname: string): AdminRouteMeta => {
  if (pathname === adminPaths.dashboard) {
    return {
      eyebrow: 'Operations Dashboard',
      title: 'Backend Operations Console',
      description: 'Monitor case throughput, pipeline health, audit risk, and service posture from one command surface.',
    }
  }

  if (pathname.startsWith('/cases/')) {
    return {
      eyebrow: 'Case Workspace',
      title: 'Case Detail',
      description: 'Inspect uploads, processing stages, linked entities, and audit evidence for the selected investigation.',
    }
  }

  if (pathname.startsWith(adminPaths.cases)) {
    return {
      eyebrow: 'Case Operations',
      title: 'Cases',
      description: 'Track operational case ownership, evidence uploads, processing status, and risk flags at investigation scale.',
    }
  }

  if (pathname.startsWith(adminPaths.ingestion)) {
    return {
      eyebrow: 'Pipeline Control',
      title: 'Ingestion Pipeline',
      description: 'Monitor uploaded datasets, validation outcomes, retry pressure, and failure diagnostics across the intake queue.',
    }
  }

  if (pathname.startsWith(adminPaths.normalization)) {
    return {
      eyebrow: 'Processing Control',
      title: 'Normalization & Processing',
      description: 'Inspect raw-to-standardized mapping, confidence, anomalies, and downstream readiness for intelligence datasets.',
    }
  }

  if (pathname.startsWith(adminPaths.tableEditor)) {
    return {
      eyebrow: 'Governed Data Access',
      title: 'Table Editor',
      description: 'Browse controlled records visually, inspect relationships, and review masked fields without exposing raw SQL workflows.',
    }
  }

  if (pathname.startsWith(adminPaths.database)) {
    return {
      eyebrow: 'Database Workspace',
      title: 'Database',
      description: 'Understand schema structure, storage posture, observability, and logs through a visual backend workspace.',
    }
  }

  if (pathname.startsWith(adminPaths.users)) {
    return {
      eyebrow: 'Identity Governance',
      title: 'Users & Roles',
      description: 'Control accounts, permissions, sessions, and recent activity with security-first administrative guardrails.',
    }
  }

  if (pathname.startsWith(adminPaths.audit)) {
    return {
      eyebrow: 'Immutable Evidence',
      title: 'Audit Trail',
      description: 'Review who changed what, when, and why through a filter-rich forensic event ledger.',
    }
  }

  if (pathname.startsWith(adminPaths.alerts)) {
    return {
      eyebrow: 'Incident Queue',
      title: 'Alerts & Incidents',
      description: 'Acknowledge operational risk, assign follow-up, and investigate linked service, user, case, and export anomalies.',
    }
  }

  if (pathname.startsWith(adminPaths.settings)) {
    return {
      eyebrow: 'Governed Configuration',
      title: 'Settings',
      description: 'Review parser, retention, masking, notification, environment, and feature controls through an audited configuration workspace.',
    }
  }

  return {
    eyebrow: 'Operations',
    title: 'Console',
    description: 'Secure administrative workspace for SHAKTI platform operations.',
  }
}
