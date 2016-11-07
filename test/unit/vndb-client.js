const { expect } = require('chai');
const EventEmitter = require('events');
const sinon = require('sinon');
const tls = require('tls');
const VNDBClient = require('../../lib/vndb-client');
const VNDBError = require('../../lib/vndb-error');
const { defaults, terminator } = require('../../lib/vndb-constants');
const utils = require('../../lib/utils');

describe('VNDBClient', function() {
  beforeEach(function() {
    this.client = new VNDBClient();

    // Helper to stub client socket that is usually created with tls.connect.
    this.stubSocket = (isEndSuccessful) => {
      this.client.socket = new EventEmitter();
      this.client.socket.connecting = false;
      this.client.socket.write = this.sandbox.stub();
      this.client.socket.end = () => {};
      this.sandbox.stub(this.client.socket, 'end', () => {
        const emitEvent = isEndSuccessful ?
          () => this.client.socket.emit('end') :
          () => this.client.socket.emit('error', new Error());
        setTimeout(emitEvent);
      });
    };

    // Helper to stub client write function
    this.stubWrite = () => {
      this.client.write = this.sandbox.stub().returns(new Promise(() => {}));
    };

    // Helper to stub client exec function
    this.stubExec = () => {
      this.client.exec = this.sandbox.stub().returns(new Promise(() => {}));
    };

    // Helper to stub tls.connect
    this.stubConnect = (isSuccessful) => {
      if (tls.connect.restore) tls.connect.restore();
      this.sandbox.stub(tls, 'connect', () => {
        const socket = new EventEmitter();
        const eventName = isSuccessful ? 'connect' : 'error';

        // Emit process/error on next cycle,
        // So that the client has a chance to register their handlers to the socket.
        setTimeout(() => socket.emit(eventName, new Error()));

        return socket;
      });
    };

    // Helper to stub login execution
    this.stubLogin = (isSuccessful) => {
      if (this.client.write.restore) this.client.write.restore();
      this.sandbox.stub(this.client, 'write', () => {
        const promise = new Promise((resolve, reject) => {
          if (isSuccessful) resolve();
          else reject(new VNDBError('generic', 'something happened'));
        });
        promise.catch(e => e);
        return promise;
      });
    };

    // Stub tls connect by default
    // To prevent real call to VNDB API.
    this.stubConnect(true);
  });

  describe('constructor', function() {
    it('should set default values from constants file', function() {
      expect(this.client._defaults).to.deep.equal(defaults);
    });

    it('should initialize an empty queue', function() {
      expect(this.client.queues).to.be.an('array').that.is.empty;
    });

    it('should initialize an empty socket', function() {
      expect(this.client.socket).not.to.exist;
    });

    it('should initialize a null bufferedResponse', function() {
      expect(this.client.bufferedResponse).to.equal(null);
    });
  });

  describe('.write(message)', function() {
    describe('when client.socket is not initialized yet', function() {
      it('should throw an error', function() {
        this.client.socket = null;

        expect(this.client.write.bind(this.client, 'a message'))
          .to.throw(Error);
      });
    });

    describe('when client.bufferedResponse is not null', function() {
      it('should throw an error', function() {
        this.client.socket = new EventEmitter();
        this.client.bufferedResponse = 'in-progre';

        expect(this.client.write.bind(this.client, 'a message'))
          .to.throw(Error);
      });
    });

    beforeEach(function() {
      this.stubSocket();
      this.promise = this.client.write('a message');
    });

    it('should call client.socket.write with same arg + terminator', function() {
      expect(this.client.socket.write).to.have.been.calledWith(`a message${terminator}`);
    });

    it('should set client.bufferedResponse to an empty string', function() {
      expect(this.client.bufferedResponse).to.equal('');
    });

    it('should register a handler to "data" event', function() {
      expect(this.client.socket.listeners('data')).to.have.lengthOf(1);
    });

    describe('on handling "data" event', function() {
      describe('when receiving a response that does not end with terminator character', function() {
        it('should save the response in client.bufferedResponse in utf8 format', function() {
          this.client.bufferedResponse = 'waiting for ';
          this.client.socket.emit('data', Buffer.from('an unfinished response'));
          expect(this.client.bufferedResponse).to.equal('waiting for an unfinished response');
        });
      });

      describe('when receiving a response that ends with terminator character', function() {
        function testCommonBehavior() {
          it('should set client.bufferedResponse back to null', function() {
            expect(this.client.bufferedResponse).to.equal(null);
          });

          it('should deregister the "data" event handler', function() {
            expect(this.client.socket.listeners('data')).to.be.empty;
          });
        }

        describe('and the final response does not begin with "error"', function() {
          beforeEach(function() {
            this.client.bufferedResponse = 'waiting for ';
            this.client.socket.emit('data', Buffer.from(`nothing${terminator}`));
          });

          testCommonBehavior();

          it('should resolve final response as utf8 string without the terminator', function* () {
            const result = yield this.promise;
            expect(result).to.equal('waiting for nothing');
          });
        });

        describe('and the final response begins with "error"', function() {
          beforeEach(function() {
            this.client.bufferedResponse = 'error {"id": "parse", "msg": "parse er';
            this.client.socket.emit('data', Buffer.from(`ror"}${terminator}`));
            this.promise.catch(e => e);
          });

          testCommonBehavior();

          it('should rejects the final response as a VNDBError object', function* () {
            const error = yield this.catchError(this.promise);

            expect(error).to.be.an.instanceof(VNDBError);
          });
        });
      });
    });
  });

  describe('.exec', function() {
    beforeEach(function() {
      this.client.bufferedResponse = null;
      this.stubSocket();
      this.stubWrite();
    });

    // A helper to generate this.client.queues randomly,
    // since it expects its items in certain structure.
    const generateQueue = (count = 1) => {
      return Array(count).fill().map((_, i) => {
        return {
          message: `Message ${i}`,
          promise: utils.createDeferredPromise(),
        };
      });
    };

    describe('()', function() {
      describe('when client queues is empty', function() {
        beforeEach(function() {
          this.client.queues = generateQueue(0);
        });

        it('should resolve undefined', function* () {
          const result = yield this.client.exec();

          expect(result).to.equal(undefined);
        });

        it('should not call .write', function() {
          this.client.exec();
          expect(this.client.write).not.to.have.been.called;
        });
      });

      describe('when client queues is not empty', function() {
        beforeEach(function() {
          this.client.queues = generateQueue(1);
          this.itemToExec = this.client.queues[0];
        });

        it('should return the first item promise in client queues', function() {
          const result = this.client.exec();
          expect(result).to.equal(this.itemToExec.promise);
        });

        it('should call .write', function() {
          this.client.exec();
          expect(this.client.write).to.have.been.called;
        });
      });
    });

    describe('(message)', function() {
      it('should call .write', function() {
        this.client.exec('a message');
        expect(this.client.write).to.have.been.called;
      });

      describe('when client queues is not empty', function() {
        beforeEach(function() {
          this.client.queues = generateQueue(2);
          this.itemToExec = this.client.queues[0];
        });

        it('should queue the message into the last of client queues', function() {
          this.client.exec('a message');
          expect(this.client.queues[this.client.queues.length - 1]).to.have.property('message', 'a message');
        });

        it('should not call .write with the provided message', function() {
          this.client.exec('a message');
          expect(this.client.write).not.to.have.been.calledWith('a message');
        });

        it('should call .write with the first item message in queue', function() {
          this.client.exec('a message');
          expect(this.client.write).to.have.been.calledWith(this.itemToExec.message);
        });

        it('should return the first item promise in client queues', function() {
          const result = this.client.exec();
          expect(result).to.equal(this.itemToExec.promise);
        });
      });
    });

    describe('all args', function() {
      beforeEach(function() {
        this.client.queues = generateQueue(1);
        this.itemToExec = this.client.queues[0];
      });

      describe('on executing message', function() {
        describe('when client is idle', function() {
          beforeEach(function() {
            this.client.bufferedResponse = null;
          });

          it('should remove the first item in client queues', function() {
            this.client.exec();
            expect(this.client.queues)
              .not.to.contain.an.item.with.property('message', this.itemToExec.message);
          });

          it('should execute the first item message in client queues', function() {
            this.client.exec();
            expect(this.client.write).to.have.been.calledWith(this.itemToExec.message);
          });
        });

        function testLazyExec() {
          it('should not remove the first item in client queues', function() {
            this.client.exec();
            expect(this.client.queues)
              .to.contain.an.item.with.property('message', this.itemToExec.message);
          });

          it('should not wite any message', function() {
            this.client.exec();
            expect(this.client.write).not.to.have.been.called;
          });

          it('should still return a promise', function() {
            const promise = this.client.exec();
            expect(promise).to.be.an.instanceof(Promise);
          });

          describe('and no items left in client queues', function() {
            it('should resolve undefined', function* () {
              this.client.queues = generateQueue(0);
              const result = yield this.client.exec();
              expect(result).to.equal(undefined);
            });
          });
        }

        describe('when client is busy', function() {
          beforeEach(function() {
            this.client.bufferedResponse = 'pending';
          });

          testLazyExec();
        });

        describe('when client has not connected yet', function() {
          beforeEach(function() {
            this.client.socket = null;
          });

          testLazyExec();
        });

        describe('when client is still connecting', function() {
          beforeEach(function() {
            this.client.socket.connecting = true;
          });

          testLazyExec();
        });
      });

      describe('on handling client.write fulfillment', function() {
        describe('on client.write promise resolved', function() {
          beforeEach(function() {
            this.client.write.resolves('write result');
          });

          it('should pipe the result into the processed item\'s promise.resolve', function* () {
            this.client.exec();
            const result = yield this.itemToExec.promise;

            expect(result).to.equal('write result');
          });

          it('should call itself to process next message', function() {
            this.sandbox.spy(this.client, 'exec');
            this.client.exec().then(() => {
              expect(this.client.exec).to.have.been.calledTwice;
            });
          });
        });

        describe('on client.write promise rejected', function() {
          beforeEach(function() {
            this.client.write.rejects('something wrong');
          });

          it('should pipe the result into the processed item\'s promise.reject', function* () {
            const error = yield this.catchError(this.client.exec());

            expect(error).to.be.an.instanceof(Error)
              .with.property('message', 'something wrong');
          });

          it('should call itself to process next message', function() {
            this.sandbox.spy(this.client, 'exec');
            this.client.exec().catch(() => {
              expect(this.client.exec).to.have.been.calledTwice;
            });
          });
        });
      });
    });
  });

  describe('.connect', function() {
    beforeEach(function() {
      this.stubExec();
      this.stubLogin(true);
    });

    describe('()', function() {
      it('should connect using default configuration', function() {
        this.client.connect();

        expect(tls.connect).to.have.been.calledWith({
          host: defaults.host,
          port: defaults.port,
        });
      });

      it('should login without username and password', function* () {
        this.client.exec.resolves();
        yield this.client.connect();

        expect(this.client.write).not.to.have.been.calledWithMatch(
          sinon.match(/"username":"testuser"/));
        expect(this.client.write).not.to.have.been.calledWithMatch(
          sinon.match(/"password":"testpass"/));
      });
    });

    describe('(username, password, config)', function() {
      it('should connect using overrided configuration', function() {
        this.client.connect('testname', 'testpass', {
          host: 'test.com',
          client: 'myclient',
        });

        expect(tls.connect).to.have.been.calledWith({
          host: 'test.com',
          port: defaults.port,
        });
      });

      it('should login with provided username and password', function* () {
        this.client.exec.resolves();
        yield this.client.connect('testname', 'testpass');

        expect(this.client.write).to.have.been.calledWithMatch(
          sinon.match(/"username":"testname"/));
        expect(this.client.write).to.have.been.calledWithMatch(
          sinon.match(/"password":"testpass"/));
      });
    });

    describe('all args', function() {
      describe('client is already connected', function() {
        it('should throw error', function() {
          this.client.socket = new EventEmitter();

          expect(this.client.connect).to.throw(Error);
        });
      });

      describe('failed to connect with tls', function() {
        it('should reject an Error', function* () {
          this.stubConnect(false);
          const error = yield this.catchError(this.client.connect());

          expect(error).to.be.an.instanceof(Error);
        });
      });

      describe('failed to login with VNDB API', function() {
        it('should reject an Error', function* () {
          this.stubLogin(false);
          const error = yield this.catchError(this.client.connect());

          expect(error).to.be.an.instanceof(VNDBError);
        });
      });

      describe('succeed to login with VNDB API', function() {
        it('should resolve undefined', function* () {
          this.stubLogin(true);
          this.client.exec.resolves();
          const result = yield this.client.connect();
          expect(result).to.equal(undefined);
        });

        it('should also start executing any queued messages', function* () {
          this.stubLogin(true);
          this.client.exec.resolves();
          yield this.client.connect();

          expect(this.client.exec).to.have.been.called;
          expect(this.client.exec).to.have.been.calledWith();
        });
      });

      describe('on converting arguments to correct login message', function() {
        function getLoginMessage(username, password, others = {}) {
          // Mandatory login body
          const loginBody = {
            protocol: others.protocol || defaults.protocol,
            client: others.client || defaults.client,
            clientver: others.clientver || defaults.clientver,
          };

          // Optional login body
          if (username) loginBody.username = username;
          if (password) loginBody.password = password;

          return `login ${JSON.stringify(loginBody)}`;
        }

        function* testConnect(client, ...args) {
          const loginMessage = getLoginMessage(...args);
          client.exec.resolves();
          yield client.connect(...args);

          expect(client.write).to.have.been.calledWith(loginMessage);
        }

        describe('with just default values (no override)', function() {
          it('should parse correctly', function* () {
            yield testConnect(this.client);
          });
        });

        describe('with providing username and password', function() {
          it('should parse correctly', function* () {
            yield testConnect(this.client, 'testuser', 'testparams');
          });
        });

        describe('with overriding config', function() {
          it('should parse correctly', function* () {
            yield testConnect(this.client, null, null, {
              client: 'test.com',
              clientver: 1,
            });
          });
        });

        describe('with username, password, and override config', function() {
          it('should parse correctly', function* () {
            yield testConnect(this.client, 'testuser', 'testparams', {
              client: 'test.com',
              clientver: 1,
            });
          });
        });
      });
    });
  });

  describe('.end()', function() {
    beforeEach(function() {
      // Defaults to successful end
      this.stubSocket(true);
    });

    it('should end the socket', function() {
      this.client.end();

      expect(this.client.socket.end).to.have.been.called;
    });

    describe('when end is successful', function() {
      it('should resolve undefined', function* () {
        const result = yield this.client.end();

        expect(result).to.equal(undefined);
      });
    });

    describe('when end is not successful', function() {
      it('should resolve undefined', function* () {
        this.stubSocket(false);
        const error = yield this.catchError(this.client.end());

        expect(error).to.be.an.instanceof(Error);
      });
    });
  });

  describe('.dbstats()', function() {
    beforeEach(function() {
      this.stubExec();
    });

    it('should execute correct message', function() {
      this.client.dbstats();

      expect(this.client.exec).to.have.been.calledWith('dbstats');
    });

    describe('when exec is successful', function() {
      it('should resolve the response as correct object', function* () {
        this.client.exec.resolves('dbstats {"users":1000,"vn":2000}');
        const result = yield this.client.dbstats();

        expect(result).to.deep.equal({
          type: 'dbstats',
          data: {
            users: 1000,
            vn: 2000,
          },
        });
      });
    });

    describe('when exec is failed', function() {
      it('should rejects the error', function* () {
        this.client.exec.rejects(new VNDBError());
        const error = yield this.catchError(this.client.dbstats());

        expect(error).to.be.an.instanceof(VNDBError);
      });
    });
  });

  describe('.get', function() {
    describe('(type)', function() {
    });

    describe('(type, flags, filters, options)', function() {
    });
  });

  describe('.vn', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.release', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.producer', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.character', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.user', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.votelist', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.vnlist', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });

  describe('.wishlist', function() {
    describe('()', function() {
    });

    describe('(flags, filters, options)', function() {
    });
  });
});

