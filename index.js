#!/usr/bin/env node
var argv = require('minimist')(process.argv, {
    'string': ['input', 'lat', 'lon', 'help', 'tag'],
    'integer': ['tol'],
});
if (argv.help || !argv.input || !argv.lat || !argv.lon || !argv.tag) {
    console.log('./index.js --input FILE.csv --lat COL --lon COL --tag KEY:VALUE');
    process.exit();
}

var request = require('request'),
    fs = require('fs'),
    readline = require('readline'),
    turf = require('turf'),
    cover = require('tile-cover'),
    async = require('async'),
    stream = require('stream');

var overpass = "http://overpass-api.de/api/interpreter?data=";

var tol = argv.tol ? argv.tol : 0.100; //In km
var tag =  { key: argv.tag.split(':')[0], value: argv.tag.split(':')[1]};
var head = true;
var fileInput = fs.createReadStream(argv.input);
var lon, lat,
    collection = [],
    osmcollection = [];
var fc, osmfc;

var rl = readline.createInterface({
    input: fileInput, 
    output: new stream()
});

rl.on('line', function (line) {
    if (head) {
        line.split(',').forEach(function(col, i) {
            if (argv.lon.toLowerCase() === col.toLowerCase()) lon = i;
            else if (argv.lat.toLowerCase() === col.toLowerCase()) lat = i;
        });
        if (!lat || !lon) throw new Error('Could not determine lat/lon cols');
        head = !head;
    } else {
        var lonRow = parseFloat(line.split(',')[lon]),
            latRow = parseFloat(line.split(',')[lat]);
        if (lonRow > -180 || lonRow < 180 || latRow > -85 || latRow < 85 || (lonRow !== 0 && latRow !== 0)) 
            collection.push(turf.point(lonRow, latRow));
        else console.log("Invalid GEOM skipped");
    } 
});

rl.on('close', getOSM);

var query = "[out:json][timeout:25];(node[" + tag.key +  "=" + tag.value + "]({{bbox}}););out body;>;out skel qt;"

function getOSM() { 
    fc = turf.featurecollection(collection);
    envelope = turf.envelope(fc);
    tiles = cover.geojson(envelope.geometry, { min_zoom: 7, max_zoom: 7 }); 
    var queries = [];
    async.each(tiles.features, function(feat, cb) {
        var bbox = turf.extent(feat);
        var query = overpass + encodeURIComponent("[out:json][timeout:25];(node[" + tag.key +  "=" + tag.value + "]("+bbox[1]+","+bbox[0]+","+bbox[3]+","+bbox[2]+"););out body;>;out skel qt;");
        request(query, function(err, res, body) {
            if (err || res.statusCode !== 200) cb(new Error("Overpass Query Failed!\n" + body));
            JSON.parse(body).elements.forEach(function(osmfeat) {
                osmcollection.push(turf.point(osmfeat.lon, osmfeat.lat));
            }); 
            setTimeout(cb, 1000); //Respect Overpass limits
        });
    }, function(err) {
        if (err) throw err;
        else diff();
    });
}

function diff() {
    osmfc = turf.featurecollection(osmcollection);
    console.log("LON,LAT"); 
    fc.features.forEach(function(pt) {
        var nearest = turf.nearest(pt, osmfc);
        if (turf.distance(pt, nearest, "kilometers") > tol)
            console.log(pt.geometry.coordinates.join(','));
    });
}
