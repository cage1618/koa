
/**
 * Module dependencies.
 */

var delegate = require('delegates');
var assert = require('assert');
var http = require('http');
var assert = require('assert');
var path = require('path');
var isJSON = require('koa-is-json');
var status = require('statuses');
var Stream = require('stream');

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
        if (null == err) { return; }

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

    /*
     * 检查任务状态
     * @param {Array} 任务列表
     */
    _isCompleted: function(requires) {
        var _tasks = this._tasks;
        var completed = true;

        requires.every(function(name) {
            if (!_tasks[name].completed) {
                completed = false;
                return false;
            }
            return true;
        });
                 
        return completed;
    },

    /*
     * 注册一个任务
     * @param {String} 任务名
     * @param {Array} 依赖列表
     * @param {Function} 任务
     * @api public
     */
    assign: function(taskName, requires, fn, flag) {
        // 执行中任务计数器

        var ctx = this;
        var argslen = arguments.length;

        if (argslen < 3) {
            fn = requires;
            requires = [];
        } else {
            if ('function' === typeof requires) {
                flag = fn;
                fn = requires;
                requires = [];
            }
        }

        // 任务队列
        var _tasks = this._tasks = this._tasks || {};

        // 注册任务
        var curTask = _tasks[taskName] = {
            // 任务结果
            completed: null,
            // 渲染模板时是否依赖此任务
            renderRequired: flag
        };

        var _cb = function(err) {
            // 当前任务名称
            var name = taskName;
            // 任务回调
            var callback = curTask.callback || function() {};
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
                    data: callback.apply(ctx, Array.prototype.slice.call(arguments, 0)) || 
                        Array.prototype.slice.call(arguments, 1)
                };
            }

            // 保存结果
            curTask.completed = results;
            // 发送通知
            ctx.emit(name);
        };

        var len = requires.length;
        // 有依赖
        if (len) {
            for (var i = len; i--;) {
                // 添加监听器
                ctx.on(requires[i], function() {
                    // 检查依赖是否全部就绪
                    if (ctx._isCompleted(requires)) {
                        var finalData = {};
                        var tn = '';
                        for (var t = len; t--;) {
                            tn = requires[t];
                            finalData[tn] = (_tasks[tn] || {})['completed'];
                        }
                        // 执行异步任务
                        process.nextTick(function() {
                            try {
                                fn.call(ctx, finalData, _cb);
                            } catch(e) {
                                console.log(e);
                            }
                        });
                    }
                });
            }
        } else {
            // 执行异步任务
            process.nextTick(function() {
                try {
                    fn.call(ctx, _cb);
                } catch(e) {
                    console.log(e);
                }
            });
        }

        // 当前任务
        this._curTask = taskName;
        return this;
    },

    /*
     * 根据不同参数，批量执行同一个任务
     * @param {Array} 参数列表
     * @param {Function} 任务
     * @param {Function} 回调
     * @api public
     * this.assign('task', function(cb) {
     *    this.map(['a.html', 'b.html'], function(item, callback) {
     *        fs.readFile(item, callback);   
     *    }, cb);
     * }).then(function(err, res) {
     *      res === a list of a.html and b.html's content
     * });
     */
    // TODO
    map: function() {
        
    },

    /*
     * 批量执行不同任务
     * @param {String} 任务名
     * @param {Array} 依赖列表
     * @param {Function} 任务
     * @api public
     * this.parallel([function(cb) {
     *     fs.readFile('a.html', cb);
     * }, function(cb) {
     *     mysql.find('id=1', cb);
     * }], cb);
     */
    // TODO
    parallel: function() {
              
    },

    then: function(fn) {
        // 注册任务的回调函数
        this._tasks[this._curTask].callback = fn;
        return this;
    },

    pipe: function(view, options) {
        assert(arguments.length > 1, 'pipe() requires at least 2 arguments');
        assert('string' === typeof view, 'The first argument must be a string');

        this._pipeCounter = (this._pipeCounter || 0) + 1;

        var ctx = this;
        var taskName = this._curTask;
        var _tasks = this._tasks;
        var curTask = _tasks[taskName];

        this.on(taskName, function() {
            if (!ctx.chunked) { return; }
            var html = ctx.app.fill(view, curTask.completed, {
                format: 'html'
            });

            var script = '<script>' +
                    '_PIPE_.emit("arrive",' + JSON.stringify({
                        id: options.id,
                        content: html
                    }) + ')' + '</script>';

            var done = function(html) {
                var res = this.res;
                this._pipeCounter--;
                this._pipeCounter ? res.write(script) : res.end(script);
            };

            if (ctx.rendered) {
                done.call(ctx, html);
            } else {
                ctx.on('rendered', function() {
                    done.call(ctx, html);
                });
            }
        });
        return this;
    },

    render: function(view, data, options) {
        var query = this.query;
        // 参数处理
        switch(arguments.length) {
            case 0:
                view = null;
                data = {};
                options = {
                    format: 'json'
                };
                break;
            case 1:
                if ('string' === typeof view && view) {
                    data = {};
                    options = {
                        format: query.format || 'html'
                    };
                } else {
                    data = view || {};
                    options = {
                        format: 'json'
                    };
                    view = null;
                }
                break;
            case 2:
                if ('string' === typeof view && view) {
                    data = data || {};
                    options = {
                        format: query.format || 'html'
                    };
                } else {
                    options = view ? data : {
                        format: 'json'
                    };
                    data = view || data || {};
                    view = null;
                }
                break;
            case 3:
            default:
                if ('string' === typeof view && view) {
                    data = data || {};    
                    options = options || {};
                    options.format = query.format || options.format || 'html';
                } else {
                    options = view ? data : {
                        format: 'json'
                    };
                    data = view || data || {};
                    view = null;
                }
        }

        var _tasks = this._tasks || {};
        var chunked = false;
        var requires = {};

        if (options.format === 'html' && (options.chunked || this.chunked || this._pipeCounter)) {
            chunked = this.chunked = true;
        } else {
            chunked = this.chunked = false;
        }

        var task = null;
        if (chunked) {
            for (var t in _tasks) {
                task = _tasks[t];
                if (task.renderRequired === true) {
                    requires[t] = task;
                }
            }
        } else {
            for (var t in _tasks) {
                task = _tasks[t];
                if (task.renderRequired !== false) {
                    requires[t] = task;
                }
            }
        }

        var done = function(view, data, options) {
            var app = this.app;

            var res = this.res;

            if (res.headersSent || !this.writable) { 
                return; 
            }

            var body = this.body = app.fill(view, data, options);
            var code = this.status;

            var chunked = this.chunked;
            var _pipeCounter = this._pipeCounter;
            if ('string' == typeof body) {
                chunked && _pipeCounter ? 
                    res.write(body + '<script>var _PIPE_=' + app._bigpipeScript + '()</script>') : 
                    res.end(body);

                this.emit('rendered');
                this.rendered = true;
                return ;
            }
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
                if (body) {
                    this.length = Buffer.byteLength(body);
                }
                return res.end(body);
            }

            if (Buffer.isBuffer(body)) {
                return res.end(body);
            }

            if (body instanceof Stream) {
                return body.pipe(res);
            }

            // body: json
            body = JSON.stringify(body);
            this.length = Buffer.byteLength(body);
            res.end(body);
        };
        
        var taskNames = [];
        for (var k in requires) {
            taskNames.push(k);
        }

        var n = '';
        var ctx = this;
        var len = taskNames.length;
        if (len) {
            for (var i = len; i--;) {
                n = taskNames[i];
                this.on(n, function() {
                    if (ctx._isCompleted(taskNames)) {
                        var task = null;
                        if ('function' === typeof data) {
                            var finalData = {};           
                            for (var t in requires) {
                                task = requires[t];
                                finalData[t] = task.completed;
                            }
                            data = data.call(ctx, finalData);
                        } else {
                            for (var t in requires) {
                                task = requires[t];
                                data[t] = task.completed;
                            }
                        }
                        // 数据处理完毕
                        done.call(ctx, view, data, options);
                    }
                });
            }
        } else {
            data = 'function' === typeof data ? data.call(this) : data;
            done.call(this, view, data, options);
        }
        return this;
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
