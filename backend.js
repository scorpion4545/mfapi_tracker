// Taskdesk website backend: Supabase sign-in + a small document store on the taskdesk_docs table.
(() => {
  const cfg = window.TASKDESK_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return; // local mode

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const TABLE = "taskdesk_docs";
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));

  function makeDb(onError) {
    const listeners = new Map(); // collection -> Set of fire()
    async function fetchCol(col) {
      const { data, error } = await client.from(TABLE).select("id,data").eq("collection", col);
      if (error) { onError(error); return null; }
      return data;
    }
    async function refresh(col) {
      const set = listeners.get(col); if (!set || !set.size) return;
      const rows = await fetchCol(col); if (!rows) return;
      set.forEach(fire => fire(rows));
    }
    client.channel("taskdesk-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, p => {
        const col = (p.new && p.new.collection) || (p.old && p.old.collection);
        if (col) refresh(col); else listeners.forEach((_, c) => refresh(c));
      })
      .subscribe();
    // Fallback refresh in case realtime is blocked on the network.
    setInterval(() => listeners.forEach((_, c) => refresh(c)), 30000);

    const docRef = (col, id) => ({
      id,
      set: async d => {
        const { error } = await client.from(TABLE).upsert({ collection: col, id, data: d, updated_at: new Date().toISOString() });
        if (error) throw { code: error.code === "42501" ? "invalid_argument" : "unavailable", message: error.message };
        refresh(col);
      },
      delete: async () => {
        const { error } = await client.from(TABLE).delete().eq("collection", col).eq("id", id);
        if (error) throw { code: "unavailable", message: error.message };
        refresh(col);
      },
    });
    const colRef = (col, ord) => ({
      doc: id => docRef(col, id || newId()),
      add: async d => { const r = docRef(col, newId()); await r.set(d); return r; },
      orderBy: f => colRef(col, f),
      onSnapshot: (next) => {
        const fire = rows => {
          let docs = rows.map(r => ({ id: r.id, exists: true, data: () => r.data }));
          if (ord) docs.sort((a, b) => (a.data()[ord] ?? 0) - (b.data()[ord] ?? 0));
          next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } });
        };
        if (!listeners.has(col)) listeners.set(col, new Set());
        listeners.get(col).add(fire);
        refresh(col);
        return () => listeners.get(col).delete(fire);
      },
    });
    return { collection: c => colRef(c), doc: p => { const [c, id] = p.split("/"); return docRef(c, id); } };
  }

  function loginScreen() {
    return new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "scrim";
      wrap.style.cssText = "display:grid;place-items:center;background:var(--bg);z-index:60;padding:16px";
      wrap.innerHTML = `
        <form class="glass" id="loginForm" style="width:min(380px,100%);padding:24px;display:flex;flex-direction:column;gap:14px;background:var(--glass2)">
          <div class="brand" style="padding:0"><div class="logo"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg></div><div><b>MfAPIs</b><small>Sign in to Taskdesk</small></div></div>
          <button class="btn" type="button" id="lGoogle" style="justify-content:center;gap:10px" hidden><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.400 13.700 17.700 9.500 24 9.500z"/><path fill="#4285F4" d="M46.100 24.500c0-1.600-.100-3.100-.400-4.500H24v9h12.400c-.500 2.900-2.200 5.300-4.600 7l7.300 5.700c4.300-4 6.800-9.800 7-17.200z"/><path fill="#FBBC05" d="M10.500 28.600c-.500-1.400-.800-3-.800-4.600s.300-3.200.800-4.600l-7.900-6.200C1 16.500 0 20.100 0 24s1 7.500 2.600 10.800l7.900-6.200z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.300-5.700c-2.100 1.400-4.900 2.300-8.600 2.300-6.300 0-11.600-4.200-13.500-10l-7.900 6.200C6.500 42.600 14.600 48 24 48z"/></svg>Continue with Google</button>
          <div class="muted" id="lOr" style="text-align:center;font-size:12px" hidden>or use email and password</div>
          <label class="fl">Email<input id="lEmail" type="email" required autocomplete="email"></label>
          <label class="fl">Password<input id="lPass" type="password" required minlength="6" autocomplete="current-password"></label>
          <div id="lMsg" class="note" hidden></div>
          <button class="btn pri" type="submit" id="lGo" style="justify-content:center">Sign in</button>
          <button class="btn ghost" type="button" id="lSwap" style="justify-content:center">New here? Create an account</button>
        </form>`;
      document.body.appendChild(wrap);
      let mode = "in";
      const msg = (t, kind) => { const m = wrap.querySelector("#lMsg"); m.hidden = !t; m.className = "note " + (kind || ""); m.textContent = t || ""; };
      // Show the Google button only when Google sign-in is switched on in Supabase.
      fetch(cfg.supabaseUrl + "/auth/v1/settings", { headers: { apikey: cfg.supabaseAnonKey } })
        .then(r => r.json()).then(d => { if (d && d.external && d.external.google) { wrap.querySelector("#lGoogle").hidden = false; wrap.querySelector("#lOr").hidden = false; } })
        .catch(() => {});
      wrap.querySelector("#lGoogle").onclick = async () => {
        // Leaves the page for Google, then returns to this same address already signed in.
        const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
        if (error) msg(error.message, "err");
      };
      wrap.querySelector("#lSwap").onclick = () => {
        mode = mode === "in" ? "up" : "in";
        wrap.querySelector("#lGo").textContent = mode === "in" ? "Sign in" : "Create account";
        wrap.querySelector("#lSwap").textContent = mode === "in" ? "New here? Create an account" : "Have an account? Sign in";
        msg("");
      };
      wrap.querySelector("#loginForm").onsubmit = async e => {
        e.preventDefault();
        const email = wrap.querySelector("#lEmail").value.trim().toLowerCase();
        const password = wrap.querySelector("#lPass").value;
        const go = wrap.querySelector("#lGo"); go.disabled = true;
        const { data, error } = mode === "in"
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({ email, password });
        go.disabled = false;
        if (error) { msg(error.message, "err"); return; }
        if (!data.session) { msg("Account created. Check your email for a confirmation link, then sign in.", "ok"); mode = "up"; wrap.querySelector("#lSwap").click(); return; }
        wrap.remove(); resolve(data.session);
      };
    });
  }

  // Signed in but not approved yet: show the request form, the waiting screen, or the rejection notice.
  async function gate(session, email, meta, accessError, signOut) {
    const wrap = document.createElement("div");
    wrap.className = "scrim";
    wrap.style.cssText = "display:grid;place-items:center;background:var(--bg);z-index:60;padding:16px;overflow:auto";
    document.body.appendChild(wrap);
    const card = inner => { wrap.innerHTML = `<div class="glass" style="width:min(460px,100%);padding:24px;display:flex;flex-direction:column;gap:14px;background:var(--glass2)">${inner}</div>`; };
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const foot = `<div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12px">Signed in as ${esc(email)}</span><button class="btn sm ghost" type="button" id="gOut">Sign out</button></div>`;
    const wire = () => { const o = wrap.querySelector("#gOut"); if (o) o.onclick = signOut; const r = wrap.querySelector("#gAgain"); if (r) r.onclick = () => location.reload(); };

    if (accessError) { card(`<h2>Couldn't check your access</h2><div class="muted">${esc(accessError.message)}. The workspace owner may need to run schema.sql in Supabase.</div>${foot}`); wire(); return; }

    const { data: req, error } = await client.from("taskdesk_requests").select("*").eq("user_id", session.user.id).maybeSingle();
    if (error) { card(`<h2>Couldn't load your request</h2><div class="muted">${esc(error.message)}. The workspace owner may need to run the latest schema.sql in Supabase.</div>${foot}`); wire(); return; }

    const waiting = r => { card(`<h2>Waiting for approval</h2><div class="muted">Your request was sent on ${new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. The workspace admin needs to approve it before you can see any tasks.</div><div class="note"><b>${esc(r.name)}</b>${r.role ? " · " + esc(r.role) : ""}<br><span class="muted">${esc(r.email)}</span></div><button class="btn pri" type="button" id="gAgain" style="justify-content:center">Check again</button>${foot}`); wire(); };
    if (req && req.status === "pending") return waiting(req);
    if (req && req.status === "rejected") { card(`<h2>Request not approved</h2><div class="muted">The workspace admin didn't approve access for ${esc(email)}. Contact them if you think this is a mistake.</div>${foot}`); wire(); return; }
    if (req && req.status === "approved") { card(`<h2>Access is being set up</h2><div class="muted">Your request was approved. Reload in a moment.</div><button class="btn pri" type="button" id="gAgain" style="justify-content:center">Reload</button>${foot}`); wire(); return; }

    card(`<form id="gForm" style="display:flex;flex-direction:column;gap:14px">
      <div><h2>Request access to Taskdesk</h2><div class="muted" style="margin-top:4px">Tell the admin who you are. You'll get in once they approve.</div></div>
      <label class="fl">Full name<input id="gName" required maxlength="80" value="${esc(meta.full_name || meta.name || "")}" autocomplete="name"></label>
      <label class="fl">Role or team<input id="gRole" required maxlength="80" placeholder="e.g. Data analyst"></label>
      <label class="fl">Phone (optional)<input id="gPhone" type="tel" maxlength="20" autocomplete="tel"></label>
      <label class="fl">Why you need access (optional)<textarea id="gNote" rows="3" maxlength="400"></textarea></label>
      <div id="gMsg" class="note err" hidden></div>
      <button class="btn pri" type="submit" id="gSend" style="justify-content:center">Send request</button>
    </form>${foot}`);
    wire();
    wrap.querySelector("#gForm").onsubmit = async e => {
      e.preventDefault();
      const v = id => wrap.querySelector(id).value.trim();
      const row = { email: email.toLowerCase(), name: v("#gName"), role: v("#gRole"), phone: v("#gPhone") || null, note: v("#gNote") || null };
      const btn = wrap.querySelector("#gSend"); btn.disabled = true;
      const { data, error } = await client.from("taskdesk_requests").insert(row).select().single();
      if (error) { btn.disabled = false; const m = wrap.querySelector("#gMsg"); m.hidden = false; m.textContent = "Couldn't send the request: " + error.message; return; }
      waiting(data);
    };
  }

  window.TaskdeskBackend = {
    name: "Supabase",
    async start(onError) {
      let { data: { session } } = await client.auth.getSession();
      if (!session) session = await loginScreen();
      const email = session.user.email || "";
      const meta = session.user.user_metadata || {};
      const signOut = async () => { await client.auth.signOut(); location.reload(); };
      const { data: ok, error } = await client.rpc("taskdesk_is_member");
      if (error || !ok) { await gate(session, email, meta, error, signOut); return null; }
      const { data: isAdmin } = await client.rpc("taskdesk_is_admin");
      const fail = e => { throw { code: e.code === "42501" ? "invalid_argument" : "unavailable", message: e.message }; };
      return {
        db: makeDb(onError),
        me: { id: session.user.id, name: meta.full_name || meta.name || email.split("@")[0], email },
        isAdmin: !!isAdmin,
        signOut,
        // Admin tools (the database refuses these for anyone who isn't an admin).
        async listRequests() { const { data, error } = await client.from("taskdesk_requests").select("*").order("created_at", { ascending: false }); if (error) fail(error); return data; },
        async listMembers() { const { data, error } = await client.from("taskdesk_members").select("email,name,is_admin,added_at").order("added_at"); if (error) fail(error); return data; },
        async decide(userId, approve) { const { error } = await client.rpc("taskdesk_decide_request", { req_user: userId, approve }); if (error) fail(error); },
        async removeMember(memberEmail) { const { error } = await client.rpc("taskdesk_remove_member", { member_email: memberEmail }); if (error) fail(error); },
      };
    },
  };
})();
