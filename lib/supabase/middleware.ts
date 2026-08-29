import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Signed-out only: a signed-in user landing here is bounced to the dashboard,
// because these pages exist to get them a session they already have.
const PUBLIC_PATHS = ["/login", "/signup"];

// Open to absolutely everyone, signed in or not. §7.6: the confirmation link is
// "single-use, 7-day expiry, no login required", and §8 calls it "the
// guardian's most common entry point; treat it as a real screen, not a
// redirect."
//
// It needs its own category rather than joining PUBLIC_PATHS, because the
// signed-in half of that rule would break it in the most confusing way
// available: a guardian who happens to still have a session on their phone taps
// Yes in their email and gets silently redirected to the dashboard, their answer
// never recorded and nothing on screen explaining why.
const OPEN_PATHS = ["/c"];

function matchesPath(paths: string[], pathname: string) {
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API routes answer their own callers directly - JSON errors, not a
  // redirect to an HTML login page a fetch() or an external cron hit could
  // never follow. Every route under here already does its own auth (the
  // scan parse route's own getUser() + 401 JSON; the cron route's own
  // Authorization: Bearer check, from a caller that has no session cookie
  // at all) - this proxy only decides page navigation.
  if (pathname.startsWith("/api/")) {
    return response;
  }

  if (matchesPath(OPEN_PATHS, pathname)) {
    return response;
  }

  const isPublic = matchesPath(PUBLIC_PATHS, pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
