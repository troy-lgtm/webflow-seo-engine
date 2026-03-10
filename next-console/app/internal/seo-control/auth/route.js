import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const expected = process.env.INTERNAL_DASHBOARD_KEY;

  if (!expected || key === expected) {
    const response = NextResponse.redirect(new URL("/internal/seo-control", request.url));
    if (expected) {
      response.cookies.set("seo_dash_key", key, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
    }
    return response;
  }

  return NextResponse.redirect(new URL("/internal/seo-control?error=invalid_key", request.url));
}
