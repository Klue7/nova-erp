import { z } from "zod";

import { ROLE_VALUES } from "@/lib/roles";

export const roleSchema = z.enum(ROLE_VALUES);

export const uuidSchema = z.string().uuid("Invalid identifier provided");
