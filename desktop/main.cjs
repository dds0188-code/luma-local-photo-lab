const { app, BrowserWindow, shell, dialog, session } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

let mainWindow;
let updateCheckStarted = false;

// The editor works on local files and does not need browser permissions.
// Deny permission prompts by default instead of allowing accidental access.
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
});

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;
autoUpdater.logger = {
  info: (...args) => console.info("[Luma updater]", ...args),
  warn: (...args) => console.warn("[Luma updater]", ...args),
  error: (...args) => console.error("[Luma updater]", ...args),
  debug: (...args) => console.debug("[Luma updater]", ...args)
};

autoUpdater.on("update-downloaded", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Luma 업데이트 준비 완료",
    message: "새 버전을 다운로드했습니다.",
    detail: "열려 있는 작업을 저장한 뒤 지금 재시작하여 업데이트할 수 있습니다. 취소하면 앱을 종료할 때 업데이트됩니다.",
    buttons: ["지금 재시작", "나중에"],
    defaultId: 0,
    cancelId: 1
  });
  if (choice.response === 0) autoUpdater.quitAndInstall();
});

autoUpdater.on("error", error => {
  console.warn("[Luma updater] 업데이트 확인 실패:", error.message);
});

function checkForUpdates() {
  if (app.isPackaged && !updateCheckStarted) {
    updateCheckStarted = true;
    autoUpdater.checkForUpdatesAndNotify().catch(error => {
      console.warn("[Luma updater] 업데이트 확인 실패:", error.message);
      updateCheckStarted = false;
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#111214",
    title: "Luma Local Photo Lab",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only explicitly trusted HTTPS links may leave the app, and never in-app.
    if (url.startsWith("https://")) shell.openExternal(url).catch(error => {
      console.warn("[Luma navigation] 외부 링크 열기 실패:", error.message);
    });
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", event => {
    // Keep remote pages and unexpected file URLs from replacing the editor.
    event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  checkForUpdates();
  setInterval(() => {
    updateCheckStarted = false;
    checkForUpdates();
  }, 6 * 60 * 60 * 1000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
