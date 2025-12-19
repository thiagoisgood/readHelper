const { ipcRenderer } = require("electron");
const marked = require("marked");
const path = require("path");

// PDF.js 初始化
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  "pdfjs-dist/legacy/build/pdf.worker.js"
);

// 全局变量
let currentFilePath = null;
let currentNotes = [];
let currentBookmarks = [];
let selectedText = "";

// PDF 相关变量
let currentPdf = null;
let currentPdfPage = 1;
let totalPdfPages = 0;
let pdfScale = 1.5;

// DOM 元素
const documentViewer = document.getElementById("documentViewer");
const fileName = document.getElementById("fileName");
const openFileBtn = document.getElementById("openFileBtn");
const openFileBtn2 = document.getElementById("openFileBtn2");
const addNoteBtn = document.getElementById("addNoteBtn");
const addBookmarkBtn = document.getElementById("addBookmarkBtn");
const translateBtn = document.getElementById("translateBtn");
const translationPanel = document.getElementById("translationPanel");
const notePanel = document.getElementById("notePanel");
const notesList = document.getElementById("notesList");
const bookmarksList = document.getElementById("bookmarksList");

// 初始化
initializeApp();

function initializeApp() {
  // 绑定事件
  openFileBtn.addEventListener("click", openFile);
  openFileBtn2.addEventListener("click", openFile);
  addNoteBtn.addEventListener("click", showNotePanel);
  addBookmarkBtn.addEventListener("click", addBookmark);
  translateBtn.addEventListener("click", translateSelection);

  document.getElementById("closeTranslation").addEventListener("click", () => {
    translationPanel.classList.add("hidden");
  });

  document.getElementById("closeNote").addEventListener("click", hideNotePanel);
  document
    .getElementById("cancelNote")
    .addEventListener("click", hideNotePanel);
  document.getElementById("saveNote").addEventListener("click", saveNote);

  // 监听文本选择
  document.addEventListener("selectionchange", handleTextSelection);

  // 监听来自主进程的文件打开事件
  ipcRenderer.on("file-opened", async (event, filePath) => {
    await loadDocument(filePath);
  });
}

function openFile() {
  // 触发文件选择对话框
  ipcRenderer.send("open-file-dialog");
}

async function loadDocument(filePath) {
  try {
    currentFilePath = filePath;
    const pathParts = filePath.split("/");
    const name = pathParts[pathParts.length - 1];
    fileName.textContent = name;

    // 启用工具栏按钮
    addNoteBtn.disabled = false;
    addBookmarkBtn.disabled = false;

    // 显示加载状态
    documentViewer.innerHTML =
      '<div class="loading-state"><p>正在加载文档...</p></div>';

    // 统一通过主进程读取文件
    const result = await ipcRenderer.invoke("read-file", filePath);

    if (result.error) {
      showError("无法读取文件: " + result.error);
      return;
    }

    // PDF 使用 PDF.js 渲染
    if (result.isPdf) {
      await loadPdfDocument(new Uint8Array(result.rawData));
    } else {
      // 其他格式使用文本渲染
      renderDocument(result.content, result.ext);
    }

    // 加载该文件的笔记和书签
    await loadNotes(filePath);
    renderNotesList();
    renderBookmarksList();
  } catch (error) {
    showError("加载文档时出错: " + error.message);
  }
}

// ===== PDF.js 渲染功能 =====

async function loadPdfDocument(pdfData) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    currentPdf = await loadingTask.promise;
    totalPdfPages = currentPdf.numPages;
    currentPdfPage = 1;

    // 渲染所有页面
    await renderAllPdfPages();
  } catch (error) {
    showError("无法加载 PDF: " + error.message);
  }
}

async function renderAllPdfPages() {
  // 创建 PDF 容器
  documentViewer.innerHTML = `
    <div class="pdf-toolbar">
      <button class="btn btn-secondary" id="pdfZoomOut">−</button>
      <span class="pdf-zoom-level">${Math.round(pdfScale * 100)}%</span>
      <button class="btn btn-secondary" id="pdfZoomIn">+</button>
      <span class="pdf-page-info">共 ${totalPdfPages} 页</span>
    </div>
    <div class="pdf-container" id="pdfContainer"></div>
  `;

  // 绑定缩放按钮事件
  document.getElementById("pdfZoomIn").addEventListener("click", () => {
    pdfScale = Math.min(pdfScale + 0.25, 3);
    renderAllPdfPages();
  });
  document.getElementById("pdfZoomOut").addEventListener("click", () => {
    pdfScale = Math.max(pdfScale - 0.25, 0.5);
    renderAllPdfPages();
  });

  const container = document.getElementById("pdfContainer");

  // 渲染每一页
  for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
    await renderPdfPage(pageNum, container);
  }
}

async function renderPdfPage(pageNum, container) {
  const page = await currentPdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: pdfScale });

  // 创建页面包装器
  const pageWrapper = document.createElement("div");
  pageWrapper.className = "pdf-page-wrapper";
  pageWrapper.setAttribute("data-page", pageNum);

  // 页面头部
  const pageHeader = document.createElement("div");
  pageHeader.className = "pdf-page-header";
  pageHeader.textContent = `第 ${pageNum} 页 / 共 ${totalPdfPages} 页`;
  pageWrapper.appendChild(pageHeader);

  // 创建页面容器（相对定位，用于叠加文本层）
  const pageContainer = document.createElement("div");
  pageContainer.className = "pdf-page-container";
  pageContainer.style.width = `${viewport.width}px`;
  pageContainer.style.height = `${viewport.height}px`;

  // Canvas 层（渲染 PDF 图像）
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  pageContainer.appendChild(canvas);

  // 文本层（用于选择文本）
  const textLayer = document.createElement("div");
  textLayer.className = "pdf-text-layer";
  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;
  pageContainer.appendChild(textLayer);

  pageWrapper.appendChild(pageContainer);
  container.appendChild(pageWrapper);

  // 渲染 Canvas
  const context = canvas.getContext("2d");
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // 渲染文本层
  const textContent = await page.getTextContent();
  await renderTextLayer(textContent, textLayer, viewport);
}

async function renderTextLayer(textContent, textLayerDiv, viewport) {
  // 使用 PDF.js 内置的文本层渲染
  const textItems = textContent.items;

  textItems.forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item.str;

    // 计算文本位置和变换
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

    const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    const left = tx[4];
    const top = viewport.height - tx[5] - fontHeight;

    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = item.fontName ? item.fontName : "sans-serif";

    // 处理文本宽度
    if (item.width > 0) {
      span.style.width = `${item.width * pdfScale}px`;
    }

    textLayerDiv.appendChild(span);
  });
}

function renderDocument(content, ext) {
  let html = "";

  switch (ext) {
    case ".md":
      html = marked.parse(content);
      break;
    case ".html":
      html = content;
      break;
    case ".txt":
    default:
      // 保留原始格式：空格、换行、缩进
      html = `<div class="text-content">${escapeHtml(content)
        .replace(/\n/g, "<br>")
        .replace(/ {2}/g, "&nbsp;&nbsp;")
        .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")}</div>`;
      break;
  }

  documentViewer.innerHTML = html;
  applyHighlights();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function handleTextSelection() {
  const selection = window.getSelection();
  selectedText = selection.toString().trim();

  if (selectedText.length > 0) {
    translateBtn.disabled = false;
  } else {
    translateBtn.disabled = true;
  }
}

// 翻译功能
async function translateSelection() {
  if (!selectedText) return;

  document.getElementById("originalText").textContent = selectedText;
  document.getElementById("translatedText").textContent = "翻译中...";
  translationPanel.classList.remove("hidden");

  try {
    // 使用简单的翻译API（这里使用免费的 LibreTranslate 或者模拟翻译）
    const translatedText = await translateText(selectedText);
    document.getElementById("translatedText").textContent = translatedText;
  } catch (error) {
    document.getElementById("translatedText").textContent =
      "翻译失败: " + error.message;
  }
}

// 模拟翻译函数（实际应用中应该使用真实的翻译API）
async function translateText(text) {
  // 这里使用一个简单的示例
  // 在实际应用中，您可以集成 Google Translate API, DeepL API 等

  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 检测是否为中文
  const isChinese = /[\u4e00-\u9fa5]/.test(text);

  if (isChinese) {
    return `[Translation to English]\n${text}\n\n提示：请配置翻译API以获得真实的翻译结果。您可以使用 Google Translate API, DeepL API, 或其他翻译服务。`;
  } else {
    return `[翻译为中文]\n${text}\n\n提示：请配置翻译API以获得真实的翻译结果。您可以使用 Google Translate API, DeepL API, 或其他翻译服务。`;
  }
}

// 笔记功能
function showNotePanel() {
  if (!selectedText) {
    alert("请先选择要添加笔记的文本");
    return;
  }

  document.getElementById("noteContext").textContent = selectedText;
  document.getElementById("noteContent").value = "";
  notePanel.classList.remove("hidden");
}

function hideNotePanel() {
  notePanel.classList.add("hidden");
  document.getElementById("noteContent").value = "";
}

async function saveNote() {
  const noteContent = document.getElementById("noteContent").value.trim();

  if (!noteContent) {
    alert("请输入笔记内容");
    return;
  }

  const note = {
    id: Date.now(),
    text: selectedText,
    content: noteContent,
    timestamp: new Date().toISOString(),
  };

  currentNotes.push(note);

  // 保存到本地
  await ipcRenderer.invoke("save-notes", {
    filePath: currentFilePath,
    notes: currentNotes,
  });

  renderNotesList();
  hideNotePanel();

  // 高亮显示有笔记的文本
  highlightText(selectedText, "note");
}

async function loadNotes(filePath) {
  const result = await ipcRenderer.invoke("load-notes", filePath);
  currentNotes = result.notes || [];
}

function renderNotesList() {
  if (currentNotes.length === 0) {
    notesList.innerHTML = '<p class="empty-state">暂无笔记</p>';
    return;
  }

  notesList.innerHTML = currentNotes
    .map(
      (note) => `
    <div class="note-item" data-note-id="${note.id}">
      <div class="note-item-text">"${note.text}"</div>
      <div class="note-item-content">${note.content}</div>
    </div>
  `
    )
    .join("");

  // 添加点击事件
  notesList.querySelectorAll(".note-item").forEach((item) => {
    item.addEventListener("click", () => {
      const noteId = parseInt(item.dataset.noteId);
      const note = currentNotes.find((n) => n.id === noteId);
      if (note) {
        alert(`笔记内容：\n\n"${note.text}"\n\n${note.content}`);
      }
    });
  });
}

// 书签功能
function addBookmark() {
  const bookmark = {
    id: Date.now(),
    text: selectedText || "书签 " + (currentBookmarks.length + 1),
    timestamp: new Date().toISOString(),
    scrollPosition: window.scrollY,
  };

  currentBookmarks.push(bookmark);
  renderBookmarksList();
}

function renderBookmarksList() {
  if (currentBookmarks.length === 0) {
    bookmarksList.innerHTML = '<p class="empty-state">暂无书签</p>';
    return;
  }

  bookmarksList.innerHTML = currentBookmarks
    .map(
      (bookmark) => `
    <div class="bookmark-item" data-bookmark-id="${bookmark.id}">
      <div class="bookmark-item-text">🔖 ${bookmark.text}</div>
    </div>
  `
    )
    .join("");

  // 添加点击事件
  bookmarksList.querySelectorAll(".bookmark-item").forEach((item) => {
    item.addEventListener("click", () => {
      const bookmarkId = parseInt(item.dataset.bookmarkId);
      const bookmark = currentBookmarks.find((b) => b.id === bookmarkId);
      if (bookmark) {
        window.scrollTo({
          top: bookmark.scrollPosition,
          behavior: "smooth",
        });
      }
    });
  });
}

// 高亮功能
function highlightText(text, type = "highlight") {
  const content = documentViewer.innerHTML;
  const highlightedContent = content.replace(
    new RegExp(escapeRegExp(text), "g"),
    `<span class="highlight" data-type="${type}">${text}</span>`
  );
  documentViewer.innerHTML = highlightedContent;
}

function applyHighlights() {
  // 应用所有已保存的高亮
  currentNotes.forEach((note) => {
    highlightText(note.text, "note");
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function showError(message) {
  documentViewer.innerHTML = `
    <div style="text-align: center; padding: 60px 20px;">
      <h2 style="color: #d32f2f;">❌ 错误</h2>
      <p style="color: #666; margin-top: 16px;">${message}</p>
    </div>
  `;
}
