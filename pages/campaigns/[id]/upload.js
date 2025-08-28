import Script from "next/script";
import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function BulkUploadPage() {
  const router = useRouter();
  const { id: campaignId } = router.query;

  const [email, setEmail] = useState(null);
  const [campaign, setCampaign] = useState(null);

  // NEW: parse state
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [parseErr, setParseErr] = useState("");

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load campaign name (nice header)
  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const { data } = await supabase
        .from("campaign")
        .select("id,name")
        .eq("id", campaignId)
        .single();
      if (data) setCampaign(data);
    })();
  }, [campaignId]);

  // NEW: handle file selection (CSV or XLSX)
  function onFileChange(e) {
    setParseErr("");
    setHeaders([]);
    setRows([]);

    const file = e.target.files?.[0];
    if (!file) return;

    const name = (file.name || "").toLowerCase();

    // .xlsx path — uses window.XLSX from the CDN script below
    if (name.endsWith(".xlsx")) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = window.XLSX.read(data, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }); // array of arrays

          if (!aoa.length) {
            setParseErr("Empty spreadsheet.");
            return;
          }

          const hdrs = (aoa[0] || []).map((h) => (h || "").toString().trim());
          const body = aoa
            .slice(1)
            .filter((r) => r && r.some((c) => String(c || "").trim() !== ""))
            .map((arr) => {
              const obj = {};
              hdrs.forEach((h, i) => (obj[h] = arr[i]));
              return obj;
            });

          setHeaders(hdrs);
          setRows(body);
        } catch (err) {
          setParseErr(err.message || "Failed to read .xlsx");
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV path — uses window.Papa from the CDN script below
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => (h || "").trim(),
      complete: ({ data, errors, meta }) => {
        if (errors?.length) {
          setParseErr(errors[0]?.message || "Parse error");
          return;
        }
        const hdrs = (meta?.fields || []).map((h) => h.trim());
        setHeaders(hdrs);
        setRows(data);
      }
    });
  }

  if (!email) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Bulk Upload</h1>
        <p>You must be signed in.</p>
        <Link href="/login">Go to login</Link>
      </main>
    );
  }

  return (
    <>
      {/* Load parsers (no npm needed) */}
      <Script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js" strategy="afterInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js" strategy="afterInteractive" />

      <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>{campaign ? `Bulk Upload — ${campaign.name}` : "Bulk Upload"}</h1>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href={`/campaigns/${campaignId}`}>← Back to Line Items</Link>
            <Link href={`/campaigns/${campaignId}/totals`}>View Totals</Link>
          </div>
        </div>

        {/* File picker */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>Choose a file</h2>
          <p style={{ color: "#555", marginTop: 6 }}>
            Supports <strong>.xlsx</strong> and <strong>.csv</strong>. After selecting, you’ll see a preview below.
          </p>
          <input
            type="file"
            accept=".csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .xlsx"
            onChange={onFileChange}
          />
          {parseErr && <p style={{ color: "crimson", marginTop: 10 }}>{parseErr}</p>}
        </section>

        {/* Preview */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          {headers.length === 0 ? (
            <p>No file parsed yet.</p>
          ) : (
            <>
              <p style={{ color: "#555" }}>
                Detected headers: {headers.join(" · ")} <br />
                Showing up to 10 rows:
              </p>
              <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {headers.map((h) => (
                          <td key={h} style={{ borderBottom: "1px solid #f6f6f6", padding: 8 }}>
                            {r[h] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
