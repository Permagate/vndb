const { createDeferredPromise } = require('../../lib/utils');
const { expect } = require('chai');

describe('Utils', () => {
  describe('.createDeferredPromise()', () => {
    it('should return a Promise with resolve and reject', function() {
      const promise = createDeferredPromise();
      expect(promise).to.be.an.instanceof(Promise);
      expect(promise.resolve).to.be.an.instanceof(Function);
      expect(promise.reject).to.be.an.instanceof(Function);
    });

    describe('when promise.resolve is called', () => {
      it('should resolve the promise', function* () {
        const promise = createDeferredPromise();
        promise.resolve('something');
        const result = yield promise;

        expect(result).to.equal('something');
      });
    });

    describe('when promise.reject is called', () => {
      it('should reject the promise', function* () {
        const promise = createDeferredPromise();
        promise.reject(new Error('something else'));
        const error = yield this.catchError(promise);

        expect(error).to.be.an.instanceof(Error)
          .with.property('message', 'something else');
      });
    });
  });
});

