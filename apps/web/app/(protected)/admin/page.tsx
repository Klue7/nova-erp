import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { guardRoute, type Role } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import {
  listUserMemberships,
} from "@/lib/admin";
import { AcceptInviteCard } from "./components/accept-invite-card";
import { AuditTable } from "./components/audit-table";
import { CreateTenantDialog } from "./components/create-tenant-dialog";
import { InviteUserDialog } from "./components/invite-user-dialog";
import { InvitesTable } from "./components/invites-table";
import { MembershipActionDialog } from "./components/membership-actions";
import { TenantSettingsCard } from "./components/tenant-settings-card";
import { TenantSwitcher } from "./components/tenant-switcher";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VIEW_MISSING = "42P01";

type TenantRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string | null;
};

type MembershipRow = {
  user_id: string;
  role: Role;
  created_at: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  role: Role;
  status: string;
  expires_at: string | null;
  created_at: string | null;
};

type AuditRow = {
  occurred_at: string;
  aggregate_type: string;
  event_type: string;
  actor_role: string;
  payload: Record<string, unknown>;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminPage() {
  const { profile } = await guardRoute({
    requiredRole: ["admin", "platform_admin"],
  });

  if (!profile) {
    throw new Error("Profile required");
  }

  const supabase = await createServerSupabaseClient();

  const [
    tenantsResult,
    activeTenantResult,
    membershipsResult,
    invitesResult,
    auditResult,
    settingsResult,
    membershipsList,
  ] = await Promise.all([
    profile.is_platform_admin
      ? supabase
          .from("tenants")
          .select("id, code, name, status, created_at")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as TenantRow[], error: null }),
    supabase
      .from("tenants")
      .select("id, code, name, status, created_at")
      .eq("id", profile.tenant_id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("user_id, role, created_at")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true }),
    supabase
      .from("invites")
      .select("id, email, role, status, expires_at, created_at")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("admin_audit_v")
      .select("occurred_at, aggregate_type, event_type, actor_role, payload")
      .eq("tenant_id", profile.tenant_id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("tenant_settings")
      .select("settings")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle(),
    listUserMemberships(),
  ]);

  const tenants: TenantRow[] = tenantsResult.data ?? [];
  const activeTenant = activeTenantResult.data ?? null;
  const memberships: MembershipRow[] =
    (membershipsResult.data ?? []).map((member) => ({
      user_id: member.user_id,
      role: member.role as Role,
      created_at: member.created_at,
    }));
  const invites: InviteRow[] =
    (invitesResult.data ?? []).map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role as Role,
      status: invite.status,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
    }));

  if (tenantsResult.error) {
    console.error("admin.tenants", tenantsResult.error);
  }
  if (activeTenantResult.error) {
    console.error("admin.activeTenant", activeTenantResult.error);
  }
  if (membershipsResult.error) {
    console.error("admin.memberships", membershipsResult.error);
  }
  if (invitesResult.error && invitesResult.error.code !== VIEW_MISSING) {
    console.error("admin.invites", invitesResult.error);
  }
  if (auditResult.error && auditResult.error.code !== VIEW_MISSING) {
    console.error("admin.audit", auditResult.error);
  }
  if (settingsResult.error) {
    console.error("admin.settings", settingsResult.error);
  }

  const auditRows: AuditRow[] =
    auditResult.error && auditResult.error.code === VIEW_MISSING
      ? []
      : auditResult.data ?? [];

  const tenantSettings =
    settingsResult.data && "settings" in settingsResult.data
      ? ((settingsResult.data.settings as Record<string, unknown>) ?? {})
      : {};

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Admin &amp; Tenancy
          </h1>
          <Badge variant="secondary">
            Active tenant:{" "}
            {activeTenant?.name ?? activeTenant?.code ?? profile.tenant_id}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage tenants, tenant memberships, invitations, and the audit trail
          for the current tenant context.
        </p>
      </header>

      <Tabs
        defaultValue={profile.is_platform_admin ? "tenants" : "members"}
        className="space-y-6"
      >
        <TabsList className="flex w-full flex-wrap gap-2 bg-muted/60 p-1">
          <TabsTrigger value="tenants" disabled={!profile.is_platform_admin}>
            Tenants
          </TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="my-tenants">My Tenants</TabsTrigger>
        </TabsList>

        <TabsContent value="tenants" className="space-y-4">
          {profile.is_platform_admin ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium text-foreground">
                    Tenant directory
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Platform administrators can provision and review all tenants
                    across Nova ERP.
                  </p>
                </div>
                <CreateTenantDialog />
              </div>
              <TenantsTable tenants={tenants} />
            </>
          ) : (
            <Card className="p-6 text-sm text-muted-foreground">
              Only platform administrators can view the full tenant directory.
            </Card>
          )}
        </TabsContent>

        <TabsContent value="members" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-foreground">
                Tenant members
              </h2>
              <p className="text-sm text-muted-foreground">
                Memberships define which Supabase Auth users can access this
                tenant and which module-level roles they hold.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <MembershipActionDialog tenantId={profile.tenant_id} action="add" />
              <MembershipActionDialog
                tenantId={profile.tenant_id}
                action="assign"
              />
              <MembershipActionDialog
                tenantId={profile.tenant_id}
                action="remove"
              />
              <MembershipActionDialog
                tenantId={profile.tenant_id}
                action="revoke"
              />
            </div>
          </div>
          <MembersTable memberships={memberships} />
          <TenantSettingsCard
            tenantId={profile.tenant_id}
            initialSettings={tenantSettings}
          />
        </TabsContent>

        <TabsContent value="invites" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-foreground">Invites</h2>
              <p className="text-sm text-muted-foreground">
                Generate invites for teammates or revoke pending invitations. Use
                the developer helper to accept tokens manually.
              </p>
            </div>
            <InviteUserDialog tenantId={profile.tenant_id} />
          </div>
          <InvitesTable invites={invites} />
          <AcceptInviteCard />
        </TabsContent>

        <TabsContent value="audit">
          <div className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">Audit log</h2>
            <p className="text-sm text-muted-foreground">
              Events emitted within this tenant across all aggregates. Filter by
              aggregate, event type, actor role, or payload contents.
            </p>
            <AuditTable rows={auditRows} />
          </div>
        </TabsContent>

        <TabsContent value="my-tenants">
          <TenantSwitcher
            memberships={membershipsList}
            activeTenantId={profile.tenant_id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TenantsTable({ tenants }: { tenants: TenantRow[] }) {
  if (tenants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tenants exist yet. Create one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Tenant ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow key={tenant.id}>
              <TableCell className="font-medium">{tenant.name}</TableCell>
              <TableCell>{tenant.code}</TableCell>
              <TableCell className="capitalize">
                <Badge variant="outline">{tenant.status}</Badge>
              </TableCell>
              <TableCell>{formatDate(tenant.created_at)}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {tenant.id}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MembersTable({ memberships }: { memberships: MembershipRow[] }) {
  if (memberships.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No members have been added yet. Invite a user or add a membership
        directly.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((member) => (
            <TableRow key={`${member.user_id}-${member.role}`}>
              <TableCell className="font-mono text-sm">
                {member.user_id}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{member.role}</Badge>
              </TableCell>
              <TableCell>{formatDate(member.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
