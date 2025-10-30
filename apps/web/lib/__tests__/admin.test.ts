import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptInvite,
  switchActiveTenant,
} from "../admin";
import { roleSchema } from "@/lib/admin-schemas";
import { getUserProfile } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

vi.mock("@/lib/rbac", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac")>(
    "@/lib/rbac",
  );
  return {
    ...actual,
    getUserProfile: vi.fn(),
  };
});

vi.mock("@/utils/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/events", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const getUserProfileMock = vi.mocked(getUserProfile);
const createServerSupabaseClientMock = vi.mocked(
  createServerSupabaseClient,
);

function resolved<T>(value: T) {
  return Promise.resolve(value);
}

describe("admin utilities", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    getUserProfileMock.mockResolvedValue({
      session: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
      profile: {
        id: "user-1",
        role: "viewer",
        tenant_id: "tenant-1",
        full_name: null,
        created_at: null,
        is_platform_admin: false,
      },
    });
  });

  it("rejects invalid roles in admin server actions schema", () => {
    expect(() => roleSchema.parse("not-a-role")).toThrowError(/Invalid role/i);
    expect(() => roleSchema.parse("admin")).not.toThrow();
  });

  it("switchActiveTenant refuses tenants without membership", async () => {
    const membershipsQuery = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    };

    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "memberships") {
          return membershipsQuery;
        }
        if (table === "profiles") {
          return {
            update: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          update: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };

    createServerSupabaseClientMock.mockReturnValue(
      resolved(supabaseMock),
    );

    await expect(
      switchActiveTenant({ tenantId: "tenant-2" }),
    ).rejects.toThrowError(/do not belong/i);
  });

  it("acceptInvite updates membership and active tenant", async () => {
    const invite = {
      id: "invite-1",
      tenant_id: "tenant-2",
      email: "user@example.com",
      role: "admin",
      status: "pending",
      expires_at: null,
    };

    const inviteSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: invite,
          error: null,
        }),
      }),
    });

    const inviteUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const inviteUpdate = vi.fn().mockReturnValue({
      eq: inviteUpdateEq,
    });

    const membershipsUpsert = vi.fn().mockResolvedValue({ error: null });
    const profileUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const profileUpdate = vi.fn().mockReturnValue({
      eq: profileUpdateEq,
    });

    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "invites") {
          return {
            select: inviteSelect,
            update: inviteUpdate,
          };
        }
        if (table === "memberships") {
          return {
            upsert: membershipsUpsert,
          };
        }
        if (table === "profiles") {
          return {
            update: profileUpdate,
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };

    createServerSupabaseClientMock.mockReturnValue(
      resolved(supabaseMock),
    );

    const result = await acceptInvite({ token: "token-123" });

    expect(result).toEqual({ tenantId: "tenant-2", role: "admin" });
    expect(membershipsUpsert).toHaveBeenCalledWith(
      {
        tenant_id: "tenant-2",
        user_id: "user-1",
        role: "admin",
      },
      { onConflict: "tenant_id,user_id,role" },
    );
    expect(profileUpdate).toHaveBeenCalledWith({
      tenant_id: "tenant-2",
      role: "admin",
    });
    expect(profileUpdateEq).toHaveBeenCalledWith("id", "user-1");
    expect(inviteUpdate).toHaveBeenCalledWith({ status: "accepted" });
    expect(inviteUpdateEq).toHaveBeenCalledWith("id", "invite-1");
  });
});
