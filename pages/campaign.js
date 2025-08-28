import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function Campaigns() {
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    case_name: "",
    geography: "",
    currency: "USD",
    commission_pct: "0",
    claims_agent_pct: "0",
    primary_audience: "",
    is_national: false,
    has_claims_agent: false,
    notes: ""
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase
        .from("campaign")
        .select("id,name,case_name,geography,currency,commission_pct,claims_agent_pct,primary_audience,is_national,has_claims_agent,created_at")
        .order("created_at", { ascending: false });
      if (error) setErr(error.message);
      else setRows(data || []);
      setLoading(false);
    }
    load();
  }, [saving]); // refresh list after save

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (!user) {
      setErr("You must be signed in.");
      return;
    }
    // basic number parsing
    const commission = parseFloat(form.commission_pct || "0");
    const agent = parseFloat(form.claims_agent_pct || "0");
    if (Number.isNaN(commission) || commission < 0) return setErr("Commission must be a non-negative number.");
    if (Number.isNaN(agent) || agent < 0) return setErr("Claims agent % must be a non-negative number.");

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      case_name: form.case_name.trim() || null,
      geography: form.geography.trim() || null,
      currency: form.currency || "USD",
      commission_pct: commission,
      claims_agent_pct: agent,
      primary_audience: form.primary_audience.trim() || null,
      is_national: !!form.is_national,
      has_claims_agent: !!form.has_claims_agent,
      notes: form.notes?.trim() || null,
      created_by: user.id
    };

    const { error } = await supabase.from("campaign").insert(payload);
    if (error) setErr(error.message);
    else {
      // reset part of the form
      setForm((f) => ({ ...f, name: "", case_name: "" }));
    }
    setSaving(false);
  }

  function F(label, children) {
    return (
      <label style={{ display: "block", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {children}
      </label>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Campaigns</h1>
        <Link href="/" style={{ textDecoration: "underline" }}>Home</Link>
      </div>

      {!user && (
        <p>
          You are not signed in. <Link href="/login">Go to login</Link>
        </p>
      )}

      <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Create Campaign</h2>
        <form onSubmit={onSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {F("Campaign Name *",
              <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Case Name",
              <input value={form.case_name} onChange={(e) => setForm({ ...form, case_name: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Geography (free text)",
              <input value={form.geography} onChange={(e) => setForm({ ...form, geography: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Currency",
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
                <option value="MXN">MXN</option>
              </select>
            )}
            {F("Commission % (on net media)",
              <input type="number" step="0.0001" min="0" value={form.commission_pct}
                onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Claims Agent % (on net media)",
              <input type="number" step="0.0001" min="0" value={form.claims_agent_pct}
                onChange={(e) => setForm({ ...form, claims_agent_pct: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Primary Audience (client-visible)",
              <input value={form.primary_audience} onChange={(e) => setForm({ ...form, primary_audience: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            {F("Notes",
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.is_national} onChange={(e) => setForm({ ...form, is_national: e.target.checked })} />
              <span>National (hide geography in client export)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.has_claims_agent} onChange={(e) => setForm({ ...form, has_claims_agent: e.target.checked })} />
              <span>Has Claims Agent Markup</span>
            </label>
          </div>

          {err && <p style={{ color: "crimson", marginTop: 10 }}>{err}</p>}

          <button disabled={saving} style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, border: "1px solid #999" }}>
            {saving ? "Saving..." : "Create Campaign"}
          </button>
        </form>
      </section>

      <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Existing Campaigns</h2>
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No campaigns yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Name</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Case</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Geo</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Currency</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Comm %</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Agent %</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Primary Audience</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.name}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.case_name || "—"}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.geography || "—"}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.currency}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, textAlign: "right" }}>{r.commission_pct}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, textAlign: "right" }}>{r.claims_agent_pct}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.primary_audience || "—"}</td>
                  <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                    {r.is_national ? "National" : "Targeted"} {r.has_claims_agent ? " • Has Claims Agent" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
