/**
 * Module dependencies.
 */

var debug = require('debug')('koa:application');
var Emitter = require('events').EventEmitter;
var compose = require('koa-compose');
var isJSON = require('koa-is-json');
var response = require('./response');
var context = require('./context');
var request = require('./request');
var finished = require('finished');
var Cookies = require('cookies');
var accepts = require('accepts');
var status = require('statuses');
var assert = require('assert');
var Stream = require('stream');
var http = require('http');
var only = require('only');
var co = require('co');
var utils = require('utilities');

/**
 * Application prototype.
 */

var app = Application.prototype;

/**
 * Expose `Application`.
 */

exports = module.exports = Application;

/**
 * Initialize a new `Application`.
 *
 * @api public
 */

function Application() {
  if (!(this instanceof Application)) return new Application;
  this.env = process.env.NODE_ENV || 'development';
  this.subdomainOffset = 2;
  this.poweredBy = true;
  this.middleware = [];
  this.context = Object.create(context);
  this.request = Object.create(request);
  this.response = Object.create(response);
}

/**
 * Inherit from `Emitter.prototype`.
 */

Application.prototype.__proto__ = Emitter.prototype;

/**
 * Shorthand for:
 *
 *    http.createServer(app.callback()).listen(...)
 *
 * @param {Mixed} ...
 * @return {Server}
 * @api public
 */

app.listen = function(){
  debug('listen');
  var server = http.createServer(this.callback());
  return server.listen.apply(server, arguments);
};

/**
 * Return JSON representation.
 *
 * @return {Object}
 * @api public
 */

app.toJSON = function(){
  return only(this, [
    'subdomainOffset',
    'poweredBy',
    'env'
  ]);
};

/**
 * Use the given middleware `fn`.
 *
 * @param {GeneratorFunction} fn
 * @return {Application} self
 * @api public
 */

app.use = function(fn){
  assert('GeneratorFunction' == fn.constructor.name, 'app.use() requires a generator function');
  debug('use %s', fn._name || fn.name || '-');
  this.middleware.push(fn);
  return this;
};

/**
 * Return a request handler callback
 * for node's native http server.
 *
 * @return {Function}
 * @api public
 */

app.callback = function(){
  var mw = [respond].concat(this.middleware);
  var gen = compose(mw);
  var fn = co(gen);
  var self = this;

  if (!this.listeners('error').length) this.on('error', this.onerror);

  return function(req, res){
    res.statusCode = 404;
    var ctx = self.createContext(req, res);
    finished(ctx, ctx.onerror);
    fn.call(ctx, ctx.onerror);
  }
};

// dispatcher
function Dispatcher() {

}

Dispatcher.prototype = {
    constructor: Dispatcher,

    then: function(fn) {
        // get task and task data
        fn.call(this, data);
    }
};

/**
 * Initialize a new context.
 *
 * @api private
 */

function _Context(app, req, res) {

    var request = this.request = Object.create(app.request);
    var response = this.response = Object.create(app.response);

    this.app = request.app = response.app = app;
    this.req = request.req = response.req = req;
    this.res = request.res = response.res = res;

    request.ctx = response.ctx = this;
    request.response = response;
    response.request = request;

    this.onerror = this.onerror.bind(this);
    this.originalUrl = request.originalUrl = req.url;
    this.cookies = new Cookies(req, res, app.keys);
    this.accept = request.accept = accepts(req);

    this._tasks = {};
}

_Context.prototype = Object.create(context);
_Context.prototype.constructor = _Context;

utils.mixin(_Context.prototype, Emitter.prototype, true);

utils.mixin(_Context.prototype, {
    write: function(chunk, encoding, callback) {
        this.status = 200;
        return this.res.write(chunk, encoding, callback);
    },

    end: function(data, encoding, callback) {
        return this.res.end(data, encoding, callback);
    },

    assign: function() {
        // 执行中任务计数器
        this._taskCounter = (this._taskCounter || 0) + 1;

        this.respond = false;
        this._chunked = true;

        var ctx = this;
        var taskName = arguments[0];
        var argsLength = arguments.length;
        var requirement = Array.prototype.slice.call(arguments, 1, -1)[0] || [];
        var fn = arguments[argsLength - 1];

        // 任务队列
        var _tasks = this._tasks = this._tasks || {};

        // 注册任务
        _tasks[taskName] = {
            // 任务名称
            name: taskName,
            // 依赖列表
            requirement: requirement,
            // 任务结果
            completed: null
        };

        function isCompleted(rs) {
            var context = ctx;
            var _tasks = context._tasks;
            var requirementCompleted = true;

            rs.every(function(v) {
                if (!_tasks[v].completed) {
                    requirementCompleted = false;
                    return false;
                }
                return true;
            });
            return requirementCompleted;
        }

        var _cb = function(err) {
            // 请求对象
            var context = ctx;
            // 当前任务名称
            var name = taskName;
            // 任务队列
            var _tasks = context._tasks;
            // 当前任务
            var curTask = _tasks[name];
            // 依赖列表
            var requirement = curTask.requirement;
            // 任务回调
            var callback = curTask.callback;
            // 当前任务返回的结果
            var results = null;
            if (err) {
                results = {
                    error: err,
                    data: null
                };
            } else {
                results = {
                    error: null,
                    data: callback.apply(context, Array.prototype.slice.call(arguments, 0)) || 
                        Array.prototype.slice.call(arguments, 1)
                };
            }

            // 保存结果
            curTask.completed = results;
            // 发送通知
            context.emit(name);

            context._taskCounter--;
            !context._taskCounter && context.end();
        };

        // 有依赖
        if (requirement.length) {
            requirement.forEach(function(v, k, a) {
                // 添加监听器
                ctx.on(v, function() {
                    var requirement = a;
                    // 检查依赖是否全部就绪
                    if (isCompleted(requirement)) {
                        // 拼装依赖任务返回的结果
                        var finalData = {};
                        requirement.forEach(function(val, key) {
                            var _tasks = ctx._tasks;
                            finalData[val] = _tasks[val].completed;
                        });
                        // 执行异步任务
                        fn.call(ctx, finalData, _cb);
                    }
                });
            });
        } else {
            // 执行异步任务
            fn.call(this, _cb);
        }

        // 当前任务
        this._curTask = taskName;
        return this;
    },

    then: function(fn) {
        // 注册任务的回调函数
        this._tasks[this._curTask].callback = fn;

        // 释放内存
        this._curTask = null;

        return this;
    }
});

app.createContext = function(req, res){
    return  new _Context(this, req, res);
  /* Version 0.8.1
  var request = context.request = Object.create(this.request);
  var response = context.response = Object.create(this.response);
  context.app = request.app = response.app = this;
  context.req = request.req = response.req = req;
  context.res = request.res = response.res = res;
  request.ctx = response.ctx = context;
  request.response = response;
  response.request = request;
  context.onerror = context.onerror.bind(context);
  context.originalUrl = request.originalUrl = req.url;
  context.cookies = new Cookies(req, res, this.keys);
  context.accept = request.accept = accepts(req);
  return context;
  */
};

/**
 * Default error handler.
 *
 * @param {Error} err
 * @api private
 */

app.onerror = function(err){
  assert(err instanceof Error, 'non-error thrown: ' + err);

  if (404 == err.status) return;
  if ('test' == this.env) return;

  var msg = err.stack || err.toString();
  console.error();
  console.error(msg.replace(/^/gm, '  '));
  console.error();
};

/**
 * Response middleware.
 */

function *respond(next) {
  if (this.app.poweredBy) this.set('X-Powered-By', 'koa');

  yield *next;

  // allow bypassing koa
  if (false === this.respond) return;

  var res = this.res;
  if (res.headersSent || !this.writable) return;

  var body = this.body;
  var code = this.status;

  // ignore body
  if (status.empty[code]) {
    // strip headers
    this.body = null;
    return res.end();
  }

  if ('HEAD' == this.method) {
    if (isJSON(body)) this.length = Buffer.byteLength(JSON.stringify(body));
    return res.end();
  }

  // status body
  if (null == body) {
    this.type = 'text';
    body = status[code];
    if (body) this.length = Buffer.byteLength(body);
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if ('string' == typeof body) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  this.length = Buffer.byteLength(body);
  res.end(body);
}
