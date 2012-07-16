var canvas = require('/Users/vorg/node_modules/canvas/build/Release/canvas.node');
var persist = require("persist");
var type = persist.type;
var models = require('../models');
var utils = require('./api.utils');
var db = require('./api.db');
var path = require('path');

exports.get = function(req, res) {
  persist.connect(function(err, connection) {
    if(err) { throw err; }

    var options = req.originalUrl.replace("/api/get", "").split("/");
    var tagsFilter = null;

    var i = 0;
    while(options.length > 0) {
      var option = options.shift();
      if (option == "tag") {
        tagsFilter = options.shift().split("+");
      }
    }

    //limit(5) - paging
    models.Image.using(connection).orderBy('id', 'desc').include("tags").all(function(err, imagesData) {
      var images = [];
      var totalFilteredOut = 0;
      imagesData.forEach(function(imageData) {
        var image = {
          id: imageData.id,
          title: imageData.title,
          referer: imageData.referer,
          originalUrl : imageData.originalUrl,
          cachedUrl : imageData.cachedUrl,
          thumbUrl : imageData.thumbUrl,
          ratio : imageData.ratio,
          tags: []
        }
        var hasTags = 0;
        var filteredOut = false;
        imageData.tags.forEach(function(tagData) {
          if (tagsFilter && (tagsFilter.indexOf(tagData.name) !== -1)) {
            hasTags++;
          }
          image.tags.push(tagData.name);
        });

        if (tagsFilter && hasTags != tagsFilter.length) {
          filteredOut = true;
          totalFilteredOut++;
        }
        else {
          images.push(image);
        }

        if (images.length + totalFilteredOut == imagesData.length) {
            res.send(JSON.stringify(images));
        }
      });
    });
  });
};

exports.post = function(req, res) {
  var callback = req.query.callback;

  var imageData = {
    title: req.query.title || "Unknown",
    referer: req.query.referer,
    originalUrl : req.query.img,
    cachedUrl : "",
    thumbUrl : "",
    ratio : 1,
    tags: req.query.tags.split(" ")
  }

  console.log("Downloading...", imageData);

  utils.downloadAndCreateThumb(imageData.originalUrl, function(err, cachedUrl, thumbUrl, ratio) {
    imageData.cachedUrl = cachedUrl;
    imageData.thumbUrl = thumbUrl;
    imageData.ratio = ratio;

    console.log("Downloaded...", imageData);

    res.setHeader("Content-Type", "text/javascript");
    var id = -1;
    if (err != null) {
      var body = "{0}({1},{2})".format(callback, err, id);
      res.send(body);
    }
    else {
      db.saveImage(imageData, function(err) {
        var body = "{0}({1},{2})".format(callback, err || "null", id);
        res.send(body);
      })
    }
  })
}

exports.update = function(req, res) {
  var imageId = req.query.id;

  persist.connect(function(err, connection) {
    if(err) { throw err; }

    if (req.query.title) {
      models.Image.update(connection, Number(imageId), { title: req.query.title}, function(err) {
        if (err) res.send(err);
        else res.send("OK");
      });
    }
    else if (req.query.tags) {
      var updatedTags = req.query.tags.split(",");
      console.log("updatedTags", updatedTags);
      db.findTags(connection, updatedTags, function(tags, newTags) {
        function saveUpdatedImage() {
          models.Image.using(connection).where('id = ?', imageId).all(function(err, imagesData) {
            console.log("tags.length", tags.length, newTags.length);
            imagesData[0].tags = tags;
            imagesData[0].save(connection, function(err) {
              if (err) res.send(err);
              else res.send("OK " + JSON.stringify(newTags));
            });
          });
        }

        if (newTags) {
          connection.save(newTags, saveUpdatedImage);
        }
        else {
          saveUpdatedImage();
        }

      })
    }
  });

}

