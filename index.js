#!/usr/bin/env node
var request = require('request');
var fs = require('fs');
var parseArgs = require('minimist');
var readline = require('readline');
var turf = require('turf');
var cover = require('tile-cover');
var async = require('async');

var overpass = "http://overpass-api.de/api/interpreter?data=";

var argv = require('minimist')(process.argv, {
    'string': ['input', 'lat', 'lon', 'help'],
    'integer': ['tol'],
    'boolean': ['--signals', '--stops']
});

if (argv.help) console.log('index.js --input file.csv --x col-name --y col-name');
if (!argv.input) throw new Error('--input argument required');
if (!argv.lat) throw new Error('--x argument required');
if (!argv.lon) throw new Error('--y argument required');

var tol = argv.tol ? argv.tol : 50;
var tag = argv.signals ? { key: "highway", value: "traffic_signals" } : { key: "highway", value: "stop" };
var head = true;
var fileInput = fs.createReadStream(argv.input);
var fileOutput = fs.createWriteStream('./out.csv');
var lon, lat,
    collection = [];
    osmcollection = [];

var rl = readline.createInterface({
    input: fileInput, 
    output: fileOutput
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
            console.log(bbox)
            if (err || res.statusCode !== 200) cb(new Error("Overpass Query Failed!"));
            body.elements.forEach(function(feat) {
                osmcollection.push(turf.point(feat.lon, feat.lat));
            }); 
        });
    }, function(err) {
        if (err) throw err;
        console.log(osmcollection);
    });
}
