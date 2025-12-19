const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    title: "ReadHelper - 文档阅读助手",
  });

  mainWindow.loadFile("index.html");

  // 开发模式下打开开发者工具
  // mainWindow.webContents.openDevTools();

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开文档",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            openDocument();
          },
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        {
          label: "切换开发者工具",
          accelerator: "Alt+CmdOrCtrl+I",
          role: "toggleDevTools",
        },
        { type: "separator" },
        { label: "实际大小", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "放大", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox({
              title: "关于 ReadHelper",
              message: "ReadHelper v1.0.0",
              detail: "一个功能强大的文档阅读助手\n支持翻译、记录和标记功能",
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function openDocument() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "所有支持的文件", extensions: ["pdf", "txt", "md", "html"] },
      { name: "PDF文件", extensions: ["pdf"] },
      { name: "文本文件", extensions: ["txt"] },
      { name: "Markdown文件", extensions: ["md"] },
      { name: "HTML文件", extensions: ["html"] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    mainWindow.webContents.send("file-opened", filePath);
  }
}

// IPC 处理
// 监听渲染进程的文件打开请求
ipcMain.on("open-file-dialog", async () => {
  await openDocument();
});

// 使用 Poppler 的 pdftotext 提取 PDF 文本
ipcMain.handle("extract-pdf-text", async (event, filePath) => {
  try {
    const { execSync } = require("child_process");

    // 使用 pdftotext 提取文本，-layout 保持原始布局
    const text = execSync(`pdftotext -layout "${filePath}" -`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    return { text, success: true };
  } catch (error) {
    console.error("Poppler extraction failed:", error.message);
    return { error: error.message, success: false };
  }
});

// 获取 PDF 页数
ipcMain.handle("get-pdf-page-count", async (event, filePath) => {
  try {
    const { execSync } = require("child_process");

    // 使用 pdfinfo 获取页数
    const info = execSync(`pdfinfo "${filePath}"`, {
      encoding: "utf-8",
    });

    const pageMatch = info.match(/Pages:\s+(\d+)/);
    const pageCount = pageMatch ? parseInt(pageMatch[1], 10) : 0;

    return { pageCount, success: true };
  } catch (error) {
    return { pageCount: 0, success: false, error: error.message };
  }
});

// 提取指定页的 PDF 文本
ipcMain.handle("extract-pdf-page-text", async (event, filePath, pageNum) => {
  try {
    const { execSync } = require("child_process");

    // 使用 pdftotext 提取指定页的文本
    const text = execSync(
      `pdftotext -f ${pageNum} -l ${pageNum} -layout "${filePath}" -`,
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return { text, success: true };
  } catch (error) {
    return { text: "", success: false, error: error.message };
  }
});

// 提取 PDF 指定区域的文本
ipcMain.handle(
  "extract-pdf-region-text",
  async (event, filePath, pageNum, x, y, width, height) => {
    try {
      const { execSync } = require("child_process");

      // 使用 pdftotext 的 -x, -y, -W, -H 参数提取指定区域
      // 注意：pdftotext 的坐标系是从左上角开始的
      const text = execSync(
        `pdftotext -f ${pageNum} -l ${pageNum} -x ${Math.round(
          x
        )} -y ${Math.round(y)} -W ${Math.round(width)} -H ${Math.round(
          height
        )} -layout "${filePath}" -`,
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      return { text: text.trim(), success: true };
    } catch (error) {
      return { text: "", success: false, error: error.message };
    }
  }
);

ipcMain.handle("read-file", async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();

    // PDF 文件返回原始数据供 PDF.js 渲染
    if (ext === ".pdf") {
      const dataBuffer = fs.readFileSync(filePath);
      // 转换为 Uint8Array 格式
      return {
        rawData: Array.from(new Uint8Array(dataBuffer)),
        ext,
        filePath,
        isPdf: true,
      };
    }

    // 读取文件的原始buffer
    const buffer = fs.readFileSync(filePath);

    // 尝试检测编码并转换
    let content;

    // 检查是否有BOM标记
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      // UTF-8 with BOM
      content = buffer.toString("utf-8").slice(1);
    } else if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      // UTF-16 LE
      content = buffer.toString("utf16le").slice(1);
    } else {
      // 尝试 UTF-8
      content = buffer.toString("utf-8");

      // 检查是否有乱码（检测是否含有替换字符）
      if (content.includes("\uFFFD") || hasGarbledText(content)) {
        // 可能是 GBK/GB2312 编码，尝试使用 iconv-lite
        try {
          const iconv = require("iconv-lite");
          content = iconv.decode(buffer, "gbk");
        } catch (e) {
          // 如果 iconv-lite 不可用，继续使用 UTF-8
          content = buffer.toString("utf-8");
        }
      }
    }

    return { content, ext, filePath };
  } catch (error) {
    return { error: error.message };
  }
});

// 检测是否有乱码的辅助函数
function hasGarbledText(text) {
  // 检查文本中是否有常见的乱码模式
  const garbledPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  return garbledPattern.test(text);
}

ipcMain.handle("save-notes", async (event, data) => {
  console.log("save-notes called with:", data?.filePath);
  try {
    if (!data || !data.filePath) {
      return { error: "Invalid data: filePath is required" };
    }

    const notesPath = path.join(app.getPath("userData"), "notes.json");
    let notes = {};

    if (fs.existsSync(notesPath)) {
      notes = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
    }

    notes[data.filePath] = data.notes || [];
    fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));

    console.log("Notes saved successfully");
    return { success: true };
  } catch (error) {
    console.error("save-notes error:", error);
    return { error: error.message };
  }
});

ipcMain.handle("load-notes", async (event, filePath) => {
  try {
    const notesPath = path.join(app.getPath("userData"), "notes.json");

    if (!fs.existsSync(notesPath)) {
      return { notes: [] };
    }

    const allNotes = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
    return { notes: allNotes[filePath] || [] };
  } catch (error) {
    return { error: error.message };
  }
});

// 保存书签
ipcMain.handle("save-bookmarks", async (event, data) => {
  console.log("save-bookmarks called with:", data?.filePath);
  try {
    if (!data || !data.filePath) {
      return { error: "Invalid data: filePath is required" };
    }

    const bookmarksPath = path.join(app.getPath("userData"), "bookmarks.json");
    let bookmarks = {};

    if (fs.existsSync(bookmarksPath)) {
      bookmarks = JSON.parse(fs.readFileSync(bookmarksPath, "utf-8"));
    }

    bookmarks[data.filePath] = data.bookmarks || [];
    fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarks, null, 2));

    console.log("Bookmarks saved successfully");
    return { success: true };
  } catch (error) {
    console.error("save-bookmarks error:", error);
    return { error: error.message };
  }
});

// 加载书签
ipcMain.handle("load-bookmarks", async (event, filePath) => {
  try {
    const bookmarksPath = path.join(app.getPath("userData"), "bookmarks.json");

    if (!fs.existsSync(bookmarksPath)) {
      return { bookmarks: [] };
    }

    const allBookmarks = JSON.parse(fs.readFileSync(bookmarksPath, "utf-8"));
    return { bookmarks: allBookmarks[filePath] || [] };
  } catch (error) {
    return { error: error.message };
  }
});

// ===== 文档历史记录功能 =====
const historyFilePath = path.join(app.getPath("userData"), "history.json");
const MAX_HISTORY_ITEMS = 50; // 最多保存50条历史

// 获取历史记录
ipcMain.handle("get-history", async () => {
  try {
    if (!fs.existsSync(historyFilePath)) {
      return { history: [] };
    }
    const history = JSON.parse(fs.readFileSync(historyFilePath, "utf-8"));
    return { history };
  } catch (error) {
    console.error("Failed to load history:", error);
    return { history: [], error: error.message };
  }
});

// 添加历史记录
ipcMain.handle("add-history", async (event, item) => {
  try {
    let history = [];
    if (fs.existsSync(historyFilePath)) {
      history = JSON.parse(fs.readFileSync(historyFilePath, "utf-8"));
    }

    // 移除相同路径的旧记录（避免重复）
    history = history.filter((h) => h.filePath !== item.filePath);

    // 添加新记录到开头
    history.unshift({
      filePath: item.filePath,
      fileName: item.fileName,
      fileType: item.fileType,
      openedAt: item.openedAt || new Date().toISOString(),
      lastPosition: item.lastPosition || null,
    });

    // 限制历史数量
    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS);
    }

    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
    return { success: true, history };
  } catch (error) {
    console.error("Failed to add history:", error);
    return { success: false, error: error.message };
  }
});

// 更新历史记录（如更新最后阅读位置）
ipcMain.handle("update-history", async (event, filePath, updates) => {
  try {
    if (!fs.existsSync(historyFilePath)) {
      return { success: false, error: "No history file" };
    }

    let history = JSON.parse(fs.readFileSync(historyFilePath, "utf-8"));
    const index = history.findIndex((h) => h.filePath === filePath);

    if (index !== -1) {
      history[index] = { ...history[index], ...updates };
      fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
      return { success: true };
    }

    return { success: false, error: "Item not found" };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 删除单条历史记录
ipcMain.handle("delete-history-item", async (event, filePath) => {
  try {
    if (!fs.existsSync(historyFilePath)) {
      return { success: true, history: [] };
    }

    let history = JSON.parse(fs.readFileSync(historyFilePath, "utf-8"));
    history = history.filter((h) => h.filePath !== filePath);
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));

    return { success: true, history };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 清除所有历史记录
ipcMain.handle("clear-history", async () => {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 检查文件是否存在
ipcMain.handle("check-file-exists", async (event, filePath) => {
  return fs.existsSync(filePath);
});

// 保存配置
ipcMain.handle("save-config", async (event, configData) => {
  try {
    const configPath = path.join(__dirname, "config.json");
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Failed to save config:", error);
    return { success: false, error: error.message };
  }
});

// 加载配置
ipcMain.handle("load-config", async () => {
  try {
    const configPath = path.join(__dirname, "config.json");
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf-8");
      return { success: true, config: JSON.parse(data) };
    }
    return { success: true, config: {} };
  } catch (error) {
    console.error("Failed to load config:", error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
