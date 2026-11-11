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
          <div class="brand" style="padding:0"><div class="logo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18V9l4 5 4-8 4 6 4-7v13"/></svg></div><div><b>mf<span>api</span></b><small>Sign in to Taskdesk</small></div></div>
          <label class="fl">Email<input id="lEmail" type="email" required autocomplete="email"></label>
          <label class="fl">Password<input id="lPass" type="password" required minlength="6" autocomplete="current-password"></label>
          <div id="lMsg" class="note" hidden></div>
          <button class="btn pri" type="submit" id="lGo" style="justify-content:center">Sign in</button>
          <button class="btn ghost" type="button" id="lSwap" style="justify-content:center">New here? Create an account</button>
        </form>`;
      document.body.appendChild(wrap);
      let mode = "in";
      const msg = (t, kind) => { const m = wrap.querySelector("#lMsg"); m.hidden = !t; m.className = "note " + (kind || ""); m.textContent = t || ""; };
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

  window.TaskdeskBackend = {
    name: "Supabase",
    async start(onError) {
      let { data: { session } } = await client.auth.getSession();
      if (!session) session = await loginScreen();
      const { data: ok, error } = await client.rpc("taskdesk_is_member");
      if (error || !ok) {
        const email = session.user.email;
        document.body.insertAdjacentHTML("beforeend", `<div class="scrim" style="display:grid;place-items:center;background:var(--bg);z-index:60;padding:16px"><div class="glass" style="width:min(420px,100%);padding:24px;display:flex;flex-direction:column;gap:12px;background:var(--glass2)"><h2>Not on the team list yet</h2><div class="muted" id="lDeny"></div><button class="btn" id="lOut">Sign out</button></div></div>`);
        document.getElementById("lDeny").textContent = error
          ? "Couldn't check access: " + error.message + ". Make sure schema.sql has been run in Supabase."
          : `${email} isn't in the taskdesk_members table. Ask the workspace owner to add it, then reload.`;
        document.getElementById("lOut").onclick = async () => { await client.auth.signOut(); location.reload(); };
        return null;
      }
      const email = session.user.email || "";
      return {
        db: makeDb(onError),
        me: { id: session.user.id, name: email.split("@")[0], email },
        signOut: async () => { await client.auth.signOut(); location.reload(); },
      };
    },
  };
})();
