// Headless Chrome or Edge for the browser tests, via Puppeteer: CHROME_PATH, else the first one installed. Each
// launch gets a profile of its own: without one, Edge on Windows can refuse to start ("The browser is already running").
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => p && fs.existsSync(p));

module.exports = (args = []) => {
  if (!executablePath) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  return puppeteer.launch({ executablePath, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-profile-')), args });
};
