const chai = require('chai');
const chaiThings = require('chai-things');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
require('co-mocha');
require('sinon-as-promised');

before(function () {
  chai.use(sinonChai);
  chai.use(chaiThings);
});

beforeEach(function () {
  this.sandbox = sinon.sandbox.create();

  // Helper to catch error from give promise and return it.
  // If it does not catch any, throw a fit.
  this.catchError = function* (promise) {
    try {
      yield promise;
    } catch (e) {
      return e;
    }
    throw new Error('catchError does not catch any error!');
  };
});

afterEach(function () {
  this.sandbox.restore();
});

