const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    titleBarStyle: "hiddenInset",
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
  try {
    const notesPath = path.join(app.getPath("userData"), "notes.json");
    let notes = {};

    if (fs.existsSync(notesPath)) {
      notes = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
    }

    notes[data.filePath] = data.notes;
    fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));

    return { success: true };
  } catch (error) {
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
