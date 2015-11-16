// jshint node: true
'use strict';

var _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    sync = require('child_process').spawnSync,
    spawn = require('child_process').spawn,
    R = require('ramda'),
    mkdir = require('mkdirp'),
    Logger = require('./Logger'),
    utils = require('./utils'),
    PROJECT_CONFIG = 'webgme-setup.json';

var BaseManager = function(logger) {
    this._logger = logger || new Logger();
};

BaseManager.prototype.start = function (callback) {
    this._logger.write('Installing dependencies...');
    var result = sync('npm', ['install']).output[0];

    if (result) {
        this._logger.error('Installation failed: ' + result);
        callback(result);
    }

    this._logger.write('Starting app...');
    // Set this up to pass through to stdout
    var app = spawn('npm', ['start']);
    app.stdout.pipe(process.stdout);
    app.stderr.pipe(process.stderr);
    app.on('close', callback);
};

BaseManager.prototype.init = function (args, callback) {  // Create new project
    var project,
        name,
        err;

    project = path.resolve(args.name || process.cwd());
    name = path.basename(project).toLowerCase();
    this._logger.info('Creating new project at '+project);

    if (!args.name) {  // Creating in current directory
        // Check if the project contains webgme-setup.json file
        var setupJsonPath = path.join(process.cwd(), PROJECT_CONFIG);
        if (fs.existsSync(setupJsonPath)) {
            err = 'Cannot create project here. Project already exists.';
            this._logger.error(err);
            return callback(err);
        }
    } else {  // Check that the target directory doesn't exist
        if (fs.existsSync(project)) {
            err = 'Cannot create '+args.name+'. File exists.';
            this._logger.error(err);
            return callback(err);
        }
    }

    mkdir(project, function(err) {
        if (err) {
            this._logger.error('Error: '+err);
            return callback(err);
        }

        // Create the package.json
        this._createPkgJson(project, name);

        // Create the base directories
        BaseManager._createBasicFileStructure(project);

        // Create the webgme files
        this._createWebGMEFiles(project);

        // Create the project info file
        var webgmeInfo = {
            components: {},
            dependencies: {}
        };
        fs.writeFileSync(path.join(project, PROJECT_CONFIG), JSON.stringify(webgmeInfo, null, 2));
        utils.updateWebGMEConfig(project);

        this._logger.write('Created project at '+project+'.\n\n'+
        'Please run \'npm init\' from the within project to finish configuration.');
        callback();
    }.bind(this));
};

BaseManager.prototype._createPkgJson = function(project, name) {
    var pkgJsonTemplatePath = path.join(__dirname, 'res', 'package.template.json'),
        pkgJsonTemplate = _.template(fs.readFileSync(pkgJsonTemplatePath)),
        toolJsonPath = path.join(__dirname, '..', 'package.json'),
        toolJson = require(toolJsonPath),
        pkgContent = {
            webgmeVersion: toolJson.dependencies.webgme,
            name: name
        },
        outputPkgJson = path.join(project, 'package.json'),
        originalPkgJson = {},
        newPkgJson = JSON.parse(pkgJsonTemplate(pkgContent)),
        pkgJson;

    // Load existing package.json, if exists
    if (fs.existsSync(outputPkgJson)) {
        originalPkgJson = require(outputPkgJson);
        // We will remove the require cache for the package.json since
        // we are changing it now
        delete require.cache[require.resolve(outputPkgJson)];
    }
    pkgJson = _.extend({}, originalPkgJson, newPkgJson);

    // Copy the dev and regular dependencies separately (_.extend is shallow)
    pkgJson.dependencies = _.extend(
        originalPkgJson.dependencies || {},
        newPkgJson.dependencies
    );
    pkgJson.devDependencies = _.extend(
        originalPkgJson.devDependencies || {},
        newPkgJson.devDependencies
    );

    this._logger.info('Writing package.json to ' + outputPkgJson);

    fs.writeFileSync(outputPkgJson, JSON.stringify(pkgJson, null, 2));
};

BaseManager._createBasicFileStructure = function(project) {
    var dirs = ['src', 'test'];

        dirs.forEach(function(dir) {
            var absDir = path.join(project, dir);
            fs.mkdirSync(absDir);
        });
};

BaseManager.prototype._createWebGMEFiles = function(project) {
    // Create webgme config info
    var configDir = path.join(project, 'config');

    // Config files
    fs.mkdirSync(configDir);
    fs.readdirSync(path.join(__dirname, 'res', 'config'))
        .map(R.pipe(R.nthArg(0), path.join.bind(path, 'config')))  // Add 'config/' for each
        .forEach(BaseManager._copyFileToProject.bind(null, project, ''));

    // Create app.js
    BaseManager._copyFileToProject(project, '', 'app.js');

    // Create test fixtures
    BaseManager._copyFileToProject(project, 'test', 'globals.js');

    // Create .gitignore
    BaseManager._weakCopyFileToProject(project, '', '.gitignore');
};

/**
 * Copy the file to the project if the file doesn't already exist
 *
 * @param {String} project
 * @param {String} subPath
 * @param {String} filename
 * @return {undefined}
 */
BaseManager._weakCopyFileToProject = function(project, subPath, filename) {
    try {
        fs.statSync(path.join(project, subPath, filename));
    } catch (err) {
        if (err.code === 'ENOENT') {  // File doesn't exist
            BaseManager._copyFileToProject(project, subPath, filename);
        }
    }
};

BaseManager._copyFileToProject = function(project, subPath, filename) {
    var boilerplatePath,
        dstPath;

    subPath = subPath || '';
    boilerplatePath = path.join(__dirname, 'res', filename);
    dstPath = path.join(project, subPath, filename);

    fs.createReadStream(boilerplatePath)
        .pipe(fs.createWriteStream(dstPath));
};

module.exports = BaseManager;
