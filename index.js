#!/usr/bin/env node
var argv = require('minimist')(process.argv, {
    'string': ['input', 'lat', 'lon', 'help', 'tag'],
    'integer': ['tol'],
});

var input = {};

if (argv._.length === 3) {
    input = require(argv._[2]);
    input.tol = argv.tol ? argv.tol : 0.100;
} else if (argv.help || !argv.input || !argv.lat || !argv.lon || !argv.tag) {
    console.error('./index.js --input CSV|HTTP --lat COL --lon COL --tag KEY:VALUE [--tol TOL]');
    console.error('./index.js JSON [--tol TOL]');
    process.exit();
} else {
    input = {
        'lon': argv.lon,
        'lat': argv.lat,
        'input': argv.input,
        'tag': argv.tag,
        'tol': argv.tol ? argv.tol : 0.100
    };
}

var request = require('request'),
    fs = require('fs'),
    readline = require('readline'),
    turf = require('turf'),
    cover = require('tile-cover'),
    async = require('async'),
    stream = require('stream');

var tag =  { key: input.tag.split(':')[0], value: input.tag.split(':')[1]};
var overpass = 'http://overpass-api.de/api/interpreter?data=';

var collection = [],
    osmcollection = [];
var fc, osmfc;

if (input.input.indexOf('http') !== -1) {
    console.error('Downloading data');
    var output = fs.createWriteStream('/tmp/ingester.csv');
    request(input.input).pipe(output);
    output.on('close', function () {
        input.input='/tmp/ingester.csv';
        getData();
    });
} else getData();

function getData() {
    var fileInput = fs.createReadStream(input.input);
    var lon, lat;
    var head = true;

    var rl = readline.createInterface({
        input: fileInput,
        output: new stream()
    });

    rl.on('line', function (line) {
        if (head) {
            line.split(',').forEach(function(col, i) {
                if (input.lon.toLowerCase() === col.toLowerCase()) lon = i;
                else if (input.lat.toLowerCase() === col.toLowerCase()) lat = i;
            });
            if (!lat || !lon) throw new Error('Could not determine lat/lon cols');
            head = !head;
        } else {
            var lonRow = parseFloat(line.split(',')[lon]),
                latRow = parseFloat(line.split(',')[lat]);
            if (lonRow > -180 || lonRow < 180 || latRow > -85 || latRow < 85 || (lonRow !== 0 && latRow !== 0))
                collection.push(turf.point([lonRow, latRow]));
            else console.error('Invalid GEOM skipped');
        }
    });
    rl.on('close', getOSM);
}

function getOSM() {
    fc = turf.featurecollection(collection);
    var envelope = turf.envelope(fc);
    console.error('Creating tiles');
    var tiles = cover.geojson(envelope.geometry, { min_zoom: 7, max_zoom: 7 });
    var urls = [];

    async.each(tiles.features, function(feat) {
        var bbox = turf.extent(feat);
        var query = overpass + encodeURIComponent('[out:json][timeout:10];(node[' + tag.key +  '=' + tag.value + ']('+bbox[1]+','+bbox[0]+','+bbox[3]+','+bbox[2]+'););out body;>;out skel qt;');
        urls.push(query);
    });
    console.error('Number of requests: ' + urls.length);
    
    var attempts = 0;
    function issueRequest(address, next) {
        console.error('issuing request for ' + address);
        request(address, function(err, res, body) {
            if (err || res.statusCode !== 200) {
                console.error(body);
                console.error('Request failed...retrying');
                attempts++;
                if (attempts < 6) issueRequest();
                else next();
            } else {
                console.error('request returned');
                JSON.parse(body).elements.forEach(function(osmfeat) {
                    osmcollection.push(turf.point([osmfeat.lon, osmfeat.lat]));
                });
                attempts = 0;
                setTimeout(next, 200)
            }
        });
    }
    var q = require('queue-async')(1);
    urls.forEach(function(t) { q.defer(issueRequest, t); });
    q.await(diff);
}

function diff() {
    osmfc = turf.featurecollection(osmcollection);
    console.log('LON,LAT');
    fc.features.forEach(function(pt) {
        var nearest = turf.nearest(pt, osmfc);
        if (turf.distance(pt, nearest, 'kilometers') > input.tol)
            console.log(pt.geometry.coordinates.join(','));
    });
}
