// WebTorrent Desktop server API
// - Tell auto-updaters the latest version
// - Log crash reports
// - Log telemetry
module.exports = { serve }

const bodyParser = require('body-parser')
const express = require('express')
const fs = require('fs')
const mkdirp = require('mkdirp')
const multer = require('multer')
const path = require('path')
const semver = require('semver')
const serveIndex = require('serve-index')
const url = require('url')

const auth = require('./auth')
const config = require('../config')
const secret = require('../secret')

var DESKTOP_VERSION = config.desktopVersion
var RELEASES_URL = 'https://github.com/feross/webtorrent-desktop/releases/download'

var TELEMETRY_PATH = path.join(config.logPath, 'telemetry')
var CRASH_REPORTS_PATH = path.join(config.logPath, 'crash-reports')

// Attempt to create the needed log folders
try { mkdirp.sync(TELEMETRY_PATH) } catch (err) {}
try { mkdirp.sync(CRASH_REPORTS_PATH) } catch (err) {}

function serve (app) {
  serveTelemetryAPI(app)
  serveCrashReportsAPI(app)
  serveAnnouncementsAPI(app)
  serveUpdateAPI(app)
}

// Log telemetry JSON summaries to a file, one per line
function serveTelemetryAPI (app) {
  app.post('/desktop/telemetry', bodyParser.json(), function (req, res) {
    var summary = req.body
    summary.ip = req.ip
    var summaryJSON = JSON.stringify(summary)

    var today = new Date().toISOString().substring(0, 10) // YYYY-MM-DD
    var telemetryPath = path.join(TELEMETRY_PATH, today + '.log')

    fs.appendFile(telemetryPath, summaryJSON + '\n', function (err) {
      if (err) {
        console.error('Error saving telemetry: ' + err.message)
        res.status(500)
      }
      res.end()
    })
  })

  var basicAuth = auth(secret.credentials)
  var fileServer = express.static(TELEMETRY_PATH)
  var indexServer = serveIndex(TELEMETRY_PATH)
  app.use('/desktop/telemetry', [basicAuth, indexServer, fileServer])
}

// Save electron process crash reports (from Crashpad), each in its own file
function serveCrashReportsAPI (app) {
  var upload = multer({ dest: CRASH_REPORTS_PATH }).single('upload_file_minidump')

  app.post('/desktop/crash-report', upload, function (req, res) {
    req.body.filename = req.file.filename
    var crashLog = JSON.stringify(req.body, undefined, 2)

    fs.writeFile(req.file.path + '.json', crashLog, function (err) {
      if (err) {
        console.error('Error saving crash report: ' + err.message)
        res.status(500)
      }
      res.end()
    })
  })
}

// This lets us send a message to all WebTorrent Desktop users
function serveAnnouncementsAPI (app) {
  app.get('/desktop/announcement', function (req, res) {
    res.status(204).end()
  })
}

// Tell the auto updaters when new version is available
function serveUpdateAPI (app) {
  // Deprecated: WebTorrent Desktop v0.0.0 - 0.2.0 use this update URL
  app.get('/app/update/?*', function (req, res) {
    res.redirect(301, req.url.replace('/app/', '/desktop/'))
  })

  // WebTorrent Desktop Mac auto-update endpoint
  app.get('/desktop/update', function (req, res) {
    var version = req.query.version
    logUpdateCheck({
      date: (new Date()).toString(),
      platform: req.query.platform,
      version: version,
      ip: req.ip
    })
    if (!semver.valid(version) || semver.lt(version, DESKTOP_VERSION)) {
      // Update is required. Send update JSON.
      // Response format docs: https://github.com/Squirrel/Squirrel.Mac#update-json-format
      res.status(200).send({
        name: 'WebTorrent v' + DESKTOP_VERSION,
        url: `${RELEASES_URL}/v${DESKTOP_VERSION}/WebTorrent-v${DESKTOP_VERSION}-darwin.zip`,
        version: DESKTOP_VERSION
      })
    } else {
      // No update required. User is on latest app version.
      res.status(204).end()
    }
  })

  // WebTorrent Desktop Windows auto-update endpoint
  app.get('/desktop/update/*', function (req, res) {
    var pathname = url.parse(req.url).pathname
    var file = pathname.replace(/^\/desktop\/update\//i, '')
    var fileVersion
    if (file === 'RELEASES') {
      fileVersion = DESKTOP_VERSION
      logUpdateCheck({
        date: (new Date()).toString(),
        platform: req.query.platform,
        version: req.query.version,
        ip: req.ip
      })
    } else {
      var match = /-(\d+\.\d+\.\d+)-/.exec(file)
      fileVersion = match && match[1]
    }
    if (!fileVersion) {
      return res.status(404).end()
    }
    var redirectURL = `${RELEASES_URL}/v${fileVersion}/${file}`
    res.redirect(302, redirectURL)
  })
}

function logUpdateCheck (log) {
  console.log('UPDATE CHECK: ' + JSON.stringify(log))
}