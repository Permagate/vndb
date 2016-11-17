/* eslint no-unused-vars: 0 */
/* eslint class-methods-use-this: 0 */
// TODO: Remove above rules if no stubs left anymore.
const { createDeferredPromise } = require('./utils');
const { defaults, terminator, allowedOptions } = require('./vndb-constants');
const tls = require('tls');
const VNDBError = require('./vndb-error');

class VNDBClient {
  /**
   * Create a new instance of VNDB client.
   * This is purely for setting internal properties without doing anything else.
   * ALL variable properties must be initialized and commented here.
   */
  constructor() {
    /**
     * A set of default values, taken from a constants file.
     */
    this._defaults = Object.assign({}, defaults);

    /**
     * A client can only process one message at a time.
     * Any request to process a message while it's busy should be pushed into client.queue.
     * Queued messages are processed with FIFO strategy.
     */
    this.queues = [];

    /**
     * client.socket will contain an instance of tls.TLSSocket.
     */
    this.socket = null;

    /**
     * After sending message to VNDB API, this client will receive responses in chunk
     * until it is terminated. Until it does, response is appended to client.bufferedResponse.
     *
     * If client.bufferedResponse is null, it is a good indication that the client is idle.
     */
    this.bufferedResponse = null;
  }

  /**
   * Write a message to VNDB API.
   * While still receiving response from API, it is appended to client.bufferedResponse.
   * Resolve/reject after the response is terminated.
   */
  write(message) {
    if (!this.socket) {
      throw new Error('fails to write, client has not connected to VNDB API yet');
    }
    if (this.bufferedResponse !== null) {
      throw new Error('fails to write, client is currently still receiving response');
    }

    return new Promise((resolve, reject) => {
      this.bufferedResponse = '';

      const handleData = (response) => {
        const utf8Response = response.toString('utf8');
        this.bufferedResponse = `${this.bufferedResponse}${utf8Response}`;

        // Continue listening for response until it is terminated properly
        if (utf8Response[utf8Response.length - 1] !== terminator) {
          return;
        }

        // Resolve the message if and only if it doesn't begin with "error"
        this.bufferedResponse = this.bufferedResponse.replace(terminator, '');
        if (this.bufferedResponse.slice(0, 5) === 'error') {
          const body = JSON.parse(this.bufferedResponse.slice(5));
          const err = new VNDBError(body.id, body.msg);
          reject(err);
        } else {
          resolve(this.bufferedResponse);
        }

        // Clean up event handler
        this.socket.removeListener('data', handleData);

        // And set bufferedResponse back to null to indicate that it's ready to write again.
        this.bufferedResponse = null;
      };
      this.socket.on('data', handleData);

      this.socket.write(`${message}${terminator}`);
    });
  }

  /**
   * Add message to client queues and execute it as soon as it can.
   * "Soon" here is when all preceding messages have been executed.
   */
  exec(message) {
    if (message && message.length > 0) {
      this.queues = this.queues.concat({
        message,
        promise: createDeferredPromise(),
      });
    }

    // Defer the exec if client is still busy or not initialized yet
    if (this.bufferedResponse !== null || !this.socket || this.socket.connecting) {
      const lastItem = this.queues[this.queues.length - 1];
      return lastItem ? lastItem.promise : Promise.resolve();
    }

    // Process the first item in client.queues if exist
    const next = this.queues[0];
    if (!next) return Promise.resolve();

    this.queues = this.queues.slice(1);
    this.write(next.message)
      .then((resp) => {
        next.promise.resolve(resp);
        this.exec();
      })
      .catch((err) => {
        next.promise.reject(err);
        this.exec();
      });

    return next.promise;
  }

  /**
   * Connect and login to VNDB API.
   */
  connect(username = null, password = null, config = {}) {
    if (this.socket) {
      throw new Error('client has already connected to VNDB API');
    }

    return new Promise((resolve, reject) => {
      const connectConfig = {
        host: config.host || this._defaults.host,
        port: config.port || this._defaults.port,
      };
      this.socket = tls.connect(connectConfig);

      // Setup login process, but don't login now
      const finalConfig = {
        protocol: config.protocol || this._defaults.protocol,
        client: config.client || this._defaults.client,
        clientver: config.clientver || this._defaults.clientver,
        username,
        password,
      };
      const loginBody = Object.keys(finalConfig)
        .filter(k => finalConfig[k])
        .reduce((result, k) => {
          return Object.assign({}, result, { [k]: finalConfig[k] });
        }, {});
      const loginMessage = `login ${JSON.stringify(loginBody)}`;
      const login = () => this.write(loginMessage)
        .then(() => this.exec()) // If login is successful, dont forget to immediately exec
        .then(resolve)
        .catch(reject);

      // Once tls connects successfully, immediately login to the API
      this.socket
        .once('connect', login)
        .once('error', reject);
    });
  }

  /**
   * End the client, mainly to just clean up the socket.
   */
  end() {
    return new Promise((resolve, reject) => {
      this.socket.end();

      this.socket
        .once('end', resolve)
        .once('error', reject);
    });
  }

  /**
   * Run "dbstats" command.
   * Reference: https://vndb.org/d11#4
   */
  dbstats() {
    return this.exec('dbstats')
      .then((resp) => {
        const type = resp.split(' ')[0];
        return {
          type,
          data: JSON.parse(resp.slice(type.length + 1)),
        };
      });
  }

  /**
   * Run "get" command.
   * Reference: https://vndb.org/d11#5
   */
  get(type, flags, filters, options = {}) {
    if (!type || !flags || !filters) {
      throw new Error('fails to get. type, flags, and filters must be provided');
    }

    // Whitelist keys in options object
    const whitelistedOptions = Object.keys(options)
      .filter(opt => allowedOptions.find(allowedOpt => allowedOpt === opt))
      .reduce((result, opt) => {
        return Object.assign({}, result, { [opt]: options[opt] });
      }, {});

    const message = 'get'
      .concat(` ${type}`)
      .concat(` ${flags.join(',')}`)
      .concat(` ${filters}`)
      .concat(
        Object.keys(whitelistedOptions).length > 0 ?
          ` ${JSON.stringify(whitelistedOptions)}` :
          ''
      );

    return this.exec(message)
      .then(response => {
        const firstSpace = response.indexOf(' ');
        return {
          type: response.substring(0, firstSpace),
          data: JSON.parse(response.substring(firstSpace + 1)),
        };
      });
  }

  /**
   * Run "vn" command.
   * Reference: https://vndb.org/d11#5.1
   */
  vn(flags = defaults.vn.flags, filters = defaults.vn.filters, options = {}) {
    return this.get('vn', flags, filters, options);
  }

  /**
   * Run "release" command.
   * Reference: https://vndb.org/d11#5.2
   */
  release(flags = defaults.release.flags, filters = defaults.release.filters, options = {}) {
    return this.get('release', flags, filters, options);
  }

  /**
   * Run "producer" command.
   * Reference: https://vndb.org/d11#5.3
   */
  producer(flags = defaults.producer.flags, filters = defaults.producer.filters, options = {}) {
    return this.get('producer', flags, filters, options);
  }

  /**
   * Run "character" command.
   * Reference: https://vndb.org/d11#5.4
   */
  character(flags = defaults.character.flags, filters = defaults.character.filters, options = {}) {
    return this.get('character', flags, filters, options);
  }

  /**
   * Run "user" command.
   * Reference: https://vndb.org/d11#5.5
   */
  user(flags = defaults.user.flags, filters = defaults.user.filters, options = {}) {
    return this.get('user', flags, filters, options);
  }

  /**
   * Run "votelist" command.
   * Reference: https://vndb.org/d11#5.6
   */
  votelist(flags = defaults.votelist.flags, filters = defaults.votelist.filters, options = {}) {
    return this.get('votelist', flags, filters, options);
  }

  /**
   * Run "vnlist" command.
   * Reference: https://vndb.org/d11#5.7
   */
  vnlist(flags = defaults.vnlist.flags, filters = defaults.vnlist.filters, options = {}) {
    return this.get('vnlist', flags, filters, options);
  }

  /**
   * Run "wishlist" command.
   * Reference: https://vndb.org/d11#5.8
   */
  wishlist(flags = defaults.wishlist.flags, filters = defaults.wishlist.filters, options = {}) {
    return this.get('wishlist', flags, filters, options);
  }
}

module.exports = VNDBClient;

