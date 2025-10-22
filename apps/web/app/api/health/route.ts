import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    // Lightweight `select 1` equivalent to confirm connectivity without
    // materializing data.
    const { error } = await supabase
      .from("profiles")
      .select("id", { head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("api.health", error);
    return NextResponse.json(
      { ok: false },
      { status: 500 },
    );
  }
}
