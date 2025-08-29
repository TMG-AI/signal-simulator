import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function BulkUploadPage() {
  const router = useRouter();
  const { id: campaignId } = router.query;

  const [email, setEmail] = useState(null);
  const [campaign, setCampaign] = useState(null);

  // Parser readiness + parse state
  const [xlsxReady, setXlsxReady] = useState(false);
  const [papaReady, setPapaReady] = useState(false);

  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [parseErr, setParseErr] = useState("");

  // Debug UI
  const [fileName, setFileName] = useState("");
  const [lastEvent, setLastEvent] = useState("");

  // ---------------- Auth ----------------
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------------- Load campaign name ----------------
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

  // ---------------- Ensure parsers are loaded (no npm needed) ----------------
  useEffect(() => {
    const XLSX_SRC = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
    const PAPA_SRC = "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js";

    function ensure(src, isReady, onReady) {
      if (isReady()) { onReady(); return; }
      let el = document.querySelector(`script[data-src="${src}"]`);
      if (!el) {
        el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.setAttribute("data-src", src);
        document.head.appendChild(el);
      }
      el.onload = onReady;
      el.onerror = () => setParseErr(`Failed to load parser: ${src}`);
    }

    ensure(XLSX_SRC, () => typeof window !== "undefined" && !!window.XLSX, () => setXlsxReady(true));
    ensure(PAPA_SRC, () => typeof window !== "undefined" && !!window.Papa, () => setPapaReady(true));
  }, []);

  function resetParse() {
    setParseErr("");
    setHeaders([]);
    setRows([]);
    setLastEvent("");
  }

  // ----------- header detection helpers -----------
  const HEADER_SYNONYMS = [
    "vendor","publisher","newspaper","partner","network",
    "cat","category","channel","media type","placement type",
    "description","line item","ad set","ad group","notes","creative","campaign line",
    "unit","measure","kpi unit",
    "qty","quantity","impressions","imps","grps","spots","circulation",
    "rate","price","cpm","cpp",
    "net","cost net","amount","spend","cost","total","total cost","net amount","gross",
    "geography","geo","market","state","dma","region","city",
    "audience","target","targeting","segment",
    "currency","ccy","currency code","iso currency",
    "fx","fx rate","exchange rate","rate to campaign","fx_rate_to_campaign",
    "start","end","start date","end date","date"
  ].map(normalize);

  function normalize(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/[\s_]+/g, " ")
      .replace(/[^a-z0-9 %/+.-]/g, "")
      .trim();
  }

  function scoreHeaderRow(cells) {
    const norm = cells.map(normalize);
    const nonEmpty = norm.filter((c) => c !== "").length;
    if (nonEmpty === 0) return -1;

    // hits = cells that look like real column names (short-ish, have letters, match synonyms)
    let hits = 0;
    for (const c of norm) {
      if (!c) continue;
      if (HEADER_SYNONYMS.includes(c)) { hits += 2; continue; }
      if (c.length <= 30 && /[a-z]/.test(c)) hits += 1;
    }
    // prefer rows with many non-empty cells and many hits
    return hits * 3 + nonEmpty;
  }

  function detectHeaderAndBodyFromAOA(aoa) {
    // scan first 50 rows for the best header candidate
    const limit = Math.min(50, aoa.length);
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < limit; i++) {
      const row = (aoa[i] || []).map((x) => String(x ?? "").trim());
      const sc = scoreHeaderRow(row);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) bestIdx = 0;

    const rawHdrs = (aoa[bestIdx] || []);
    const hdrs = rawHdrs.map((h, i) => {
      const n = normalize(h);
      if (!n) return `col_${i + 1}`;
      // prettify: Title Case with spaces
      return n.replace(/\s+/g, " ");
    });

    // ensure uniqueness
    const seen = {};
    for (let i = 0; i < hdrs.length; i++) {
      let h = hdrs[i];
      if (!seen[h]) { seen[h] = 1; continue; }
      seen[h] += 1;
      hdrs[i] = `${h}_${seen[h]}`;
    }

    // body from next row onward; drop fully-empty rows
    const body = [];
    for (let r = bestIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const clean = {};
      let hasAny = false;
      for (let c = 0; c < hdrs.length; c++) {
        const v = row[c];
        const s = v == null ? "" : String(v).trim();
        if (s !== "") hasAny = true;
        clean[hdrs[c]] = s;
      }
      if (hasAny) body.push(clean);
    }

    return { hdrs, body, headerRowIndex: bestIdx };
  }

  // Fallback for CSV text (run same detection on AoA)
  function csvTextToAoA(text) {
    if (!window.Papa) return [[]];
    const out = window.Papa.parse(text, { header: false, skipEmptyLines: false });
    return out?.data || [];
  }

  // ------------- helpers -------------
  function parseCSVText(csvText) {
    const aoa = csvTextToAoA(csvText);
    const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(aoa);
    setHeaders(hdrs);
    setRows(body);
    setLastEvent(`CSV parsed · header row #${headerRowIndex + 1} · rows=${body.length}`);
  }

  // ---------------- Handle file selection (CSV or XLS/XLSX) ----------------
  function onFileChange(e) {
    resetParse();

    const file = e.target.files?.[0];
    if (!file) { setLastEvent("No file in event"); return; }

    setFileName(file.name || "");
    const name = (file.name || "").toLowerCase();

    // Excel path (.xlsx/.xls)
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (!window.XLSX) {
        setParseErr("Excel parser isn’t available yet. Hard refresh (Cmd+Shift+R) and reselect the file.");
        setLastEvent("XLSX not ready");
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = window.XLSX.read(data, { type: "array" });
          const sheetName = wb.SheetNames[0];
          if (!sheetName) {
            setParseErr("No sheets found in workbook.");
            return;
          }
          const sheet = wb.Sheets[sheetName];

          // Build AoA (no assumption that row 1 is headers)
          const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
          if (!aoa || !aoa.length) {
            setParseErr("Empty spreadsheet.");
            return;
          }

          const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(aoa);
          setHeaders(hdrs);
          setRows(body);
          setLastEvent(`XLSX parsed · header row #${headerRowIndex + 1} · rows=${body.length}`);
        } catch (err) {
          setParseErr(err?.message || "Failed to read Excel file.");
          setLastEvent("XLSX read error");
        }
      };
      reader.onerror = () => {
        setParseErr("Failed to read file (FileReader error).");
        setLastEvent("FileReader onerror");
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV path
    if (!window.Papa) {
      setParseErr("CSV parser isn’t available yet. Hard refresh (Cmd+Shift+R) and reselect the file.");
      setLastEvent("Papa not ready");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      setLastEvent("FileReader loaded (csv)");
      parseCSVText(evt.target.result);
    };
    reader.onerror = () => {
      setParseErr("Failed to read file (FileReader error).");
      setLastEvent("FileReader onerror (csv)");
    };
    reader.readAsText(file);
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
      <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>{campaign ? `Bulk Upload — ${campaign.name}` : "Bulk Upload"}</h1>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href={`/campaigns/${campaignId}`}>← Back to Line Items</Link>
            <Link href={`/campaigns/${campaignId}/totals`}>View Totals</Link>
          </div>
        </div>

        <p style={{ color: "#555" }}>
          Parsers: XLSX <strong>{xlsxReady ? "ready" : "loading…"}</strong> · CSV <strong>{papaReady ? "ready" : "loading…"}</strong>
        </p>

        {/* File picker */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>Choose a file</h2>
          <p style={{ color: "#555", marginTop: 6 }}>
            Supports <strong>.xlsx/.xls</strong> and <strong>.csv</strong>. After selecting, you’ll see a preview below.
          </p>
          <input
            key={`${xlsxReady}-${papaReady}`}     // remount input after parsers load
            type="file"
            accept=".csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .xlsx, .xls"
            onChange={onFileChange}
            onClick={(e) => { e.currentTarget.value = null; }} // allow re-selecting the same file
          />
          {parseErr && <p style={{ color: "crimson", marginTop: 10 }}>{parseErr}</p>}
          <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
            Debug: file=<strong>{fileName || "—"}</strong> · {lastEvent || "no events yet"} · headers={headers.length} · rows={rows.length}
          </div>
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
