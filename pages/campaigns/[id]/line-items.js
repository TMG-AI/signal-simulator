import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const CAT_OPTIONS = ["DIGITAL", "BROADCAST", "PRINT", "OOH_DOOH", "CREATIVE", "FEES"];

export default function LineItemsPage() {
  const router = useRouter();
  const { id } = router.query; // campaign_id

  const [campaign, setCampaign] = useState(null);
  const [subgroups, setSubgroups] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const [form, setForm] = useState({
    cat: "DIGITAL",
    sub_group_id: "",
    vendor: "",
    description: "",
    unit: "impressions", // impressions | GRPs | circulation | spots | etc.
    quantity: "",
    cost_net: "",
    geography: "",
    audience_descriptor: "", // DIGITAL only
    currency: "",            // blank = same as campaign
    fx_rate_to_campaign: ""  // blank = 1.0 implicitly
  });

  const isDigital = form.cat === "DIGITAL";

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErr(null);

      const { data: crows, error: cerr } = await supabase
        .from("campaign")
        .select("id,name,currency,geography,commission_pct,claims_agent_pct,primary_audience")
        .eq("id", id)
        .limit(1);
      if (cerr) return setErr(cerr.message);
      setCampaign(crows?.[0] || null);

      const { data: srows, error: serr } = await supabase
        .from("sub_group")
        .select("id,cat,name")
        .order("cat", { ascending: true })
        .order("name", { ascending: true });
      if (serr) return setErr(serr.message);
      setSubgroups(srows || []);

      const { data: lrows, error: lerr } = await supabase
        .from("line_item")
        .select("id,cat,sub_group_id,vendor,description,unit,quantity,cost_net,geography,audience_descriptor,currency,fx_rate_to_campaign,created_at")
        .eq("campaign_id", id)
        .order("created_at", { ascending: false });
      if (lerr) return setErr(lerr.message);
      setRows(lrows || []);

      setLoading(false);
    })();
  }, [id, saving]);

  const subgroupOptions = useMemo(
    () => subgroups.filter((s) => s.cat === form.cat),
    [subgroups, form.cat]
  );

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (!id) return setErr("Missing campaign id.");

    const quantity = form.quantity === "" ? null : Number(form.quantity);
    const costNet = Number(form.cost_net);
    if (!form.vendor.trim()) return setErr("Vendor is required.");
    if (!Number.isFinite(costNet) || costNet < 0) return setErr("Net cost must be a non-negative number.");

    const fx =
      form.fx_rate_to_campaign === "" || form.fx_rate_to_campaign === null
        ? null
        : Number(form.fx_rate_to_campaign);
    if (fx !== null && (!Number.isFinite(fx) || fx <= 0)) {
      return setErr("FX rate must be a positive number.");
    }

    setSaving(true);
    const payload = {
      campaign_id: id,
      cat: form.cat,
      sub_group_id: form.sub_group_id ? Number(form.sub_group_id) : null,
      vendor: form.vendor.trim(),
      description: form.description.trim() || null,
      unit: form.unit || null,
      quantity,
      cost_net: costNet,
      geography: form.geography.trim() || null,
      audience_descriptor: isDigital ? (form.audience_descriptor.trim() || null) : null,
      currency: form.currency.trim() || null,
      fx_rate_to_campaign: fx
    };

    const { error } = await supabase.from("line_item").insert(payload);
    if (error) setErr(error.message);
    else {
      setForm((f) => ({ ...f, vendor: "", description: "", quantity: "", cost_net: "" }));
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
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{campaign ? `Line Items — ${campaign.name}` : "Line Items"}</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/campaigns">← Back to Campaigns</Link>
          <Link href="/">Home</Link>
    {id && (
  <Link href={`/campaigns/${id}/totals`}>
    <button style={{ border: "1px solid #ccc", borderRadius: 6, padding: "6px 10px" }}>
      View totals
    </button>
  </Link>
)}
        </div>
      </div>

      {campaign && (
        <p style={{ marginTop: 0, color: "#555" }}>
          Campaign currency: <strong>{campaign.currency}</strong>
        </p>
      )}

      <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Add Line Item</h2>
        <form onSubmit={onSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {F("Category *",
              <select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value, sub_group_id: "" })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                {CAT_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {F("Sub-group",
              <select value={form.sub_group_id} onChange={(e) => setForm({ ...form, sub_group_id: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">—</option>
                {subgroupOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {F("Vendor *",
              <input value={form.vendor} required onChange={(e) => setForm({ ...form, vendor: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Description",
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Unit",
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="impressions | GRPs | circulation | spots" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Quantity",
              <input type="number" step="0.0001" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Net Cost (vendor net) *",
              <input type="number" required step="0.01" min="0" value={form.cost_net} onChange={(e) => setForm({ ...form, cost_net: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Geography override (optional)",
              <input value={form.geography} onChange={(e) => setForm({ ...form, geography: e.target.value })} placeholder="leave blank to inherit campaign geography" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {isDigital && F("Audience descriptor (Digital only)",
              <input value={form.audience_descriptor} onChange={(e) => setForm({ ...form, audience_descriptor: e.target.value })} placeholder='e.g., "Adults 50+ / Adults 18+ – Targeted (…)"' style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}

            {F("Line currency (optional)",
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">Same as campaign</option>
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
                <option value="MXN">MXN</option>
              </select>
            )}

            {F("FX rate → campaign currency (optional)",
              <input type="number" step="0.0001" min="0" value={form.fx_rate_to_campaign} onChange={(e) => setForm({ ...form, fx_rate_to_campaign: e.target.value })} placeholder="e.g., 0.74 if CAD→USD" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
            )}
          </div>

          {err && <p style={{ color: "crimson", marginTop: 10 }}>{err}</p>}

          <button disabled={saving} style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, border: "1px solid #999" }}>
            {saving ? "Saving..." : "Add Line Item"}
          </button>
        </form>
      </section>

      <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Existing Line Items</h2>
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No line items yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Category</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Sub-group</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Vendor</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Unit</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Qty</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Net Cost</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Currency</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>FX→Campaign</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Geo</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Audience (Digital)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sg = subgroups.find((s) => s.id === r.sub_group_id);
                return (
                  <tr key={r.id}>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.cat}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{sg ? sg.name : "—"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.vendor}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.unit || "—"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, textAlign: "right" }}>{r.quantity ?? "—"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, textAlign: "right" }}>
                      {Number(r.cost_net).toLocaleString(undefined, { style: "currency", currency: campaign?.currency || "USD" })}
                    </td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.currency || campaign?.currency || "USD"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, textAlign: "right" }}>{r.fx_rate_to_campaign ?? "—"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.geography || "—"}</td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{r.audience_descriptor || (r.cat === "DIGITAL" ? "—" : "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
