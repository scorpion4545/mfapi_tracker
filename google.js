// Taskdesk website: Google sign-in for reading linked sheets and creating the merged sheet.
// Uses Google Identity Services (browser-only token, no server secret) and the Sheets API.
(() => {
  const clientId = (window.TASKDESK_CONFIG || {}).googleClientId;
  if (!clientId) return; // feature off until a Client ID is set in config.js

  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly", // read sheets you can open
    "https://www.googleapis.com/auth/drive.file",            // create the merged sheet in your Drive
  ].join(" ");
  let token = null, expiresAt = 0, client = null;

  function getToken(forcePrompt) {
    return new Promise((resolve, reject) => {
      if (!forcePrompt && token && Date.now() < expiresAt - 60000) return resolve(token);
      if (!window.google || !google.accounts || !google.accounts.oauth2)
        return reject(new Error("Google sign-in didn't load. Check your connection and reload the page."));
      client = client || google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
      client.callback = r => {
        if (r.error) return reject(new Error(r.error === "access_denied" ? "Google access was not allowed." : (r.error_description || r.error)));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(" ")))
          return reject(new Error("Allow both Google permissions (read sheets and create files) to merge sheets."));
        token = r.access_token; expiresAt = Date.now() + r.expires_in * 1000; resolve(token);
      };
      client.error_callback = e => reject(new Error(e && e.type === "popup_closed" ? "The Google sign-in window was closed before finishing."
        : e && e.type === "popup_failed_to_open" ? "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again."
        : "Google sign-in failed."));
      client.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
    });
  }

  async function api(url, opts = {}) {
    const t = await getToken(false);
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + t, "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) { token = null; throw new Error("Your Google sign-in expired. Click Connect Google and try again."); }
      if (r.status === 403 || r.status === 404) throw new Error("You don't have access to this sheet in Google, or the link is wrong. Ask its owner to share it with your Google account.");
      throw new Error((j.error && j.error.message) || "Google returned an error (" + r.status + ").");
    }
    return j;
  }

  const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
  window.TaskdeskGoogle = {
    isSignedIn: () => !!token && Date.now() < expiresAt - 60000,
    signIn: () => getToken(true),
    // Returns {title, tables: [{tab, header, rows}]}, one table per non-empty tab.
    async readSheet(id) {
      const meta = await api(`${SHEETS}/${encodeURIComponent(id)}?fields=properties.title,sheets.properties.title`);
      const tabs = (meta.sheets || []).map(s => s.properties.title);
      if (!tabs.length) return { title: meta.properties.title, tables: [] };
      const q = tabs.map(t => "ranges=" + encodeURIComponent("'" + t.replace(/'/g, "''") + "'")).join("&");
      const vals = await api(`${SHEETS}/${encodeURIComponent(id)}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`);
      const tables = (vals.valueRanges || []).map((vr, i) => ({ tab: tabs[i], values: (vr.values || []).filter(r => r.some(c => String(c).trim() !== "")) }))
        .filter(t => t.values.length)
        .map(t => ({ tab: t.tab, header: t.values[0].map(String), rows: t.values.slice(1) }));
      return { title: meta.properties.title, tables };
    },
    // Creates a new Google Sheet with one "Merged" tab and returns {id, url}.
    async createSheet(title, cols, rows) {
      const s = await api(SHEETS, { method: "POST", body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "Merged", gridProperties: { frozenRowCount: 1 } } }] }) });
      await api(`${SHEETS}/${s.spreadsheetId}/values/${encodeURIComponent("Merged!A1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [cols, ...rows] }) });
      return { id: s.spreadsheetId, url: s.spreadsheetUrl };
    },
  };
})();
