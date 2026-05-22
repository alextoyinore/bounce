"use strict";
const require$$3 = require("electron");
const require$$0$1 = require("path");
const fs = require("fs/promises");
const require$$1$1 = require("child_process");
const require$$0 = require("tty");
const require$$1 = require("util");
const require$$3$1 = require("fs");
const require$$4 = require("net");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const is = {
  dev: !require$$3.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      require$$3.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return require$$3.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      require$$3.app.setLoginItemSettings({ openAtLogin: auto });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return require$$3.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window2, shortcutOptions) {
    if (!window2)
      return;
    const { webContents } = window2;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "KeyI" && (input.alt && input.meta || input.control && input.shift)) {
            event.preventDefault();
          }
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window2.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    require$$3.ipcMain.on("win:invoke", (event, action) => {
      const win = require$$3.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var src = { exports: {} };
var browser = { exports: {} };
var debug = { exports: {} };
var ms;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var y = d * 365.25;
  ms = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse(val);
    } else if (type === "number" && isNaN(val) === false) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
    );
  };
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
      str
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return void 0;
    }
  }
  function fmtShort(ms2) {
    if (ms2 >= d) {
      return Math.round(ms2 / d) + "d";
    }
    if (ms2 >= h) {
      return Math.round(ms2 / h) + "h";
    }
    if (ms2 >= m) {
      return Math.round(ms2 / m) + "m";
    }
    if (ms2 >= s) {
      return Math.round(ms2 / s) + "s";
    }
    return ms2 + "ms";
  }
  function fmtLong(ms2) {
    return plural(ms2, d, "day") || plural(ms2, h, "hour") || plural(ms2, m, "minute") || plural(ms2, s, "second") || ms2 + " ms";
  }
  function plural(ms2, n, name) {
    if (ms2 < n) {
      return;
    }
    if (ms2 < n * 1.5) {
      return Math.floor(ms2 / n) + " " + name;
    }
    return Math.ceil(ms2 / n) + " " + name + "s";
  }
  return ms;
}
var hasRequiredDebug;
function requireDebug() {
  if (hasRequiredDebug) return debug.exports;
  hasRequiredDebug = 1;
  (function(module, exports$1) {
    exports$1 = module.exports = createDebug.debug = createDebug["default"] = createDebug;
    exports$1.coerce = coerce;
    exports$1.disable = disable;
    exports$1.enable = enable;
    exports$1.enabled = enabled;
    exports$1.humanize = requireMs();
    exports$1.names = [];
    exports$1.skips = [];
    exports$1.formatters = {};
    var prevTime;
    function selectColor(namespace) {
      var hash = 0, i;
      for (i in namespace) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return exports$1.colors[Math.abs(hash) % exports$1.colors.length];
    }
    function createDebug(namespace) {
      function debug2() {
        if (!debug2.enabled) return;
        var self = debug2;
        var curr = +/* @__PURE__ */ new Date();
        var ms2 = curr - (prevTime || curr);
        self.diff = ms2;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; i++) {
          args[i] = arguments[i];
        }
        args[0] = exports$1.coerce(args[0]);
        if ("string" !== typeof args[0]) {
          args.unshift("%O");
        }
        var index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
          if (match === "%%") return match;
          index++;
          var formatter = exports$1.formatters[format];
          if ("function" === typeof formatter) {
            var val = args[index];
            match = formatter.call(self, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        exports$1.formatArgs.call(self, args);
        var logFn = debug2.log || exports$1.log || console.log.bind(console);
        logFn.apply(self, args);
      }
      debug2.namespace = namespace;
      debug2.enabled = exports$1.enabled(namespace);
      debug2.useColors = exports$1.useColors();
      debug2.color = selectColor(namespace);
      if ("function" === typeof exports$1.init) {
        exports$1.init(debug2);
      }
      return debug2;
    }
    function enable(namespaces) {
      exports$1.save(namespaces);
      exports$1.names = [];
      exports$1.skips = [];
      var split = (typeof namespaces === "string" ? namespaces : "").split(/[\s,]+/);
      var len = split.length;
      for (var i = 0; i < len; i++) {
        if (!split[i]) continue;
        namespaces = split[i].replace(/\*/g, ".*?");
        if (namespaces[0] === "-") {
          exports$1.skips.push(new RegExp("^" + namespaces.substr(1) + "$"));
        } else {
          exports$1.names.push(new RegExp("^" + namespaces + "$"));
        }
      }
    }
    function disable() {
      exports$1.enable("");
    }
    function enabled(name) {
      var i, len;
      for (i = 0, len = exports$1.skips.length; i < len; i++) {
        if (exports$1.skips[i].test(name)) {
          return false;
        }
      }
      for (i = 0, len = exports$1.names.length; i < len; i++) {
        if (exports$1.names[i].test(name)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) return val.stack || val.message;
      return val;
    }
  })(debug, debug.exports);
  return debug.exports;
}
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser.exports;
  hasRequiredBrowser = 1;
  (function(module, exports$1) {
    exports$1 = module.exports = requireDebug();
    exports$1.log = log;
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.storage = "undefined" != typeof chrome && "undefined" != typeof chrome.storage ? chrome.storage.local : localstorage();
    exports$1.colors = [
      "lightseagreen",
      "forestgreen",
      "goldenrod",
      "dodgerblue",
      "darkorchid",
      "crimson"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && window.process.type === "renderer") {
        return true;
      }
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 || // double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    exports$1.formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (err) {
        return "[UnexpectedJSONParseError]: " + err.message;
      }
    };
    function formatArgs(args) {
      var useColors2 = this.useColors;
      args[0] = (useColors2 ? "%c" : "") + this.namespace + (useColors2 ? " %c" : " ") + args[0] + (useColors2 ? "%c " : " ") + "+" + exports$1.humanize(this.diff);
      if (!useColors2) return;
      var c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      var index = 0;
      var lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, function(match) {
        if ("%%" === match) return;
        index++;
        if ("%c" === match) {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    function log() {
      return "object" === typeof console && console.log && Function.prototype.apply.call(console.log, console, arguments);
    }
    function save(namespaces) {
      try {
        if (null == namespaces) {
          exports$1.storage.removeItem("debug");
        } else {
          exports$1.storage.debug = namespaces;
        }
      } catch (e) {
      }
    }
    function load() {
      var r;
      try {
        r = exports$1.storage.debug;
      } catch (e) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    exports$1.enable(load());
    function localstorage() {
      try {
        return window.localStorage;
      } catch (e) {
      }
    }
  })(browser, browser.exports);
  return browser.exports;
}
var node = { exports: {} };
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return node.exports;
  hasRequiredNode = 1;
  (function(module, exports$1) {
    var tty = require$$0;
    var util = require$$1;
    exports$1 = module.exports = requireDebug();
    exports$1.init = init;
    exports$1.log = log;
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.colors = [6, 2, 3, 4, 5, 1];
    exports$1.inspectOpts = Object.keys(process.env).filter(function(key) {
      return /^debug_/i.test(key);
    }).reduce(function(obj, key) {
      var prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, function(_, k) {
        return k.toUpperCase();
      });
      var val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
      else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
      else if (val === "null") val = null;
      else val = Number(val);
      obj[prop] = val;
      return obj;
    }, {});
    var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
    if (1 !== fd && 2 !== fd) {
      util.deprecate(function() {
      }, "except for stderr(2) and stdout(1), any other usage of DEBUG_FD is deprecated. Override debug.log if you want to use a different log function (https://git.io/debug_fd)")();
    }
    var stream = 1 === fd ? process.stdout : 2 === fd ? process.stderr : createWritableStdioStream(fd);
    function useColors() {
      return "colors" in exports$1.inspectOpts ? Boolean(exports$1.inspectOpts.colors) : tty.isatty(fd);
    }
    exports$1.formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map(function(str) {
        return str.trim();
      }).join(" ");
    };
    exports$1.formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
    function formatArgs(args) {
      var name = this.namespace;
      var useColors2 = this.useColors;
      if (useColors2) {
        var c = this.color;
        var prefix = "  \x1B[3" + c + ";1m" + name + " \x1B[0m";
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push("\x1B[3" + c + "m+" + exports$1.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = (/* @__PURE__ */ new Date()).toUTCString() + " " + name + " " + args[0];
      }
    }
    function log() {
      return stream.write(util.format.apply(util, arguments) + "\n");
    }
    function save(namespaces) {
      if (null == namespaces) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = namespaces;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function createWritableStdioStream(fd2) {
      var stream2;
      var tty_wrap = process.binding("tty_wrap");
      switch (tty_wrap.guessHandleType(fd2)) {
        case "TTY":
          stream2 = new tty.WriteStream(fd2);
          stream2._type = "tty";
          if (stream2._handle && stream2._handle.unref) {
            stream2._handle.unref();
          }
          break;
        case "FILE":
          var fs2 = require$$3$1;
          stream2 = new fs2.SyncWriteStream(fd2, { autoClose: false });
          stream2._type = "fs";
          break;
        case "PIPE":
        case "TCP":
          var net = require$$4;
          stream2 = new net.Socket({
            fd: fd2,
            readable: false,
            writable: true
          });
          stream2.readable = false;
          stream2.read = null;
          stream2._type = "pipe";
          if (stream2._handle && stream2._handle.unref) {
            stream2._handle.unref();
          }
          break;
        default:
          throw new Error("Implement me. Unknown stream file type!");
      }
      stream2.fd = fd2;
      stream2._isStdio = true;
      return stream2;
    }
    function init(debug2) {
      debug2.inspectOpts = {};
      var keys = Object.keys(exports$1.inspectOpts);
      for (var i = 0; i < keys.length; i++) {
        debug2.inspectOpts[keys[i]] = exports$1.inspectOpts[keys[i]];
      }
    }
    exports$1.enable(load());
  })(node, node.exports);
  return node.exports;
}
var hasRequiredSrc;
function requireSrc() {
  if (hasRequiredSrc) return src.exports;
  hasRequiredSrc = 1;
  if (typeof process !== "undefined" && process.type === "renderer") {
    src.exports = requireBrowser();
  } else {
    src.exports = requireNode();
  }
  return src.exports;
}
var electronSquirrelStartup;
var hasRequiredElectronSquirrelStartup;
function requireElectronSquirrelStartup() {
  if (hasRequiredElectronSquirrelStartup) return electronSquirrelStartup;
  hasRequiredElectronSquirrelStartup = 1;
  var path = require$$0$1;
  var spawn = require$$1$1.spawn;
  var debug2 = requireSrc()("electron-squirrel-startup");
  var app = require$$3.app;
  var run = function(args, done) {
    var updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
    debug2("Spawning `%s` with args `%s`", updateExe, args);
    spawn(updateExe, args, {
      detached: true
    }).on("close", done);
  };
  var check = function() {
    if (process.platform === "win32") {
      var cmd = process.argv[1];
      debug2("processing squirrel command `%s`", cmd);
      var target = path.basename(process.execPath);
      if (cmd === "--squirrel-install" || cmd === "--squirrel-updated") {
        run(["--createShortcut=" + target], app.quit);
        return true;
      }
      if (cmd === "--squirrel-uninstall") {
        run(["--removeShortcut=" + target], app.quit);
        return true;
      }
      if (cmd === "--squirrel-obsolete") {
        app.quit();
        return true;
      }
    }
    return false;
  };
  electronSquirrelStartup = check();
  return electronSquirrelStartup;
}
var electronSquirrelStartupExports = requireElectronSquirrelStartup();
const squirrelStartup = /* @__PURE__ */ getDefaultExportFromCjs(electronSquirrelStartupExports);
function buildCrashWavBuffer() {
  const RATE = 44100, DURATION = 2;
  const N = Math.round(RATE * DURATION);
  const attack = Math.round(3e-3 * RATE);
  const partials = [
    [1200, 0.08],
    [3100, 0.12],
    [4700, 0.18],
    [5800, 0.22],
    [7300, 0.2],
    [9100, 0.16],
    [11400, 0.12],
    [14e3, 0.08]
  ];
  const phases = partials.map(() => 0);
  const floats = new Float32Array(N);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const env = i < attack ? i / attack : Math.exp(-5.5 * (i - attack) / (N - attack));
    let s = (Math.random() * 2 - 1) * 0.55;
    for (let p = 0; p < partials.length; p++) {
      phases[p] += 2 * Math.PI * partials[p][0] / RATE;
      s += Math.sin(phases[p]) * partials[p][1];
    }
    floats[i] = s * env;
    if (Math.abs(floats[i]) > peak) peak = Math.abs(floats[i]);
  }
  const scale = peak > 0.98 ? 0.98 / peak : 1;
  const pcm = Buffer.alloc(N * 2);
  for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, floats[i] * scale));
    const s = Math.round(v < 0 ? v * 32768 : v * 32767);
    pcm[i * 2] = s & 255;
    pcm[i * 2 + 1] = s >> 8 & 255;
  }
  const h = Buffer.alloc(44);
  const w32 = (o, v) => {
    h[o] = v & 255;
    h[o + 1] = v >> 8 & 255;
    h[o + 2] = v >> 16 & 255;
    h[o + 3] = v >> 24 & 255;
  };
  const w16 = (o, v) => {
    h[o] = v & 255;
    h[o + 1] = v >> 8 & 255;
  };
  h.write("RIFF", 0);
  w32(4, 36 + N * 2);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  w32(16, 16);
  w16(20, 1);
  w16(22, 1);
  w32(24, RATE);
  w32(28, RATE * 2);
  w16(32, 2);
  w16(34, 16);
  h.write("data", 36);
  w32(40, N * 2);
  return Buffer.concat([h, pcm]);
}
async function _isDrumKitFolder(dirPath) {
  try {
    const files = await fs__namespace.readdir(dirPath);
    const sigs = ["kick", "snare", "hihat", "hi-hat", "hat", "clap", "tom"];
    return files.some((f) => sigs.some((s) => f.toLowerCase().includes(s)));
  } catch {
    return false;
  }
}
async function _writeCrashIfMissing(dirPath, buf) {
  if (!await _isDrumKitFolder(dirPath)) return;
  const crashPath = require$$0$1.join(dirPath, "crash.wav");
  try {
    const stat = await fs__namespace.stat(crashPath);
    if (stat.size > 100) return;
  } catch {
  }
  await fs__namespace.writeFile(crashPath, buf);
  console.log(`[Main] Generated crash.wav → ${crashPath}`);
}
async function ensureCrashSamples(libraryPath) {
  try {
    const crashBuf = buildCrashWavBuffer();
    const packs = await fs__namespace.readdir(libraryPath, { withFileTypes: true });
    for (const pack of packs) {
      if (!pack.isDirectory()) continue;
      const packPath = require$$0$1.join(libraryPath, pack.name);
      await _writeCrashIfMissing(packPath, crashBuf);
      try {
        const subs = await fs__namespace.readdir(packPath, { withFileTypes: true });
        for (const sub of subs) {
          if (!sub.isDirectory()) continue;
          await _writeCrashIfMissing(require$$0$1.join(packPath, sub.name), crashBuf);
        }
      } catch {
      }
    }
  } catch {
  }
}
if (squirrelStartup) require$$3.app.quit();
const icon = require$$0$1.join(__dirname, "../../resources/icon.png");
let mainWindow = null;
let fileToOpen = null;
require$$3.app.on("open-file", (event, path) => {
  event.preventDefault();
  fileToOpen = path;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-file", path);
    fileToOpen = null;
  }
});
const gotTheLock = require$$3.app.requestSingleInstanceLock();
if (!gotTheLock) {
  require$$3.app.quit();
} else {
  require$$3.app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const path = commandLine.find((arg) => arg.endsWith(".bounce"));
      if (path) {
        mainWindow.webContents.send("open-file", path);
      }
    }
  });
  const initialPath = process.argv.find((arg) => arg.endsWith(".bounce"));
  if (initialPath) {
    fileToOpen = initialPath;
  }
}
function createWindow() {
  mainWindow = new require$$3.BrowserWindow({
    width: 1250,
    height: 720,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: require$$0$1.join(__dirname, "preload.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    require$$3.shell.openExternal(details.url);
    return { action: "deny" };
  });
  {
    mainWindow.loadURL("http://localhost:5173");
  }
  mainWindow.webContents.on("did-finish-load", () => {
    if (fileToOpen) {
      mainWindow.webContents.send("open-file", fileToOpen);
      fileToOpen = null;
    }
  });
}
require$$3.app.whenReady().then(() => {
  try {
    const docsPath = require$$3.app.getPath("documents");
    const bounceProjectsPath = require$$0$1.join(docsPath, "Bounce", "projects");
    const bounceLibraryPath = require$$0$1.join(docsPath, "Bounce", "library");
    fs__namespace.mkdir(bounceProjectsPath, { recursive: true }).catch(
      (err) => console.error("Failed to create default projects path on start:", err)
    );
    fs__namespace.mkdir(bounceLibraryPath, { recursive: true }).then(() => ensureCrashSamples(bounceLibraryPath)).catch((err) => console.error("Failed to create default library path on start:", err));
  } catch (err) {
    console.error("Failed to initialize default Bounce directories on startup:", err);
  }
  electronApp.setAppUserModelId("com.electron");
  require$$3.app.on("browser-window-created", (_, window2) => {
    optimizer.watchWindowShortcuts(window2);
  });
  require$$3.ipcMain.on("ping", () => console.log("pong"));
  require$$3.ipcMain.on("window-minimize", () => {
    const win = require$$3.BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });
  require$$3.ipcMain.on("window-maximize", () => {
    const win = require$$3.BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  require$$3.ipcMain.on("window-close", () => {
    const win = require$$3.BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });
  require$$3.ipcMain.handle("dialog:openFolder", async () => {
    const { canceled, filePaths } = await require$$3.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });
  require$$3.ipcMain.handle("fs:readDirectory", async (event, dirPath) => {
    try {
      console.log("[Main] Reading directory:", dirPath);
      const entries = await fs__namespace.readdir(dirPath, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        const fullPath = require$$0$1.join(dirPath, entry.name);
        try {
          const stats = await fs__namespace.stat(fullPath);
          if (stats.isDirectory()) {
            result.push({ name: entry.name, path: fullPath, type: "directory" });
          } else {
            const ext = require$$0$1.extname(entry.name).toLowerCase();
            if ([".wav", ".mp3", ".ogg", ".flac"].includes(ext)) {
              result.push({ name: entry.name, path: fullPath, type: "file" });
            }
          }
        } catch (e) {
          console.error(`[Main] Failed to stat ${fullPath}:`, e);
        }
      }
      console.log(`[Main] Found ${result.length} items in ${dirPath}`);
      return result;
    } catch (error) {
      console.error("[Main] Failed to read directory:", dirPath, error);
      return [];
    }
  });
  require$$3.ipcMain.handle("dialog:saveFile", async (event, defaultPath) => {
    const { canceled, filePath } = await require$$3.dialog.showSaveDialog({
      title: "Save Bounce Project",
      defaultPath: defaultPath || "Untitled.bounce",
      filters: [{ name: "Bounce Project", extensions: ["bounce"] }]
    });
    if (canceled || !filePath) return null;
    return filePath;
  });
  require$$3.ipcMain.handle("dialog:exportFile", async (event, defaultName, ext, desc) => {
    const { canceled, filePath } = await require$$3.dialog.showSaveDialog({
      title: "Export Audio Mixdown",
      defaultPath: defaultName || "Mixdown." + ext,
      filters: [{ name: desc, extensions: [ext] }]
    });
    if (canceled || !filePath) return null;
    return filePath;
  });
  require$$3.ipcMain.handle("dialog:openFile", async () => {
    const { canceled, filePaths } = await require$$3.dialog.showOpenDialog({
      title: "Open Bounce Project",
      filters: [{ name: "Bounce Project", extensions: ["bounce"] }],
      properties: ["openFile"]
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });
  require$$3.ipcMain.handle("fs:writeFile", async (event, filePath, data) => {
    try {
      if (typeof data === "string") {
        await fs__namespace.writeFile(filePath, data, "utf-8");
      } else {
        await fs__namespace.writeFile(filePath, Buffer.from(data));
      }
      return true;
    } catch (error) {
      console.error("Failed to write file:", error);
      return false;
    }
  });
  require$$3.ipcMain.handle("app:getDefaultProjectsPath", async () => {
    try {
      const docsPath = require$$3.app.getPath("documents");
      const bounceProjectsPath = require$$0$1.join(docsPath, "Bounce", "projects");
      await fs__namespace.mkdir(bounceProjectsPath, { recursive: true });
      const libraryPath = require$$0$1.join(docsPath, "Bounce", "library");
      await fs__namespace.mkdir(libraryPath, { recursive: true });
      return bounceProjectsPath;
    } catch (error) {
      console.error("Failed to get default projects path:", error);
      return require$$3.app.getPath("userData");
    }
  });
  require$$3.ipcMain.handle("app:getLibraryPath", async () => {
    try {
      const docsPath = require$$3.app.getPath("documents");
      const libraryPath = require$$0$1.join(docsPath, "Bounce", "library");
      await fs__namespace.mkdir(libraryPath, { recursive: true });
      return libraryPath;
    } catch (error) {
      console.error("Failed to get library path:", error);
      return null;
    }
  });
  require$$3.ipcMain.handle("fs:mkdir", async (event, dirPath) => {
    try {
      await fs__namespace.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error("Failed to create directory:", error);
      return false;
    }
  });
  require$$3.ipcMain.handle("fs:exists", async (event, filePath) => {
    try {
      await fs__namespace.access(filePath);
      return true;
    } catch {
      return false;
    }
  });
  require$$3.ipcMain.handle("app:getAudioPath", () => {
    if (is.dev) {
      return require$$0$1.join(require$$3.app.getAppPath(), "src/renderer/public/audio");
    }
    return require$$0$1.join(require$$3.app.getAppPath(), ".vite/renderer/main_window/audio");
  });
  require$$3.ipcMain.handle("app:installSoundPack", async () => {
    console.log("[Main] Install sound pack requested");
    const { canceled, filePaths } = await require$$3.dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Sound Pack Folder to Install"
    });
    if (canceled || filePaths.length === 0) return null;
    const srcPath = filePaths[0];
    const packName = srcPath.split(/[/\\]/).pop();
    const docsPath = require$$3.app.getPath("documents");
    const targetBase = require$$0$1.join(docsPath, "Bounce", "library");
    await fs__namespace.mkdir(targetBase, { recursive: true });
    const destPath = require$$0$1.join(targetBase, packName);
    try {
      const recursiveCopy = async (s, d) => {
        await fs__namespace.mkdir(d, { recursive: true });
        const entries = await fs__namespace.readdir(s, { withFileTypes: true });
        for (const entry of entries) {
          const sp = require$$0$1.join(s, entry.name), dp = require$$0$1.join(d, entry.name);
          if (entry.isDirectory()) await recursiveCopy(sp, dp);
          else await fs__namespace.copyFile(sp, dp);
        }
      };
      await recursiveCopy(srcPath, destPath);
      await ensureCrashSamples(destPath);
      return { success: true, name: packName };
    } catch (error) {
      console.error("Failed to install sound pack:", error);
      return { success: false, error: error.message };
    }
  });
  require$$3.ipcMain.handle("fs:readFile", async (event, filePath) => {
    try {
      return await fs__namespace.readFile(filePath);
    } catch (error) {
      console.error("Failed to read file:", error);
      return null;
    }
  });
  createWindow();
  require$$3.app.on("activate", function() {
    if (require$$3.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
require$$3.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    require$$3.app.quit();
  }
});
