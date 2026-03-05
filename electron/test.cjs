const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  });
  win.loadURL('https://www.google.com');
  console.log('Electron started successfully');
});

app.on('window-all-closed', () => {
  app.quit();
});
