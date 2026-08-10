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

async function processFiles(files) {
  return files.map((file) => ({ name: file.name, data: file.data }));
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
