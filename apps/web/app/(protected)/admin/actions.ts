"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  acceptInvite,
  addMembership,
  assignRole,
  createTenant,
  inviteUser,
  removeMembership,
  revokeInvite,
  revokeRole,
  switchActiveTenant,
  updateTenantSettings,
} from "@/lib/admin";
import { roleSchema, uuidSchema } from "@/lib/admin-schemas";

type ActionResult<T = void> =
  | { ok: true; data: T extends void ? undefined : T }
  | { ok: false; error: string };

function success<T = void>(data?: T): ActionResult<T> {
  revalidatePath("/admin");
  if (typeof data === "undefined") {
    return { ok: true, data: undefined } as ActionResult<T>;
  }

  return { ok: true, data } as ActionResult<T>;
}

function failure(error: unknown): ActionResult<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error occurred",
  };
}

export async function createTenantAction(raw: unknown) {
  try {
    const input = z
      .object({
        code: z.string().min(2, "Code must be at least 2 characters"),
        name: z.string().min(2, "Name must be at least 2 characters"),
      })
      .parse(raw);
    const tenant = await createTenant({
      code: input.code,
      name: input.name,
    });
    return success(tenant);
  } catch (error) {
    return failure(error);
  }
}

export async function inviteUserAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        email: z.string().email("Enter a valid email address"),
        role: roleSchema,
      })
      .parse(raw);
    const result = await inviteUser({
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
    });
    return success(result);
  } catch (error) {
    return failure(error);
  }
}

export async function revokeInviteAction(raw: unknown) {
  try {
    const input = z.object({ id: uuidSchema }).parse(raw);
    await revokeInvite({ id: input.id });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function acceptInviteAction(raw: unknown) {
  try {
    const input = z
      .object({
        token: z.string().min(10, "Token appears invalid"),
      })
      .parse(raw);
    const result = await acceptInvite({ token: input.token });
    revalidatePath("/dashboard");
    return success(result);
  } catch (error) {
    return failure(error);
  }
}

export async function addMembershipAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        userId: uuidSchema,
        role: roleSchema,
      })
      .parse(raw);
    await addMembership({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function removeMembershipAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        userId: uuidSchema,
        role: roleSchema,
      })
      .parse(raw);
    await removeMembership({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function assignRoleAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        userId: uuidSchema,
        role: roleSchema,
      })
      .parse(raw);
    await assignRole({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function revokeRoleAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        userId: uuidSchema,
        role: roleSchema,
      })
      .parse(raw);
    await revokeRole({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function switchActiveTenantAction(raw: unknown) {
  try {
    const input = z.object({ tenantId: uuidSchema }).parse(raw);
    const result = await switchActiveTenant({ tenantId: input.tenantId });
    revalidatePath("/dashboard");
    return success(result);
  } catch (error) {
    return failure(error);
  }
}

export async function updateTenantSettingsAction(raw: unknown) {
  try {
    const input = z
      .object({
        tenantId: uuidSchema,
        settings: z.record(z.any()),
      })
      .parse(raw);
    const result = await updateTenantSettings({
      tenantId: input.tenantId,
      settings: input.settings,
    });
    return success(result);
  } catch (error) {
    return failure(error);
  }
}
