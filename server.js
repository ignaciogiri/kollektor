// server.js
//
// This is the kollektor server responsible for
// - scanning given directory for existing files and their metadata
// - maintain in memory database of all files in the collection
// - serving client files for browsing your collection via web interface
// - exposing a REST API for retrieving and modifying the collection
// - watching that directory for file changes due to adding files manuall or API uploads
//
// What it doesn't do
// - sync files across multiple kollektor instances.
//   That's currently handles by 3rd party e.g. Dropbox

const commander = require('commander')
const pacakge = require('./package.json')
const express = require('express')
const debug = require('debug')
const scanDir = require('./lib/scan-dir')
const path = require('path')
const url = require('url')
const browserify = require('browserify')
const fs = require('fs')
const generateThumbnail = require('./lib/generate-thumbnail')
const endsWith = require('ends-with')

// Initialize logger
debug.enable('kollektor')
const log = debug('kollektor')

const THUMB_WIDTH = 600

// ## Command line options
//
// Server is a command line app so lets define it's interface

// We support only two options:
// - the port at which we want to run (defaults to 3000)
// - collection's directory
// Todo:
// - [ ] create folder if it doesn't exist
// - [ ] find next available port if 3000 is taken
commander
  .version(pacakge.version)
  .usage('[options] <dir>')
  .option('-p, --port [value]', 'Server port')
  .parse(process.argv)

const port = commander.port || 3000
const dir = commander.args[0]

if (!dir) {
  commander.help()
  process.exit(-1)
}

// ## Init

// Scan given folder for all images and their metadata

log(`Scanning "${dir}" for files`)
scanDir(dir, (err, items) => {
  log(`Scan complete. ${items.length} items found`)
  if (err) {
    log('ERROR', err)
    return
  }

  startServer(items)
})

// ## Server

// Now we start a web server responsible for handline API requests and serving the web interface

function startServer (items) {
  var app = express()

  // Serve root path / from public folder with static assets (html, css)
  app.use(express.static(__dirname + '/public'))

  // Client web interface code is bundled on the fly. This probably shouldn't go into production.
  app.get('/client.bundle.js', (req, res) => {
    var b = browserify()
    b.add(__dirname + '/client.js')
    b.bundle((err, buf) => {
      if (err) {
        log('Client bundle error', err)
        res.end()
      } else {
        res.send(buf)
      }
    })
  })

  // API for getting all items currently in the db
  app.get('/api/get/*', (req, res) => {
    res.send(JSON.stringify(items))
  })

  // Serve individual image files from the given path
  app.get('/images/*', (req, res) => {
    var filePath = path.relative('/images', url.parse(req.path).pathname)
    filePath = unescape(filePath)
    filePath = path.normalize(dir + '/' + filePath)
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (!err) {
        res.sendFile(filePath)
      } else {
        if (endsWith(filePath, '.thumb')) {
          var orig = filePath.substring(0, filePath.length - 6)
          var thumb = filePath
          log('Orig?', orig)
          if (fs.existsSync(orig)) {
            generateThumbnail(orig, thumb, THUMB_WIDTH, () => {
              res.sendFile(thumb)
            })
          } else {
            log('ERROR', 'No source file to make thumbnail')
            res.end()
          }
        } else {
          log('ERROR', 'Not a thumbnail')
          res.end()
        }
      }
    })
  })

  // Start the server on a given port
  app.listen(port, () => {
    log(`Starting on port http://localhost:${port}`)
  })
}
