import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: "Missing environment variables" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing token" });

  const { site_id, email, role } = (req.body && typeof req.body === "object") ? req.body : {};
  if (!site_id || !email) return res.status(400).json({ error: "site_id and email required" });

  const lowerEmail = String(email).toLowerCase().trim();
  const safeRole = role === "admin" ? "admin" : "member";

  // Client for the currently logged-in user
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: caller, error: profErr } = await userClient
    .from("profiles")
    .select("site_id, role")
    .single();

  if (profErr) return res.status(400).json({ error: profErr.message });

  const isAdminish = caller && caller.site_id === Number(site_id) && ["owner", "admin"].includes(caller.role);
  if (!isAdminish) return res.status(403).json({ error: "Forbidden" });

  // Admin client (service role) to send invite + pre-create profile
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(lowerEmail, {
    redirectTo: `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/thanks.html`
  });

  if (invErr) return res.status(400).json({ error: invErr.message });

  const invitedUserId = invited?.user?.id;
  if (invitedUserId) {
    await admin.from("profiles").upsert(
      { user_id: invitedUserId, site_id: Number(site_id), role: safeRole },
      { onConflict: "user_id" }
    );
  }

  return res.status(200).json({ ok: true });
}