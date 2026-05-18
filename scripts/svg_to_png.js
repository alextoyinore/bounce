const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true
    }
  });

  const svgContent = fs.readFileSync(path.join(__dirname, '../resources/icon.svg'), 'utf-8');
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
          svg { width: 1024px; height: 1024px; display: block; }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  win.webContents.on('did-finish-load', () => {
    // Wait a tiny bit to ensure the SVG is fully rendered
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage();
        const buffer = image.toPNG();
        fs.writeFileSync(path.join(__dirname, '../resources/icon.png'), buffer);
        fs.writeFileSync(path.join(__dirname, '../build/icon.png'), buffer);
        console.log('Successfully generated icon.png');
        app.quit();
      } catch (err) {
        console.error('Error capturing page:', err);
        app.quit();
      }
    }, 500);
  });
});
