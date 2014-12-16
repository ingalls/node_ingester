#!/usr/bin/env node
var request = require('request');
var fs = require('fs');
var parseArgs = require('minimist');
var readline = require('readline');
var turf = require('turf');
var cover = require('tile-cover');

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
var lon, lat, collection = [];

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
        collection.push(turf.point(line.split(',')[lon], line.split(',')[lat]));
    } 
});

rl.on('close', getOSM);

var query = "[out:json][timeout:25];(node[" + tag.key +  "=" + tag.value + "]({{bbox}}););out body;>;out skel qt;"

function getOSM() {
    
    fc = turf.featurecollection(collection);
    envelope = turf.envelope(fc);
    tiles = cover.geojson(envelope.geometry, { min_zoom: 6, max_zoom: 6 }); 
    console.log(tiles.features.length);

    tiles.features.forEach(function(feat) {
        var bbox = turf.extent(feat);
        var query = overpass + encodeURIComponent("[out:json][timeout:25];(node[" + tag.key +  "=" + tag.value + "](" + bbox + "););out body;>;out skel qt;");
        console.log(query);
    });
}
