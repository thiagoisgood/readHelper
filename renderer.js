const { ipcRenderer } = require("electron");
const marked = require("marked");
const path = require("path");
const fs = require("fs");

// 加载配置文件
let config = {};
try {
  const configPath = path.join(__dirname, "config.json");
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log("Config loaded successfully");
  } else {
    console.warn("Config file not found, using default settings");
  }
} catch (error) {
  console.error("Failed to load config:", error);
}

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
let noteSelectedText = ""; // 用于保存笔记时使用的选中文本
let selectedTextPageNum = null; // 用于保存选中文本所在的页码

// PDF 相关变量
let currentPdf = null;
let currentPdfPage = 1;
let totalPdfPages = 0;
let pdfScale = 1.5;

// TTS 语音朗读相关变量
let speechSynthesis = window.speechSynthesis;
let currentUtterance = null;
let isSpeaking = false;
let isPaused = false;
let availableVoices = [];
let currentTTSRate = 0.8; // 默认0.8，对中文更友好

// 历史记录
let documentHistory = [];

// 框选提取相关变量
let isSelectionMode = false;
let selectionStart = null;
let currentSelectionBox = null;
let extractionRecords = [];

// DOM 元素
const documentViewer = document.getElementById("documentViewer");
const fileName = document.getElementById("fileName");
const openFileBtn = document.getElementById("openFileBtn");
const openFileBtn2 = document.getElementById("openFileBtn2");
const addNoteBtn = document.getElementById("addNoteBtn");
const addBookmarkBtn = document.getElementById("addBookmarkBtn");
const translateBtn = document.getElementById("translateBtn");
const readBtn = document.getElementById("readBtn");
const translationPanel = document.getElementById("translationPanel");
const notePanel = document.getElementById("notePanel");
const notesList = document.getElementById("notesList");
const bookmarksList = document.getElementById("bookmarksList");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

// 侧边栏和工具栏元素
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const actionToolbar = document.getElementById("actionToolbar");
const zoomControls = document.getElementById("zoomControls");

// 图标栏按钮
const iconOpenFile = document.getElementById("iconOpenFile");
const iconHistory = document.getElementById("iconHistory");
const iconNotes = document.getElementById("iconNotes");
const iconBookmarks = document.getElementById("iconBookmarks");

// 框选提取相关元素
const extractBtn = document.getElementById("extractBtn");
const extractionPanel = document.getElementById("extractionPanel");
const extractionList = document.getElementById("extractionList");
const clearExtractionsBtn = document.getElementById("clearExtractions");
const closeExtractionPanelBtn = document.getElementById("closeExtractionPanel");

// 初始化
initializeApp();

function initializeApp() {
  // 绑定事件
  openFileBtn.addEventListener("click", openFile);
  openFileBtn2.addEventListener("click", openFile);
  addNoteBtn.addEventListener("click", showNotePanel);
  addBookmarkBtn.addEventListener("click", addBookmark);
  translateBtn.addEventListener("click", translateSelection);

  // TTS 朗读按钮
  readBtn.addEventListener("click", speakSelection);

  // 框选提取按钮
  extractBtn.addEventListener("click", toggleSelectionMode);
  clearExtractionsBtn.addEventListener("click", clearExtractions);
  closeExtractionPanelBtn.addEventListener("click", closeExtractionPanel);

  // 侧边栏展开/收起事件（单一按钮控制）
  sidebarToggle.addEventListener("click", toggleSidebar);

  // 可折叠区域事件（笔记栏和书签栏）
  document.getElementById("notesHeader").addEventListener("click", () => {
    toggleCollapsibleSection("notesHeader");
  });
  document.getElementById("bookmarksHeader").addEventListener("click", () => {
    toggleCollapsibleSection("bookmarksHeader");
  });

  // 图标栏按钮事件
  iconOpenFile.addEventListener("click", openFile);
  iconHistory.addEventListener("click", () => {
    expandSidebar();
    // 滚动到历史记录区域
    setTimeout(() => {
      document
        .querySelector(".history-section")
        ?.scrollIntoView({ behavior: "smooth" });
    }, 300);
  });
  iconNotes.addEventListener("click", () => {
    expandSidebar();
    setTimeout(() => {
      notesList.scrollIntoView({ behavior: "smooth" });
    }, 300);
  });
  iconBookmarks.addEventListener("click", () => {
    expandSidebar();
    setTimeout(() => {
      bookmarksList.scrollIntoView({ behavior: "smooth" });
    }, 300);
  });

  // 固定工具栏的缩放按钮
  document.getElementById("mainZoomIn").addEventListener("click", () => {
    if (currentPdf) {
      pdfScale = Math.min(pdfScale + 0.25, 3);
      updateZoomDisplay();
      renderAllPdfPages();
    }
  });
  document.getElementById("mainZoomOut").addEventListener("click", () => {
    if (currentPdf) {
      pdfScale = Math.max(pdfScale - 0.25, 0.5);
      updateZoomDisplay();
      renderAllPdfPages();
    }
  });

  document.getElementById("closeTranslation").addEventListener("click", () => {
    translationPanel.classList.add("hidden");
  });

  document.getElementById("closeNote").addEventListener("click", hideNotePanel);
  document
    .getElementById("cancelNote")
    .addEventListener("click", hideNotePanel);
  document.getElementById("saveNote").addEventListener("click", saveNote);

  // TTS 控制面板事件
  document.getElementById("closeTTS").addEventListener("click", hideTTSPanel);
  document
    .getElementById("ttsPlayBtn")
    .addEventListener("click", toggleSpeaking);
  document
    .getElementById("ttsPauseBtn")
    .addEventListener("click", pauseSpeaking);
  document.getElementById("ttsStopBtn").addEventListener("click", stopSpeaking);

  // 语速控制
  const rateSlider = document.getElementById("ttsRate");
  rateSlider.addEventListener("input", (e) => {
    currentTTSRate = parseFloat(e.target.value);
    document.getElementById("ttsRateValue").textContent =
      currentTTSRate.toFixed(1) + "x";
  });

  // 初始化 TTS
  initializeTTS();

  // 监听文本选择
  document.addEventListener("selectionchange", handleTextSelection);

  // 监听来自主进程的文件打开事件
  ipcRenderer.on("file-opened", async (event, filePath) => {
    await loadDocument(filePath);
  });

  // 历史记录相关事件
  clearHistoryBtn.addEventListener("click", clearAllHistory);

  // 加载历史记录
  loadHistory();
}

// ===== 侧边栏控制 =====
// 切换侧边栏展开/收起（单一按钮控制）
function toggleSidebar() {
  const isCollapsed = sidebar.classList.contains("collapsed");
  if (isCollapsed) {
    sidebar.classList.remove("collapsed");
    sidebarToggle.textContent = "«";
    sidebarToggle.title = "收起侧边栏";
  } else {
    sidebar.classList.add("collapsed");
    sidebarToggle.textContent = "»";
    sidebarToggle.title = "展开侧边栏";
  }
}

// 展开侧边栏内容
function expandSidebar() {
  sidebar.classList.remove("collapsed");
  sidebarToggle.textContent = "«";
  sidebarToggle.title = "收起侧边栏";
}

// 收起侧边栏内容（只显示图标栏）
function collapseSidebar() {
  sidebar.classList.add("collapsed");
  sidebarToggle.textContent = "»";
  sidebarToggle.title = "展开侧边栏";
}

// 切换可折叠区域（笔记栏/书签栏）
function toggleCollapsibleSection(headerId) {
  const header = document.getElementById(headerId);
  const section = header.closest(".collapsible-section");
  if (section) {
    section.classList.toggle("collapsed");
  }
}

// 更新缩放显示
function updateZoomDisplay() {
  document.getElementById("mainZoomLevel").textContent = `${Math.round(
    pdfScale * 100
  )}%`;
}

// ===== 历史记录功能 =====

// 加载历史记录
async function loadHistory() {
  try {
    const result = await ipcRenderer.invoke("get-history");
    documentHistory = result.history || [];
    renderHistoryList();
  } catch (error) {
    console.error("Failed to load history:", error);
  }
}

// 添加历史记录
async function addToHistory(filePath, fileName, fileType) {
  try {
    const item = {
      filePath,
      fileName,
      fileType,
      openedAt: new Date().toISOString(),
      lastPosition: null,
    };

    const result = await ipcRenderer.invoke("add-history", item);
    if (result.success) {
      documentHistory = result.history;
      renderHistoryList();
    }
  } catch (error) {
    console.error("Failed to add history:", error);
  }
}

// 更新历史记录（如阅读位置）
async function updateHistoryPosition(filePath, position) {
  try {
    await ipcRenderer.invoke("update-history", filePath, {
      lastPosition: position,
    });
  } catch (error) {
    console.error("Failed to update history position:", error);
  }
}

// 删除单条历史
async function deleteHistoryItem(filePath) {
  try {
    const result = await ipcRenderer.invoke("delete-history-item", filePath);
    if (result.success) {
      documentHistory = result.history;
      renderHistoryList();
    }
  } catch (error) {
    console.error("Failed to delete history item:", error);
  }
}

// 清除所有历史
async function clearAllHistory() {
  if (!confirm("确定要清除所有历史记录吗？")) {
    return;
  }

  try {
    const result = await ipcRenderer.invoke("clear-history");
    if (result.success) {
      documentHistory = [];
      renderHistoryList();
    }
  } catch (error) {
    console.error("Failed to clear history:", error);
  }
}

// 渲染历史列表
function renderHistoryList() {
  if (documentHistory.length === 0) {
    historyList.innerHTML = '<p class="empty-state">暂无历史记录</p>';
    return;
  }

  historyList.innerHTML = documentHistory
    .map((item, index) => {
      const timeAgo = getRelativeTime(new Date(item.openedAt));
      const fileIcon = getFileIcon(item.fileType);
      const isActive = currentFilePath === item.filePath;

      return `
        <div class="history-item ${isActive ? "active" : ""}" data-path="${
        item.filePath
      }">
          <div class="history-item-main" onclick="openHistoryItem('${item.filePath.replace(
            /'/g,
            "\\'"
          )}')">
            <span class="history-icon">${fileIcon}</span>
            <div class="history-info">
              <div class="history-name" title="${item.filePath}">${
        item.fileName
      }</div>
              <div class="history-time">${timeAgo}</div>
            </div>
          </div>
          <button class="history-delete" onclick="event.stopPropagation(); deleteHistoryItem('${item.filePath.replace(
            /'/g,
            "\\'"
          )}')" title="删除">×</button>
        </div>
      `;
    })
    .join("");
}

// 获取文件图标
function getFileIcon(fileType) {
  const icons = {
    ".pdf": "📕",
    ".txt": "📄",
    ".md": "📝",
    ".html": "🌐",
  };
  return icons[fileType] || "📄";
}

// 获取相对时间
function getRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) {
    return "刚刚";
  } else if (diffMin < 60) {
    return `${diffMin} 分钟前`;
  } else if (diffHour < 24) {
    return `${diffHour} 小时前`;
  } else if (diffDay < 7) {
    return `${diffDay} 天前`;
  } else if (diffWeek < 4) {
    return `${diffWeek} 周前`;
  } else if (diffMonth < 12) {
    return `${diffMonth} 个月前`;
  } else {
    // 超过一年，显示具体日期
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
}

// 从历史记录打开文件
async function openHistoryItem(filePath) {
  // 检查文件是否存在
  const exists = await ipcRenderer.invoke("check-file-exists", filePath);
  if (!exists) {
    alert("文件不存在或已被移动。是否从历史记录中删除？");
    deleteHistoryItem(filePath);
    return;
  }

  await loadDocument(filePath);
}

// 将函数暴露到全局（供 onclick 使用）
window.openHistoryItem = openHistoryItem;
window.deleteHistoryItem = deleteHistoryItem;

function openFile() {
  // 触发文件选择对话框
  ipcRenderer.send("open-file-dialog");
}

async function loadDocument(filePath) {
  try {
    currentFilePath = filePath;
    const pathParts = filePath.split("/");
    const name = pathParts[pathParts.length - 1];
    const ext = path.extname(filePath).toLowerCase();
    fileName.textContent = name;

    // 打开文件时自动收起侧边栏
    collapseSidebar();

    // 启用工具栏按钮
    addNoteBtn.disabled = false;
    addBookmarkBtn.disabled = false;

    // 只有 PDF 才启用框选提取
    const isPdf = ext === ".pdf";
    extractBtn.disabled = !isPdf;
    if (isPdf) {
      // PDF 时重置提取记录
      extractionRecords = [];
      renderExtractionList();
      document.querySelectorAll(".selection-marker").forEach((m) => m.remove());
    } else {
      // 非 PDF 时关闭提取面板和模式
      isSelectionMode = false;
      extractBtn.classList.remove("active");
      extractBtn.innerHTML = "✂️ 框选";
      extractionPanel.classList.add("hidden");
    }

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
    await loadBookmarks(filePath);
    renderNotesList();
    renderBookmarksList();

    // 添加到历史记录
    await addToHistory(filePath, name, ext);
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

    // 使用懒加载渲染页面
    await renderPdfWithLazyLoad();
  } catch (error) {
    showError("无法加载 PDF: " + error.message);
  }
}

// 已渲染页面的记录
const renderedPages = new Set();

// 懒加载渲染 PDF
async function renderPdfWithLazyLoad() {
  // 显示固定工具栏
  actionToolbar.classList.add("visible");
  zoomControls.style.visibility = "visible";
  updateZoomDisplay();
  document.getElementById(
    "mainPageInfo"
  ).textContent = `共 ${totalPdfPages} 页`;

  // 创建 PDF 容器
  documentViewer.innerHTML = `
    <div class="pdf-container" id="pdfContainer"></div>
  `;

  const container = document.getElementById("pdfContainer");

  // 清空已渲染页面记录
  renderedPages.clear();

  // 获取第一页来确定尺寸
  const firstPage = await currentPdf.getPage(1);
  const viewport = firstPage.getViewport({ scale: pdfScale });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;

  // 为所有页面创建占位符
  for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
    const placeholder = document.createElement("div");
    placeholder.className = "pdf-page-wrapper pdf-page-placeholder";
    placeholder.setAttribute("data-page", pageNum);
    placeholder.style.minHeight = `${pageHeight + 60}px`; // 加上页头高度
    placeholder.innerHTML = `
      <div class="pdf-page-header">第 ${pageNum} 页 / 共 ${totalPdfPages} 页</div>
      <div class="pdf-page-loading" style="width: ${pageWidth}px; height: ${pageHeight}px;">
        <span>加载中...</span>
      </div>
    `;
    container.appendChild(placeholder);
  }

  // 使用 IntersectionObserver 监听页面可见性
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.getAttribute("data-page"));
          if (!renderedPages.has(pageNum)) {
            renderPdfPageLazy(pageNum, entry.target);
          }
        }
      });
    },
    {
      root: documentViewer,
      rootMargin: "200px 0px", // 提前 200px 开始加载
      threshold: 0.01,
    }
  );

  // 监听所有占位符
  container.querySelectorAll(".pdf-page-placeholder").forEach((placeholder) => {
    observer.observe(placeholder);
  });

  // 立即渲染前 3 页
  for (let i = 1; i <= Math.min(3, totalPdfPages); i++) {
    const placeholder = container.querySelector(`[data-page="${i}"]`);
    if (placeholder && !renderedPages.has(i)) {
      await renderPdfPageLazy(i, placeholder);
    }
  }
}

// 懒加载渲染单个页面
async function renderPdfPageLazy(pageNum, placeholder) {
  if (renderedPages.has(pageNum)) return;
  renderedPages.add(pageNum);

  try {
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

    // 创建页面容器
    const pageContainer = document.createElement("div");
    pageContainer.className = "pdf-page-container";
    pageContainer.style.display = "flex";
    pageContainer.style.gap = "20px";

    // 左侧：Canvas 渲染
    const canvasWrapper = document.createElement("div");
    canvasWrapper.className = "pdf-canvas-wrapper";
    canvasWrapper.style.position = "relative";
    canvasWrapper.style.width = `${viewport.width}px`;
    canvasWrapper.style.height = `${viewport.height}px`;

    // Canvas 层
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvasWrapper.appendChild(canvas);

    // 文本层
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    canvasWrapper.appendChild(textLayer);

    pageContainer.appendChild(canvasWrapper);

    // 绑定框选事件
    setupSelectionEvents(canvasWrapper, pageNum, viewport);

    pageWrapper.appendChild(pageContainer);

    // 替换占位符
    placeholder.replaceWith(pageWrapper);

    // 渲染 Canvas
    const context = canvas.getContext("2d");
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // 渲染文本层
    const textContent = await page.getTextContent();
    await renderTextLayer(textContent, textLayer, viewport);

    // 释放页面资源
    page.cleanup();
  } catch (error) {
    console.error(`渲染第 ${pageNum} 页失败:`, error);
    renderedPages.delete(pageNum); // 允许重试
  }
}

// 重新渲染所有已渲染的页面（用于缩放）
async function renderAllPdfPages() {
  // 显示固定工具栏
  actionToolbar.classList.add("visible");
  zoomControls.style.visibility = "visible";
  updateZoomDisplay();
  document.getElementById(
    "mainPageInfo"
  ).textContent = `共 ${totalPdfPages} 页`;

  // 重新使用懒加载
  renderedPages.clear();
  await renderPdfWithLazyLoad();
}

async function renderTextLayer(textContent, textLayerDiv, viewport) {
  // 使用 PDF.js 的 renderTextLayer 方法
  const textItems = textContent.items;
  const textStyles = textContent.styles;

  // 清空文本层
  textLayerDiv.innerHTML = "";

  // 遍历文本项并创建 span 元素
  for (const item of textItems) {
    if (!item.str) continue;

    const span = document.createElement("span");
    span.textContent = item.str;

    // 获取变换矩阵
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

    // 计算字体大小和位置
    const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    const left = tx[4];
    const top = viewport.height - tx[5];

    // 设置样式
    span.style.position = "absolute";
    span.style.left = `${left}px`;
    span.style.top = `${top - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = item.fontName
      ? textStyles[item.fontName]?.fontFamily || "sans-serif"
      : "sans-serif";
    span.style.transformOrigin = "0% 0%";

    // 处理文本宽度
    if (item.width > 0) {
      span.style.width = `${item.width * pdfScale}px`;
      span.style.whiteSpace = "pre";
    }

    // 处理旋转
    const angle = Math.atan2(tx[1], tx[0]);
    if (angle !== 0) {
      span.style.transform = `rotate(${angle}rad)`;
    }

    textLayerDiv.appendChild(span);
  }
}

function renderDocument(content, ext) {
  // 显示工具栏但隐藏缩放控件（非 PDF 不需要缩放）
  actionToolbar.classList.add("visible");
  zoomControls.style.visibility = "hidden";
  document.getElementById("mainPageInfo").textContent = "";

  let html = "";
  const lines = content.split("\n");
  const totalLines = lines.length;

  switch (ext) {
    case ".md":
      // Markdown 渲染后显示，同时保留原始行号信息
      const mdContent = marked.parse(content);
      html = `
        <div class="document-with-lines">
          <div class="line-info">共 ${totalLines} 行</div>
          <div class="document-content markdown-content">${mdContent}</div>
        </div>
      `;
      break;
    case ".html":
      html = `
        <div class="document-with-lines">
          <div class="line-info">共 ${totalLines} 行</div>
          <div class="document-content">${content}</div>
        </div>
      `;
      break;
    case ".txt":
    default:
      // TXT 文件显示行号
      const numberedLines = lines
        .map((line, index) => {
          const lineNum = index + 1;
          const escapedLine = escapeHtml(line) || "&nbsp;";
          return `<div class="text-line"><span class="line-number">${lineNum}</span><span class="line-content">${escapedLine}</span></div>`;
        })
        .join("");
      html = `
        <div class="document-with-lines">
          <div class="line-info">共 ${totalLines} 行</div>
          <div class="text-content-numbered">${numberedLines}</div>
        </div>
      `;
      break;
  }

  documentViewer.innerHTML = html;
  applyHighlights();
}

// ===== 框选提取功能 =====

// 切换框选模式
function toggleSelectionMode() {
  if (!currentPdf) return;

  isSelectionMode = !isSelectionMode;

  if (isSelectionMode) {
    extractBtn.classList.add("active");
    extractBtn.innerHTML = "✂️ 取消";
    // 显示提取面板
    extractionPanel.classList.remove("hidden");
    // 添加选择模式样式
    document.querySelectorAll(".pdf-canvas-wrapper").forEach((wrapper) => {
      wrapper.classList.add("selection-mode");
    });
  } else {
    extractBtn.classList.remove("active");
    extractBtn.innerHTML = "✂️ 框选";
    // 移除选择模式样式
    document.querySelectorAll(".pdf-canvas-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("selection-mode");
    });
    // 移除当前的选择框
    if (currentSelectionBox) {
      currentSelectionBox.remove();
      currentSelectionBox = null;
    }
  }
}

// 关闭提取面板
function closeExtractionPanel() {
  extractionPanel.classList.add("hidden");
}

// 清空所有提取记录
function clearExtractions() {
  extractionRecords = [];
  renderExtractionList();
  // 移除所有标记
  document.querySelectorAll(".selection-marker").forEach((m) => m.remove());
}

// 设置框选事件
function setupSelectionEvents(canvasWrapper, pageNum, viewport) {
  let isDrawing = false;
  let startX, startY;

  canvasWrapper.addEventListener("mousedown", (e) => {
    if (!isSelectionMode) return;

    const rect = canvasWrapper.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isDrawing = true;

    // 创建选择框
    currentSelectionBox = document.createElement("div");
    currentSelectionBox.className = "selection-box";
    currentSelectionBox.style.left = `${startX}px`;
    currentSelectionBox.style.top = `${startY}px`;
    currentSelectionBox.style.width = "0";
    currentSelectionBox.style.height = "0";
    canvasWrapper.appendChild(currentSelectionBox);
  });

  canvasWrapper.addEventListener("mousemove", (e) => {
    if (!isDrawing || !currentSelectionBox) return;

    const rect = canvasWrapper.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const width = currentX - startX;
    const height = currentY - startY;

    // 支持反向拖拽
    if (width < 0) {
      currentSelectionBox.style.left = `${currentX}px`;
      currentSelectionBox.style.width = `${-width}px`;
    } else {
      currentSelectionBox.style.left = `${startX}px`;
      currentSelectionBox.style.width = `${width}px`;
    }

    if (height < 0) {
      currentSelectionBox.style.top = `${currentY}px`;
      currentSelectionBox.style.height = `${-height}px`;
    } else {
      currentSelectionBox.style.top = `${startY}px`;
      currentSelectionBox.style.height = `${height}px`;
    }
  });

  canvasWrapper.addEventListener("mouseup", async (e) => {
    if (!isDrawing || !currentSelectionBox) return;
    isDrawing = false;

    const rect = canvasWrapper.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    // 计算选择区域（确保坐标正确）
    const x1 = Math.min(startX, endX);
    const y1 = Math.min(startY, endY);
    const x2 = Math.max(startX, endX);
    const y2 = Math.max(startY, endY);

    const selectionWidth = x2 - x1;
    const selectionHeight = y2 - y1;

    // 如果选择区域太小，忽略
    if (selectionWidth < 10 || selectionHeight < 10) {
      currentSelectionBox.remove();
      currentSelectionBox = null;
      return;
    }

    // 转换为 PDF 坐标
    const pdfX1 = x1 / pdfScale;
    const pdfY1 = y1 / pdfScale;
    const pdfX2 = x2 / pdfScale;
    const pdfY2 = y2 / pdfScale;

    // 提取选中区域的文本
    await extractTextFromRegion(
      pageNum,
      pdfX1,
      pdfY1,
      pdfX2,
      pdfY2,
      viewport,
      canvasWrapper
    );

    // 移除临时选择框
    currentSelectionBox.remove();
    currentSelectionBox = null;
  });

  // 鼠标离开时取消绘制
  canvasWrapper.addEventListener("mouseleave", () => {
    if (isDrawing && currentSelectionBox) {
      currentSelectionBox.remove();
      currentSelectionBox = null;
      isDrawing = false;
    }
  });
}

// 从选中区域提取文本
async function extractTextFromRegion(
  pageNum,
  x1,
  y1,
  x2,
  y2,
  viewport,
  canvasWrapper
) {
  try {
    // 显示加载状态
    const loadingItem = document.createElement("div");
    loadingItem.className = "extraction-loading";
    loadingItem.textContent = "正在提取文本...";
    extractionList.insertBefore(loadingItem, extractionList.firstChild);

    // 获取 PDF 页面信息用于坐标转换
    const page = await currentPdf.getPage(pageNum);
    const pdfViewport = page.getViewport({ scale: 1 });

    // pdftotext 使用的是 72 DPI 坐标系
    // PDF.js viewport 的宽高是实际的 PDF 点大小
    const pdfWidth = pdfViewport.width;
    const pdfHeight = pdfViewport.height;

    // 转换坐标：从屏幕坐标到 PDF 坐标（72 DPI）
    // y1, y2 已经是从顶部开始的坐标
    const regionX = x1;
    const regionY = y1;
    const regionWidth = x2 - x1;
    const regionHeight = y2 - y1;

    console.log(
      `提取区域: 页${pageNum}, x=${regionX}, y=${regionY}, w=${regionWidth}, h=${regionHeight}`
    );

    // 使用 Poppler 提取指定区域的文本
    const result = await ipcRenderer.invoke(
      "extract-pdf-region-text",
      currentFilePath,
      pageNum,
      regionX,
      regionY,
      regionWidth,
      regionHeight
    );

    let extractedText = "";

    if (result.success && result.text) {
      extractedText = result.text;
    } else {
      // 如果区域提取失败，尝试使用 PDF.js 文本层
      console.log("Poppler 区域提取失败，使用 PDF.js 备选方案");
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        if (!item.str) continue;

        // 获取文本位置（转换到屏幕坐标）
        const tx = pdfjsLib.Util.transform(
          pdfViewport.transform,
          item.transform
        );
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);

        // PDF 坐标系 Y 轴从底部开始，需要转换
        const itemX = tx[4];
        const itemY = pdfHeight - tx[5]; // 转换为从顶部开始
        const itemWidth = item.width || item.str.length * fontHeight * 0.6;
        const itemHeight = fontHeight;

        // 检查文本是否在选中区域内
        const itemX2 = itemX + itemWidth;
        const itemY2 = itemY + itemHeight;

        if (itemX < x2 && itemX2 > x1 && itemY < y2 && itemY2 > y1) {
          extractedText += item.str;
          // 检查是否需要添加空格或换行
          if (item.hasEOL) {
            extractedText += "\n";
          } else {
            extractedText += " ";
          }
        }
      }
      extractedText = extractedText.trim();
    }

    // 移除加载提示
    loadingItem.remove();

    // 检查是否提取到文本
    if (!extractedText) {
      extractedText = "(未检测到文本，请尝试选择更大的区域或调整选择位置)";
    } else {
      // 使用 AI 格式化文本
      console.log("开始格式化文本，原文长度:", extractedText.length);
      extractedText = await formatExtractedText(extractedText);
      console.log("格式化完成，结果长度:", extractedText.length);
    }

    // 创建提取记录
    const record = {
      id: Date.now(),
      pageNum: pageNum,
      time: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      text: extractedText,
      region: { x1, y1, x2, y2 },
    };

    extractionRecords.unshift(record);
    renderExtractionList();

    // 同步更新选中文本和页码（用于后续添加书签/笔记）
    if (extractedText && !extractedText.startsWith("(未检测到文本")) {
      selectedText = extractedText;
      selectedTextPageNum = pageNum;
      translateBtn.disabled = false;
      readBtn.disabled = false;
    }

    // 在 PDF 上添加标记
    addSelectionMarker(
      canvasWrapper,
      x1 * pdfScale,
      y1 * pdfScale,
      x2 * pdfScale,
      y2 * pdfScale,
      extractionRecords.length
    );
  } catch (error) {
    console.error("提取文本失败:", error);
    alert("提取失败: " + error.message);
  }
}

// 添加选中区域标记
function addSelectionMarker(canvasWrapper, x1, y1, x2, y2, index) {
  const marker = document.createElement("div");
  marker.className = "selection-marker";
  marker.style.left = `${x1}px`;
  marker.style.top = `${y1}px`;
  marker.style.width = `${x2 - x1}px`;
  marker.style.height = `${y2 - y1}px`;

  const label = document.createElement("div");
  label.className = "selection-marker-label";
  label.textContent = `#${index}`;
  marker.appendChild(label);

  canvasWrapper.appendChild(marker);
}

// 渲染提取记录列表
function renderExtractionList() {
  if (extractionRecords.length === 0) {
    extractionList.innerHTML =
      '<p class="empty-state">点击「框选」按钮后在PDF上画框选择区域</p>';
    return;
  }

  extractionList.innerHTML = extractionRecords
    .map(
      (record, index) => `
    <div class="extraction-item" data-id="${record.id}">
      <div class="extraction-item-header">
        <div class="extraction-meta">
          <span class="extraction-page">第 ${record.pageNum} 页</span>
          <span class="extraction-time">${record.time}</span>
        </div>
        <div class="extraction-item-actions">
          <button onclick="copyExtractionText(${
            record.id
          })" title="复制">📋</button>
          <button onclick="deleteExtraction(${
            record.id
          })" title="删除">🗑️</button>
        </div>
      </div>
      <div class="extraction-item-content">
        <pre class="extraction-text">${escapeHtml(record.text)}</pre>
      </div>
    </div>
  `
    )
    .join("");
}

// 复制提取的文本
function copyExtractionText(id) {
  const record = extractionRecords.find((r) => r.id === id);
  if (record) {
    navigator.clipboard.writeText(record.text).then(() => {
      const btn = document.querySelector(
        `.extraction-item[data-id="${id}"] button[title="复制"]`
      );
      if (btn) {
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = "📋"), 1500);
      }
    });
  }
}

// 删除提取记录
function deleteExtraction(id) {
  const index = extractionRecords.findIndex((r) => r.id === id);
  if (index !== -1) {
    extractionRecords.splice(index, 1);
    renderExtractionList();
  }
}

// 格式化提取的文本：支持 DeepSeek AI 格式化
async function formatExtractedText(text) {
  if (!text) return "";

  // 如果配置了 DeepSeek API，使用 AI 智能格式化
  const deepseekConfig = config?.deepseek;
  const deepseekApiKey = deepseekConfig?.apiKey;
  const deepseekEnabled = deepseekConfig?.enabled !== false;

  if (
    deepseekEnabled &&
    deepseekApiKey &&
    deepseekApiKey !== "YOUR_DEEPSEEK_API_KEY"
  ) {
    try {
      console.log("Using DeepSeek AI for text formatting...");
      return await formatTextWithDeepSeek(text, deepseekApiKey);
    } catch (error) {
      console.error("DeepSeek format failed, using local format:", error);
      // 失败时回退到本地格式化
    }
  }

  // 本地格式化（备用方案）
  return localFormatText(text);
}

// 本地格式化函数
function localFormatText(text) {
  if (!text) return "";

  let result = text
    // 去除页眉页脚常见的页码格式
    .replace(/^\s*\d+\s*$/gm, "")
    // 将多个连续空格替换为单个空格
    .replace(/ {2,}/g, " ")
    // 将多个连续换行替换为两个换行（保留段落）
    .replace(/\n{3,}/g, "\n\n")
    // 去除行首行尾空格
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0) // 过滤空行
    .join("\n")
    // 合并被错误断开的英文句子（行尾没有标点的情况）
    .replace(/([a-zA-Z,])\n([a-z])/g, "$1 $2")
    // 合并被错误断开的英文单词（连字符断词）
    .replace(/(\w)-\n(\w)/g, "$1$2")
    // 合并中文被断开的句子（非标点结尾后接中文）
    .replace(/([\u4e00-\u9fa5])\n([\u4e00-\u9fa5])/g, "$1$2")
    // 处理中英文之间的空格
    .replace(/([\u4e00-\u9fa5])\s+([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])\s+([\u4e00-\u9fa5])/g, "$1 $2")
    // 最后再清理一次多余空格
    .replace(/ {2,}/g, " ")
    .trim();

  // 如果结果中有太多短行，尝试合并成段落
  const lines = result.split("\n");
  if (lines.length > 3) {
    const avgLength =
      lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
    if (avgLength < 40) {
      // 短行较多，尝试智能合并
      result = lines.reduce((acc, line, i) => {
        if (i === 0) return line;
        const prevLine = lines[i - 1];
        // 如果前一行以标点结尾，保持换行；否则合并
        if (/[。！？.!?]$/.test(prevLine)) {
          return acc + "\n" + line;
        } else {
          return acc + " " + line;
        }
      }, "");
    }
  }

  return result;
}

// 使用 DeepSeek API 智能格式化文本
async function formatTextWithDeepSeek(text, apiKey) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "你是一个文本格式化助手。请将用户提供的从PDF提取的文本进行格式化：1. 去除多余的换行和空格 2. 合并被错误断开的句子 3. 保持段落结构 4. 只返回格式化后的文本，不要添加任何解释或前缀。",
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `DeepSeek API error: ${response.status} - ${
        errorData.error?.message || "Unknown error"
      }`
    );
  }

  const data = await response.json();
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }
  throw new Error("Invalid response from DeepSeek API");
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
    readBtn.disabled = false;
  } else {
    translateBtn.disabled = true;
    readBtn.disabled = true;
  }
}

// ===== TTS 语音朗读功能 =====

// 初始化 TTS
function initializeTTS() {
  loadVoices();
  // Chrome/Electron 中，voices 可能异步加载
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
}

function loadVoices() {
  availableVoices = speechSynthesis.getVoices();
  console.log("Available TTS voices:", availableVoices.length);
  // 打印可用语音列表以便调试
  availableVoices.forEach((v, i) => {
    console.log(
      `${i}: ${v.name} (${v.lang}) ${v.localService ? "[local]" : "[remote]"}`
    );
  });
  
  // 如果语音列表为空，稍后重试
  if (availableVoices.length === 0) {
    setTimeout(loadVoices, 100);
  }
}

// 检测文本语言（中文/英文）
function detectLanguage(text) {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const totalChars = text.replace(/\s/g, "").length;
  const chineseRatio = totalChars > 0 ? chineseChars.length / totalChars : 0;
  return chineseRatio > 0.3 ? "zh" : "en";
}

// 根据语言选择最佳语音
function selectVoiceForLanguage(lang) {
  // 确保语音已加载
  if (availableVoices.length === 0) {
    availableVoices = speechSynthesis.getVoices();
    console.log("Re-loaded voices:", availableVoices.length);
  }

  let preferredVoice = null;

  if (lang === "zh") {
    // macOS 高质量中文语音优先 - 扩展候选列表
    preferredVoice =
      // 婷婷 - macOS 高质量中文语音
      availableVoices.find(
        (v) => v.name.includes("Tingting") || v.name.includes("婷婷")
      ) ||
      // 其他 macOS 中文语音
      availableVoices.find(
        (v) => v.name.includes("Sinji") || v.name.includes("Meijia")
      ) ||
      // 李连杰、玉林等语音
      availableVoices.find(
        (v) => v.name.includes("Lilian") || v.name.includes("Yu-shu")
      ) ||
      // 简体中文本地语音
      availableVoices.find((v) => v.lang === "zh-CN" && v.localService) ||
      // 繁体中文
      availableVoices.find((v) => v.lang === "zh-TW" && v.localService) ||
      availableVoices.find((v) => v.lang === "zh-HK" && v.localService) ||
      // 任何中文语音
      availableVoices.find((v) => v.lang === "zh-CN") ||
      availableVoices.find((v) => v.lang === "zh-TW") ||
      availableVoices.find((v) => v.lang === "zh-HK") ||
      availableVoices.find((v) => v.lang.startsWith("zh")) ||
      availableVoices.find((v) => v.lang.includes("CN") || v.lang.includes("Chinese"));
  } else {
    // macOS 高质量英文语音优先
    preferredVoice =
      availableVoices.find((v) => v.name.includes("Samantha")) ||
      availableVoices.find((v) => v.name.includes("Alex")) ||
      availableVoices.find((v) => v.name.includes("Daniel")) ||
      availableVoices.find((v) => v.lang === "en-US" && v.localService) ||
      availableVoices.find((v) => v.lang === "en-US") ||
      availableVoices.find((v) => v.lang === "en-GB") ||
      availableVoices.find((v) => v.lang.startsWith("en"));
  }

  console.log("Selected voice for lang", lang, ":", preferredVoice?.name, preferredVoice?.lang);
  
  // 如果没找到匹配语音，使用默认语音但设置正确的语言
  if (!preferredVoice && availableVoices.length > 0) {
    console.warn("No matching voice found for language:", lang);
    preferredVoice = availableVoices[0];
  }
  
  return preferredVoice;
}

// 朗读选中文本
function speakSelection() {
  if (!selectedText) {
    alert("请先选择要朗读的文本");
    return;
  }
  speakText(selectedText);
}

// 朗读指定文本
function speakText(text) {
  // 如果正在朗读，先停止
  if (isSpeaking) {
    stopSpeaking();
  }

  // 检测语言并选择语音
  const lang = detectLanguage(text);
  const voice = selectVoiceForLanguage(lang);

  // 创建语音实例
  currentUtterance = new SpeechSynthesisUtterance(text);

  // 设置语音参数
  if (voice) {
    currentUtterance.voice = voice;
    currentUtterance.lang = voice.lang;
  } else {
    // 如果没有找到语音，设置默认语言
    currentUtterance.lang = lang === "zh" ? "zh-CN" : "en-US";
    console.warn("No voice available, using default lang:", currentUtterance.lang);
  }
  
  currentUtterance.rate = currentTTSRate;
  currentUtterance.pitch = 1.0;
  currentUtterance.volume = 1.0;
  
  console.log("TTS config - Voice:", voice?.name, "Lang:", currentUtterance.lang, "Rate:", currentTTSRate);

  // 事件监听
  currentUtterance.onstart = () => {
    isSpeaking = true;
    isPaused = false;
    updateTTSPanel("speaking");
  };

  currentUtterance.onend = () => {
    isSpeaking = false;
    isPaused = false;
    updateTTSPanel("stopped");
  };

  currentUtterance.onerror = (event) => {
    isSpeaking = false;
    isPaused = false;
    updateTTSPanel("stopped");
    console.error("Speech error:", event.error);
  };

  currentUtterance.onpause = () => {
    isPaused = true;
    updateTTSPanel("paused");
  };

  currentUtterance.onresume = () => {
    isPaused = false;
    updateTTSPanel("speaking");
  };

  // 开始朗读
  speechSynthesis.speak(currentUtterance);

  // 显示控制面板
  showTTSPanel(text, lang);
}

// 暂停朗读
function pauseSpeaking() {
  if (isSpeaking && !isPaused) {
    speechSynthesis.pause();
  }
}

// 继续朗读
function resumeSpeaking() {
  if (isSpeaking && isPaused) {
    speechSynthesis.resume();
  }
}

// 停止朗读
function stopSpeaking() {
  speechSynthesis.cancel();
  isSpeaking = false;
  isPaused = false;
  currentUtterance = null;
  updateTTSPanel("stopped");
}

// 切换播放/暂停
function toggleSpeaking() {
  if (!isSpeaking) {
    speakSelection();
  } else if (isPaused) {
    resumeSpeaking();
  } else {
    pauseSpeaking();
  }
}

// 显示 TTS 控制面板
function showTTSPanel(text, lang) {
  const panel = document.getElementById("ttsPanel");
  document.getElementById("ttsText").textContent =
    text.length > 200 ? text.substring(0, 200) + "..." : text;
  document.getElementById("ttsLanguage").textContent =
    lang === "zh" ? "中文" : "English";
  panel.classList.remove("hidden");
}

// 隐藏 TTS 控制面板
function hideTTSPanel() {
  stopSpeaking();
  document.getElementById("ttsPanel").classList.add("hidden");
}

// 更新面板状态
function updateTTSPanel(state) {
  const playBtn = document.getElementById("ttsPlayBtn");
  const pauseBtn = document.getElementById("ttsPauseBtn");
  const statusText = document.getElementById("ttsStatus");

  switch (state) {
    case "speaking":
      playBtn.classList.add("hidden");
      pauseBtn.classList.remove("hidden");
      statusText.textContent = "正在朗读...";
      break;
    case "paused":
      playBtn.classList.remove("hidden");
      pauseBtn.classList.add("hidden");
      statusText.textContent = "已暂停";
      break;
    case "stopped":
      playBtn.classList.remove("hidden");
      pauseBtn.classList.add("hidden");
      statusText.textContent = "已停止";
      break;
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

// 翻译功能 - 使用 Google Cloud Translation API V2
async function translateText(text) {
  const apiKey = config?.googleCloud?.apiKey;

  // 检查 API 配置
  if (!apiKey || apiKey === "YOUR_GOOGLE_CLOUD_API_KEY") {
    return `❌ 翻译 API 未配置

请在 config.json 文件中配置您的 Google Cloud API Key：

1. 打开项目根目录下的 config.json
2. 将 "YOUR_GOOGLE_CLOUD_API_KEY" 替换为您的 API 密钥
3. 重新启动应用

原文：${text}`;
  }

  try {
    // 检测源语言 - 计算中文字符比例
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    const totalChars = text.replace(/\s/g, "").length;
    const chineseRatio = totalChars > 0 ? chineseChars.length / totalChars : 0;

    // 确定目标语言：中文翻译成英文，其他翻译成中文
    let targetLanguage;
    if (chineseRatio > 0.3) {
      targetLanguage = config?.translation?.alternativeTargetLanguage || "en";
    } else {
      targetLanguage = config?.translation?.defaultTargetLanguage || "zh-CN";
    }

    // Google Cloud Translation API V2 请求
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        target: targetLanguage,
        format: "text",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();

    if (
      data.data &&
      data.data.translations &&
      data.data.translations.length > 0
    ) {
      const translation = data.data.translations[0];
      const detectedSource = translation.detectedSourceLanguage || "auto";
      const translatedText = translation.translatedText;
      const langInfo = `[${detectedSource.toUpperCase()} → ${targetLanguage.toUpperCase()}]`;
      return `${langInfo}\n\n${translatedText}`;
    } else {
      throw new Error("未收到翻译结果");
    }
  } catch (error) {
    console.error("Translation error:", error);
    return `翻译失败: ${error.message}\n\n原文: ${text}`;
  }
}

// 笔记功能
function showNotePanel() {
  if (!selectedText) {
    alert("请先选择要添加笔记的文本");
    return;
  }

  // 保存选中的文本，避免在输入笔记内容时被清空
  noteSelectedText = selectedText;
  document.getElementById("noteContext").textContent = noteSelectedText;
  document.getElementById("noteContent").value = "";
  notePanel.classList.remove("hidden");
}

function hideNotePanel() {
  notePanel.classList.add("hidden");
  document.getElementById("noteContent").value = "";
  noteSelectedText = ""; // 清空保存的文本
}

async function saveNote() {
  const noteContent = document.getElementById("noteContent").value.trim();

  if (!noteContent) {
    alert("请输入笔记内容");
    return;
  }

  if (!currentFilePath) {
    alert("请先打开一个文档");
    hideNotePanel();
    return;
  }

  try {
    // 使用保存的文本，而不是当前选中的文本
    const textToSave = noteSelectedText || selectedText;

    if (!textToSave) {
      alert("没有选中的文本");
      return;
    }

    const note = {
      id: Date.now(),
      text: textToSave,
      content: noteContent,
      timestamp: new Date().toISOString(),
    };

    currentNotes.push(note);

    // 保存到本地
    const result = await ipcRenderer.invoke("save-notes", {
      filePath: currentFilePath,
      notes: currentNotes,
    });

    if (result.error) {
      console.error("保存笔记失败:", result.error);
      alert("保存失败: " + result.error);
      // 回滚
      currentNotes.pop();
      return;
    }

    renderNotesList();
    hideNotePanel();

    // 高亮显示有笔记的文本（仅对非PDF文档生效）
    if (!currentPdf) {
      highlightText(textToSave, "note");
    }
  } catch (error) {
    console.error("保存笔记出错:", error);
    alert("保存笔记出错: " + error.message);
  }
}

async function loadNotes(filePath) {
  try {
    const result = await ipcRenderer.invoke("load-notes", filePath);
    if (result && Array.isArray(result.notes)) {
      currentNotes = result.notes;
    } else {
      currentNotes = [];
    }
  } catch (error) {
    console.error("加载笔记失败:", error);
    currentNotes = [];
  }
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
      <div class="note-item-row">
        <div class="note-item-preview">
          <span class="note-preview-label">📝</span>
          <span class="note-preview-text">${escapeHtml(note.content)}</span>
        </div>
        <button class="note-delete-btn" data-note-id="${
          note.id
        }" title="删除笔记">×</button>
      </div>
      <div class="note-item-source">📄 ${escapeHtml(note.text)}</div>
    </div>
  `
    )
    .join("");

  // 添加点击事件（显示详情弹框）
  notesList.querySelectorAll(".note-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // 如果点击的是删除按钮，不触发弹框
      if (e.target.classList.contains("note-delete-btn")) return;

      const noteId = parseInt(item.dataset.noteId);
      const note = currentNotes.find((n) => n.id === noteId);
      if (note) {
        showNoteDetailModal(note);
      }
    });
  });

  // 添加删除按钮事件
  notesList.querySelectorAll(".note-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const noteId = parseInt(btn.dataset.noteId);
      if (confirm("确定要删除这条笔记吗？")) {
        await deleteNote(noteId);
      }
    });
  });
}

// 显示笔记详情弹框
function showNoteDetailModal(note) {
  // 创建模态框
  const modal = document.createElement("div");
  modal.className = "note-detail-modal";
  modal.innerHTML = `
    <div class="note-detail-overlay"></div>
    <div class="note-detail-content">
      <div class="note-detail-header">
        <h3>📝 笔记详情</h3>
        <button class="note-detail-close">×</button>
      </div>
      <div class="note-detail-body">
        <div class="note-detail-section">
          <div class="note-detail-label">📄 原文内容</div>
          <div class="note-detail-text">${escapeHtml(note.text)}</div>
        </div>
        <div class="note-detail-section">
          <div class="note-detail-label">📝 笔记内容</div>
          <div class="note-detail-note">${escapeHtml(note.content)}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 关闭事件
  modal.querySelector(".note-detail-close").addEventListener("click", () => {
    modal.remove();
  });
  modal.querySelector(".note-detail-overlay").addEventListener("click", () => {
    modal.remove();
  });
}

// 删除笔记
async function deleteNote(noteId) {
  try {
    currentNotes = currentNotes.filter((n) => n.id !== noteId);

    const result = await ipcRenderer.invoke("save-notes", {
      filePath: currentFilePath,
      notes: currentNotes,
    });

    if (result.error) {
      console.error("删除笔记失败:", result.error);
      alert("删除失败: " + result.error);
      return;
    }

    renderNotesList();
  } catch (error) {
    console.error("删除笔记出错:", error);
  }
}

// 书签功能
async function addBookmark() {
  if (!currentFilePath) {
    alert("请先打开一个文档");
    return;
  }

  try {
    // 获取文档类型
    const ext = path.extname(currentFilePath).toLowerCase();
    const isPdf = ext === ".pdf";

    // 获取页码：PDF优先用选中文本记录的页码，否则用当前可见页
    const pageNum = isPdf
      ? selectedTextPageNum || getCurrentVisiblePage()
      : null;

    const bookmark = {
      id: Date.now(),
      text: selectedText || "书签 " + (currentBookmarks.length + 1),
      pageNum: pageNum,
      timestamp: new Date().toISOString(),
      scrollPosition: window.scrollY,
      // 保存选中文本用于非PDF定位
      searchText: selectedText ? selectedText.substring(0, 100) : null,
    };

    currentBookmarks.push(bookmark);

    // 保存到本地
    const result = await ipcRenderer.invoke("save-bookmarks", {
      filePath: currentFilePath,
      bookmarks: currentBookmarks,
    });

    if (result.error) {
      console.error("保存书签失败:", result.error);
      alert("保存失败: " + result.error);
      currentBookmarks.pop();
      return;
    }

    renderBookmarksList();
  } catch (error) {
    console.error("保存书签出错:", error);
    alert("保存书签出错: " + error.message);
  }
}

async function loadBookmarks(filePath) {
  try {
    const result = await ipcRenderer.invoke("load-bookmarks", filePath);
    if (result && Array.isArray(result.bookmarks)) {
      currentBookmarks = result.bookmarks;
    } else {
      currentBookmarks = [];
    }
  } catch (error) {
    console.error("加载书签失败:", error);
    currentBookmarks = [];
  }
}

function renderBookmarksList() {
  if (currentBookmarks.length === 0) {
    bookmarksList.innerHTML = '<p class="empty-state">暂无书签</p>';
    return;
  }

  bookmarksList.innerHTML = currentBookmarks
    .map((bookmark) => {
      // PDF显示页码，其他类型显示位置标记
      let badge = "";
      if (bookmark.pageNum) {
        badge = `<span class="bookmark-page-badge">P${bookmark.pageNum}</span>`;
      } else if (bookmark.searchText) {
        badge = `<span class="bookmark-page-badge">📍</span>`;
      }
      return `
    <div class="bookmark-item" data-bookmark-id="${bookmark.id}">
      <div class="bookmark-item-content">
        <div class="bookmark-item-row">
          ${badge}
          <span class="bookmark-item-text">${escapeHtml(bookmark.text)}</span>
        </div>
      </div>
      <button class="bookmark-delete-btn" data-bookmark-id="${
        bookmark.id
      }" title="删除书签">×</button>
    </div>
  `;
    })
    .join("");

  // 添加点击事件（跳转到书签位置）
  bookmarksList
    .querySelectorAll(".bookmark-item-content")
    .forEach((content) => {
      content.addEventListener("click", () => {
        const item = content.closest(".bookmark-item");
        const bookmarkId = parseInt(item.dataset.bookmarkId);
        const bookmark = currentBookmarks.find((b) => b.id === bookmarkId);
        if (bookmark) {
          goToBookmark(bookmark);
        }
      });
    });

  // 添加删除按钮事件
  bookmarksList.querySelectorAll(".bookmark-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const bookmarkId = parseInt(btn.dataset.bookmarkId);
      if (confirm("确定要删除这个书签吗？")) {
        await deleteBookmark(bookmarkId);
      }
    });
  });
}

// 删除书签
async function deleteBookmark(bookmarkId) {
  try {
    currentBookmarks = currentBookmarks.filter((b) => b.id !== bookmarkId);

    const result = await ipcRenderer.invoke("save-bookmarks", {
      filePath: currentFilePath,
      bookmarks: currentBookmarks,
    });

    if (result.error) {
      console.error("删除书签失败:", result.error);
      alert("删除失败: " + result.error);
      return;
    }

    renderBookmarksList();
  } catch (error) {
    console.error("删除书签出错:", error);
  }
}

// 获取当前可见的页面号
function getCurrentVisiblePage() {
  if (!currentPdf) return 1;

  const container = document.getElementById("pdfContainer");
  if (!container) return 1;

  const pages = container.querySelectorAll(".pdf-page-wrapper");
  const viewerRect = documentViewer.getBoundingClientRect();
  const viewerCenter = viewerRect.top + viewerRect.height / 2;

  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    if (rect.top <= viewerCenter && rect.bottom >= viewerCenter) {
      return parseInt(page.getAttribute("data-page")) || 1;
    }
  }

  return 1;
}

// 跳转到书签位置
function goToBookmark(bookmark) {
  if (currentPdf && bookmark.pageNum) {
    // PDF 文档：跳转到对应页面
    const container = document.getElementById("pdfContainer");
    if (container) {
      const targetPage = container.querySelector(
        `[data-page="${bookmark.pageNum}"]`
      );
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }

  // 非 PDF：先滚动到大致位置，再尝试定位到文本
  window.scrollTo({
    top: bookmark.scrollPosition,
    behavior: "smooth",
  });

  // 尝试通过文本搜索定位并高亮
  if (bookmark.searchText && !currentPdf) {
    setTimeout(() => {
      highlightAndScrollToText(bookmark.searchText);
    }, 500);
  }
}

// 在文档中查找并高亮文本
function highlightAndScrollToText(searchText) {
  if (!searchText) return;

  // 移除之前的临时高亮
  document.querySelectorAll(".bookmark-highlight-temp").forEach((el) => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });

  // 在文档内容中搜索文本
  const walker = document.createTreeWalker(
    documentViewer,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    const index = text.indexOf(searchText.substring(0, 50));
    if (index !== -1) {
      // 找到匹配，创建高亮
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, Math.min(index + searchText.length, text.length));

      const highlight = document.createElement("span");
      highlight.className = "bookmark-highlight-temp";
      highlight.style.cssText =
        "background: #ffeb3b; padding: 2px; border-radius: 2px; transition: background 2s;";

      try {
        range.surroundContents(highlight);
        highlight.scrollIntoView({ behavior: "smooth", block: "center" });

        // 3秒后移除高亮
        setTimeout(() => {
          highlight.style.background = "transparent";
          setTimeout(() => {
            const parent = highlight.parentNode;
            if (parent) {
              parent.replaceChild(
                document.createTextNode(highlight.textContent),
                highlight
              );
              parent.normalize();
            }
          }, 500);
        }, 3000);
      } catch (e) {
        console.log("无法高亮文本:", e);
      }
      return;
    }
  }
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
  // 应用所有已保存的高亮（仅对非PDF文档生效）
  if (currentPdf) return;

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
