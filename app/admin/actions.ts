"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/supabase-admin";

const AUTH_COOKIE = "admin-auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type LoginState = { error?: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { error: "ADMIN_PASSWORD not configured on the server." };
  }
  if (password !== expected) {
    return { error: "Wrong password." };
  }
  const c = await cookies();
  c.set(AUTH_COOKIE, password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const c = await cookies();
  c.delete(AUTH_COOKIE);
  redirect("/admin");
}

/**
 * Mark a flag as resolved (no other state changes — caller has decided the
 * resolver's guess is correct, or fixed it manually elsewhere).
 */
export async function resolveFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  if (!flagId) return;
  await adminClient()
    .from("flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);
  revalidatePath("/admin");
}

/**
 * Assign cuisines to a restaurant flagged with `kind = missing_cuisine`.
 * The form sends one or more `cuisines` entries (max 3, validated client-
 * side) plus the flag id. We update the restaurant row and resolve the flag.
 */
export async function assignCuisines(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  const cuisines = formData
    .getAll("cuisines")
    .map(String)
    .filter(Boolean)
    .slice(0, 3);
  if (!flagId || cuisines.length === 0) return;

  const supabase = adminClient();

  // Look up which restaurant this flag is about, then write to it.
  const { data: flag } = await supabase
    .from("flags")
    .select("restaurant_id")
    .eq("id", flagId)
    .single();
  if (!flag?.restaurant_id) return;

  await supabase
    .from("restaurants")
    .update({ cuisines })
    .eq("id", flag.restaurant_id);

  await supabase
    .from("flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}

/**
 * Dismiss a flag — the mention was a false positive (extract pulled
 * something that isn't a real restaurant). Also nulls the extraction's
 * restaurant_id and zeros its vote weight so it stops contributing to
 * scores.
 */
export async function dismissFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  if (!flagId) return;
  const supabase = adminClient();

  const { data: flag } = await supabase
    .from("flags")
    .select("extraction_id")
    .eq("id", flagId)
    .single();

  if (flag?.extraction_id) {
    await supabase
      .from("extractions")
      .update({ restaurant_id: null, vote_weight: 0 })
      .eq("id", flag.extraction_id);
  }

  await supabase
    .from("flags")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}
