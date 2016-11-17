/**
 * A factory that creates native Promise with resolve and reject functions attached,
 * so that the execution can be deferred.
 */
function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((pResolve, pReject) => {
    resolve = pResolve;
    reject = pReject;
  });
  return Object.assign(promise, { resolve, reject });
}

module.exports = {
  createDeferredPromise,
};

