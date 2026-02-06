function normalizePath(path) {
  return String(path || '').replace(/^\.\//, '').replace(/^\/+/, '');
}

function parseDefaultExportModule(code) {
  const source = String(code || '');
  try {
    const transformed = source.replace(/export\s+default/, 'const __default_export__ =');
    return new Function(`${transformed}\nreturn typeof __default_export__ !== 'undefined' ? __default_export__ : null;`)();
  } catch {
    const transformed = source.replace(/export\s+default/, 'return');
    return new Function(transformed)();
  }
}

function parseFactionsModule(code) {
  const transformed = String(code || '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+/g, 'const __default_export__ = ');
  return new Function(`${transformed}\nreturn { FACTIONS, FACTION_RELATIONS, FACTION_ORDER };`)();
}

let zipPromise = null;

async function getJSZip() {
  if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
  const mod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
  return mod.default || mod.JSZip || null;
}

function getRomUrl() {
  const params = new URLSearchParams(window.location.search);
  const romRaw = params.get('rom');
  const rom = String(romRaw == null ? 'data.zip' : romRaw).trim();
  if (!rom || rom === '0') return null;
  return new URL(rom, window.location.href).toString();
}

function getRomRef() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('romref') || '').trim();
}

async function fetchRomBlobByRef(ref) {
  if (!ref) return null;
  const openReq = indexedDB.open('rom-file-store', 1);
  const db = await new Promise((resolve, reject) => {
    openReq.onupgradeneeded = () => {
      const dbUp = openReq.result;
      if (!dbUp.objectStoreNames.contains('files')) dbUp.createObjectStore('files');
    };
    openReq.onsuccess = () => resolve(openReq.result);
    openReq.onerror = () => reject(openReq.error || new Error('indexedDB open failed'));
  });
  const blob = await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(ref);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('indexedDB read failed'));
  });
  db.close();
  return blob;
}

async function loadZip() {
  if (zipPromise) return zipPromise;
  zipPromise = (async () => {
    const JSZip = await getJSZip();
    if (!JSZip) return null;
    const romRef = getRomRef();
    let blob = null;
    if (romRef) {
      blob = await fetchRomBlobByRef(romRef);
      if (!blob) return null;
    } else {
      const romUrl = getRomUrl();
      if (!romUrl) return null;
      const resp = await fetch(romUrl);
      if (!resp.ok) throw new Error(`ROM fetch failed: ${resp.status}`);
      blob = await resp.blob();
    }
    return JSZip.loadAsync(blob);
  })();
  return zipPromise;
}

function findZipEntry(zip, candidates) {
  for (const candidate of candidates) {
    const n = normalizePath(candidate);
    const exact = zip.file(n);
    if (exact) return exact;
    const suffix = `/${n}`;
    const bySuffix = Object.values(zip.files).find((f) => !f.dir && normalizePath(f.name).endsWith(suffix));
    if (bySuffix) return bySuffix;
  }
  return null;
}

async function readTextFromZip(path) {
  const zip = await loadZip();
  if (!zip) return null;
  const file = findZipEntry(zip, [path, `data/${normalizePath(path)}`]);
  if (!file) return null;
  return file.async('string');
}

export async function loadDefaultExportFromRom(path, fallbackValue) {
  try {
    const code = await readTextFromZip(path);
    if (!code) return fallbackValue;
    const parsed = parseDefaultExportModule(code);
    return typeof parsed === 'undefined' ? fallbackValue : parsed;
  } catch {
    return fallbackValue;
  }
}

export async function loadFactionsFromRom(path, fallbackValue) {
  try {
    const code = await readTextFromZip(path);
    if (!code) return fallbackValue;
    const parsed = parseFactionsModule(code);
    return {
      FACTIONS: parsed.FACTIONS || fallbackValue.FACTIONS,
      FACTION_RELATIONS: parsed.FACTION_RELATIONS || fallbackValue.FACTION_RELATIONS,
      FACTION_ORDER: parsed.FACTION_ORDER || fallbackValue.FACTION_ORDER
    };
  } catch {
    return fallbackValue;
  }
}
