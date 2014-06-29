
/**
 * Module dependencies.
 */

var delegate = require('delegates');
var assert = require('assert');
var http = require('http');

/**
 * Context prototype.
 */

var proto = module.exports = {

  /**
   * Return JSON representation.
   *
   * Here we explicitly invoke .toJSON() on each
   * object, as iteration will otherwise fail due
   * to the getters and cause utilities such as
   * clone() to fail.
   *
   * @return {Object}
   * @api public
   */

  toJSON: function(){
    return {
      request: this.request.toJSON(),
      response: this.response.toJSON()
    }
  },

  /**
   * Throw an error with `msg` and optional `status`
   * defaulting to 500. Note that these are user-level
   * errors, and the message may be exposed to the client.
   *
   *    this.throw(403)
   *    this.throw('name required', 400)
   *    this.throw(400, 'name required')
   *    this.throw('something exploded')
   *    this.throw(new Error('invalid'), 400);
   *    this.throw(400, new Error('invalid'));
   *
   * @param {String|Number|Error} err, msg or status
   * @param {String|Number|Error} err, msg or status
   * @api public
   */

  throw: function(msg, status){
    if ('number' == typeof msg) {
      var tmp = msg;
      msg = status || http.STATUS_CODES[tmp];
      status = tmp;
    }

    var err = msg instanceof Error ? msg : new Error(msg);
    err.status = status || err.status || 500;
    err.expose = err.status < 500;
    throw err;
  },

  /**
   * Alias for .throw() for backwards compatibility.
   * Do not use - will be removed in the future.
   *
   * @param {String|Number} msg
   * @param {Number} status
   * @api private
   */

  error: function(msg, status){
    console.warn('ctx.error is deprecated, use ctx.throw');
    this.throw(msg, status);
  },

  /**
   * Default error handling.
   *
   * @param {Error} err
   * @api private
   */

  onerror: function(err){
    // don't do anything if there is no error.
    // this allows you to pass `this.onerror`
    // to node-style callbacks.
    if (null == err) return;

    assert(err instanceof Error, 'non-error thrown: ' + err);

    // delegate
    this.app.emit('error', err, this);

    // nothing we can do here other
    // than delegate to the app-level
    // handler and log.
    if (this.headerSent || !this.writable) {
      err.headerSent = true;
      return;
    }

    // unset all headers
    this.res._headers = {};

    // force text/plain
    this.type = 'text';

    // ENOENT support
    if ('ENOENT' == err.code) err.status = 404;

    // default to 500
    err.status = err.status || 500;

    // respond
    var code = http.STATUS_CODES[err.status];
    var msg = err.expose ? err.message : code;
    this.status = err.status;
    this.length = Buffer.byteLength(msg);
    this.res.end(msg);
  },
    
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
        this._tasks[this._curTask].callback = fn || function() {};

        // 释放内存
        this._curTask = null;

        return this;
    },

    pipe: function() {
          
    }
};

/**
 * Response delegation.
 */

delegate(proto, 'response')
  .method('attachment')
  .method('redirect')
  .method('remove')
  .method('vary')
  .method('set')
  .access('status')
  .access('body')
  .access('length')
  .access('type')
  .access('lastModified')
  .access('etag')
  .getter('headerSent')
  .getter('writable');

/**
 * Request delegation.
 */

delegate(proto, 'request')
  .method('acceptsLanguages')
  .method('acceptsEncodings')
  .method('acceptsCharsets')
  .method('accepts')
  .method('get')
  .method('is')
  .access('querystring')
  .access('idempotent')
  .access('socket')
  .access('search')
  .access('method')
  .access('query')
  .access('path')
  .access('url')
  .getter('subdomains')
  .getter('protocol')
  .getter('host')
  .getter('hostname')
  .getter('header')
  .getter('secure')
  .getter('stale')
  .getter('fresh')
  .getter('ips')
  .getter('ip');
