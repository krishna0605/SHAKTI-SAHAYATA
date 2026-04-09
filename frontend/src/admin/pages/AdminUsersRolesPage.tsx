import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '../../lib/apiClient'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, formatTimestamp, titleCase } from '../lib/format'
import { OpsDataTable, OpsDefinitionList, OpsDrawerInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsSummaryStrip } from '../components/OpsPrimitives'
import AdminRecentAuthDialog from '../components/AdminRecentAuthDialog'
import type { AdminSessionRow, OfficerAdminUserRow } from '../types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function AdminUsersRolesPage() {
  const queryClient = useQueryClient()
  const [recentAuthOpen, setRecentAuthOpen] = useState(false)
  const [selectedSession, setSelectedSession] = useState<AdminSessionRow | null>(null)
  const [selectedUser, setSelectedUser] = useState<OfficerAdminUserRow | null>(null)

  const usersQuery = useQuery({
    queryKey: ['ops-users'],
    queryFn: () => adminConsoleAPI.getUsers(),
    refetchInterval: 30000,
  })

  const sessionsQuery = useQuery({
    queryKey: ['ops-sessions'],
    queryFn: () => adminConsoleAPI.getSessions(true),
    refetchInterval: 15000,
  })

  const forceLogoutMutation = useMutation({
    mutationFn: (session: AdminSessionRow) => adminConsoleAPI.forceLogout(session.id, session.session_type, 'Governed session termination from Users & Roles'),
    onSuccess: async () => {
      toast.success('Session terminated successfully.')
      setSelectedSession(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-users'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-sessions'] }),
      ])
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'RECENT_ADMIN_AUTH_REQUIRED') {
        setRecentAuthOpen(true)
        return
      }
      toast.error(error instanceof Error ? error.message : 'Failed to terminate session.')
    },
  })

  const permissionRows = useMemo(
    () => [
      ['Create Case', 'Super Admin, System Admin, Investigator'],
      ['Edit Case', 'Super Admin, System Admin, Assigned Investigator'],
      ['Reassign Case', 'Super Admin, Supervisor'],
      ['Upload Files', 'Super Admin, Investigator, Analyst'],
      ['Re-run Normalization', 'Super Admin, Technical Administrator'],
      ['Edit Table Rows', 'Super Admin, Database Admin'],
      ['View Sensitive Fields', 'Super Admin, Security Reviewer'],
      ['Export Data', 'Super Admin, Supervisor, Read-only Auditor'],
      ['View Logs', 'Super Admin, Technical Administrator, Security Reviewer'],
      ['View Audit Trail', 'All admin console roles'],
      ['Manage Users', 'Super Admin, System Admin'],
      ['Manage Settings', 'Super Admin only'],
    ],
    [],
  )

  if (usersQuery.isLoading || sessionsQuery.isLoading) {
    return <div className="page-loading">Loading users and roles...</div>
  }

  if (usersQuery.isError || sessionsQuery.isError || !usersQuery.data || !sessionsQuery.data) {
    return <OpsPageState title="Users workspace unavailable" description="Identity governance data could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const officers = usersQuery.data.officers
  const admins = usersQuery.data.admins
  const sessions = [...sessionsQuery.data.officerSessions, ...sessionsQuery.data.adminSessions]

  return (
    <div className="min-w-0 space-y-5">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Total Users" value={formatNumber(usersQuery.data.summary.totalOfficers + usersQuery.data.summary.totalAdmins)} detail="Officer and admin accounts in scope." />
        <OpsMetricTile label="Active Today" value={formatNumber(usersQuery.data.summary.activeOfficerSessions + usersQuery.data.summary.activeAdminSessions)} detail="Current live session footprint." tone="info" />
        <OpsMetricTile label="Locked Accounts" value={formatNumber([...officers, ...admins].filter((item) => item.is_active === false).length)} detail="Restricted accounts requiring review." tone="warning" />
        <OpsMetricTile label="Role Coverage" value={formatNumber(admins.length)} detail="Administrative identities provisioned." />
      </OpsSummaryStrip>

      <OpsSection title="Identity workspace" description="Accounts, sessions, and permission scope in one flatter operator surface.">
        <Tabs defaultValue="users" className="min-w-0 space-y-4">
          <TabsList className="inline-flex h-auto w-auto flex-wrap justify-start rounded-lg border border-white/8 bg-[#0f1218] p-1">
            <TabsTrigger value="users" className="rounded-md px-3 py-2">Users</TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-md px-3 py-2">Active Sessions</TabsTrigger>
            <TabsTrigger value="permissions" className="rounded-md px-3 py-2">Permission Matrix</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="min-w-0 space-y-4">
            <OpsSection title="Officer accounts" description="Operational users creating cases, uploading evidence, and reviewing results.">
              <OpsDataTable
                columns={[
                  { key: 'name', header: 'Name', render: (row) => <div><div className="font-medium">{row.full_name}</div><div className="text-xs text-muted-foreground">{row.email}</div></div> },
                  { key: 'role', header: 'Role', render: (row) => <OpsStatusBadge label={titleCase(row.role)} tone="neutral" /> },
                  { key: 'department', header: 'Department / Unit', render: (row) => row.department || row.station || 'Unspecified' },
                  { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={row.is_active ? 'Active' : 'Restricted'} tone={row.is_active ? 'success' : 'warning'} /> },
                  { key: 'lastLogin', header: 'Last Login', render: (row) => formatTimestamp(row.last_login) },
                  { key: 'cases', header: 'Cases Assigned', render: (row) => formatNumber(row.open_cases || row.total_cases || 0) },
                ]}
                rows={officers}
                rowKey={(row) => String(row.id)}
                onRowClick={(row) => setSelectedUser(row)}
              />
            </OpsSection>

            <OpsSection title="Administrative roles" description="Console operators with governed access to system-level surfaces.">
              <OpsDataTable
                columns={[
                  { key: 'name', header: 'Name', render: (row) => <div><div className="font-medium">{row.full_name}</div><div className="text-xs text-muted-foreground">{row.email}</div></div> },
                  { key: 'role', header: 'Role', render: (row) => <OpsStatusBadge label={titleCase(row.role)} tone="info" /> },
                  { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={row.is_active ? 'Active' : 'Restricted'} tone={row.is_active ? 'success' : 'warning'} /> },
                  { key: 'activity', header: 'Recent Actions', render: (row) => formatNumber(row.recent_actions_7d) },
                  { key: 'sessions', header: 'Live Sessions', render: (row) => formatNumber(row.active_sessions) },
                ]}
                rows={admins}
                rowKey={(row) => `admin-${row.id}`}
              />
            </OpsSection>
          </TabsContent>

          <TabsContent value="sessions" className="min-w-0">
            <OpsDataTable
              columns={[
                { key: 'actor', header: 'Actor', render: (row) => <div><div className="font-medium">{row.actor_name}</div><div className="text-xs text-muted-foreground">{row.actor_email}</div></div> },
                { key: 'type', header: 'Type', render: (row) => <OpsStatusBadge label={titleCase(row.session_type)} tone={row.session_type === 'admin' ? 'info' : 'neutral'} /> },
                { key: 'started', header: 'Started', render: (row) => formatTimestamp(row.started_at) },
                { key: 'ip', header: 'IP', render: (row) => <span className="font-mono text-xs">{row.ip_address || 'Unknown'}</span> },
                {
                  key: 'action',
                  header: 'Action',
                  render: (row) => (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedSession(row)
                      }}
                    >
                      Force Logout
                    </Button>
                  ),
                },
              ]}
              rows={sessions}
              rowKey={(row) => row.id}
            />
          </TabsContent>

          <TabsContent value="permissions" className="min-w-0">
            <OpsDataTable
              columns={[
                { key: 'permission', header: 'Permission', render: (row) => <span className="font-medium">{row[0]}</span> },
                { key: 'scope', header: 'Allowed Roles', render: (row) => row[1] },
              ]}
              rows={permissionRows}
              rowKey={(row) => row[0]}
            />
          </TabsContent>
        </Tabs>
      </OpsSection>

      <OpsDrawerInspector
        open={Boolean(selectedUser)}
        onOpenChange={(open) => {
          if (!open) setSelectedUser(null)
        }}
        title={selectedUser?.full_name || 'User inspector'}
        subtitle={selectedUser?.email || 'Select an account row to inspect profile context.'}
      >
        {selectedUser ? (
          <div className="space-y-5">
            <OpsDefinitionList
              items={[
                { label: 'Role', value: titleCase(selectedUser.role) },
                { label: 'Department', value: selectedUser.department || 'Unspecified' },
                { label: 'Station', value: selectedUser.station || 'Unspecified' },
                { label: 'Status', value: selectedUser.is_active ? 'Active' : 'Restricted' },
                { label: 'Last Login', value: formatTimestamp(selectedUser.last_login) },
                { label: 'Recent Actions', value: formatNumber(selectedUser.recent_actions_7d) },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <OpsMetricTile label="Open Cases" value={formatNumber(selectedUser.open_cases || 0)} detail="Currently assigned investigations." tone="info" />
              <OpsMetricTile label="Sessions" value={formatNumber(selectedUser.active_sessions)} detail={`${formatNumber(selectedUser.login_count || 0)} total logins`} />
            </div>
            <div className="ops-subpanel">
              <div className="ops-subpanel-title">Permission scope</div>
              <p className="text-sm text-muted-foreground">Role-based permissions are enforced server-side. Sensitive data visibility and write paths remain explicitly gated and audited.</p>
            </div>
          </div>
        ) : (
          <OpsPageState title="No user selected" description="Choose an account from the table to inspect profile, role, and session context." />
        )}
      </OpsDrawerInspector>

      <AdminRecentAuthDialog
        open={recentAuthOpen}
        onOpenChange={setRecentAuthOpen}
        title="Recent auth required"
        description="Session termination is a governed action. Re-authenticate before forcing logout."
        onSuccess={async () => {
          setRecentAuthOpen(false)
          if (selectedSession) {
            await forceLogoutMutation.mutateAsync(selectedSession)
          }
        }}
      />
    </div>
  )
}
