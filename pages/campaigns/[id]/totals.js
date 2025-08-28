import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient"; // note the path

export default function CampaignTotalsPage() {
  const router = useRouter();
  const { id: campaignId } = router.query;

  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState(null);
  const [items, setItems] = useState([]);
  const [commissionPct, setCommissionPct] = useState(0);
  const [agentPct, setAgentPct] = useState(0);
  const [savingPcts, setSavingPcts] = useState(false);
  const [error, setError] = useState("");

  // auth state
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // load campaign + line items
  useEffect(() => {
    if (!campaignId) return;
    const load = async () => {
      setLoading(true);
      setError("");

      // 1) campaign (table name is singular: public.campaign)
      const { data: camp, error: campErr } = await supabase
        .from("campaign")
        .select("id, name, commission_pct, claims_agent_pct, created_by")
        .eq("id", campaignId)
        .single();

      if (campErr) {
        setError(campErr.message);
        setLoading(false);
        return;
      }
      setCampaign(camp);
      setCommissionPct(Number(camp.commission_pct ?? 0));
      setAgentPct(Number(camp.claims_agent_pct ?? 0));

      // 2) line items for this campaign
      const { data: li, error: liErr } = await supabase
        .from("line_items") // if your table is named "line_item", change this to "line_item"
        .select("id, vendor, category, net_cost, campaign_id")
        .eq("campaign_id", campaignId);

      if (liErr) {
        setError(liErr.message);
        setLoading(false);
        return;
      }
      setItems(li ?? []);
      setLoading(false);
    };
    load();
  }, [campaignId]);

  // compute totals
  const { byCategory, programSubtotal, claimsAgentAmt, commissionAmt, grandTotal } = useMemo(() => {
    const cats = {};
    let subtotal = 0;

    for (const it of items) {
      const cost = Number(it.net_cost ?? 0);
      subtotal += cost;
      const key = it.category || "Uncategorized";
      cats[key] = (cats[key] ?? 0) + cost;
    }

    const agent = subtotal * Number(agentPct || 0);
    const comm = subtotal * Number(commissionPct || 0);
    const grand = subtotal + agent + comm;

    return {
      byCategory: Object.entries(cats).sort(([a],[b]) => a.localeCompare(b)),
      programSubtotal: subtotal,
      claimsAgentAmt: agent,
      commissionAmt: comm,
      grandTotal: grand,
    };
  }, [items, commissionPct, agentPct]);

  const fmt = (n) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const savePercents = async () => {
    if (!campaignId) return;
    setSavingPcts(true);
    setError("");

    const { error: upErr } = await supabase
      .from("campaign") // singular
      .update({
        commission_pct: Number(commissionPct || 0),
        claims_agent_pct: Number(agentPct || 0),
      })
      .eq("id", campaignId);

    if (upErr) setError(upErr.message);
    setSavingPcts(false);
  };

  if (!email) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Campaign Totals</h1>
        <p>You must be signed in.</p>
        <Link href="/login">Go to login</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{campaign?.name || "Campaign"} — Totals</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href={`/campaigns`}>
            <button style={{ border: "1px solid #ccc", borderRadius: 8, padding: "8px 12px" }}>All Campaigns</button>
          </Link>
          <Link href={`/campaigns/${campaignId}`}>
            <button style={{ border: "1px solid #ccc", borderRadius: 8, padding: "8px 12px" }}>Manage line items</button>
          </Link>
        </div>
      </div>

      {/* Percent controls */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Settings (this campaign)</h3>
        <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6 }}>
            Commission %
            <input
              type="number"
              step="0.01"
              value={commissionPct}
              onChange={(e) => setCommissionPct(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", width: 140 }}
              placeholder="e.g. 0.15"
            />
            <small style={{ color: "#666" }}>Enter as decimal (0.15 = 15%)</small>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            Claims Agent %
            <input
              type="number"
              step="0.01"
              value={agentPct}
              onChange={(e) => setAgentPct(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", width: 140 }}
              placeholder="e.g. 0.10"
            />
            <small style={{ color: "#666" }}>Enter as decimal (0.10 = 10%)</small>
          </label>

          <button
            onClick={savePercents}
            disabled={savingPcts}
            style={{ border: "1px solid #ccc", borderRadius: 8, padding: "10px 14px", height: 42 }}
          >
            {savingPcts ? "Saving…" : "Save %"}
          </button>
        </div>
        {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}
      </section>

      {/* Internal breakdown */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Internal Breakdown (Vendor Net by Category)</h3>

        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p>No line items yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 0" }}>Category</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 0" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map(([cat, sum]) => (
                <tr key={cat}>
                  <td style={{ padding: "8px 0" }}>{cat}</td>
                  <td style={{ textAlign: "right", padding: "8px 0" }}>{fmt(sum)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ paddingTop: 12, fontWeight: 600 }}>Program Subtotal</td>
                <td style={{ textAlign: "right", paddingTop: 12, fontWeight: 600 }}>{fmt(programSubtotal)}</td>
              </tr>
              <tr>
                <td>Claims Agent Markup ({(agentPct * 100).toFixed(1)}%)</td>
                <td style={{ textAlign: "right" }}>{fmt(claimsAgentAmt)}</td>
              </tr>
              <tr>
                <td>Commission ({(commissionPct * 100).toFixed(1)}%)</td>
                <td style={{ textAlign: "right" }}>{fmt(commissionAmt)}</td>
              </tr>
              <tr>
                <td style={{ paddingTop: 8, fontWeight: 700, borderTop: "1px solid #eee" }}>Grand Total</td>
                <td style={{ textAlign: "right", paddingTop: 8, fontWeight: 700, borderTop: "1px solid #eee" }}>
                  {fmt(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* Optional client view */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #f3f3f3", borderRadius: 8 }}>
        <details>
          <summary style={{ cursor: "pointer" }}>
            Client-Ready Category Totals (no vendor rows) — optional preview
          </summary>
          <p style={{ color: "#666", marginTop: 8 }}>
            Each category total includes its share of Commission and Claims Agent (allocated pro-rata by net).
          </p>
          <ClientTotalsTable
            byCategory={byCategory}
            commissionAmt={commissionAmt}
            claimsAgentAmt={claimsAgentAmt}
            programSubtotal={programSubtotal}
            fmt={fmt}
          />
        </details>
      </section>

      <div style={{ marginTop: 24 }}>
        <Link href={`/campaigns/${campaignId}`}>← Back to Manage line items</Link>
      </div>
    </main>
  );
}

function ClientTotalsTable({ byCategory, commissionAmt, claimsAgentAmt, programSubtotal, fmt }) {
  if (programSubtotal <= 0) return <p>No data.</p>;

  const rows = byCategory.map(([cat, sum]) => {
    const share = sum / programSubtotal;
    const allocComm = commissionAmt * share;
    const allocAgent = claimsAgentAmt * share;
    const total = sum + allocComm + allocAgent;
    return { cat, sum, allocComm, allocAgent, total };
  });

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 0" }}>Category</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 0" }}>Net</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 0" }}>Claims Agent Alloc</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 0" }}>Commission Alloc</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 0" }}>Category Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cat}>
            <td style={{ padding: "8px 0" }}>{r.cat}</td>
            <td style={{ textAlign: "right", padding: "8px 0" }}>{fmt(r.sum)}</td>
            <td style={{ textAlign: "right", padding: "8px 0" }}>{fmt(r.allocAgent)}</td>
            <td style={{ textAlign: "right", padding: "8px 0" }}>{fmt(r.allocComm)}</td>
            <td style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>{fmt(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
