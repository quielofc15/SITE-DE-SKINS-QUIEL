const zipInput = document.getElementById("zipInput");
const patchBtn = document.getElementById("patchBtn");
const dropArea = document.getElementById("dropArea");
const log = document.getElementById("log");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const fileNameLabel = document.getElementById("fileName");
const fileSizeLabel = document.getElementById("fileSize");
const fileDetails = document.querySelector(".file-details");
const preloader = document.getElementById("preloader");

let currentZip = null;
let currentGroups = [];

window.addEventListener("load", () => {
  if (preloader) {
    setTimeout(() => preloader.classList.add("hidden"), 400);
  }
});

function addLog(message, type = "info") {
  const item = document.createElement("div");
  item.className = `log-item ${type}`;
  item.textContent = message;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  log.innerHTML = "";
}

function setProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}% - ${text}`;
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(2)} KB`;
  return `${(size / 1024 ** 2).toFixed(2)} MB`;
}

function setFileInfo(file) {
  if (!fileDetails) return;
  fileNameLabel.textContent = file.name;
  fileSizeLabel.textContent = formatBytes(file.size);
  fileDetails.classList.remove("ghost");
}

function handleError(stage, error) {
  const message = error?.message || String(error || "Erro desconhecido");
  addLog(`[ERRO] ${stage}: ${message}`, "fail");
  console.error(stage, error);
  setProgress(0, `FALHA: ${stage}`);
  patchBtn.disabled = true;
}

function getSlotGroups(fileNames) {
  const slots = {};
  const regexBytes = /(?:^|\/)ProjectData_slot_(\d+)\.bytes$/i;
  const regexMeta = /(?:^|\/)ProjectData_slot_(\d+)\.meta$/i;
  const regexUl = /(?:^|\/)UserLevelData_(\d+)\.bytes$/i;

  for (const name of fileNames) {
    let match = name.match(regexBytes);
    if (match) {
      const index = match[1];
      slots[index] = slots[index] || {};
      slots[index].pbytes = name;
      continue;
    }

    match = name.match(regexMeta);
    if (match) {
      const index = match[1];
      slots[index] = slots[index] || {};
      slots[index].meta = name;
      continue;
    }

    match = name.match(regexUl);
    if (match) {
      const index = match[1];
      slots[index] = slots[index] || {};
      slots[index].ul = name;
    }
  }

  return Object.values(slots).filter((group) => group.pbytes && group.meta && group.ul);
}

const markerRules = [
  { name: "Conjunto Completo (Set)", from: -10001, to: -269001 },
  { name: "Cabelo", from: -10001, to: -269002 },
  { name: "Acessório de Cabeça/Máscara", from: -10001, to: -269003 },
  { name: "Rosto/Maquiagem", from: -10001, to: -269004 },
  { name: "Peitoral/Camisa", from: -10001, to: -269005 },
  { name: "Calça/Bermuda", from: -10001, to: -269006 },
  { name: "Calçado/Tênis", from: -10001, to: -269007 },
  { name: "Skins de Arma (wSkin)", from: -10001, to: -14056 },
  { name: "Skin de Mochila (bSkin)", from: -10001, to: -14075 }
];

const markerRulesOriginalNames = [
  "SetID",
  "HairID",
  "HeadAdditiveID",
  "FaceID",
  "ChestID",
  "LegsID",
  "FeetID",
  "wSkinIDs",
  "bSkinID"
];

const markerPatches = markerRules.map((rule, index) => ({
  name: rule.name,
  marker: stringToHex(markerRulesOriginalNames[index]),
  search: "88 01 " + encodeSignedVarint64(rule.from),
  replace: "88 01 " + encodeSignedVarint64(rule.to)
}));

function stringToHex(str) {
  return Array.from(str)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join(" ");
}

function encodeSignedVarint64(num) {
  let value = BigInt.asUintN(64, BigInt(num));
  const out = [];
  while (value >= 0x80n) {
    out.push(Number((value & 0x7fn) | 0x80n));
    value >>= 7n;
  }
  out.push(Number(value));
  return out.map((v) => v.toString(16).padStart(2, "0")).join(" ");
}

function hexToBytes(hex) {
  return hex.trim().split(/\s+/).map((x) => parseInt(x, 16));
}

function findPattern(data, pattern, start = 0) {
  for (let i = start; i <= data.length - pattern.length; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function replaceBytes(data, oldBytes, newBytes) {
  const pos = findPattern(data, Array.from(oldBytes));
  if (pos === -1) return data;
  const before = Array.from(data.slice(0, pos));
  const after = Array.from(data.slice(pos + oldBytes.length));
  return new Uint8Array([...before, ...newBytes, ...after]);
}

function readVarint(data, pos) {
  let result = 0n;
  let shift = 0n;
  const start = pos;
  while (true) {
    const b = BigInt(data[pos]);
    pos += 1;
    result |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) break;
    shift += 7n;
  }
  return [result, pos, data.slice(start, pos)];
}

function encodeVarint(value) {
  let n = BigInt(value);
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return new Uint8Array(out);
}

function getUidInfo(data) {
  let pos = 0;
  while (pos < data.length) {
    const [tag, p1] = readVarint(data, pos);
    pos = p1;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const [value, p2, raw] = readVarint(data, pos);
      pos = p2;
      if (field === 7) {
        return { uid: value.toString(), raw };
      }
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 2) {
      const [len, p2] = readVarint(data, pos);
      pos = p2 + Number(len);
    } else if (wire === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return null;
}

function patchByMarker(data, patch) {
  const marker = hexToBytes(patch.marker);
  const search = hexToBytes(patch.search);
  const replace = hexToBytes(patch.replace);
  let pos = 0;

  while (true) {
    const found = findPattern(data, search, pos);
    if (found === -1) break;
    const markerPos = found + search.length + 94;
    if (markerPos + marker.length > data.length) {
      pos = found + 1;
      continue;
    }

    let ok = true;
    for (let i = 0; i < marker.length; i++) {
      if (data[markerPos + i] !== marker[i]) {
        ok = false;
        break;
      }
    }

    if (ok) {
      for (let i = 0; i < replace.length; i++) {
        data[found + i] = replace[i];
      }
      if (patch.name.includes("Arma") || patch.name.includes("Mochila")) {
        addLog(`MODIFICADO: ${patch.name}`, "item-equip");
      } else {
        addLog(`MODIFICADO: ${patch.name}`, "item-clothing");
      }
      break;
    }
    pos = found + 1;
  }
}

function md5Bytes(buffer) {
  const data = new Uint8Array(buffer);
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  function rotl(x, c) {
    return (x << c) | (x >>> (32 - c));
  }

  const paddedLength = (((data.length + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const bitLen = data.length * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < padded.length; i += 64) {
    const M = new Uint32Array(padded.buffer, i, 16);
    let A = a;
    let B = b;
    let C = c;
    let D = d;

    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }
      const temp = D;
      D = C;
      C = B;
      B = (B + rotl((A + F + K[j] + M[g]) >>> 0, s[j])) >>> 0;
      A = temp;
    }

    a = (a + A) >>> 0;
    b = (b + B) >>> 0;
    c = (c + C) >>> 0;
    d = (d + D) >>> 0;
  }

  const result = new Uint8Array(16);
  const w = [a, b, c, d];
  for (let i = 0; i < 4; i++) {
    result[i * 4] = w[i] & 0xff;
    result[i * 4 + 1] = (w[i] >>> 8) & 0xff;
    result[i * 4 + 2] = (w[i] >>> 16) & 0xff;
    result[i * 4 + 3] = (w[i] >>> 24) & 0xff;
  }
  return result;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function processFiles(files) {
  const pbytes = files.find((file) => /ProjectData_slot_\d+\.bytes$/i.test(file.name));
  const meta = files.find((file) => /ProjectData_slot_\d+\.meta$/i.test(file.name));
  const ul = files.find((file) => /UserLevelData_\d+\.bytes$/i.test(file.name));

  if (!pbytes || !meta || !ul) {
    return files.map((file) => ({ name: file.name, data: file.data }));
  }

  const pData = new Uint8Array(pbytes.data);
  let metaData = new Uint8Array(meta.data);
  const ulData = new Uint8Array(ul.data);

  const uidInfo = getUidInfo(pData);
  if (uidInfo) {
    addLog(`[INFO] UID detectado: ${uidInfo.uid}`, "info");
  } else {
    addLog("[INFO] UID não encontrado em ProjectData", "info");
  }

  const oldUlMd5 = md5Bytes(ulData.buffer);
  markerPatches.forEach((patch) => patchByMarker(ulData, patch));
  const newUlMd5 = md5Bytes(ulData.buffer);

  if (!arraysEqual(oldUlMd5, newUlMd5)) {
    addLog("[OK] Atualizando MD5 no metadata", "metadata");
    metaData = replaceBytes(metaData, oldUlMd5, newUlMd5);
  }

  return [
    { name: pbytes.name, data: pData },
    { name: meta.name, data: metaData },
    { name: ul.name, data: ulData }
  ];
}

async function loadZip(file) {
  try {
    clearLog();
    setFileInfo(file);
    setProgress(0, "ZIP carregado");
    addLog("[SISTEMA] Inicializado", "info");
    addLog("[UPLOAD] Arquivo recebido", "upload");

    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new Error("APENAS ARQUIVOS .ZIP SÃO SUPORTADOS");
    }

    const arrayBuffer = await file.arrayBuffer();
    currentZip = await JSZip.loadAsync(arrayBuffer);
    addLog("[ANÁLISE] Abrindo ZIP", "analysis");
    addLog("[ANÁLISE] Procurando arquivos", "analysis");

    const fileNames = Object.keys(currentZip.files);
    if (!fileNames.length) {
      throw new Error("ZIP vazio");
    }

    const groups = getSlotGroups(fileNames);
    if (!groups.length) {
      const patterns = [
        "ProjectData_slot_\d+\.bytes",
        "ProjectData_slot_\d+\.meta",
        "UserLevelData_\d+\.bytes",
      ];
      throw new Error(`Nenhum conjunto completo encontrado. Padrões esperados: ${patterns.join(", ")}`);
    }

    groups.forEach((group) => {
      addLog(`✅ ${group.pbytes} encontrado`, "success");
      addLog(`✅ ${group.meta} encontrado`, "success");
      addLog(`✅ ${group.ul} encontrado`, "success");
    });

    currentGroups = groups;
    patchBtn.disabled = false;
    setProgress(20, "Arquivos localizados");
    addLog("[OK] Arquivos encontrados", "success");
  } catch (error) {
    handleError("Validação ZIP", error);
    throw error;
  }
}

async function readFiles(groups) {
  try {
    const result = [];

    for (const group of groups) {
      const pbytesData = await currentZip.file(group.pbytes).async("uint8array");
      const metaData = await currentZip.file(group.meta).async("uint8array");
      const ulData = await currentZip.file(group.ul).async("uint8array");

      addLog(`[INFO] ${group.pbytes}: ${pbytesData.length} bytes`, "info");
      addLog(`[INFO] ${group.meta}: ${metaData.length} bytes`, "info");
      addLog(`[INFO] ${group.ul}: ${ulData.length} bytes`, "info");

      result.push({
        pbytes: { name: group.pbytes, data: pbytesData },
        meta: { name: group.meta, data: metaData },
        ul: { name: group.ul, data: ulData },
      });
    }

    setProgress(40, "Arquivos lidos");
    addLog("[OK] Arquivos lidos", "success");
    return result;
  } catch (error) {
    handleError("Ler arquivos", error);
    throw error;
  }
}

async function createProcessedZip(groupsWithData) {
  try {
    const processed = [];

    for (const group of groupsWithData) {
      const files = [group.pbytes, group.meta, group.ul];
      const transformed = await processFiles(files);
      processed.push(...transformed);
    }

    setProgress(60, "Processamento");
    addLog("[OK] Processamento concluído", "success");

    processed.forEach((file) => {
      currentZip.file(file.name, file.data, { binary: true });
    });

    return currentZip;
  } catch (error) {
    handleError("Processamento de arquivos", error);
    throw error;
  }
}

async function downloadZip() {
  try {
    const blob = await currentZip.generateAsync({ type: "blob", compression: "DEFLATE" });
    setProgress(80, "Novo ZIP criado");
    addLog("[OK] Novo ZIP criado", "success");

    const fileName = "QUIELZIN15_MAPA_MODIFICADO.zip";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setProgress(100, "Download iniciado");
    addLog("✅ PROCESSAMENTO CONCLUÍDO", "success");
    addLog(`📦 ${fileName}`, "success");
  } catch (error) {
    handleError("Criar novo ZIP", error);
  }
}

zipInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) {
    await loadZip(file);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  dropArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropArea.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropArea.classList.remove("drag-over");
  });
});

dropArea.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    zipInput.files = event.dataTransfer.files;
    await loadZip(file);
  }
});

patchBtn.addEventListener("click", async () => {
  try {
    if (!currentZip || !currentGroups.length) {
      throw new Error("Arquivo ZIP não carregado ou nenhum grupo válido encontrado.");
    }
    const groupsWithData = await readFiles(currentGroups);
    await createProcessedZip(groupsWithData);
    await downloadZip();
  } catch (error) {
    handleError("Processamento final", error);
  }
});
