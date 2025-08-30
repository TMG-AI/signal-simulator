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

  // Debug
  const [fileName, setFileName] = useState("");
  const [lastEvent, setLastEvent] = useState("");

  // ----- Mapping state -----
  const CANONICAL = ["vendor","cat","cost_net","description","unit","quantity","geography","audience_descriptor","currency","fx_rate_to_campaign"];
  const [mapping, setMapping] = useState({
    vendor: "",
    cost_net: "",
    description: "",
    unit: "",
    quantity: "",
    geography: "",
    audience_descriptor: "",
    currency: "",
    fx_rate_to_campaign: ""
  });
  // cat can be taken from a column OR set as a constant (PRINT etc.)
  const [catMode, setCatMode] = useState("constant"); // "constant" | "header"
  const [catHeader, setCatHeader] = useState("");
  const [catConstant, setCatConstant] = useState("PRINT");

  // Mapped preview rows (canonical shape)
  const [mappedRows, setMappedRows] = useState([]);
  const REQUIRED = ["vendor","cat","cost_net"];
  const [mapErr, setMapErr] = useState("");

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
        .select("id,name,currency")
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
    setMappedRows([]);
    setMapErr("");
  }

  // ----------- header detection helpers -----------
  const HEADER_SYNONYMS = [
    "vendor","publisher","newspaper","partner","network","seller",
    "cat","category","channel","media type","placement type",
    "description","line item","ad set","ad group","notes","creative","campaign line","edition","editions","order",
    "unit","measure","kpi unit","size",
    "qty","quantity","impressions","imps","grps","spots","circulation","ins","insertions",
    "rate","price","cpm","cpp","inch rate","color charge","open national","net per unit",
    "net","cost net","amount","spend","cost","total","total cost","net amount","gross",
    "geography","geo","market","state","dma","region","city",
    "audience","target","targeting","segment",
    "currency","ccy","currency code","iso currency",
    "fx","fx rate","exchange rate","rate to campaign","fx_rate_to_campaign",
    "start","end","start date","end date","date","dow","tech specs"
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
    let hits = 0;
    for (const c of norm) {
      if (!c) continue;
      if (HEADER_SYNONYMS.includes(c)) { hits += 2; continue; }
      if (c.length <= 30 && /[a-z]/.test(c)) hits += 1;
    }
    return hits * 3 + nonEmpty;
  }

  function detectHeaderAndBodyFromAOA(aoa) {
    const limit = Math.min(50, aoa.length);
    let bestIdx = -1, bestScore = -1;
    for (let i = 0; i < limit; i++) {
      const row = (aoa[i] || []).map((x) => String(x ?? "").trim());
      const sc = scoreHeaderRow(row);
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    if (bestIdx === -1) bestIdx = 0;

    const rawHdrs = (aoa[bestIdx] || []);
    const hdrs = rawHdrs.map((h, i) => {
      const n = normalize(h);
      return n || `col_${i + 1}`;
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

  function csvTextToAoA(text) {
    if (!window.Papa) return [[]];
    const out = window.Papa.parse(text, { header: false, skipEmptyLines: false });
    return out?.data || [];
  }

  function parseCSVText(csvText) {
    const aoa = csvTextToAoA(csvText);
    const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(aoa);
    setHeaders(hdrs);
    setRows(body);
    setLastEvent(`CSV parsed · header row #${headerRowIndex + 1} · rows=${body.length}`);
    guessMapping(hdrs);
  }

  // ---------------- Handle file selection (CSV or XLS/XLSX) ----------------
  function onFileChange(e) {
    resetParse();
    const file = e.target.files?.[0];
    if (!file) { setLastEvent("No file in event"); return; }

    setFileName(file.name || "");
    const name = (file.name || "").toLowerCase();

    // Excel path
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
          if (!sheetName) { setParseErr("No sheets found."); return; }
          const sheet = wb.Sheets[sheetName];
          const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
          if (!aoa?.length) { setParseErr("Empty spreadsheet."); return; }
          const { hdrs, body, headerRowIndex } = detectHeaderAndBodyFromAOA(aoa);
          setHeaders(hdrs);
          setRows(body);
          setLastEvent(`XLSX parsed · header row #${headerRowIndex + 1} · rows=${body.length}`);
          guessMapping(hdrs);
        } catch (err) {
          setParseErr(err?.message || "Failed to read Excel file.");
          setLastEvent("XLSX read error");
        }
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
    reader.onload = (evt) => { setLastEvent("FileReader loaded (csv)"); parseCSVText(evt.target.result); };
    reader.readAsText(file);
  }

  // ---------------- Mapping (guess + apply) ----------------
  const FIELD_SYNONYMS = {
    vendor: ["vendor","publisher","newspaper","partner","network","seller","account","media vendor","paper"],
    cost_net: ["cost net","net","net cost","amount","spend","cost","total","total cost","net amount"],
    description: ["description","notes","order","edition","editions"],
    unit: ["unit","measure","kpi unit","size"],
    quantity: ["quantity","qty","impressions","imps","grps","spots","circulation","ins","insertions"],
    geography: ["geography","geo","market","city","state","dma","region"],
    audience_descriptor: ["audience","target","targeting","segment"],
    currency: ["currency","ccy","currency code","iso currency"],
    fx_rate_to_campaign: ["fx rate","exchange rate","rate to campaign","fx","fx_rate_to_campaign"],
  };

  function normalizeHeaderForMatch(h) {
    return String(h || "").trim().toLowerCase();
  }

  function guessHeaderFor(field, hdrs) {
    const normHdrs = hdrs.map((h) => ({ raw: h, n: normalizeHeaderForMatch(h) }));
    // hard choices for newspaper-style sheets
    if (field === "vendor") {
      const hit = normHdrs.find(({ n }) => n.includes("newspaper") || n.includes("publisher") || n === "vendor");
      if (hit) return hit.raw;
    }
    if (field === "cost_net") {
      const hit = normHdrs.find(({ n }) => n === "total" || n.includes("net per unit") || n === "net");
      if (hit) return hit.raw;
    }
    // general synonym match
    const syns = (FIELD_SYNONYMS[field] || []).map(normalizeHeaderForMatch);
    const bySyn = normHdrs.find(({ n }) => syns.includes(n));
    if (bySyn) return bySyn.raw;
    // soft contains
    const soft = normHdrs.find(({ n }) => syns.some((s) => n.includes(s)));
    return soft ? soft.raw : "";
  }

  function guessMapping(hdrs) {
    // default cat as constant PRINT (can change in UI)
    setCatMode("constant");
    setCatConstant("PRINT");
    setCatHeader("");

    const m = { ...mapping };
    m.vendor = guessHeaderFor("vendor", hdrs) || m.vendor;
    m.cost_net = guessHeaderFor("cost_net", hdrs) || m.cost_net;
    m.description = guessHeaderFor("description", hdrs) || m.description;
    m.unit = guessHeaderFor("unit", hdrs) || m.unit;
    m.quantity = guessHeaderFor("quantity", hdrs) || m.quantity;
    m.geography = guessHeaderFor("geography", hdrs) || m.geography;
    m.audience_descriptor = guessHeaderFor("audience_descriptor", hdrs) || m.audience_descriptor;
    m.currency = guessHeaderFor("currency", hdrs) || m.currency;
    m.fx_rate_to_campaign = guessHeaderFor("fx_rate_to_campaign", hdrs) || m.fx_rate_to_campaign;
    setMapping(m);
  }

  function toNumberLoose(v) {
    if (v === undefined || v === null || v === "") return NaN;
    const cleaned = String(v).replace(/[$, ]/g, "");
    const n = Number(cleaned);
    return n;
  }
  function nullableStr(v) {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  }
  function applyMapping() {
    setMapErr("");
    const out = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];

      const vendor = String(raw[mapping.vendor] ?? "").trim();
      const costNet = toNumberLoose(raw[mapping.cost_net]);
      const cat = catMode === "constant"
        ? String(catConstant || "").toUpperCase()
        : String(raw[catHeader] ?? "").toUpperCase();

      if (!vendor) return setMapErr(`Row ${i + 1}: vendor is required (map it to the right column).`);
      if (!cat) return setMapErr(`Row ${i + 1}: cat is required (choose a header or set a constant).`);
      if (!Number.isFinite(costNet) || costNet < 0) return setMapErr(`Row ${i + 1}: cost_net must be a non-negative number.`);

      const item = {
        vendor,
        cat,
        cost_net: costNet,
        description: nullableStr(raw[mapping.description]),
        unit: nullableStr(raw[mapping.unit]),
        quantity: raw[mapping.quantity] === undefined || raw[mapping.quantity] === "" ? null : Number(String(raw[mapping.quantity]).replace(/[, ]/g, "")),
        geography: nullableStr(raw[mapping.geography]),
        audience_descriptor: cat === "DIGITAL" ? nullableStr(raw[mapping.audience_descriptor]) : (nullableStr(raw[mapping.audience_descriptor]) || null),
        currency: nullableStr(raw[mapping.currency]),
        fx_rate_to_campaign: raw[mapping.fx_rate_to_campaign] ? Number(String(raw[mapping.fx_rate_to_campaign]).replace(/[, ]/g, "")) : null
      };

      out.push(item);
    }

    setMappedRows(out);
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
            key={`${xlsxReady}-${papaReady}`}
            type="file"
            accept=".csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .xlsx, .xls"
            onChange={onFileChange}
            onClick={(e) => { e.currentTarget.value = null; }}
          />
          {parseErr && <p style={{ color: "crimson", marginTop: 10 }}>{parseErr}</p>}
          <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
            Debug: file=<strong>{fileName || "—"}</strong> · {lastEvent || "no events yet"} · headers={headers.length} · rows={rows.length}
          </div>
        </section>

        {/* Raw preview (helps pick mappings) */}
        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          {headers.length === 0 ? (
            <p>No file parsed yet.</p>
          ) : (
            <>
              <p style={{ color: "#555" }}>
                Detected headers: {headers.join(" · ")} <br />
                Showing up to 10 rows:
              </p>
              <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{headers.map((h) => (<th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>{h}</th>))}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {headers.map((h) => (<td key={h} style={{ borderBottom: "1px solid #f6f6f6", padding: 8 }}>{r[h] ?? "—"}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Mapping UI */}
        {headers.length > 0 && (
          <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Map columns</h2>
            <p style={{ color: "#555" }}>Required: <code>vendor</code>, <code>cat</code>, <code>cost_net</code>. You can leave the rest blank.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, alignItems: "center" }}>
              {/* Vendor */}
              <div>vendor *</div>
              <select value={mapping.vendor} onChange={(e) => setMapping((m) => ({ ...m, vendor: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— choose header —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              {/* Category */}
              <div>cat *</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label><input type="radio" name="catmode" checked={catMode==="constant"} onChange={() => setCatMode("constant")} /> Constant</label>
                {catMode === "constant" && (
                  <select value={catConstant} onChange={(e) => setCatConstant(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                    <option value="PRINT">PRINT</option>
                    <option value="DIGITAL">DIGITAL</option>
                    <option value="BROADCAST">BROADCAST</option>
                    <option value="OOH_DOOH">OOH_DOOH</option>
                    <option value="CREATIVE">CREATIVE</option>
                    <option value="FEES">FEES</option>
                  </select>
                )}
                <label><input type="radio" name="catmode" checked={catMode==="header"} onChange={() => setCatMode("header")} /> From header</label>
                {catMode === "header" && (
                  <select value={catHeader} onChange={(e) => setCatHeader(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                    <option value="">— choose header —</option>
                    {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
                  </select>
                )}
              </div>

              {/* Cost */}
              <div>cost_net *</div>
              <select value={mapping.cost_net} onChange={(e) => setMapping((m) => ({ ...m, cost_net: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— choose header —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              {/* Optional fields */}
              <div>description</div>
              <select value={mapping.description} onChange={(e) => setMapping((m) => ({ ...m, description: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              <div>unit</div>
              <select value={mapping.unit} onChange={(e) => setMapping((m) => ({ ...m, unit: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              <div>quantity</div>
              <select value={mapping.quantity} onChange={(e) => setMapping((m) => ({ ...m, quantity: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              <div>geography</div>
              <select value={mapping.geography} onChange={(e) => setMapping((m) => ({ ...m, geography: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              <div>currency</div>
              <select value={mapping.currency} onChange={(e) => setMapping((m) => ({ ...m, currency: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>

              <div>fx_rate_to_campaign</div>
              <select value={mapping.fx_rate_to_campaign} onChange={(e) => setMapping((m) => ({ ...m, fx_rate_to_campaign: e.target.value }))} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
                <option value="">— none —</option>
                {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>
            </div>

            {mapErr && <p style={{ color: "crimson", marginTop: 10 }}>{mapErr}</p>}
            <button onClick={applyMapping} style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, border: "1px solid #999" }}>
              Apply mapping
            </button>
          </section>
        )}

        {/* Mapped preview */}
        {mappedRows.length > 0 && (
          <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>Mapped Preview (canonical)</h2>
            <p style={{ color: "#555" }}>{mappedRows.length} row(s) mapped.</p>
            <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid #eee", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {CANONICAL.map((h) => (<th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 10).map((r, i) => (
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
          </section>
        )}
      </main>
    </>
  );
}
