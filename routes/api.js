var persist = require("persist");
var type = persist.type;
var models = require('../models');
var utils = require('./api.utils');
var db = require('./api.db');
var path = require('path');

exports.get = function(req, res) {
  persist.connect(function(err, connection) {
    if(err) {
      console.log("api.get failed")
      throw err;
    }

    var options = req.originalUrl.replace("/api/get", "").split("/");
    var tagsFilter = null;
    var searchFilter = null;

    var i = 0;
    while(options.length > 0) {
      var option = options.shift();
      if (option == "tag") {
        tagsFilter = unescape(options.shift()).split("+");
      }
       if (option == "s") {
        searchFilter = unescape('' + options.shift()).replace(/\+/g, ' ').toLowerCase();
      }
    }

    //limit(5) - paging
    models.Image.using(connection).orderBy('id', 'desc').include("tags").all(function(err, imagesData) {
      var images = [];
      var totalFilteredOut = 0;
      imagesData = imagesData || [];
      if (imagesData.length == 0) {
        res.send(JSON.stringify(images));
      };
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
        else if (searchFilter && (image.title.toLowerCase().indexOf(searchFilter) == -1 && (image.referer || '').toLowerCase().indexOf(searchFilter) == -1)) {
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
    connection.close();
  });
};

exports.post = function(req, res) {
  var callback = req.query.callback;

  var imageData = {
    title: req.query.title || "Unknown",
    referer: req.query.referer || "http://unknown",
    originalUrl : decodeURIComponent(req.query.img),
    cachedUrl : "",
    thumbUrl : "",
    ratio : 1,
    tags: (req.query.tags ? req.query.tags.split(" ") : null)
  }

  console.log(req.query);

  console.log("Downloading...", imageData);

  utils.downloadAndCreateThumb(imageData.originalUrl, function(err, cachedUrl, thumbUrl, ratio) {
    imageData.cachedUrl = cachedUrl;
    imageData.thumbUrl = thumbUrl;
    imageData.ratio = ratio;

    console.log("Downloaded...", imageData);

    res.setHeader("Content-Type", "text/javascript");
    var id = -1;
    if (err != null) {
      res.send(JSON.stringify({error:err}));
    }
    else {
      db.saveImage(imageData, function(err, imageId) {
        imageData.id = imageId;
        res.send('inspiration_callback_1234567890('+err+')');
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
    if (req.query.referer) {
      models.Image.update(connection, Number(imageId), { referer: req.query.referer}, function(err) {
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

    connection.close();
  });
}

exports.tags = function(req, res) {
  persist.connect(function(err, connection) {
    if(err) {
      console.log("api.tags failed");
      throw err;
    }

    var tagsQuery = "SELECT name, COUNT(tag_id) as count FROM images_tags it JOIN tags t ON it.tag_id = t.id GROUP BY tag_id ORDER BY COUNT(tag_id) DESC";

    connection.runSqlAll(tagsQuery, [], function(err, tags) {
      res.send(JSON.stringify(tags));
    });

    connection.close();
  });
}

exports.latest = function(req, res) {
  persist.connect(function(err, connection) {
    if(err) {
      console.log("api.latest failed");
      throw err;
    }

    var latestQuery = "SELECT thumb_url, ratio FROM images JOIN images_tags ON images.id = images_tags.image_id JOIN tags ON images_tags.tag_id = tags.id WHERE tags.name = ? ORDER BY images.id DESC LIMIT 5";

    connection.runSqlAll(latestQuery, [req.query.tag], function(err, images) {
      res.send(JSON.stringify(images));
    });

    connection.close();
  });
}

exports.delete = function(req, res) {
  db.delete(req.query.imageId, function(err, chachedImageFile, thumbImageFile) {
    utils.deleteImageFile(chachedImageFile);
    utils.deleteImageFile(thumbImageFile);
    res.send(JSON.stringify({ err: err }));
  })
}

exports.upload = function(req, res) {
  var file = req.files.file;

  var imageData = {
    title: file.name,
    referer: "",
    originalUrl : "",
    cachedUrl : "",
    thumbUrl : "",
    ratio : 1,
    tags: null
  }

  utils.copyAndCreateThumb(file, function(err, cachedUrl, thumbUrl, ratio) {
    imageData.cachedUrl = cachedUrl;
    imageData.thumbUrl = thumbUrl;
    imageData.ratio = ratio;

    console.log("Downloaded...", imageData);

    res.setHeader("Content-Type", "text/javascript");
    var id = -1;
    if (err != null) {
      console.log('ERROR upload:', err);
      var body = "({1},{2})".format(err, id);
      res.send(body);
    }
    else {
      console.log('image saved almost');
      db.saveImage(imageData, function(err, imageId) {
        console.log('image saved', imageId);
        imageData.id = imageId;
        res.send(JSON.stringify(imageData));
      })
    }
  })

  //setTimeout(function() {
  //  res.contentType('application/json');
  //  res.send({name:file.name, bla:file.path, rnd: Math.random()});
  //  res.end();
  //}, Math.floor(Math.random() * 2000));
}
