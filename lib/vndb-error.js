/**
 * Wrapper for error that comes from VNDB API.
 * Reference: https://vndb.org/d11#7
 */
class VNDBError extends Error {
  constructor(id, msg) {
    super(msg);
    this.name = this.constructor.name;
    this.id = id;
    this.msg = msg;
    this.message = msg;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = VNDBError;

