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
    this.stubSocket = () => {
      this.client.socket = new EventEmitter();
      this.client.socket.connecting = false;
      this.client.socket.write = this.sandbox.stub();
      this.client.socket.end = this.sandbox.stub();
      return this.client.socket;
    };

    // Helper to stub client write function
    this.stubWrite = () => {
      this.client.write = this.sandbox.stub().returns(new Promise(() => {}));
    };

    // Helper to stub client exec function
    this.stubExec = () => {
      this.client.exec = this.sandbox.stub().returns(new Promise(() => {}));
    };

    this.stubGet = () => {
      this.client.get = this.sandbox.stub().returns(new Promise(() => {}));
    };

    // Helper to stub tls.connect
    this.stubConnect = () => {
      tls.connect = this.sandbox.stub();
    };

    // Stub tls connect by default
    // To prevent real call to VNDB API.
    this.stubConnect();
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
    beforeEach(function() {
      this.stubSocket();
    });

    describe('when client.socket is not initialized yet', function() {
      it('should throw an error', function() {
        this.client.socket = null;

        expect(this.client.write.bind(this.client, 'a message'))
          .to.throw(Error);
      });
    });

    describe('when client.bufferedResponse is not null', function() {
      it('should throw an error', function() {
        this.client.bufferedResponse = 'in-progre';

        expect(this.client.write.bind(this.client, 'a message'))
          .to.throw(Error);
      });
    });

    describe('before receiving "data" event', function() {
      it('should call client.socket.write with same arg + terminator', function () {
        this.client.write('a message');

        expect(this.client.socket.write).to.have.been.calledWith(`a message${terminator}`);
      });

      it('should set client.bufferedResponse to an empty string', function () {
        this.client.write('a message');

        expect(this.client.bufferedResponse).to.equal('');
      });

      it('should register a handler to "data" event', function () {
        this.client.write('a message');

        expect(this.client.socket.listeners('data')).to.have.lengthOf(1);
      });
    });

    describe('when receiving "data" event', function() {
      describe('and it does not end with terminator character', function() {
        it('should save the response in client.bufferedResponse', function() {
          this.client.write('a message');
          this.client.bufferedResponse = 'waiting for ';
          this.client.socket.emit('data', Buffer.from('an unfinished response'));

          expect(this.client.bufferedResponse).to.equal('waiting for an unfinished response');
        });
      });

      describe('and it ends with terminator character', function() {
        describe('and the final response does not begin with "error"', function() {
          it('should resolve final response without the terminator', function* () {
            const promise = this.client.write('a message');
            this.client.bufferedResponse = 'waiting for ';
            this.client.socket.emit('data', Buffer.from(`nothing${terminator}`));

            const result = yield promise;

            expect(result).to.equal('waiting for nothing');
          });

          it('should cleanup properly', function* () {
            const promise = this.client.write('a message');
            this.client.bufferedResponse = 'waiting for ';
            this.client.socket.emit('data', Buffer.from(`nothing${terminator}`));

            yield promise;

            expect(this.client.bufferedResponse).to.equal(null);
            expect(this.client.socket.listeners('data')).to.be.empty;
          });
        });

        describe('and the final response begins with "error"', function() {
          it('should rejects the final response as a VNDBError object', function* () {
            const promise = this.client.write('a message');
            this.client.bufferedResponse = 'error {"id": "parse", "msg": "parse er';
            this.client.socket.emit('data', Buffer.from(`ror"}${terminator}`));

            const error = yield this.catchError(promise);

            expect(error).to.be.an.instanceof(VNDBError)
              .with.property('message', 'parse error');
          });

          it('should cleanup properly', function* () {
            const promise = this.client.write('a message');
            this.client.bufferedResponse = 'error {"id": "parse", "msg": "parse er';
            this.client.socket.emit('data', Buffer.from(`ror"}${terminator}`));

            yield this.catchError(promise);

            expect(this.client.bufferedResponse).to.equal(null);
            expect(this.client.socket.listeners('data')).to.be.empty;
          });
        });
      });
    });
  });

  describe('.exec', function() {
    beforeEach(function() {
      // A helper to generate this.client.queues randomly,
      // since it expects its items in certain structure.
      this.generateQueue = (count = 1) => {
        return Array(count).fill().map((_, i) => {
          return {
            message: `Message ${i}`,
            promise: utils.createDeferredPromise(),
          };
        });
      };

      this.stubSocket();
      this.stubWrite();
    });

    describe('()', function() {
      describe('when client queues is empty', function() {
        beforeEach(function() {
          this.client.queues = this.generateQueue(0);
        });

        it('should resolve undefined', function* () {
          const result = yield this.client.exec();

          expect(result).to.equal(undefined);
        });

        it('should not call .write', function* () {
          yield this.client.exec();

          expect(this.client.write).not.to.have.been.called;
        });
      });

      describe('when client queues is not empty', function() {
        beforeEach(function() {
          this.client.queues = this.generateQueue(1);
        });

        it('should return the first item promise in client queues', function() {
          const firstPromise = this.client.queues[0].promise;

          const execPromise = this.client.exec();

          expect(execPromise).to.equal(firstPromise);
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
          this.client.queues = this.generateQueue(2);
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
          const firstMessage = this.client.queues[0].message;

          this.client.exec('a message');

          expect(this.client.write).to.have.been.calledWith(firstMessage);
        });

        it('should return the first item promise in client queues', function() {
          const firstPromise = this.client.queues[0].promise;

          const execPromise = this.client.exec();

          expect(execPromise).to.equal(firstPromise);
        });
      });
    });

    describe('all args', function() {
      beforeEach(function() {
        this.client.queues = this.generateQueue(1);
      });

      describe('when executing message', function() {
        describe('and client is idle', function() {
          it('should remove the first item in client queues', function() {
            const firstMessage = this.client.queues[0].message;

            this.client.exec();

            expect(this.client.queues)
              .not.to.contain.an.item.with.property('message', firstMessage);
          });

          it('should execute the first item message in client queues', function() {
            const firstMessage = this.client.queues[0].message;

            this.client.exec();

            expect(this.client.write).to.have.been.calledWith(firstMessage);
          });
        });

        function testLazyExec() {
          it('should not remove the first item in client queues', function() {
            const firstMessage = this.client.queues[0].message;

            this.client.exec();

            expect(this.client.queues)
              .to.contain.an.item.with.property('message', firstMessage);
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
              this.client.queues = this.generateQueue(0);

              const result = yield this.client.exec();

              expect(result).to.equal(undefined);
            });
          });
        }

        describe('and client is busy', function() {
          beforeEach(function() {
            this.client.bufferedResponse = 'pending';
          });

          testLazyExec();
        });

        describe('and client has not connected yet', function() {
          beforeEach(function() {
            this.client.socket = null;
          });

          testLazyExec();
        });

        describe('and client is still connecting', function() {
          beforeEach(function() {
            this.client.socket.connecting = true;
          });

          testLazyExec();
        });
      });

      describe('when handling resolved write', function() {
        it('should pipe the result into the processed item\'s promise.resolve', function* () {
          this.client.write.resolves('write result');

          const result = yield this.client.exec();

          expect(result).to.equal('write result');
        });

        it('should call itself to process next message', function* () {
          this.client.write.resolves('write result');
          this.sandbox.spy(this.client, 'exec');

          yield this.client.exec();

          expect(this.client.exec).to.have.been.calledTwice;
        });
      });

      describe('when handling rejected write', function() {
        it('should pipe the result into the processed item\'s promise.reject', function* () {
          this.client.write.rejects('something wrong');

          const error = yield this.catchError(this.client.exec());

          expect(error).to.be.an.instanceof(Error)
            .with.property('message', 'something wrong');
        });

        it('should call itself to process next message', function* () {
          this.client.write.rejects('something wrong');
          this.sandbox.spy(this.client, 'exec');

          yield this.catchError(this.client.exec());

          expect(this.client.exec).to.have.been.calledTwice;
        });
      });
    });
  });

  describe('.connect', function() {
    beforeEach(function() {
      this.stubExec();
      this.stubWrite();

      // Make tls.connect always returns a fake socket.
      const socket = this.stubSocket();
      tls.connect.returns(socket);
      this.client.socket = null;
    });

    describe('()', function() {
      it('should connect using default configuration', function() {
        this.client.connect();

        expect(tls.connect).to.have.been.calledWith({
          host: defaults.host,
          port: defaults.port,
        });
      });

      it('should login without username and password', function () {
        this.client.connect();
        this.client.exec.resolves();

        this.client.socket.emit('connect');

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

      it('should login with provided username and password', function () {
        this.client.connect('testname', 'testpass');
        this.client.exec.resolves();

        this.client.socket.emit('connect');

        expect(this.client.write).to.have.been.calledWithMatch(
          sinon.match(/"username":"testname"/));
        expect(this.client.write).to.have.been.calledWithMatch(
          sinon.match(/"password":"testpass"/));
      });
    });

    describe('all args', function() {
      describe('client is already connected', function() {
        it('should throw error', function() {
          this.stubSocket();

          expect(this.client.connect).to.throw(Error);
        });
      });

      describe('failed to connect with tls', function() {
        it('should reject an Error', function* () {
          const promise = this.client.connect();
          this.client.socket.emit('error', new Error());

          const error = yield this.catchError(promise);

          expect(error).to.be.an.instanceof(Error);
        });
      });

      describe('failed to login with VNDB API', function() {
        it('should reject an Error', function* () {
          const promise = this.client.connect();
          this.client.write.rejects(new VNDBError());
          this.client.socket.emit('connect');

          const error = yield this.catchError(promise);

          expect(error).to.be.an.instanceof(VNDBError);
        });
      });

      describe('succeed to login with VNDB API', function() {
        beforeEach(function() {
          this.makeSuccessfulLogin = () => {
            const promise = this.client.connect();
            this.client.write.resolves();
            this.client.exec.resolves();
            this.client.socket.emit('connect');
            return promise;
          };
        });
        it('should resolve undefined', function* () {
          const result = yield this.makeSuccessfulLogin();

          expect(result).to.equal(undefined);
        });

        it('should also start executing any queued messages', function* () {
          yield this.makeSuccessfulLogin();

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

        function testConnect(client, ...args) {
          const loginMessage = getLoginMessage(...args);
          client.connect(...args);
          client.socket.emit('connect');

          expect(client.write).to.have.been.calledWith(loginMessage);
        }

        describe('with just default values (no override)', function() {
          it('should parse correctly', function* () {
            testConnect(this.client);
          });
        });

        describe('with providing username and password', function() {
          it('should parse correctly', function* () {
            testConnect(this.client, 'testuser', 'testparams');
          });
        });

        describe('with overriding config', function() {
          it('should parse correctly', function* () {
            testConnect(this.client, null, null, {
              client: 'test.com',
              clientver: 1,
            });
          });
        });

        describe('with username, password, and override config', function() {
          it('should parse correctly', function* () {
            testConnect(this.client, 'testuser', 'testparams', {
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
      this.stubSocket();
    });

    it('should end the socket', function() {
      this.client.end();

      expect(this.client.socket.end).to.have.been.called;
    });

    describe('when end is successful', function() {
      it('should resolve undefined', function* () {
        const promise = this.client.end();
        this.client.socket.emit('end');

        const result = yield promise;

        expect(result).to.equal(undefined);
      });
    });

    describe('when end is not successful', function() {
      it('should resolve undefined', function* () {
        const promise = this.client.end();
        this.client.socket.emit('error', new VNDBError());

        const error = yield this.catchError(promise);

        expect(error).to.be.an.instanceof(VNDBError);
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
    beforeEach(function() {
      this.stubExec();
    });

    describe('()', function() {
      it('should throws an Error', function() {
        expect(this.client.get.bind(this.client))
          .to.throw(Error);
      });
    });

    describe('(type)', function() {
      it('should throw an Error', function() {
        expect(this.client.get.bind(this.client, 'vn'))
          .to.throw(Error);
      });
    });

    describe('(type, flags)', function() {
      it('should throw an Error', function() {
        expect(this.client.get.bind(this.client, 'vn', ['flag1', 'flag2']))
          .to.throw(Error);
      });
    });

    describe('(type, flags, filters)', function() {
      it('should parse everything correctly', function() {
        this.client.get('vn', ['flag1', 'flag2'], '(id = 1)');

        expect(this.client.exec).to.have.been.calledWithMatch(/^get vn flag1,flag2 \(id = 1\)$/);
      });
    });

    describe('(type, flags, filters, options)', function() {
      it('should parse options correctly', function() {
        const options = {
          page: 1,
          results: 10,
          sort: 'title',
          reverse: true,
        };

        this.client.get('vn', ['flag1', 'flag2'], '(id = 1)', options);

        expect(this.client.exec).to.have.been.calledWithMatch(/"page":1/);
        expect(this.client.exec).to.have.been.calledWithMatch(/"results":10/);
        expect(this.client.exec).to.have.been.calledWithMatch(/"sort":"title"/);
        expect(this.client.exec).to.have.been.calledWithMatch(/"reverse":true/);
      });

      it('should not parse unsupported option', function() {
        const options = {
          page: 1,
          invalid: true,
          sort: 'title',
        };

        this.client.get('vn', ['flag1', 'flag2'], '(id = 1)', options);

        expect(this.client.exec).not.to.have.been.calledWithMatch(/invalid/);
      });
    });

    describe('when exec is successful', function() {
      it('should resolve the response as correct object', function* () {
        this.client.exec.resolves('results {"num": 0,"more": false, "items":[]}');

        const result = yield this.client.get('vn', ['basic'], '(id = 1)');

        expect(result).to.deep.equal({
          type: 'results',
          data: {
            num: 0,
            more: false,
            items: [],
          },
        });
      });
    });

    describe('when exec is failed', function() {
      it('should rejects the error', function* () {
        this.client.exec.rejects(new VNDBError());

        const error = yield this.catchError(this.client.get('vn', ['basic'], '(id = 1)'));

        expect(error).to.be.an.instanceof(VNDBError);
      });
    });
  });

  /**
   * Get command of any type usually has the exact same signature and return.
   * What makes them different is only the type and the default values of other modifiers.
   */
  function testGet(type) {
    beforeEach(function() {
      this.stubGet();
    });

    describe('()', function() {
      it('should provide default arguments for get function', function() {
        this.client[type]();

        expect(this.client.get).to
          .have.been.calledWith(type, sinon.match.array, sinon.match.string);
      });
    });

    describe('(flags, filters, options)', function() {
      it('should use the provided arguments for get function', function() {
        const args = [['basic'], '(id = 1)', { page: 1, results: 20 }];

        this.client[type](...args);

        expect(this.client.get).to
          .have.been.calledWith(type, ...args);
      });
    });

    describe('all args', function() {
      it('should just return the promise provided by get function', function() {
        const getPromise = new Promise(() => {});
        this.client.get = this.sandbox.stub().returns(getPromise);

        const result = this.client[type]();

        expect(result).to.equal(getPromise);
      });
    });
  }

  describe('.vn', function() {
    testGet('vn');
  });

  describe('.release', function() {
    testGet('release');
  });

  describe('.producer', function() {
    testGet('producer');
  });

  describe('.character', function() {
    testGet('character');
  });

  describe('.user', function() {
    testGet('user');
  });

  describe('.votelist', function() {
    testGet('votelist');
  });

  describe('.vnlist', function() {
    testGet('vnlist');
  });

  describe('.wishlist', function() {
    testGet('wishlist');
  });
});

