/* btcmex · plataforma de operaciones MX ⇄ HK
 * Estado local por operación, agentes por etapa, expediente descargable.
 */
(function () {
  "use strict";

  /* ---------- Utilidades ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var nf2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf4 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  function mxn(v) { return "$" + nf2.format(v || 0) + " MXN"; }
  function usd(v) { return nf2.format(v || 0) + " USD"; }
  function usdt(v) { return nf4.format(v || 0) + " USDT"; }
  function num(v) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? Math.min(ms, 120) : ms); }); }
  function nowISO() { return new Date().toISOString(); }
  function fmtDT(iso) { if (!iso) return "—"; var d = new Date(iso); return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function fmtT(iso) { return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function hex(n) { var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function alnum(n) { var c = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", s = "", a = new Uint8Array(n); crypto.getRandomValues(a); for (var i = 0; i < n; i++) s += c[a[i] % c.length]; return s; }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase(); }
  function short(h) { return h ? h.slice(0, 10) + "…" + h.slice(-8) : "—"; }
  function kb(b) { return b > 1048576 ? nf2.format(b / 1048576) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }

  /* ---------- Validaciones ---------- */
  var CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
  var RFC_PF = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/;
  var RFC_PM = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/;
  function curpDigit(c) {
    var d = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ", s = 0;
    for (var i = 0; i < 17; i++) s += d.indexOf(c[i]) * (18 - i);
    return String((10 - (s % 10)) % 10);
  }
  function curpCheck(c) {
    c = norm(c);
    if (!c) return { ok: false, msg: "" };
    if (c.length !== 18) return { ok: false, msg: "La CURP tiene 18 caracteres; llevas " + c.length + "." };
    if (!CURP_RE.test(c)) return { ok: false, msg: "La estructura no corresponde a una CURP." };
    if (curpDigit(c) !== c[17]) return { ok: false, msg: "El dígito verificador no coincide; revisa el último carácter." };
    return { ok: true, msg: "CURP válida · dígito verificador correcto." };
  }
  function rfcCheck(r, moral, curp) {
    r = norm(r);
    if (!r) return { ok: false, msg: "" };
    var re = moral ? RFC_PM : RFC_PF;
    if (!re.test(r)) return { ok: false, msg: moral ? "RFC de persona moral: 12 caracteres (3 letras, fecha, homoclave)." : "RFC de persona física: 13 caracteres (4 letras, fecha, homoclave)." };
    if (!moral && curp && curpCheck(curp).ok && norm(curp).slice(0, 10) !== r.slice(0, 10)) return { ok: false, msg: "No concilia con la CURP: los primeros 10 caracteres deben coincidir." };
    return { ok: true, msg: !moral && curp ? "RFC conciliado con CURP." : "RFC con estructura válida." };
  }
  var WALLET_RE = { "TRC-20": /^T[1-9A-HJ-NP-Za-km-z]{33}$/, "ERC-20": /^0x[0-9a-fA-F]{40}$/, "Polygon": /^0x[0-9a-fA-F]{40}$/ };
  var CONFIRMS = { "TRC-20": 19, "ERC-20": 12, "Polygon": 64 };
  var SUPPLIER_WALLET = { "TRC-20": "TJ7vQx3kRb9WmPz4Lc8NfH2sYd6aEg5UoK", "ERC-20": "0x4b9Ac03e1F7d28C6a5E90b3dD8217f6Ce94A1b3f", "Polygon": "0x4b9Ac03e1F7d28C6a5E90b3dD8217f6Ce94A1b3f" };

  /* ---------- Catálogo de documentos ---------- */
  var AG = { IA1: "IA1", C: "IA1.concilia", IA2: "IA2", IA3: "IA3", A33: "IA3.3", PRV: "Agente Proveedores" };
  var DOCS = [
    { id: "ine", st: 1, ag: AG.C, name: "Identificación oficial vigente", desc: "INE o pasaporte. La plataforma solicita validación biométrica.", up: true },
    { id: "csf", st: 1, ag: AG.C, name: "Constancia de Situación Fiscal", desc: "CSF con RFC vigente para vincular tu identidad fiscal.", up: true },
    { id: "acta", st: 1, ag: AG.C, name: "Acta constitutiva", desc: "Persona moral: escritura de constitución.", up: true, moral: true },
    { id: "poderes", st: 1, ag: AG.C, name: "Poderes del representante legal", desc: "Persona moral: facultades para actos de dominio o administración.", up: true, moral: true },
    { id: "benef", st: 1, ag: AG.C, name: "Identificación de beneficiarios finales", desc: "Persona moral: accionistas con control efectivo.", up: true, moral: true },
    { id: "domicilio", st: 1, ag: AG.C, name: "Comprobante de domicilio", desc: "Luz, agua o estado de cuenta, no mayor a 3 meses.", up: true },
    { id: "origen", st: 1, ag: AG.C, name: "Estado de cuenta de origen de recursos", desc: "Cuenta mexicana a tu nombre desde donde sale el SPEI.", up: true },
    { id: "conversion", st: 1, ag: AG.IA1, name: "Comprobante de compra / conversión", desc: "Fecha, hora, tipo de cambio, comisiones y monto adquirido." },
    { id: "po", st: 2, ag: AG.IA2, name: "Orden de compra (PO)", desc: "Modelo, tallas, materiales, cantidad, precio y pago en activos virtuales." },
    { id: "proforma", st: 2, ag: AG.IA2, name: "Factura proforma", desc: "Monto, wallet del destinatario, red y paridad acordada." },
    { id: "travel", st: 2, ag: AG.IA2, name: "Declaración de Regla de Viaje", desc: "Beneficiario en Hong Kong y tipo de wallet destino." },
    { id: "txid", st: 2, ag: AG.IA2, name: "TXID y comprobante de explorador", desc: "Emisora, receptora, monto exacto y fecha/hora." },
    { id: "invoice", st: 2, ag: AG.IA2, name: "Factura comercial y recibo de pago", desc: "Emitidos por el proveedor al confirmar la transferencia." },
    { id: "permuta", st: 3, ag: AG.IA3, name: "Contrato de permuta o dación en pago", desc: "El proveedor acepta stablecoin como pago total." },
    { id: "nif", st: 3, ag: AG.IA3, name: "Hoja de valuación NIF C-22", desc: "Valor en pesos al comprar contra valor al transferir." },
    { id: "materialidad", st: 3, ag: AG.IA3, name: "Expediente de materialidad", desc: "Correos, cotizaciones, conversaciones y TXID." },
    { id: "padron", st: 4, ag: AG.A33, name: "Padrón de Importadores y Sectorial Textil (Sector 11)", desc: "Obligatorio para importar ropa con fines comerciales.", up: true, route: "A" },
    { id: "encargo", st: 4, ag: AG.A33, name: "Encargo conferido", desc: "Autorización al agente aduanal firmada con e.firma.", route: "A" },
    { id: "invTrad", st: 4, ag: AG.A33, name: "Factura comercial traducida", desc: "Descripción detallada, valores en USD, comprador y vendedor.", route: "A" },
    { id: "packing", st: 4, ag: AG.A33, name: "Lista de empaque", desc: "Cajas, peso bruto y neto, dimensiones y tallas.", route: "A" },
    { id: "awb", st: 4, ag: AG.A33, name: "Guía aérea (AWB) o B/L", desc: "Transporte internacional Hong Kong – México.", up: true, route: "A" },
    { id: "origenCert", st: 4, ag: AG.A33, name: "Certificado o declaración de origen", desc: "Hong Kong o China continental; define aranceles y cuotas.", up: true, route: "A" },
    { id: "nom004", st: 4, ag: AG.A33, name: "Etiquetado NOM-004-SE-2021", desc: "Etiqueta en español cosida o adherida de origen.", route: "A" },
    { id: "cove", st: 4, ag: AG.A33, name: "COVE y MVE (VUCEM)", desc: "Valor en aduana y método de pago con el TXID anexo.", route: "A" },
    { id: "pedimento", st: 4, ag: AG.A33, name: "Pedimento de importación pagado", desc: "IGI, DTA e IVA liquidados por el agente aduanal.", route: "A" },
    { id: "rfcDest", st: 4, ag: AG.PRV, name: "RFC o CURP del destinatario", desc: "Obligatorio en paquetes internacionales hacia México.", route: "B" },
    { id: "carta", st: 4, ag: AG.PRV, name: "Carta de uso personal", desc: "Declaración bajo protesta de decir verdad.", route: "B" },
    { id: "pagoB", st: 4, ag: AG.PRV, name: "Comprobante de pago", desc: "Factura de Hong Kong, recibo del exchange y TXID.", route: "B" }
  ];
  var DOC = {}; DOCS.forEach(function (d) { DOC[d.id] = d; });

  var STAGES = [
    { n: 1, short: "MXN", name: "Salida MXN", long: "KYC y conversión a stablecoin", agents: ["Agente IA1", "IA1.concilia"] },
    { n: 2, short: "HK", name: "Envío a Hong Kong", long: "PO, proforma, Regla de Viaje", agents: ["Agente IA2"] },
    { n: 3, short: "SAT", name: "Respaldo SAT", long: "Permuta, NIF C-22, materialidad", agents: ["Agente IA3"] },
    { n: 4, short: "Aduana", name: "Aduana", long: "Despacho formal o paquetería", agents: ["Subagente IA3.3", "Agente Proveedores"] },
    { n: 5, short: "Exp.", name: "Expediente", long: "Documentos y descarga", agents: [] }
  ];

  /* ---------- Estado ---------- */
  var KEY = "btcmex.operacion.v1";
  function fresh() {
    var d = new Date();
    return {
      id: "OP-" + String(d.getFullYear()).slice(2) + ("0" + (d.getMonth() + 1)).slice(-2) + "-0001",
      created: nowISO(),
      stage: 1,
      persona: "fisica",
      kyc: { nombre: "", curp: "", rfc: "", titular: "", domFecha: "" },
      docs: {},
      conv: { exchange: "Bitso", mxn: 2600, tc: 18.3, com: 0.65 },
      po: { proveedor: "Kowloon Knit Works Ltd.", modelo: "Playera cuello redondo", material: "100 % algodón, tejido de punto", S: 5, M: 7, L: 5, XL: 3, precio: 6.5, red: "TRC-20" },
      walletConfirm: "",
      tr: { beneficiario: "Kowloon Knit Works Ltd.", custodia: "no_custodial", vasp: "", acepto: false },
      tx: null,
      fiscal: { objetivo: "deducir", tcTransfer: 18.42 },
      aduana: { ruta: "A", flete: 48, tcAduana: 18.4, igi: 35, cajas: 1, bruto: 4.6, neto: 4.1, nom: {} , cartaOk: false },
      log: []
    };
  }
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { S = fresh(); }
  var defaults = fresh();
  Object.keys(defaults).forEach(function (k) { if (S[k] === undefined) S[k] = defaults[k]; });
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* almacenamiento no disponible */ } }
  var busy = false;

  function dstate(id) { return S.docs[id] || { st: "pendiente" }; }
  function setDoc(id, patch) { S.docs[id] = Object.assign({}, dstate(id), patch); save(); }
  function ok(id) { return dstate(id).st === "validado"; }
  function applicable(d) {
    if (d.moral && S.persona !== "moral") return false;
    if (d.route && d.route !== S.aduana.ruta) return false;
    return true;
  }
  function appDocs(stage) { return DOCS.filter(function (d) { return applicable(d) && (!stage || d.st === stage); }); }
  function stageDone(n) { var l = appDocs(n); return l.filter(function (d) { return ok(d.id); }).length + "/" + l.length; }

  /* ---------- Cálculos ---------- */
  function C() {
    var c = S.conv, p = S.po, f = S.fiscal, a = S.aduana;
    var comMXN = num(c.mxn) * num(c.com) / 100;
    var netMXN = num(c.mxn) - comMXN;
    var usdtBought = num(c.tc) > 0 ? netMXN / num(c.tc) : 0;
    var qty = num(p.S) + num(p.M) + num(p.L) + num(p.XL);
    var total = qty * num(p.precio);
    var receipt = dstate("conversion").meta;
    var owned = receipt ? receipt.usdt : 0;
    var costPerUSDT = receipt ? receipt.mxn / receipt.usdt : 0;
    var paid = S.tx ? S.tx.amount : total;
    var costoMXN = paid * costPerUSDT;
    var valorMXN = paid * num(f.tcTransfer);
    var va = (total + num(a.flete)) * num(a.tcAduana);
    var igi = va * num(a.igi) / 100;
    var dta = va * 0.008;
    var iva = (va + igi + dta) * 0.16;
    return { comMXN: comMXN, netMXN: netMXN, usdtBought: usdtBought, qty: qty, total: total, owned: owned, costPerUSDT: costPerUSDT, paid: paid, costoMXN: costoMXN, valorMXN: valorMXN, dif: valorMXN - costoMXN, va: va, igi: igi, dta: dta, iva: iva, contrib: igi + dta + iva };
  }

  /* ---------- Bitácora ---------- */
  function log(who, msg, kind) {
    S.log.unshift({ t: nowISO(), who: who, msg: msg, k: kind || "" });
    if (S.log.length > 120) S.log.length = 120;
    save();
    renderLog();
  }

  /* ---------- Agentes ---------- */
  function runAgent(id, opts) {
    var d = DOC[id];
    setDoc(id, { st: "revision", note: "", file: opts.file || dstate(id).file });
    log(d.ag, opts.start || ("Revisando " + d.name.toLowerCase() + "."));
    refresh();
    return sleep(opts.delay || 900).then(function () {
      var r = opts.check ? opts.check() : { ok: true };
      setDoc(id, { st: r.ok ? "validado" : "observado", note: r.note || "", at: nowISO(), meta: r.meta || dstate(id).meta });
      log(d.ag, r.ok ? (r.log || (d.name + " validado.")) : ("Observación en " + d.name.toLowerCase() + ": " + r.note), r.ok ? "is-ok" : "is-err");
      refresh();
      return r.ok;
    });
  }

  function kycDocsOk() { return appDocs(1).filter(function (d) { return d.up; }).every(function (d) { return ok(d.id); }); }

  var CHECKS = {
    ine: function () { return { ok: true, note: "Vigencia y legibilidad verificadas.", log: "INE verificada. CURP lista para conciliar con RFC." }; },
    csf: function () {
      var r = rfcCheck(S.kyc.rfc, S.persona === "moral", S.kyc.curp);
      if (!S.kyc.rfc) return { ok: false, note: "Captura el RFC que aparece en la constancia." };
      return r.ok ? { ok: true, note: r.msg, log: "CSF validada · " + r.msg } : { ok: false, note: r.msg };
    },
    acta: function () { return { ok: true, note: "Folio mercantil legible." }; },
    poderes: function () { return { ok: true, note: "Facultades suficientes para la operación." }; },
    benef: function () { return { ok: true, note: "Beneficiarios finales identificados." }; },
    domicilio: function () {
      if (!S.kyc.domFecha) return { ok: false, note: "Captura la fecha de emisión del comprobante." };
      var days = (Date.now() - new Date(S.kyc.domFecha + "T12:00:00").getTime()) / 864e5;
      if (days < 0) return { ok: false, note: "La fecha de emisión está en el futuro." };
      if (days > 92) return { ok: false, note: "Tiene " + Math.floor(days) + " días; el límite es 3 meses." };
      return { ok: true, note: "Emitido hace " + Math.floor(days) + " días." };
    },
    origen: function () {
      var who = S.persona === "moral" ? S.kyc.nombre : S.kyc.nombre;
      if (!S.kyc.titular || !who) return { ok: false, note: "Captura tu nombre y el titular de la cuenta." };
      if (norm(S.kyc.titular) !== norm(who)) return { ok: false, note: "El titular no coincide con tu nombre; las plataformas no aceptan depósitos de terceros." };
      return { ok: true, note: "Cuenta a nombre del solicitante.", log: "Titular de la cuenta conciliado con la identidad del solicitante." };
    }
  };

  function attach(id, file) {
    if (busy && !file.__auto) return;
    var f = { name: file.name, size: file.size };
    return runAgent(id, { file: f, start: "Recibí " + file.name + " (" + kb(file.size) + "). Revisando.", check: CHECKS[id] || function () { return { ok: true, note: "Documento legible y vigente." }; } });
  }

  /* ---------- Acciones por etapa ---------- */
  var A = {};

  A.convert = function () {
    if (!kycDocsOk()) { toast("Completa y valida los documentos KYC antes de convertir."); return Promise.resolve(false); }
    var c = C();
    if (c.usdtBought <= 0) { toast("Revisa el monto y el tipo de cambio."); return Promise.resolve(false); }
    return runAgent("conversion", {
      start: "Enviando SPEI de " + mxn(num(S.conv.mxn)) + " a " + S.conv.exchange + " y ejecutando la compra.",
      delay: 1300,
      check: function () {
        var m = { folio: S.conv.exchange.slice(0, 3).toUpperCase() + "-" + alnum(8), at: nowISO(), mxn: num(S.conv.mxn), tc: num(S.conv.tc), com: num(S.conv.com), comMXN: c.comMXN, usdt: Math.floor(c.usdtBought * 1e4) / 1e4, exchange: S.conv.exchange };
        return { ok: true, meta: m, note: "Folio " + m.folio, log: "Compra ejecutada: " + usdt(m.usdt) + " a " + nf4.format(m.tc) + " MXN por USDT. Costo de adquisición documentado." };
      }
    });
  };

  A.emitPO = function () {
    var c = C();
    if (!S.po.proveedor || !S.po.modelo) { toast("Captura proveedor y modelo."); return Promise.resolve(false); }
    if (c.qty <= 0 || num(S.po.precio) <= 0) { toast("Captura cantidades y precio unitario."); return Promise.resolve(false); }
    return runAgent("po", {
      start: "Emitiendo orden de compra a " + S.po.proveedor + ".",
      check: function () { return { ok: true, meta: { folio: "PO-" + S.id.slice(3), total: c.total, qty: c.qty, red: S.po.red }, note: c.qty + " piezas · " + usd(c.total), log: "PO emitida con pago en activos virtuales sobre " + S.po.red + "." }; }
    }).then(function (r) {
      if (!r) return false;
      return runAgent("proforma", {
        start: S.po.proveedor + " está emitiendo la factura proforma.",
        delay: 1500,
        check: function () {
          var m = { folio: "PI-" + alnum(6), total: c.total, red: S.po.red, wallet: SUPPLIER_WALLET[S.po.red], paridad: "1 USDT = 1 USD" };
          return { ok: true, meta: m, note: "Total " + usd(m.total) + " · " + m.red, log: "Proforma recibida. Wallet con formato válido para " + m.red + "; confirma los últimos 6 caracteres con el proveedor." };
        }
      });
    });
  };

  A.signTravel = function () {
    var pf = dstate("proforma").meta;
    if (!ok("proforma") || !pf) { toast("Primero recibe la factura proforma."); return Promise.resolve(false); }
    return runAgent("travel", {
      start: "Verificando la declaración de Regla de Viaje.",
      check: function () {
        if (!S.tr.beneficiario) return { ok: false, note: "Captura el nombre o razón social del beneficiario." };
        if (S.tr.custodia === "custodial" && !S.tr.vasp) return { ok: false, note: "Indica el exchange (VASP) que custodia la wallet destino." };
        if (norm(S.walletConfirm) !== norm(pf.wallet.slice(-6))) return { ok: false, note: "Los últimos 6 caracteres no coinciden con la wallet de la proforma." };
        if (!S.tr.acepto) return { ok: false, note: "Marca la declaración de veracidad." };
        return { ok: true, meta: { beneficiario: S.tr.beneficiario, pais: "Hong Kong", custodia: S.tr.custodia, vasp: S.tr.vasp }, note: "Firmada · wallet " + (S.tr.custodia === "custodial" ? "custodial" : "no custodial"), log: "Regla de Viaje firmada. Envío liberado por el exchange de origen." };
      }
    });
  };

  A.send = function () {
    var c = C(), pf = dstate("proforma").meta;
    var miss = [];
    if (!ok("conversion")) miss.push("comprobante de conversión");
    if (!ok("proforma")) miss.push("factura proforma");
    if (!ok("travel")) miss.push("Regla de Viaje");
    if (miss.length) { toast("Falta: " + miss.join(", ") + "."); return Promise.resolve(false); }
    if (c.owned < pf.total) { toast("Saldo insuficiente: tienes " + usdt(c.owned) + " y la proforma pide " + usdt(pf.total) + "."); return Promise.resolve(false); }
    var need = CONFIRMS[pf.red];
    var h = hex(32);
    var txHash = pf.red === "TRC-20" ? h : "0x" + h;
    S.tx = { hash: txHash, amount: pf.total, red: pf.red, from: pf.red === "TRC-20" ? "TXmK2p8Rv4cNb7Lq9Wf3Hs6Yd1Ze5Ga2Uj" : "0x91cE4d7A2b08F3e6C5d1A9b7E24f60D3c8B5a7E1", to: pf.wallet, at: nowISO(), conf: 0, need: need, block: 70000000 + Math.floor(Math.random() * 999999) };
    save();
    setDoc("txid", { st: "revision", note: "" });
    log(AG.IA2, "Transferencia transmitida a la red " + pf.red + ". Esperando " + need + " confirmaciones.");
    refresh();
    return new Promise(function (resolve) {
      var tick = function () {
        S.tx.conf = Math.min(need, S.tx.conf + (reduceMotion ? need : 1));
        var bar = $("#confirm-fill"), lbl = $("#confirm-label");
        if (bar) bar.style.width = (S.tx.conf / need * 100) + "%";
        if (lbl) lbl.textContent = S.tx.conf + " / " + need;
        if (S.tx.conf >= need) {
          save();
          setDoc("txid", { st: "validado", at: nowISO(), note: short(S.tx.hash), meta: { hash: S.tx.hash } });
          log(AG.IA2, "TXID confirmado: " + short(S.tx.hash) + ". Comprobante de explorador generado.", "is-ok");
          refresh(); resolve(true);
        } else setTimeout(tick, 110);
      };
      setTimeout(tick, 300);
    });
  };

  A.invoice = function () {
    if (!ok("txid")) { toast("La factura comercial se emite al confirmar la transferencia."); return Promise.resolve(false); }
    return runAgent("invoice", {
      start: "Solicitando factura comercial definitiva y recibo de pago a " + S.po.proveedor + ".",
      delay: 1400,
      check: function () { return { ok: true, meta: { folio: "CI-" + alnum(6), recibo: "RC-" + alnum(6) }, note: "Deuda liquidada mediante stablecoin.", log: "Factura comercial y recibo recibidos. La PO queda liquidada." }; }
    });
  };

  A.permuta = function () {
    if (!ok("po") || !ok("txid")) { toast("El contrato se redacta con la PO emitida y el TXID confirmado."); return Promise.resolve(false); }
    return runAgent("permuta", {
      start: "Redactando contrato de dación en pago con los datos de la PO y el TXID.",
      delay: 1100,
      check: function () { return { ok: true, meta: { firmado: nowISO() }, note: "Firmado con e.firma por el comprador; aceptación del proveedor anexa.", log: "Contrato de permuta firmado y anexado al expediente." }; }
    });
  };

  A.nif = function () {
    if (!ok("conversion") || !ok("txid")) { toast("La valuación necesita el comprobante de conversión y el TXID."); return Promise.resolve(false); }
    var c = C();
    return runAgent("nif", {
      start: "Calculando valuación NIF C-22.",
      check: function () { return { ok: true, meta: { costo: c.costoMXN, valor: c.valorMXN, dif: c.dif, tc: num(S.fiscal.tcTransfer) }, note: (c.dif >= 0 ? "Ganancia " : "Pérdida ") + mxn(Math.abs(c.dif)), log: "Valuación registrada: " + (c.dif >= 0 ? "ganancia" : "pérdida") + " de " + mxn(Math.abs(c.dif)) + " entre compra y transferencia." }; }
    });
  };

  A.materialidad = function (file) {
    var f = file ? { name: file.name, size: file.size } : dstate("materialidad").file;
    return runAgent("materialidad", {
      file: f,
      start: "Integrando correos, cotización, conversaciones y TXID.",
      check: function () {
        var miss = [];
        if (!ok("po")) miss.push("PO");
        if (!ok("proforma")) miss.push("proforma");
        if (!ok("txid")) miss.push("TXID");
        if (!f) miss.push("correos y conversaciones");
        return miss.length ? { ok: false, note: "Falta: " + miss.join(", ") + "." } : { ok: true, note: "4 de 4 evidencias integradas.", log: "Expediente de materialidad completo." };
      }
    });
  };

  A.encargo = function () { return runAgent("encargo", { start: "Solicitando firma con e.firma del encargo conferido.", check: function () { return S.kyc.rfc ? { ok: true, note: "Firmado con e.firma · RFC " + norm(S.kyc.rfc) } : { ok: false, note: "Se necesita el RFC del expediente KYC." }; } }); };
  A.invTrad = function () { return runAgent("invTrad", { start: "Traduciendo la factura comercial al español.", check: function () { return ok("invoice") ? { ok: true, note: "Playera cuello redondo, " + S.po.material + " · " + C().qty + " piezas · " + usd(C().total) } : { ok: false, note: "Primero recibe la factura comercial del proveedor." }; } }); };
  A.packing = function () { return runAgent("packing", { start: "Generando lista de empaque.", check: function () { var a = S.aduana; if (num(a.cajas) <= 0 || num(a.bruto) <= 0 || num(a.neto) <= 0) return { ok: false, note: "Captura cajas y pesos." }; if (num(a.neto) > num(a.bruto)) return { ok: false, note: "El peso neto no puede exceder el bruto." }; return { ok: true, note: a.cajas + " caja(s) · " + nf2.format(num(a.bruto)) + " kg bruto · S " + S.po.S + " / M " + S.po.M + " / L " + S.po.L + " / XL " + S.po.XL }; } }); };
  A.nom004 = function () { return runAgent("nom004", { start: "Revisando etiquetado NOM-004-SE-2021.", check: function () { var keys = NOM_FIELDS.map(function (f) { return f[0]; }); var miss = keys.filter(function (k) { return !S.aduana.nom[k]; }); return miss.length ? { ok: false, note: "Faltan " + miss.length + " elemento(s) de la etiqueta." } : { ok: true, note: "6 de 6 elementos presentes en cada prenda." }; } }); };
  A.cove = function () { return runAgent("cove", { start: "Transmitiendo COVE y MVE en VUCEM.", delay: 1300, check: function () { if (!ok("invTrad") || !ok("txid")) return { ok: false, note: "Se necesita la factura traducida y el TXID." }; return { ok: true, meta: { cove: "COVE" + alnum(9) }, note: "Método de pago: transferencia de activos virtuales · TXID " + short(S.tx.hash), log: "COVE y MVE transmitidos con el TXID como prueba de pago." }; } }); };
  A.pedimento = function () {
    var need = ["padron", "encargo", "invTrad", "packing", "awb", "origenCert", "nom004", "cove"].filter(function (id) { return !ok(id); });
    if (need.length) { toast("Antes del pedimento falta: " + need.map(function (id) { return DOC[id].name; }).join(", ") + "."); return Promise.resolve(false); }
    var c = C();
    return runAgent("pedimento", { start: "El agente aduanal está liquidando IGI, DTA e IVA.", delay: 1500, check: function () { var y = String(new Date().getFullYear()).slice(2); var n = y + "  47  3912  6" + String(Math.floor(Math.random() * 999999)).padStart(6, "0"); return { ok: true, meta: { numero: n, contrib: c.contrib }, note: "Pedimento " + n + " · " + mxn(c.contrib), log: "Pedimento pagado. Mercancía liberada para despacho." }; } });
  };
  A.rfcDest = function () { return runAgent("rfcDest", { start: "Tomando RFC/CURP del expediente KYC.", check: function () { var r = rfcCheck(S.kyc.rfc, S.persona === "moral", S.kyc.curp); var cu = curpCheck(S.kyc.curp); return r.ok || cu.ok ? { ok: true, note: (r.ok ? "RFC " + norm(S.kyc.rfc) : "CURP " + norm(S.kyc.curp)) } : { ok: false, note: "No hay RFC ni CURP válidos en la etapa 1." }; } }); };
  A.carta = function () { return runAgent("carta", { start: "Registrando carta de uso personal.", check: function () { return S.aduana.cartaOk ? { ok: true, note: "Firmada bajo protesta de decir verdad." } : { ok: false, note: "Marca la declaración de uso personal." }; } }); };
  A.pagoB = function () { return runAgent("pagoB", { start: "Integrando factura, recibo del exchange y TXID.", check: function () { return ok("invoice") && ok("conversion") && ok("txid") ? { ok: true, note: "3 de 3 comprobantes anexos." } : { ok: false, note: "Faltan comprobantes de las etapas 1 y 2." }; } }); };

  var NOM_FIELDS = [["marca", "Marca comercial"], ["insumos", "Descripción de insumos (100 % algodón)"], ["talla", "Talla"], ["cuidado", "Instrucciones de cuidado"], ["pais", "País de origen"], ["importador", "Datos del importador en México"]];

  /* ---------- Flujo asistido ---------- */
  function docFile(name, size) { return { name: name, size: size, __auto: true }; }
  async function autoStage(n) {
    if (n === 1) {
      if (!S.kyc.nombre) S.kyc.nombre = S.persona === "moral" ? "Textiles Robles SA de CV" : "Mariana Robles Treviño";
      if (!S.kyc.curp) S.kyc.curp = "ROTM910314MNLBRR09";
      if (!S.kyc.rfc) S.kyc.rfc = S.persona === "moral" ? "TRO190522AB4" : "ROTM910314KJ3";
      if (!S.kyc.titular) S.kyc.titular = S.kyc.nombre;
      if (!S.kyc.domFecha) { var d = new Date(Date.now() - 21 * 864e5); S.kyc.domFecha = d.toISOString().slice(0, 10); }
      save(); refresh();
      var files = { ine: ["INE_frente_reverso.pdf", 482113], csf: ["Constancia_Situacion_Fiscal.pdf", 211904], acta: ["Acta_constitutiva.pdf", 1803392], poderes: ["Poder_notarial.pdf", 640211], benef: ["Beneficiarios_finales.pdf", 158220], domicilio: ["Recibo_CFE.pdf", 305118], origen: ["Estado_de_cuenta.pdf", 702455] };
      for (var i = 0; i < appDocs(1).length; i++) { var dd = appDocs(1)[i]; if (dd.up && !ok(dd.id)) await attach(dd.id, docFile(files[dd.id][0], files[dd.id][1])); }
      if (!ok("conversion")) await A.convert();
    }
    if (n === 2) {
      if (!ok("po") || !ok("proforma")) await A.emitPO();
      var pf = dstate("proforma").meta;
      if (pf && !ok("travel")) { S.walletConfirm = pf.wallet.slice(-6); S.tr.acepto = true; save(); refresh(); await sleep(400); await A.signTravel(); }
      if (!ok("txid")) await A.send();
      if (!ok("invoice")) await A.invoice();
    }
    if (n === 3) {
      if (!ok("permuta")) await A.permuta();
      if (!ok("nif")) await A.nif();
      if (!ok("materialidad")) await A.materialidad(dstate("materialidad").file || docFile("Correos_y_conversaciones_proveedor.zip", 1240771));
    }
    if (n === 4) {
      if (S.aduana.ruta === "A") {
        var f4 = { padron: ["Padron_Sectorial_Textil_S11.pdf", 189003], awb: ["AWB_HKG-MEX.pdf", 96512], origenCert: ["Certificado_de_origen.pdf", 133840] };
        for (var k in f4) if (!ok(k)) await attach(k, docFile(f4[k][0], f4[k][1]));
        if (!ok("encargo")) await A.encargo();
        if (!ok("invTrad")) await A.invTrad();
        if (!ok("packing")) await A.packing();
        if (!ok("nom004")) { NOM_FIELDS.forEach(function (f) { S.aduana.nom[f[0]] = true; }); save(); refresh(); await A.nom004(); }
        if (!ok("cove")) await A.cove();
        if (!ok("pedimento")) await A.pedimento();
      } else {
        if (!ok("rfcDest")) await A.rfcDest();
        if (!ok("carta")) { S.aduana.cartaOk = true; save(); refresh(); await A.carta(); }
        if (!ok("pagoB")) await A.pagoB();
      }
    }
  }
  async function autoRun(stages) {
    if (busy) return;
    busy = true; refresh();
    log("Orquestador", "Iniciando ejecución con agentes para " + (stages.length > 1 ? "las etapas 1 a 4" : "la etapa " + stages[0]) + ".");
    try {
      for (var i = 0; i < stages.length; i++) {
        if (stages.length > 1) { S.stage = stages[i]; save(); go("#plataforma/" + stages[i], true); }
        await autoStage(stages[i]);
      }
      log("Orquestador", "Ejecución terminada. " + progress().done + " de " + progress().total + " documentos validados.", "is-ok");
    } finally { busy = false; refresh(); }
  }
  function progress() { var l = appDocs(); var d = l.filter(function (x) { return ok(x.id); }).length; return { done: d, total: l.length, pct: l.length ? Math.round(d / l.length * 100) : 0 }; }

  /* ---------- Render: piezas ---------- */
  var ST_LABEL = { pendiente: "Pendiente", revision: "En revisión", validado: "Validado", observado: "Observado" };
  function pill(st) { return '<span class="pill pill--' + st + '">' + ST_LABEL[st] + "</span>"; }
  function docRow(id, actionsHTML) {
    var d = DOC[id], s = dstate(id);
    var meta = [];
    if (s.file) meta.push(esc(s.file.name) + " · " + kb(s.file.size));
    if (s.at) meta.push(fmtDT(s.at));
    return '<div class="doc" id="doc-' + id + '"><div><div class="doc__name">' + esc(d.name) + '</div><div class="doc__desc">' + esc(d.desc) + "</div>" +
      (meta.length ? '<div class="doc__meta">' + meta.join(" · ") + "</div>" : "") +
      (s.note ? '<div class="doc__note ' + (s.st === "observado" ? "doc__note--err" : s.st === "validado" ? "doc__note--ok" : "") + '">' + esc(s.note) + "</div>" : "") +
      '</div><div class="doc__actions">' + pill(s.st) + (actionsHTML || "") + "</div></div>";
  }
  function uploadBtn(id) {
    var s = dstate(id);
    return '<label class="btn btn--sm file-btn"' + (busy ? ' aria-disabled="true"' : "") + ">" + (s.file ? "Reemplazar" : "Adjuntar") +
      '<input type="file" data-upload="' + id + '" accept=".pdf,.jpg,.jpeg,.png,.zip,.xml"' + (busy ? " disabled" : "") + ' aria-label="Adjuntar ' + esc(DOC[id].name) + '"></label>';
  }
  function actBtn(action, label, primary, extra) {
    var running = DOC[action] && dstate(action).st === "revision";
    return '<button type="button" class="btn btn--sm' + (primary ? " btn--primary" : "") + '" data-act="' + action + '"' + (busy || running ? " disabled" : "") + (running ? ' data-state="loading"' : "") + (extra || "") + ">" + label + "</button>";
  }
  function field(id, label, value, opts) {
    opts = opts || {};
    return '<label class="field" for="' + id + '"><span>' + label + "</span>" +
      '<input class="input' + (opts.mono ? " mono" : "") + '" id="' + id + '" data-bind="' + opts.bind + '" type="' + (opts.type || "text") + '"' +
      (opts.step ? ' step="' + opts.step + '"' : "") + (opts.min != null ? ' min="' + opts.min + '"' : "") + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : "") +
      (opts.max ? ' maxlength="' + opts.max + '"' : "") + (opts.disabled ? " disabled" : "") + ' value="' + esc(value) + '" autocomplete="off" spellcheck="false">' +
      (opts.hint !== undefined ? '<small id="' + id + '-hint" data-hint="' + id + '">' + opts.hint + "</small>" : "") + "</label>";
  }
  function seg(name, bind, options, current, disabledMap) {
    return '<div class="seg" role="radiogroup">' + options.map(function (o) {
      var id = name + "-" + o[0];
      return '<label for="' + id + '"><input type="radio" id="' + id + '" name="' + name + '" data-bind="' + bind + '" value="' + o[0] + '"' + (current === o[0] ? " checked" : "") + (disabledMap && disabledMap[o[0]] ? " disabled" : "") + "><span>" + o[1] + "</span></label>";
    }).join("") + "</div>";
  }
  function block(title, body, right, noPad) {
    return '<section class="block"><div class="block__head"><h3>' + title + "</h3>" + (right || "") + "</div>" + (noPad ? body : '<div class="block__body">' + body + "</div>") + "</section>";
  }
  function row(label, val, cls, outKey) { return '<div class="calc__row ' + (cls || "") + '"><span>' + label + "</span><b" + (outKey ? ' data-out="' + outKey + '"' : "") + ">" + val + "</b></div>"; }
  function panelHead(st, p) {
    return '<div class="panel__head"><div class="stage__num">' + st.n + ".0 · " + esc(st.name) + "</div><h2>" + p.title + "</h2><p>" + p.lede + '</p><div class="stage__agent">' + st.agents.map(function (a) { return '<span class="agent-tag">' + a + "</span>"; }).join("") + "</div>" +
      '<div class="actions">' + '<button type="button" class="btn btn--sm" data-auto="' + st.n + '"' + (busy ? " disabled" : "") + ">Ejecutar etapa con agentes</button>" + '<span class="label">' + stageDone(st.n) + " validados</span></div></div>";
  }

  /* ---------- Render: etapas ---------- */
  function stage1() {
    var k = S.kyc, c = C(), cu = curpCheck(k.curp), rf = rfcCheck(k.rfc, S.persona === "moral", k.curp);
    var rc = dstate("conversion").meta;
    var h = panelHead(STAGES[0], { title: "Expediente KYC y compra de USDT.", lede: "IA1.concilia valida tu identidad, concilia CURP con RFC y confirma que los pesos salen de una cuenta a tu nombre. Con el expediente completo, IA1 ejecuta la compra en un exchange regulado." });
    h += block("Tipo de solicitante", seg("persona", "persona", [["fisica", "Persona física"], ["moral", "Persona moral"]], S.persona) + '<p class="block__note" style="margin-top:var(--space-xs)">' + (S.persona === "moral" ? "Se suman acta constitutiva, poderes del representante legal y beneficiarios finales." : "Si operas como empresa, cambia a persona moral.") + "</p>");
    h += block("Datos de identidad",
      '<div class="form-grid form-grid--2">' +
      field("f-nombre", S.persona === "moral" ? "Razón social" : "Nombre completo", k.nombre, { bind: "kyc.nombre" }) +
      field("f-curp", S.persona === "moral" ? "CURP del representante legal" : "CURP", k.curp, { bind: "kyc.curp", mono: true, max: 18, hint: k.curp ? (cu.msg) : "IA1.concilia la toma de tu identificación.", }) +
      field("f-rfc", "RFC", k.rfc, { bind: "kyc.rfc", mono: true, max: 13, hint: k.rfc ? rf.msg : "Tal como aparece en tu Constancia de Situación Fiscal." }) +
      field("f-titular", "Titular de la cuenta bancaria de origen", k.titular, { bind: "kyc.titular", hint: "Debe coincidir con el solicitante." }) +
      field("f-dom", "Fecha de emisión del comprobante de domicilio", k.domFecha, { bind: "kyc.domFecha", type: "date" }) +
      "</div>");
    h += block("Documentos", appDocs(1).filter(function (d) { return d.up; }).map(function (d) { return docRow(d.id, uploadBtn(d.id)); }).join(""), '<span class="label">IA1.concilia</span>', true);
    var convBody = '<div class="form-grid form-grid--4">' +
      '<label class="field" for="f-exch"><span>Exchange</span><select class="select" id="f-exch" data-bind="conv.exchange"><option' + (S.conv.exchange === "Bitso" ? " selected" : "") + '>Bitso</option><option' + (S.conv.exchange === "Otro exchange regulado" ? " selected" : "") + ">Otro exchange regulado</option></select></label>" +
      field("f-mxn", "Monto SPEI (MXN)", S.conv.mxn, { bind: "conv.mxn", type: "number", step: "0.01", min: 0, inputmode: "decimal" }) +
      field("f-tc", "MXN por USDT", S.conv.tc, { bind: "conv.tc", type: "number", step: "0.0001", min: 0, inputmode: "decimal" }) +
      field("f-com", "Comisión (%)", S.conv.com, { bind: "conv.com", type: "number", step: "0.01", min: 0, inputmode: "decimal" }) + "</div>" +
      '<div class="calc">' + row("Comisión del exchange", mxn(c.comMXN), "", "comMXN") + row("Neto a convertir", mxn(c.netMXN), "", "netMXN") + row("USDT a recibir", usdt(c.usdtBought), "calc__row--total", "usdtBought") + row("Total de la proforma (etapa 2)", usd(c.total), "", "total") + "</div>" +
      (c.usdtBought && c.usdtBought < c.total ? '<div class="alert alert--warn" data-out-alert="short"><b>Monto corto.</b> Con este SPEI compras menos USDT de los que pide la orden de compra.</div>' : '<div data-out-alert="short"></div>') +
      '<div class="actions">' + actBtn("conversion", ok("conversion") ? "Comprar de nuevo" : "Enviar SPEI y comprar USDT", !ok("conversion")) + (kycDocsOk() ? "" : '<span class="block__note">Se habilita con los documentos KYC validados.</span>') + "</div>";
    h += block("Conversión MXN → USDT", convBody, pill(dstate("conversion").st));
    if (rc) {
      h += block("Comprobante de conversión", '<div class="calc">' + row("Folio", esc(rc.folio)) + row("Exchange", esc(rc.exchange)) + row("Fecha y hora", fmtDT(rc.at)) + row("Monto enviado", mxn(rc.mxn)) + row("Tipo de cambio", nf4.format(rc.tc) + " MXN/USDT") + row("Comisión", mxn(rc.comMXN) + " (" + nf2.format(rc.com) + " %)") + row("USDT adquiridos", usdt(rc.usdt), "calc__row--total") + row("Costo de adquisición por USDT", mxn(rc.mxn / rc.usdt)) + "</div>");
    }
    return h;
  }

  function stage2() {
    var p = S.po, c = C(), pf = dstate("proforma").meta, tx = S.tx;
    var h = panelHead(STAGES[1], { title: "Orden de compra, proforma y envío.", lede: "IA2 emite la PO, recibe la proforma con la wallet del proveedor y no libera el envío hasta que la Regla de Viaje está firmada y la wallet verificada." });
    var poBody = '<div class="form-grid form-grid--2">' +
      field("f-prov", "Proveedor en Hong Kong", p.proveedor, { bind: "po.proveedor" }) +
      field("f-modelo", "Modelo", p.modelo, { bind: "po.modelo" }) +
      field("f-material", "Materiales", p.material, { bind: "po.material" }) +
      '<label class="field" for="f-red"><span>Red blockchain pactada</span><select class="select" id="f-red" data-bind="po.red"' + (ok("po") ? " disabled" : "") + ">" + ["TRC-20", "ERC-20", "Polygon"].map(function (r) { return "<option" + (p.red === r ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="form-grid form-grid--4" style="margin-top:var(--space-sm)">' + ["S", "M", "L", "XL"].map(function (t) { return field("f-t" + t, "Talla " + t, p[t], { bind: "po." + t, type: "number", min: 0, step: "1", inputmode: "numeric" }); }).join("") + "</div>" +
      '<div class="form-grid form-grid--2" style="margin-top:var(--space-sm)">' + field("f-precio", "Precio unitario (USD)", p.precio, { bind: "po.precio", type: "number", step: "0.01", min: 0, inputmode: "decimal" }) + "</div>" +
      '<div class="calc">' + row("Piezas", c.qty, "", "qty") + row("Total de la orden", usd(c.total), "calc__row--total", "total") + row("Forma de pago", "Activos virtuales · USDT") + "</div>" +
      '<div class="actions">' + actBtn("po", ok("po") ? "Reemitir PO" : "Emitir orden de compra", !ok("po")) + "</div>";
    h += block("Orden de compra", poBody, pill(dstate("po").st));
    h += block("Factura proforma", pf ? ('<div class="calc">' + row("Folio", esc(pf.folio)) + row("Monto total", usd(pf.total)) + row("Red", esc(pf.red)) + row("Paridad", esc(pf.paridad)) + "</div>" +
      '<div class="doc__meta" style="margin-top:var(--space-sm)">Wallet del destinatario</div><div class="mono" style="overflow-wrap:anywhere;color:var(--color-ink);font-size:var(--text-sm)">' + esc(pf.wallet) + "</div>" +
      '<div class="doc__note doc__note--ok">' + (WALLET_RE[pf.red].test(pf.wallet) ? "Formato válido para " + esc(pf.red) + "." : "") + "</div>") :
      '<p class="block__note">Llega del proveedor después de emitir la orden de compra.</p>', pill(dstate("proforma").st));
    var trBody = '<div class="form-grid form-grid--2">' +
      field("f-benef", "Beneficiario (nombre o razón social)", S.tr.beneficiario, { bind: "tr.beneficiario" }) +
      field("f-pais", "País del beneficiario", "Hong Kong", { bind: "noop", disabled: true }) + "</div>" +
      '<div style="margin-top:var(--space-sm)">' + seg("custodia", "tr.custodia", [["no_custodial", "Wallet no custodial"], ["custodial", "Wallet custodial (exchange)"]], S.tr.custodia) + "</div>" +
      '<div class="form-grid form-grid--2" style="margin-top:var(--space-sm)">' +
      (S.tr.custodia === "custodial" ? field("f-vasp", "Exchange que custodia la wallet", S.tr.vasp, { bind: "tr.vasp" }) : "") +
      field("f-wconf", "Últimos 6 caracteres de la wallet", S.walletConfirm, { bind: "walletConfirm", mono: true, max: 6, hint: "Confírmalos con el proveedor por un canal distinto al correo de la proforma." }) + "</div>" +
      '<label class="check" for="f-acepto"><input type="checkbox" id="f-acepto" data-bind="tr.acepto"' + (S.tr.acepto ? " checked" : "") + ">Declaro que la información del beneficiario es correcta y completa.</label>" +
      '<div class="actions">' + actBtn("travel", ok("travel") ? "Firmar de nuevo" : "Firmar declaración", !ok("travel")) + "</div>";
    h += block("Declaración de Regla de Viaje", trBody, pill(dstate("travel").st));
    var sendBody = '<div class="calc">' + row("Saldo en USDT", usdt(c.owned)) + row("A enviar", pf ? usdt(pf.total) : "—") + row("Red", pf ? esc(pf.red) : "—") + "</div>" +
      '<div class="actions">' + actBtn("txid", tx && ok("txid") ? "Transferencia confirmada" : "Enviar USDT al proveedor", !ok("txid"), ok("txid") ? " disabled" : "") + "</div>";
    if (tx) {
      sendBody += '<figure class="code-card explorer" style="margin-top:var(--space-md)"><div class="code-card__head"><span>Comprobante de explorador · ' + esc(tx.red) + '</span><span class="chip-ok">' + (tx.conf >= tx.need ? "Confirmada" : "Confirmando") + '</span></div><div class="confirm-bar"><i id="confirm-fill" style="width:' + (tx.conf / tx.need * 100) + '%"></i></div>' +
        "<dl><dt>TXID</dt><dd>" + esc(tx.hash) + "</dd><dt>Bloque</dt><dd>" + tx.block + "</dd><dt>Emisora</dt><dd>" + esc(tx.from) + "</dd><dt>Receptora</dt><dd>" + esc(tx.to) + "</dd><dt>Monto</dt><dd>" + usdt(tx.amount) + "</dd><dt>Fecha y hora</dt><dd>" + fmtDT(tx.at) + '</dd><dt>Confirmaciones</dt><dd id="confirm-label">' + tx.conf + " / " + tx.need + "</dd></dl>" +
        '<div class="code-card__foot"><span>Hash inmutable del registro</span><button type="button" class="btn btn--sm btn--ghost" data-copy="' + esc(tx.hash) + '" style="color:var(--color-on-graphite)">Copiar TXID</button></div></figure>';
    }
    h += block("Envío de stablecoin", sendBody, pill(dstate("txid").st));
    var inv = dstate("invoice").meta;
    h += block("Cierre con el proveedor", (inv ? '<div class="calc">' + row("Factura comercial", esc(inv.folio)) + row("Recibo de pago", esc(inv.recibo)) + row("Estado de la deuda", "Liquidada") + "</div>" : '<p class="block__note">Se solicita cuando la transferencia está confirmada.</p>') +
      '<div class="actions">' + actBtn("invoice", "Solicitar factura comercial y recibo", !ok("invoice"), ok("invoice") ? " disabled" : "") + "</div>", pill(dstate("invoice").st));
    return h;
  }

  function stage3() {
    var c = C(), f = S.fiscal;
    var h = panelHead(STAGES[2], { title: "Respaldo fiscal y contable.", lede: "Pagar mercancía con cripto es una enajenación o permuta. Bajo CARF, el SAT cruza datos bancarios y de plataformas: IA3 deja documentado cada peso." });
    h += block("Objetivo de la compra", seg("objetivo", "fiscal.objetivo", [["deducir", "Deducir como costo de ventas"], ["personal", "Uso personal"]], f.objetivo) +
      '<div class="alert alert--info">' + (f.objetivo === "deducir" ? "<b>Pedimento obligatorio.</b> Una factura extranjera pagada con cripto sin pedimento aduanal no es deducible. La etapa 4 queda en carga formal." : "<b>Sin contabilidad formal.</b> Conserva el origen de tus pesos y el TXID por si el banco pide una aclaración.") + "</div>");
    var pm = ok("permuta");
    h += block("Contrato de permuta o dación en pago", '<p class="block__note">IA3 lo redacta con la PO, la proforma y el TXID.</p>' +
      (ok("po") ? '<details class="doc-preview"' + (pm ? "" : " open") + "><summary>Ver contrato</summary><h4>Contrato de dación en pago</h4><p>Comparecen " + esc(S.kyc.nombre || "el comprador") + " (RFC " + esc(norm(S.kyc.rfc) || "—") + "), como comprador, y " + esc(S.po.proveedor) + ", con domicilio en Hong Kong, como proveedor.</p><p>Primera. El proveedor entrega " + c.qty + " piezas de " + esc(S.po.modelo.toLowerCase()) + ", " + esc(S.po.material) + ", por un total de " + usd(c.total) + ".</p><p>Segunda. Las partes acuerdan que el pago se liquida mediante " + usdt(c.total) + " sobre la red " + esc(S.po.red) + ", con paridad 1 USDT = 1 USD, y el proveedor los acepta como pago total.</p><p>Tercera. La transferencia se identifica con el TXID " + esc(S.tx ? S.tx.hash : "pendiente") + ".</p></details>" : "") +
      '<div class="actions">' + actBtn("permuta", pm ? "Contrato firmado" : "Redactar y firmar con e.firma", !pm, pm ? " disabled" : "") + "</div>", pill(dstate("permuta").st));
    h += block("Hoja de valuación NIF C-22",
      '<div class="form-grid form-grid--2">' + field("f-tct", "MXN por USDT al transferir", f.tcTransfer, { bind: "fiscal.tcTransfer", type: "number", step: "0.0001", min: 0, inputmode: "decimal", hint: "Tipo de cambio al momento de entregar los USDT al proveedor." }) + "</div>" +
      '<div class="calc">' + row("USDT entregados", usdt(c.paid), "", "paid") + row("Costo por USDT (comprobante de conversión)", c.costPerUSDT ? mxn(c.costPerUSDT) : "—", "", "costPerUSDT") + row("Valor en pesos al comprar", mxn(c.costoMXN), "", "costoMXN") + row("Valor en pesos al transferir", mxn(c.valorMXN), "", "valorMXN") +
      row(c.dif >= 0 ? "Ganancia cambiaria / de capital" : "Pérdida cambiaria / de capital", mxn(Math.abs(c.dif)), "calc__row--total " + (c.dif >= 0 ? "calc__row--pos" : "calc__row--neg"), "dif") + "</div>" +
      '<div class="actions">' + actBtn("nif", ok("nif") ? "Registrar de nuevo" : "Registrar valuación", !ok("nif")) + "</div>", pill(dstate("nif").st));
    var ev = [["Orden de compra y cotización", ok("po")], ["Factura proforma", ok("proforma")], ["TXID confirmado", ok("txid")], ["Correos y conversaciones", !!dstate("materialidad").file]];
    h += block("Expediente de materialidad", ev.map(function (e) { return '<div class="calc__row"><span>' + e[0] + "</span><b>" + (e[1] ? "✓ Integrado" : "Pendiente") + "</b></div>"; }).join("") +
      '<div class="actions"><label class="btn btn--sm file-btn"' + (busy ? ' aria-disabled="true"' : "") + ">Adjuntar correos y conversaciones" + '<input type="file" data-upload="materialidad" accept=".pdf,.zip,.eml,.msg,.png,.jpg"' + (busy ? " disabled" : "") + ' aria-label="Adjuntar correos y conversaciones"></label>' + actBtn("materialidad", "Integrar expediente", false) + "</div>", pill(dstate("materialidad").st));
    return h;
  }

  function stage4() {
    var a = S.aduana, c = C(), ded = S.fiscal.objetivo === "deducir";
    if (ded && a.ruta !== "A") { a.ruta = "A"; save(); }
    var h = panelHead(STAGES[3], { title: "Despacho aduanal de las " + c.qty + " playeras.", lede: "El sector textil es de los más vigilados para evitar subvaluación y contrabando. La ruta depende del objetivo que declaraste en la etapa 3." });
    h += block("Ruta de despacho", seg("ruta", "aduana.ruta", [["A", "A · Carga formal (agente aduanal)"], ["B", "B · Paquetería simplificada"]], a.ruta, { B: ded }) +
      (ded ? '<div class="alert alert--info"><b>Ruta A obligatoria.</b> Elegiste deducir la compra; necesitas pedimento a tu nombre.</div>' : '<div class="alert alert--warn"><b>Ojo con 20 piezas iguales.</b> El vista aduanal puede presumir fines comerciales y mandar la mercancía a despacho formal.</div>'));
    if (a.ruta === "A") {
      h += block("Documentos del importador", ["padron", "awb", "origenCert"].map(function (id) { return docRow(id, uploadBtn(id)); }).join("") +
        docRow("encargo", actBtn("encargo", "Firmar con e.firma", false, ok("encargo") ? " disabled" : "")) +
        docRow("invTrad", actBtn("invTrad", "Traducir factura", false, ok("invTrad") ? " disabled" : "")) +
        docRow("cove", actBtn("cove", "Transmitir a VUCEM", false, ok("cove") ? " disabled" : "")), '<span class="label">IA3.3</span>', true);
      h += block("Lista de empaque", '<div class="form-grid form-grid--3">' + field("f-cajas", "Cajas", a.cajas, { bind: "aduana.cajas", type: "number", min: 0, step: "1", inputmode: "numeric" }) + field("f-bruto", "Peso bruto (kg)", a.bruto, { bind: "aduana.bruto", type: "number", min: 0, step: "0.01", inputmode: "decimal" }) + field("f-neto", "Peso neto (kg)", a.neto, { bind: "aduana.neto", type: "number", min: 0, step: "0.01", inputmode: "decimal" }) + "</div>" +
        '<p class="block__note" style="margin-top:var(--space-xs)">Desglose de tallas tomado de la PO: S ' + S.po.S + " · M " + S.po.M + " · L " + S.po.L + " · XL " + S.po.XL + ".</p>" +
        '<div class="actions">' + actBtn("packing", "Generar lista de empaque", false) + "</div>", pill(dstate("packing").st));
      h += block("Etiquetado NOM-004-SE-2021", NOM_FIELDS.map(function (f) { return '<label class="check" for="nom-' + f[0] + '"><input type="checkbox" id="nom-' + f[0] + '" data-bind="aduana.nom.' + f[0] + '"' + (a.nom[f[0]] ? " checked" : "") + ">" + f[1] + "</label>"; }).join("") +
        '<div class="actions">' + actBtn("nom004", "Validar etiquetado", false) + "</div>", pill(dstate("nom004").st));
      var ped = dstate("pedimento").meta;
      h += block("Contribuciones y pedimento",
        '<div class="form-grid form-grid--3">' + field("f-flete", "Flete y seguro (USD)", a.flete, { bind: "aduana.flete", type: "number", min: 0, step: "0.01", inputmode: "decimal" }) + field("f-tca", "Tipo de cambio DOF", a.tcAduana, { bind: "aduana.tcAduana", type: "number", min: 0, step: "0.0001", inputmode: "decimal" }) + field("f-igi", "Tasa IGI (%)", a.igi, { bind: "aduana.igi", type: "number", min: 0, step: "0.1", inputmode: "decimal", hint: "Confírmala con tu agente según la fracción arancelaria." }) + "</div>" +
        '<div class="calc">' + row("Valor en aduana", mxn(c.va), "", "va") + row("IGI", mxn(c.igi), "", "igi") + row("DTA (8 al millar)", mxn(c.dta), "", "dta") + row("IVA 16 %", mxn(c.iva), "", "iva") + row("Total de contribuciones", mxn(c.contrib), "calc__row--total", "contrib") + "</div>" +
        (ped ? '<div class="alert alert--info"><b>Pedimento ' + esc(ped.numero) + "</b> pagado por " + mxn(ped.contrib) + ".</div>" : "") +
        '<div class="actions">' + actBtn("pedimento", ok("pedimento") ? "Pedimento pagado" : "Pagar pedimento", !ok("pedimento"), ok("pedimento") ? " disabled" : "") + "</div>", pill(dstate("pedimento").st));
    } else {
      h += block("Paquetería · DHL, FedEx o UPS",
        docRow("rfcDest", actBtn("rfcDest", "Tomar del expediente", false, ok("rfcDest") ? " disabled" : "")) +
        '<div class="doc"><div><label class="check" for="f-carta"><input type="checkbox" id="f-carta" data-bind="aduana.cartaOk"' + (a.cartaOk ? " checked" : "") + ">Declaro bajo protesta de decir verdad que las prendas son para uso personal y no para venta.</label></div></div>" +
        docRow("carta", actBtn("carta", "Firmar carta", false, ok("carta") ? " disabled" : "")) +
        docRow("pagoB", actBtn("pagoB", "Integrar comprobantes", false, ok("pagoB") ? " disabled" : "")), '<span class="label">Agente Proveedores</span>', true);
    }
    return h;
  }

  function dossier() {
    var p = progress();
    var h = '<div class="panel__head"><div class="stage__num">Expediente · ' + esc(S.id) + "</div><h2>" + p.done + " de " + p.total + " documentos validados.</h2><p>Cada documento con su agente responsable, la hora de validación y el archivo o folio que lo respalda.</p>" +
      '<div class="actions"><button type="button" class="btn btn--primary btn--sm" data-act="download">Descargar expediente (.json)</button><button type="button" class="btn btn--sm" data-act="print">Imprimir resumen</button></div></div>';
    [1, 2, 3, 4].forEach(function (n) {
      var list = appDocs(n);
      h += '<section class="block dossier-group"><div class="block__head"><h3>' + n + ".0 · " + STAGES[n - 1].name + '</h3><span class="label">' + stageDone(n) + '</span></div><div class="block__body"><table class="dossier"><thead><tr><th scope="col">Documento</th><th scope="col">Agente</th><th scope="col">Estado</th><th scope="col">Respaldo</th></tr></thead><tbody>' +
        list.map(function (d) { var s = dstate(d.id); var ref = s.file ? esc(s.file.name) : (s.note ? esc(s.note) : "—"); return "<tr><td>" + esc(d.name) + '</td><td class="meta">' + esc(d.ag) + "</td><td>" + pill(s.st) + '</td><td class="meta">' + ref + (s.at ? "<br>" + fmtDT(s.at) : "") + "</td></tr>"; }).join("") +
        "</tbody></table></div></section>";
    });
    return h;
  }

  /* ---------- Render: estructura ---------- */
  function renderApp() {
    var root = $("#view-app");
    var p = progress();
    root.innerHTML =
      '<div class="app-head"><div class="wrap"><div class="app-head__row"><div><div class="label">Operación ' + esc(S.id) + "</div><h1>Importación de " + C().qty + ' playeras desde Hong Kong</h1><div class="app-head__meta"><span>' + esc(S.po.proveedor) + "</span><span>Pago en USDT · " + esc(S.po.red) + "</span><span>Abierta " + fmtDT(S.created) + "</span></div></div>" +
      '<div class="app-head__actions"><button type="button" class="btn btn--primary" data-auto="all"' + (busy ? ' disabled data-state="loading"' : "") + ">" + (busy ? "Agentes trabajando" : "Ejecutar flujo con agentes") + '</button><button type="button" class="btn" data-act="reset"' + (busy ? " disabled" : "") + ">Nueva operación</button></div></div>" +
      '<div class="progress" aria-label="Avance del expediente"><div class="progress__bar"><div class="progress__fill" id="prog-fill" style="width:' + p.pct + '%"></div></div><span class="progress__txt" id="prog-txt">' + p.done + "/" + p.total + " · " + p.pct + " %</span></div></div></div>" +
      '<div class="wrap app"><nav class="rail" aria-label="Etapas" id="rail"></nav><div class="panel" id="panel"></div>' +
      '<aside class="log" aria-labelledby="log-title"><div class="log__head"><h2 id="log-title">Bitácora de agentes</h2><span class="label" id="log-count"></span></div><ol class="log__list" id="log-list" aria-live="polite"></ol></aside></div>';
    renderRail(); renderPanel(); renderLog();
  }
  function renderRail() {
    var r = $("#rail"); if (!r) return;
    r.innerHTML = STAGES.map(function (st) {
      return '<button type="button" class="rail__item" data-stage="' + st.n + '"' + (S.stage === st.n ? ' aria-current="step"' : "") + '><span class="rail__num">' + (st.n < 5 ? st.n + ".0" : "→") + '</span><span class="rail__name"><span class="rail__abbr">' + esc(st.short) + '</span><span class="rail__full">' + esc(st.name) + '</span></span><span class="rail__long">' + esc(st.long) + '</span><span class="rail__state">' + (st.n < 5 ? stageDone(st.n) + " validados" : progress().pct + " % completo") + "</span></button>";
    }).join("");
  }
  function renderPanel() {
    var el = $("#panel"); if (!el) return;
    var active = document.activeElement, aid = active && active.id, selStart = null;
    try { selStart = active && active.selectionStart; } catch (e) { selStart = null; }
    el.innerHTML = [null, stage1, stage2, stage3, stage4, dossier][S.stage]();
    if (aid) { var n = document.getElementById(aid); if (n && el.contains(n)) { n.focus({ preventScroll: true }); try { if (selStart != null) n.setSelectionRange(selStart, selStart); } catch (e) { /* tipo sin selección */ } } }
  }
  function renderLog() {
    var l = $("#log-list"); if (!l) return;
    $("#log-count").textContent = S.log.length ? S.log.length + " eventos" : "";
    l.innerHTML = S.log.length ? S.log.slice(0, 80).map(function (e) { return '<li class="' + e.k + '"><span class="log__time">' + fmtT(e.t) + '</span><span class="log__who">' + esc(e.who) + "</span> " + esc(e.msg) + "</li>"; }).join("") :
      '<li class="log__empty">Sin eventos todavía. Adjunta tu identificación o pulsa “Ejecutar flujo con agentes”.</li>';
  }
  function renderProgress() {
    var p = progress(), f = $("#prog-fill"), t = $("#prog-txt");
    if (f) f.style.width = p.pct + "%";
    if (t) t.textContent = p.done + "/" + p.total + " · " + p.pct + " %";
  }
  function refresh() {
    if ($("#view-app").hidden) return;
    var h = $(".app-head__actions");
    if (h) {
      var b = h.querySelector("[data-auto]");
      b.disabled = busy; b.textContent = busy ? "Agentes trabajando" : "Ejecutar flujo con agentes";
      if (busy) b.setAttribute("data-state", "loading"); else b.removeAttribute("data-state");
      h.querySelector('[data-act="reset"]').disabled = busy;
    }
    var h1 = $(".app-head h1"); if (h1) h1.textContent = "Importación de " + C().qty + " playeras desde Hong Kong";
    renderRail(); renderPanel(); renderProgress();
  }

  /* Actualiza cifras calculadas sin repintar el formulario */
  function updateOutputs() {
    var c = C();
    var map = { comMXN: mxn(c.comMXN), netMXN: mxn(c.netMXN), usdtBought: usdt(c.usdtBought), total: usd(c.total), qty: c.qty, paid: usdt(c.paid), costPerUSDT: c.costPerUSDT ? mxn(c.costPerUSDT) : "—", costoMXN: mxn(c.costoMXN), valorMXN: mxn(c.valorMXN), dif: mxn(Math.abs(c.dif)), va: mxn(c.va), igi: mxn(c.igi), dta: mxn(c.dta), iva: mxn(c.iva), contrib: mxn(c.contrib) };
    $$("[data-out]").forEach(function (n) { var k = n.getAttribute("data-out"); if (map[k] != null) n.textContent = map[k]; });
    var difRow = $('[data-out="dif"]');
    if (difRow) { var r = difRow.parentNode; r.classList.toggle("calc__row--pos", c.dif >= 0); r.classList.toggle("calc__row--neg", c.dif < 0); r.firstChild.textContent = c.dif >= 0 ? "Ganancia cambiaria / de capital" : "Pérdida cambiaria / de capital"; }
    var al = $('[data-out-alert="short"]');
    if (al) { var short_ = c.usdtBought && c.usdtBought < c.total; al.className = short_ ? "alert alert--warn" : ""; al.innerHTML = short_ ? "<b>Monto corto.</b> Con este SPEI compras menos USDT de los que pide la orden de compra." : ""; }
    var curp = $("#f-curp-hint"); if (curp) { var cc = curpCheck(S.kyc.curp); curp.textContent = S.kyc.curp ? cc.msg : "IA1.concilia la toma de tu identificación."; curp.className = S.kyc.curp ? (cc.ok ? "ok" : "err") : ""; $("#f-curp").setAttribute("aria-invalid", S.kyc.curp && !cc.ok ? "true" : "false"); }
    var rfc = $("#f-rfc-hint"); if (rfc) { var rr = rfcCheck(S.kyc.rfc, S.persona === "moral", S.kyc.curp); rfc.textContent = S.kyc.rfc ? rr.msg : "Tal como aparece en tu Constancia de Situación Fiscal."; rfc.className = S.kyc.rfc ? (rr.ok ? "ok" : "err") : ""; $("#f-rfc").setAttribute("aria-invalid", S.kyc.rfc && !rr.ok ? "true" : "false"); }
    var h1 = $(".app-head h1"); if (h1) h1.textContent = "Importación de " + c.qty + " playeras desde Hong Kong";
  }

  function setPath(path, value) {
    var parts = path.split("."), o = S;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  /* ---------- Eventos de la plataforma ---------- */
  var appRoot = $("#view-app");
  appRoot.addEventListener("input", function (e) {
    var t = e.target, b = t.getAttribute("data-bind");
    if (!b || b === "noop" || t.type === "radio" || t.type === "checkbox" || t.tagName === "SELECT") return;
    var v = t.value;
    if (b === "kyc.curp" || b === "kyc.rfc" || b === "walletConfirm") { var pos = t.selectionStart; v = v.toUpperCase(); if (t.value !== v) { t.value = v; try { t.setSelectionRange(pos, pos); } catch (er) { /* sin selección */ } } }
    if (t.type === "number") v = t.value === "" ? "" : num(t.value);
    setPath(b, v); save(); updateOutputs();
  });
  appRoot.addEventListener("change", function (e) {
    var t = e.target, b = t.getAttribute("data-bind");
    if (t.matches("[data-upload]")) {
      var id = t.getAttribute("data-upload"), file = t.files && t.files[0];
      if (!file) return;
      if (file.size > 20 * 1048576) { toast("El archivo pesa " + kb(file.size) + "; el límite es 20 MB."); return; }
      if (id === "materialidad") A.materialidad(file); else attach(id, file);
      return;
    }
    if (!b || b === "noop") return;
    if (t.type === "checkbox") { setPath(b, t.checked); save(); return; }
    if (t.type === "radio" || t.tagName === "SELECT") {
      setPath(b, t.value);
      if (b === "persona") log(AG.C, t.value === "moral" ? "Solicitante cambiado a persona moral: se suman acta, poderes y beneficiarios." : "Solicitante cambiado a persona física.");
      if (b === "fiscal.objetivo" && t.value === "deducir") S.aduana.ruta = "A";
      save(); refresh();
    }
  });
  appRoot.addEventListener("click", function (e) {
    var t = e.target.closest("button, [data-stage]");
    if (!t || t.disabled) return;
    if (t.hasAttribute("data-stage")) { go("#plataforma/" + t.getAttribute("data-stage")); return; }
    if (t.hasAttribute("data-auto")) { var v = t.getAttribute("data-auto"); autoRun(v === "all" ? [1, 2, 3, 4] : [num(v)]); return; }
    if (t.hasAttribute("data-copy")) { copy(t.getAttribute("data-copy"), t); return; }
    var act = t.getAttribute("data-act"); if (!act) return;
    if (act === "download") return download();
    if (act === "print") return window.print();
    if (act === "reset") return resetOp();
    var fnMap = { conversion: A.convert, po: A.emitPO, travel: A.signTravel, txid: A.send, invoice: A.invoice, permuta: A.permuta, nif: A.nif, materialidad: function () { return A.materialidad(); } };
    var fn = fnMap[act] || A[act];
    if (fn && !busy) fn();
  });

  function copy(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "Copiado"; setTimeout(function () { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("No se pudo copiar; selecciona el TXID manualmente."); });
    else toast("Tu navegador no permite copiar; selecciona el TXID manualmente.");
  }

  function download() {
    var c = C();
    var out = {
      operacion: S.id, generado: nowISO(), solicitante: { tipo: S.persona, nombre: S.kyc.nombre, curp: norm(S.kyc.curp), rfc: norm(S.kyc.rfc) },
      mercancia: { proveedor: S.po.proveedor, modelo: S.po.modelo, material: S.po.material, tallas: { S: S.po.S, M: S.po.M, L: S.po.L, XL: S.po.XL }, piezas: c.qty, total_usd: c.total },
      conversion: dstate("conversion").meta || null, transferencia: S.tx, valuacion_nif_c22: dstate("nif").meta || null,
      aduana: { ruta: S.aduana.ruta, contribuciones_mxn: S.aduana.ruta === "A" ? { valor_aduana: c.va, igi: c.igi, dta: c.dta, iva: c.iva, total: c.contrib } : null, pedimento: (dstate("pedimento").meta || {}).numero || null },
      documentos: appDocs().map(function (d) { var s = dstate(d.id); return { etapa: d.st, documento: d.name, agente: d.ag, estado: s.st, archivo: s.file ? s.file.name : null, nota: s.note || null, validado: s.at || null }; }),
      bitacora: S.log.slice().reverse()
    };
    try {
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "expediente-" + S.id + ".json";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { toast("No se pudo generar la descarga en este navegador."); }
  }

  function resetOp() {
    var snapshot = JSON.stringify(S);
    S = fresh(); save(); renderApp();
    toast("Operación nueva abierta.", "Deshacer", function () { S = JSON.parse(snapshot); save(); renderApp(); });
  }

  /* ---------- Toast (fallas y deshacer) ---------- */
  function toast(msg, actionLabel, action) {
    var st = $("#toasts"), t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status");
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (actionLabel ? '<button type="button">' + esc(actionLabel) + "</button>" : "");
    if (actionLabel) t.querySelector("button").addEventListener("click", function () { action(); t.remove(); });
    st.appendChild(t);
    setTimeout(function () { t.remove(); }, actionLabel ? 8000 : 5000);
  }

  /* ---------- Rutas ---------- */
  var landing = $("#view-landing");
  function go(hash, replace) { if (replace) history.replaceState(null, "", hash); else history.pushState(null, "", hash); route(); }
  function route() {
    var h = location.hash || "#inicio";
    var m = h.match(/^#(plataforma)(?:\/(\d))?$|^#(expediente)$/);
    var isApp = !!m;
    landing.hidden = isApp; appRoot.hidden = !isApp;
    $$("[data-nav-app]").forEach(function (a) { a.textContent = isApp ? "Volver al inicio" : "Abrir plataforma"; a.setAttribute("href", isApp ? "#inicio" : "#plataforma"); });
    if (isApp) {
      var n = m[3] ? 5 : (m[2] ? Math.min(5, Math.max(1, num(m[2]))) : S.stage || 1);
      var first = !appRoot.firstChild;
      S.stage = n; save();
      if (first) renderApp(); else { renderRail(); renderPanel(); renderLog(); renderProgress(); }
      var top = $("#panel"); if (top && !first && window.innerWidth < 960) top.scrollIntoView({ block: "start" });
      if (first) window.scrollTo(0, 0);
      document.title = "btcmex · " + S.id + " · " + STAGES[n - 1].name;
    } else {
      document.title = "btcmex · Importación MX–HK";
      var target = document.getElementById(h.slice(1));
      if (target && h !== "#inicio") target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      else window.scrollTo(0, 0);
      initReveal();
    }
  }
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    go(a.getAttribute("href"));
  });

  /* ---------- Reveal + type-in ---------- */
  var revealed = false;
  function initReveal() {
    if (revealed) return; revealed = true;
    var els = $$(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("is-in"); }); return; }
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (e) { io.observe(e); });
    var ti = $("#typein");
    if (ti && !reduceMotion) {
      var full = ti.getAttribute("data-text"), i = 0; ti.textContent = "";
      var step = function () { ti.textContent = full.slice(0, ++i); if (i < full.length) setTimeout(step, 38); };
      setTimeout(step, 500);
    }
  }

  /* ---------- Paleta de comandos ---------- */
  var pal = $("#palette"), pin = $("#palette-input"), plist = $("#palette-list"), lastFocus = null, sel = 0, shown = [];
  var CMDS = [
    { t: "Cómo funciona", h: "#flujo", k: "inicio" },
    { t: "Expediente único y TXID", h: "#expediente-unico", k: "inicio" },
    { t: "Marco regulatorio", h: "#marco", k: "inicio" },
    { t: "Abrir plataforma", h: "#plataforma", k: "plataforma" },
    { t: "Etapa 1 · Salida MXN y KYC", h: "#plataforma/1", k: "IA1" },
    { t: "Etapa 2 · Envío a Hong Kong", h: "#plataforma/2", k: "IA2" },
    { t: "Etapa 3 · Respaldo SAT", h: "#plataforma/3", k: "IA3" },
    { t: "Etapa 4 · Aduana", h: "#plataforma/4", k: "IA3.3" },
    { t: "Ver expediente", h: "#expediente", k: "plataforma" },
    { t: "Ejecutar flujo con agentes", run: function () { go("#plataforma/1"); setTimeout(function () { autoRun([1, 2, 3, 4]); }, 60); }, k: "orquestador" },
    { t: "Descargar expediente (.json)", run: download, k: "expediente" }
  ];
  function openPal() { lastFocus = document.activeElement; pal.hidden = false; pin.value = ""; sel = 0; renderPal(); pin.focus(); }
  function closePal() { pal.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function renderPal() {
    var q = norm(pin.value);
    shown = CMDS.filter(function (c) { return !q || norm(c.t + " " + c.k).indexOf(q) > -1; });
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    plist.innerHTML = shown.length ? shown.map(function (c, i) { return '<li role="option" id="pal-' + i + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span>' + esc(c.t) + "</span><small>" + esc(c.k) + "</small></li>"; }).join("") : '<li class="palette__empty" role="option" aria-disabled="true">Sin coincidencias.</li>';
    pin.setAttribute("aria-activedescendant", shown.length ? "pal-" + sel : "");
  }
  function runPal(i) { var c = shown[i]; if (!c) return; closePal(); if (c.run) c.run(); else go(c.h); }
  $$("[data-open-palette]").forEach(function (b) { b.addEventListener("click", openPal); });
  pin.addEventListener("input", function () { sel = 0; renderPal(); });
  pin.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % Math.max(1, shown.length); renderPal(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(1, shown.length); renderPal(); }
    else if (e.key === "Enter") { e.preventDefault(); runPal(sel); }
    else if (e.key === "Tab") { e.preventDefault(); }
  });
  plist.addEventListener("click", function (e) { var li = e.target.closest("[data-i]"); if (li) runPal(num(li.getAttribute("data-i"))); });
  pal.addEventListener("click", function (e) { if (e.target === pal) closePal(); });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (pal.hidden) openPal(); else closePal(); }
    else if (e.key === "Escape" && !pal.hidden) closePal();
  });

  /* Si una ejecución quedó a medias en otra sesión, se limpia el estado de revisión */
  Object.keys(S.docs).forEach(function (id) { if (S.docs[id].st === "revision") S.docs[id].st = "pendiente"; });
  if (S.tx && S.tx.conf < S.tx.need) { S.tx = null; }
  save();
  route();
})();
