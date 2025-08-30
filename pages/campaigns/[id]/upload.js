import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function BulkUploadPage() {
  const router = useRouter();
  const { id: campaignId } = router.query;

  const [email, setEmail] = useState(null);
  const [campaign, setCampaign] = useState(null);

  // Parser readiness
  const [xlsxReady, setXlsxReady] = useState(false);
  const [papaReady, setPapaReady] = useState(false);
  const [cpexReady, setCpexReady] = useState(false); // legacy .xls encodings

  // Workbook / sheet
  const [fileName, setFileName] = useState("");
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetsAoA, setSheetsAoA] = useState({}); // {sheetName: AoA}
  const [selectedSheet, setSelectedSheet] = useState("");

  // Current sheet (raw) + parsed
  const [rawAoA, setRawAoA] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);

  // Overrides
  const [startRow, setStartRow] = useState("");        // 1-based
  const [startCol, setStartCol] = useState("");        // letters (A, B, AA…)
  const [manualHeaderRow, setManualHeaderRow] = useState(""); // 1-based within trimmed area

  // Auto-mapped output (focused on your 4 fields + a few helpful columns)
  const CANONICAL = ["vendor","geography","ad_size","cost_net","cat","description","unit","quantity","currency","fx_rate_to_campaign","audience_descriptor"];
  const [mappedRows, setMappedRows] = useState([]);
  const [issues, setIssues] = useState([]);

  // UI
  const [parseErr, setParseErr] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const [inserting, setInserting] = useState(false);
  const [insertMsg, setInsertMsg] = useState("");

  // ---------- Auth ----------
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- Campaign ----------
  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const { data } = await supabase
        .from("campaign")
        .select("id,name,currency,geography")
        .eq("id", campaignId)
        .single();
      if (data) setCampaign(data);
    })();
  }, [campaignId]);

  // ---------- Load parsers (no npm) ----------
  useEffect(() => {
    const CPEX_SRC = "https://cdn.jsdelivr.net/npm/xlsx/dist/cpexcel.full.min.js";
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
      el.onerror = () => setParseErr((p) => p || `Failed to load parser: ${src}`);
    }

    // Load cpexcel first so XLSX can decode older .xls encodings
    ensure(CPEX_SRC, () => !!window.cptable, () => setCpexReady(true));
    ensure(XLSX_SRC, () => !!window.XLSX, () => setXlsxReady(true));
    ensure(PAPA_SRC, () => !!window.Papa, () => setPapaReady(true));
  }, []);

  // ---------- utils ----------
  function resetAll() {
    setParseErr("");
    setSheetNames([]); setSheetsAoA({}); setSelectedSheet("");
    setRawAoA([]); setHeaders([]); setRows([]); setMappedRows([]);
    setIssues([]); setInsertMsg(""); setLastEvent("");
    setStartRow(""); setStartCol(""); setManualHeaderRow("");
  }
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const nonEmpty = (s) => (s ?? "").toString().trim() !== "";
  function toNumberLoose(v) {
    if (v === undefined || v === null || v === "") return NaN;
    // handle $(1,234.56) and (1,234.56)
    const neg = /^\(.*\)$/.test(String(v));
    const cleaned = String(v).replace(/[()$,\s]/g, "");
    const n = Number(cleaned);
    return neg ? -n : n;
  }
  const nullableStr = (v) => {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  };
  const colLettersToIndex = (letters) => {
    if (!letters) return 1;
    const L = letters.toUpperCase().replace(/[^A-Z]/g, "");
    let n = 0;
    for (let i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64);
    return n; // 1-based
  };

  // ----- header detection -----
  const HEADER_SYNONYMS = [
    "vendor","publisher","newspaper","partner","network","seller","paper",
    "cat","category","channel","media type","placement type",
    "description","line item","edition","editions","order","program",
    "unit","measure","kpi unit","size","ad size",
    "qty","quantity","impressions","imps","grps","spots","circulation","ins","insertions",
    "rate","price","cpm","cpp","inch rate","color charge","open national","net per unit","unit cost",
    "net","cost net","amount","spend","cost","total","total cost","net amount","gross",
    "geography","geo","market","state","dma","region","city",
    "audience","target","segment",
    "currency","ccy","currency code",
    "fx","fx rate","exchange rate","rate to campaign","fx_rate_to_campaign",
    "start","end","start date","end date","date","dow"
  ].map((s) => s.toLowerCase());

  function scoreHeaderRow(cells) {
    const n = cells.map((x) => norm(x));
    const filled = n.filter((c) => c !== "").length;
    if (!filled) return -1;
    let hits = 0;
    for (const c of n) {
      if (!c) continue;
      if (HEADER_SYNONYMS.includes(c)) { hits += 2; continue; }
      if (c.length <= 30 && /[a-z]/.test(c)) hits += 1;
    }
    return hits * 3 + filled;
  }

  function detectHeaderAndBodyFromAOA(aoa, headerRowOverride /* 1-based */) {
    let bestIdx = -1;
    if (headerRowOverride && Number(headerRowOverride) >= 1) {
      bestIdx = Number(headerRowOverride) - 1;
    } else {
      const limit = Math.min(50, aoa.length);
      let bestScore = -1;
      for (let i = 0; i < limit; i++) {
        const row = (aoa[i] || []).map((x) => String(x ?? "").trim());
        const sc = scoreHeaderRow(row);
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      }
      if (bestIdx === -1) bestIdx = 0;
    }

    const rawHdrs = aoa[bestIdx] || [];
    const hdrs = rawHdrs.map((h, i) => {
      const t = norm(h).replace(/\s+/g, " ");
      return t || `col_${i + 1}`;
    });

    // ensure uniqueness
    const seen = {};
    for (let i = 0; i < hdrs.length; i++) {
      const h = hdrs[i];
      seen[h] = (seen[h] || 0) + 1;
      if (seen[h] > 1) hdrs[i] = `${h}_${seen[h]}`;
    }

    const body = [];
    for (let r = bestIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const o = {}; let hasAny = false;
      for (let c = 0; c < hdrs.length; c++) {
        const v = row[c]; const s = v == null ? "" : String(v).trim();
        if (s !== "") hasAny = true;
        o[hdrs[c]] = s;
      }
      if (hasAny) body.push(o);
    }
    return { hdrs, body, headerRowIndex: bestIdx + 1 };
  }

  // ---------- vendor-type detection (sets cat + math rules) ----------
  function detectVendorType(hdrs) {
    const H = hdrs.map(norm);
    const any = (...arr) => arr.some((t) => H.includes(t));
    if (any("newspaper","inch rate","ins","insertions","editions","edition","net per unit","open national")) return "PRINT_NEWS";
    if (any("impressions","imps","clicks","ctr","cpm","cpc","ad set","ad group")) return "DIGITAL";
    if (any("spots","grps","cpp","rating","program")) return "BROADCAST";
    if (any("faces","units","board id","panel id","weekly impressions")) return "OOH_DOOH";
    return "UNKNOWN";
  }
  const inferredCatForType = (t) =>
    t === "PRINT_NEWS" ? "PRINT" : t === "DIGITAL" ? "DIGITAL" : t === "BROADCAST" ? "BROADCAST" : t === "OOH_DOOH" ? "OOH_DOOH" : "FEES";

  // ---------- AUTO MAP ----------
  function autoMap(hdrs, body) {
    const t = detectVendorType(hdrs);
    const catDefault = inferredCatForType(t);

    const byNorm = {};
    for (const h of hdrs) byNorm[norm(h)] = h;

    const hVendor   = byNorm["newspaper"] || byNorm["publisher"] || byNorm["vendor"] || byNorm["paper"] || hdrs[0];
    const hMarket   = byNorm["market"] || byNorm["city"] || byNorm["dma"] || byNorm["region"];
    const hState    = byNorm["state"];
    const hSize     = byNorm["ad size"] || byNorm["size"];
    const hIns      = byNorm["ins"] || byNorm["insertions"] || byNorm["qty"] || byNorm["quantity"] || byNorm["spots"];
    const hTotal    = byNorm["total"] || byNorm["total cost"] || byNorm["net"] || byNorm["cost net"] || byNorm["amount"];
    const hNPU      = byNorm["net per unit"] || byNorm["rate"] || byNorm["price"] || byNorm["inch rate"] || byNorm["cpp"] || byNorm["cpm"];
    const hImps     = byNorm["impressions"] || byNorm["imps"];
    const hGRPs     = byNorm["grps"];
    const hCurrency = byNorm["currency"] || byNorm["ccy"];
    const hFX       = byNorm["fx_rate_to_campaign"] || byNorm["fx rate"] || byNorm["exchange rate"];

    const out = [];
    const problems = [];

    for (let i = 0; i < body.length; i++) {
      const r = body[i];

      const vendor = String(r[hVendor] ?? "").trim();
      if (!vendor) { problems.push(`Row ${i + 1}: vendor missing`); continue; }

      // quantities + totals (handle multiple media maths)
      const qty = hIns ? Number(String(r[hIns]).replace(/[, ]/g, "")) : null;

      let total = hTotal ? toNumberLoose(r[hTotal]) : NaN;

      // DIGITAL: CPM × impressions / 1000
      if (!Number.isFinite(total) || total === 0) {
        const cpm = byNorm["cpm"] ? toNumberLoose(r[byNorm["cpm"]]) : NaN;
        const imps = hImps ? Number(String(r[hImps]).replace(/[, ]/g, "")) : NaN;
        if (Number.isFinite(cpm) && Number.isFinite(imps)) total = (cpm * imps) / 1000;
      }
      // PRINT: net per unit × insertions
      if (!Number.isFinite(total) || total === 0) {
        const npu = hNPU ? toNumberLoose(r[hNPU]) : NaN;
        if (Number.isFinite(npu) && Number.isFinite(qty)) total = npu * qty;
      }
      // BROADCAST: CPP × GRPs or rate × spots
      if (!Number.isFinite(total) || total === 0) {
        const cpp = byNorm["cpp"] ? toNumberLoose(r[byNorm["cpp"]]) : NaN;
        const grps = hGRPs ? Number(String(r[hGRPs]).replace(/[, ]/g, "")) : NaN;
        if (Number.isFinite(cpp) && Number.isFinite(grps)) total = cpp * grps;
        if (!Number.isFinite(total) || total === 0) {
          const rate = byNorm["rate"] ? toNumberLoose(r[byNorm["rate"]]) : NaN;
          if (Number.isFinite(rate) && Number.isFinite(qty)) total = rate * qty;
        }
      }

      if (!Number.isFinite(total) || total < 0) { problems.push(`Row ${i + 1}: cost not found`); continue; }

      let geography = null;
      if (nonEmpty(r[hMarket])) geography = r[hMarket];
      if (nonEmpty(r[hState])) geography = geography ? `${geography}, ${r[hState]}` : r[hState];

      const ad_size = nullableStr(r[hSize]) || null;
      let unit = null;
      if (t === "PRINT_NEWS") unit = "insertions";
      else if (t === "DIGITAL" && hImps) unit = "impressions";
      else if (t === "BROADCAST" && (byNorm["spots"] || byNorm["grps"])) unit = byNorm["spots"] ? "spots" : "GRPs";

      const currency = nullableStr(r[hCurrency]);
      const fx = r[hFX] ? Number(String(r[hFX]).replace(/[, ]/g, "")) : null;

      out.push({
        vendor,
        geography,
        ad_size,
        cost_net: total,
        cat: inferredCatForType(t),
        description: ad_size ? `Size: ${ad_size}` : null,
        unit,
        quantity: qty ?? null,
        currency,
        fx_rate_to_campaign: fx,
        audience_descriptor: null
      });
    }

    setMappedRows(out);
    setIssues(problems);
  }

  // ---------- recompute (sheet + start/header overrides) ----------
  function recomputeFromAoA(baseAoA) {
    if (!baseAoA?.length) { setHeaders([]); setRows([]); setMappedRows([]); return; }
    const sr = Number(startRow) || 1;
    const sc = colLettersToIndex(startCol || "A");
    const trimmed = baseAoA.slice(Math.max(0, sr - 1)).map((row) => row.slice(Math.max(0, sc - 1)));

    const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(
      trimmed,
      manualHeaderRow ? Number(manualHeaderRow) : undefined
    );
    setHeaders(hdrs); setRows(body);
    setLastEvent(`Applied start: row ${sr}, col ${sc} · header row (within trimmed) = ${headerRowIndex}`);
    autoMap(hdrs, body);
  }

  // ---------- file selection ----------
  function onFileChange(e) {
    resetAll();
    const file = e.target.files?.[0];
    if (!file) { setLastEvent("No file in event"); return; }

    setFileName(file.name || "");
    const name = (file.name || "").toLowerCase();

    // Excel
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (!window.XLSX) { setParseErr("Excel parser isn’t available yet. Hard refresh."); return; }
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = window.XLSX.read(data, { type: "array" });
          const names = wb.SheetNames || [];
          const map = {};
          names.forEach((n) => {
            const sheet = wb.Sheets[n];
            const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false, defval: "" });
            map[n] = aoa;
          });
          setSheetNames(names);
          setSheetsAoA(map);
          const first = names[0];
          setSelectedSheet(first || "");
          const base = map[first] || [];
          setRawAoA(base);
          // initial parse without overrides
          const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(base);
          setHeaders(hdrs); setRows(body);
          setLastEvent(`Sheet "${first}" · header row #${headerRowIndex} · rows=${body.length}`);
          autoMap(hdrs, body);
        } catch (err) {
          setParseErr(err?.message || "Failed to read Excel file.");
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV
    if (name.endsWith(".csv")) {
      if (!window.Papa) { setParseErr("CSV parser isn’t available yet. Hard refresh."); return; }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        const parsed = window.Papa.parse(text, { header: false, skipEmptyLines: false });
        const aoa = parsed?.data || [];
        setSheetNames(["CSV"]);
        setSheetsAoA({ CSV: aoa });
        setSelectedSheet("CSV");
        setRawAoA(aoa);
        const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(aoa);
        setHeaders(hdrs); setRows(body);
        setLastEvent(`CSV · header row #${headerRowIndex} · rows=${body.length}`);
        autoMap(hdrs, body);
      };
      reader.readAsText(file);
      return;
    }

    setParseErr("Unsupported file type. Use .xls, .xlsx, or .csv.");
  }

  // when sheet changes, recompute with current overrides
  useEffect(() => {
    if (!selectedSheet) return;
    const base = sheetsAoA[selectedSheet] || [];
    setRawAoA(base);
    if (base.length) recomputeFromAoA(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSheet]);

  function applyStart() {
    if (!rawAoA.length) return;
    recomputeFromAoA(rawAoA);
  }
  function clearStart() {
    setStartRow(""); setStartCol(""); setManualHeaderRow("");
    if (!rawAoA.length) return;
    const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(rawAoA);
    setHeaders(hdrs); setRows(body);
    setLastEvent(`Cleared overrides · header row #${headerRowIndex} · rows=${body.length}`);
    autoMap(hdrs, body);
  }

  // ---------- insert ----------
  async function insertRows() {
    if (!campaignId || mappedRows.length === 0 || issues.length > 0) return;
    setInserting(true); setInsertMsg("");
    const payload = mappedRows.map((r) => ({
      campaign_id: campaignId,
      cat: r.cat || "FEES",
      sub_group_id: null,
      vendor: r.vendor,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      cost_net: r.cost_net,
      geography: r.geography,
      audience_descriptor: r.audience_descriptor,
      currency: r.currency,
      fx_rate_to_campaign: r.fx_rate_to_campaign
    }));
    const { error } = await supabase.from("line_item").insert(payload);
    if (error) setInsertMsg(error.message);
    else setInsertMsg(`Inserted ${payload.length} line item(s).`);
    setInserting(false);
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
          Parsers: XLSX <strong>{xlsxReady ? "ready" : "loading…"}</strong> ·
          {" "}CSV <strong>{papaReady ? "ready" : "loading…"}</strong> ·
          {" "}XLS (codepage) <strong>{cpexReady ? "ready" : "loading…"}</strong>
        </p>

        {/* File picker */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Choose a file</h2>
          <input
            type="file"
            accept=".csv, text/csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .xls, .xlsx"
            onChange={onFileChange}
            onClick={(e) => { e.currentTarget.value = null; }}
          />
          {parseErr && <p style={{ color: "crimson", marginTop: 10 }}>{parseErr}</p>}
          <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
            Debug: file=<strong>{fileName || "—"}</strong> · sheets={sheetNames.length} · rows(raw)={rawAoA.length} · {lastEvent || "—"}
          </div>
        </section>

        {/* Sheet picker */}
        {sheetNames.length > 1 && (
          <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Pick a sheet</h2>
            <select
              value={selectedSheet}
              onChange={(e) => setSelectedSheet(e.target.value)}
              style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
            >
              {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </section>
        )}

        {/* Start + header override */}
        {rawAoA.length > 0 && (
          <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>If your sheet has cover text, set where the table starts</h2>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label>Start row&nbsp;
                <input type="number" min="1" value={startRow} onChange={(e) => setStartRow(e.target.value)}
                       placeholder="e.g. 16" style={{ width: 100, padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
              </label>
              <label>Start column&nbsp;
                <input value={startCol} onChange={(e) => setStartCol(e.target.value)}
                       placeholder="e.g. A or AA" style={{ width: 100, padding: 8, border: "1px solid #ccc", borderRadius: 6, textTransform: "uppercase" }} />
              </label>
              <label>Header row (within trimmed)&nbsp;
                <input type="number" min="1" value={manualHeaderRow} onChange={(e) => setManualHeaderRow(e.target.value)}
                       placeholder="optional" style={{ width: 120, padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
              </label>
              <button onClick={applyStart} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #999" }}>Apply start</button>
              <button onClick={clearStart} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #999" }}>Clear</button>
            </div>

            {/* Raw grid (first 20 rows) */}
            <div style={{ marginTop: 12, color: "#555" }}>Raw grid preview (first 20 rows of current sheet):</div>
            <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6, marginTop: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {(rawAoA || []).slice(0, 20).map((r, ri) => (
                    <tr key={ri}>
                      <td style={{ borderRight: "1px solid #eee", padding: 4, color: "#888" }}>{ri + 1}</td>
                      {r.map((c, ci) => (
                        <td key={ci} style={{ borderBottom: "1px solid #f6f6f6", padding: 4 }}>
                          {String(c ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Mapped Preview */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Mapped Preview (automatic)</h2>
          {mappedRows.length === 0 ? (
            <p>No mapped rows yet.</p>
          ) : (
            <>
              {issues.length > 0 ? (
                <p style={{ color: "crimson" }}>
                  {issues.length} issue(s). First 3: {issues.slice(0,3).join(" | ")}
                </p>
              ) : (
                <p style={{ color: "green" }}>All checks passed.</p>
              )}
              <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {CANONICAL.map((h) => (
                        <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 12).map((r, i) => (
                      <tr key={i}>
                        {CANONICAL.map((h) => (
                          <td key={h} style={{ borderBottom: "1px solid #f6f6f6", padding: 8 }}>
                            {h === "cost_net"
                              ? (Number.isFinite(r[h]) ? Number(r[h]).toLocaleString(undefined, { style: "currency", currency: campaign?.currency || "USD" }) : "—")
                              : (r[h] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={insertRows}
                disabled={inserting || issues.length > 0 || mappedRows.length === 0}
                style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, border: "1px solid #999" }}
              >
                {inserting ? "Inserting…" : "Insert all mapped rows"}
              </button>
              {insertMsg && <p style={{ marginTop: 8, color: insertMsg.startsWith("Inserted") ? "green" : "crimson" }}>{insertMsg}</p>}
            </>
          )}
        </section>
      </main>
    </>
  );
}
